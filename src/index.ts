/** Each root Session selecting Superagent owns an isolated Runtime; there is no shared Router owner. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import { Store, type GlobalConfigurationChange } from './app/store.ts'
import { Runtime } from './app/runtime.ts'
import { RouterController } from './app/router-controller.ts'
import { ROUTER_PRESET, LEGACY_WORKER_PRESETS } from './app/sessions.ts'
import { protectRouter } from './app/router-boundary.ts'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { registerGlobalSettingsHttp, sameOrigin } from './app/http.ts'
import { Config, machineOf, type DeploymentConfig } from './deployment.ts'
import { key } from './core/ids.ts'
import * as githubSource from './sources/github.ts'
import * as feishuSource from './sources/feishu.ts'
import { workerModuleDiagnostics } from './worker-composition.ts'

export const name = 'dsh-superagent'
export const inject = ['agents', 'agentPresets', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'llm', 'subprocess']
export { Config }
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  const machine = machineOf(config)
  const configurationDir = join(machine.stateDir, 'global-config')
  mkdirSync(configurationDir, { recursive: true, mode: 0o700 })
  const releaseConfigurationLock = lockSync(configurationDir, { stale: 30_000 })
  const configuration = new Store(join(configurationDir, 'settings.sqlite'), error => ctx.logger.warn('dsh-superagent global settings: %s', String(error)))
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const runtimes = new Map<string, Runtime>()
  const errors = new Map<string, string>()
  const configurationListener = async (source: Store, change: GlobalConfigurationChange) => {
    const targets = [...runtimes.values()].filter(runtime => runtime.store !== source)
    const results = await Promise.allSettled(targets.map(runtime => runtime.applyGlobalConfigurationChange(change)))
    for (const result of results) if (result.status === 'rejected') ctx.logger.warn('dsh-superagent could not apply shared configuration: %s', String(result.reason))
  }
  const protectedRoots = new Map<Agent, () => void>()
  const notices = new Map<Agent, () => void>()
  const protect = (agent: Agent) => {
    if (!protectedRoots.has(agent)) protectedRoots.set(agent, protectRouter(agent, () => runtimes.get(agent.id)?.routerToolNames ?? new Map()))
  }
  // Only this coordinator is global: it resolves an owned Worker environment without sharing Runtime services or state.
  ctx.provide('superagentCoordinator', { environmentFor(id: string) {
    for (const runtime of runtimes.values()) { const env = runtime.environmentFor(id); if (env) return env }
    return undefined
  } })
  ctx.effect(() => registerGlobalSettingsHttp(ctx, () => runtimes.values().next().value?.managementHost(), machine.stateDir))
  const controller = new RouterController<Agent>(async agent => {
    const isolated = ctx.isolate('orchestrator')
    let runtime: Runtime | undefined
    const restart = () => {
      void controller.restart(agent, () => ctx.agents.get(agent.id) === agent && selected(agent))
        .then(() => { ctx.get('settings')?.describe() })
        .catch(error => { errors.set(agent.id, String(error)); ctx.logger.error(String(error)) })
    }
    const mounted = isolated.plugin({ name: 'superagent-session-deployment', inject, apply(child: Context) {
      // Configuration limits are profile-wide volatile references; do not freeze them per Session.
      const perSession = { ...machine, stateDir: join(machine.stateDir, 'sessions', key(agent.id)) }
      runtime = new Runtime(child, perSession, restart, agent, true, configuration, configurationListener)
      runtimes.set(agent.id, runtime)
      child.effect(() => async () => {
        try { await runtime!.stop() }
        finally { if (runtimes.get(agent.id) === runtime) runtimes.delete(agent.id) }
      })
      // Each Source resolves the same isolated orchestrator provider, so configuration and cursors cannot cross Sessions.
      const github = child.plugin(githubSource), feishu = child.plugin(feishuSource)
      return Promise.all([runtime.ready, github.await(), feishu.await()]).then(() => undefined)
    } })
    try { await mounted.await() } catch (error) { await mounted.dispose(); throw error }
    return { stop: async () => { await mounted.dispose() } }
  })
  const selected = (agent: Agent): boolean => {
    const presets = ctx.get('agentPresets') as { presetForSession(session: Agent['session']): string | null }
    const preset = presets.presetForSession(agent.session) ?? agent.session.header.agentPreset
    return !agent.session.header.parentSession && !agent.id.startsWith('worker-') && (preset === ROUTER_PRESET || LEGACY_WORKER_PRESETS.includes(preset as never))
  }
  const activate = async (agent: Agent) => {
    protect(agent)
    try {
      const presets = ctx.get('agentPresets') as { presetForSession(session: Agent['session']): string | null; recompose(ctx: Context, id: string): Promise<unknown> }
      const previous = presets.presetForSession(agent.session) ?? agent.session.header.agentPreset
      if (LEGACY_WORKER_PRESETS.includes(previous as never)) {
        agent.cancel({ kind: 'user' }, { keepInbox: true }); await agent.whenIdle()
        await presets.recompose(agent.ctx, ROUTER_PRESET)
        ;(agent.session as unknown as { append(type: string, value: { agentPreset: string }): void }).append('agent-preset/selected', { agentPreset: ROUTER_PRESET })
      }
      await controller.use(agent)
      errors.delete(agent.id); notices.get(agent)?.(); notices.delete(agent)
    } catch (error) {
      errors.set(agent.id, String(error)); ctx.logger.error('Superagent Session %s: %s', agent.id, String(error))
      if (!notices.has(agent)) notices.set(agent, agent.ctx.systemPrompt.section({ name: 'superagent-unavailable', order: 10000,
        text: `Superagent initialization failed for this Session: ${String(error)}. Explain the problem; do not execute work directly.` }))
    }
  }
  const describe = (id: string) => {
    const runtime = runtimes.get(id)
    return { ...controller.status(id), ...(errors.has(id) ? { error: errors.get(id) } : {}),
      ...(runtime ? { stateDir: runtime.machine.stateDir, configured: runtime.configured(), local: runtime.configured() && !!runtime.deployment.local, paused: runtime.store.settings().paused } : {}) }
  }
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('Superagent requires a loopback Web server')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/superagent-status', handler: async (req, res) => {
    if (!sameOrigin(req, ctx.webServer.port)) { res.writeHead(403); res.end(); return }
    let targetId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')
    if (req.method === 'POST') {
      try {
        let body = ''; for await (const chunk of req) { body += String(chunk); if (Buffer.byteLength(body) > 4096) throw new Error('Request is too large') }
        const value = JSON.parse(body) as { sessionId?: unknown }
        if (typeof value.sessionId !== 'string' || !value.sessionId || Object.keys(value).some(k => k !== 'sessionId')) throw new Error('Expected a Superagent sessionId')
        const resolved = await ctx.sessionController.resolveAgent(value.sessionId as Agent['id'])
        if ('error' in resolved || !selected(resolved.agent)) throw new Error('Target must be a root Session using Superagent')
        await activate(resolved.agent); targetId = resolved.agent.id
        if (errors.has(targetId)) throw new Error(errors.get(targetId))
      } catch (error) { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })); return }
    } else if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
    const target = targetId ? ctx.agents.get(targetId as Agent['id']) : undefined
    const inspection = target && selected(target) ? { inspectedSessionId: target.id,
      routerTools: (target.ctx.tools as unknown as { definitions?: (scope: unknown) => { name: string }[] }).definitions?.(scopeOf(target.ctx)).map(tool => tool.name) ?? [] } : {}
    const result = targetId ? { ...describe(targetId), ...inspection } : {
      state: runtimes.size ? 'active' : 'inactive', instances: [...new Set([...runtimes.keys(), ...errors.keys()])].map(describe),
    }
    let diagnostics = {}
    if (new URL(req.url ?? '/', 'http://localhost').searchParams.get('diagnostics') === 'workers') {
      try { diagnostics = { workerModules: workerModuleDiagnostics() } }
      catch (error) { diagnostics = { workerModules: { error: String(error) } } }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ...result, ...diagnostics }))
  } }))
  ctx.on('agent/created', async ({ agent }) => { if (selected(agent)) await activate(agent) })
  ctx.on('agent-preset/selected', (id, preset) => {
    const agent = ctx.agents.get(id as Agent['id'])
    if (agent && selected(agent)) return activate(agent)
    if (agent && preset !== ROUTER_PRESET) {
      errors.delete(id)
      protectedRoots.get(agent)?.(); protectedRoots.delete(agent)
      notices.get(agent)?.(); notices.delete(agent)
      return controller.release(id)
    }
  })
  ctx.on('agent/disposed', async ({ agent }) => {
    errors.delete(agent.id)
    protectedRoots.get(agent)?.(); protectedRoots.delete(agent)
    notices.get(agent)?.(); notices.delete(agent)
    await controller.release(agent.id)
  })
  ctx.effect(() => async () => {
    const failures: unknown[] = []
    try { await controller.stop() } catch (error) { failures.push(error) }
    finally {
      for (const release of protectedRoots.values()) release()
      for (const release of notices.values()) release()
      protectedRoots.clear(); notices.clear(); errors.clear()
      try { configuration.close() } catch (error) { failures.push(error) }
      try { releaseConfigurationLock() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Superagent coordinator shutdown had cleanup failures')
  })
  await Promise.all(ctx.agents.list().filter(selected).map(activate))
  ctx.logger.info('Superagent ready: each selected root Session owns an independent instance')
}
export type { Deployment, DeploymentConfig } from './deployment.ts'
export * from './core/index.ts'
