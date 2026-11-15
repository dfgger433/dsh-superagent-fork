/** Host coordinator: only a real Session selecting the Router preset mounts the deployment. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import { Runtime } from './app/runtime.ts'
import { RouterController } from './app/router-controller.ts'
import { ROUTER_PRESET } from './app/sessions.ts'
import { sameOrigin } from './app/http.ts'
import { Config, machineOf, type DeploymentConfig } from './deployment.ts'

export const name = 'dsh-superagent'
export const inject = ['agents', 'agentPresets', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'llm', 'subprocess']
export { Config }
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  const machine = machineOf(config)
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let activeRuntime: Runtime | undefined
  let activationError: string | undefined
  let transferring = false
  const blocked = new Map<Agent, (() => void)[]>()
  const explain = (agent: Agent, reason: string) => {
    if (blocked.has(agent)) return
    const disposers = [agent.ctx.tools.restrict({ allow: [] }), agent.ctx.systemPrompt.section({
      name: 'superagent-router-unavailable', order: 9999, text: `Superagent is unavailable in this Session: ${reason}. Explain this to the user. Do not execute or route work from here.`,
    })]
    blocked.set(agent, disposers)
  }
  const controller = new RouterController<Agent>(async agent => {
    let runtime: Runtime | undefined
    const restart = () => { ctx.fiber.restart().then(() => { ctx.get('settings')?.describe() }).catch(error => ctx.logger.error(String(error))) }
    const mounted = ctx.plugin({ name: 'superagent-active-deployment', inject, apply(child: Context) {
      runtime = activeRuntime = new Runtime(child, machine, restart, agent)
      child.effect(() => async () => { await runtime!.stop(); if (activeRuntime === runtime) activeRuntime = undefined })
      return runtime.ready
    } })
    try { await mounted.await() }
    catch (error) { await mounted.dispose(); throw error }
    return { stop: async () => { await mounted.dispose() } }
  }, (agent, owner) => explain(agent, `This deployment already belongs to Router Session ${owner}; reopen it, or use a different stateDir`))
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('Superagent requires a loopback Web server')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/superagent-status', handler: async (req, res) => {
    if (!sameOrigin(req, ctx.webServer.port)) { res.writeHead(403); res.end(); return }
    if (req.method === 'POST') {
      if (transferring) { res.writeHead(409); res.end(JSON.stringify({ error: 'Router transfer already in progress' })); return }
      transferring = true
      try {
        let body = ''
        for await (const chunk of req) { body += String(chunk); if (Buffer.byteLength(body) > 4096) throw new Error('Request is too large') }
        const value = JSON.parse(body) as { sessionId?: unknown }
        if (typeof value.sessionId !== 'string' || !value.sessionId || Object.keys(value).some(key => key !== 'sessionId')) throw new Error('Expected a Router sessionId')
        const resolved = await ctx.sessionController.resolveAgent(value.sessionId as Agent['id'])
        if ('error' in resolved) throw new Error('Target Session is unavailable')
        if (!selected(resolved.agent)) throw new Error('Target must be a root Session using the Superagent Router preset')
        const owner = activeRuntime
        if (owner && owner.masterId !== resolved.agent.id) {
          owner.transferRouter(resolved.agent.id)
          await controller.release(owner.masterId)
        }
        for (const dispose of blocked.get(resolved.agent) ?? []) dispose()
        blocked.delete(resolved.agent)
        await activate(resolved.agent)
        if (activationError) throw new Error(activationError)
      } catch (error) {
        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: String(error) })); return
      } finally { transferring = false }
    } else if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ...controller.status(), ...(activationError ? { error: activationError } : {}),
      ...(activeRuntime ? { sessionId: activeRuntime.masterId, configured: activeRuntime.configured(), paused: activeRuntime.store.settings().paused } : {}) }))
  } }))
  const selected = (agent: Agent): boolean => {
    const presets = ctx.get('agentPresets') as { presetForSession(session: Agent['session']): string | null }
    return !agent.session.header.parentSession && (presets.presetForSession(agent.session) ?? agent.session.header.agentPreset) === ROUTER_PRESET
  }
  const activate = async (agent: Agent) => {
    try { await controller.use(agent); activationError = undefined }
    catch (error) { activationError = String(error); ctx.logger.error('Superagent activation failed: %s', String(error)); explain(agent, String(error)) }
  }
  ctx.on('agent/created', async ({ agent }) => { if (selected(agent)) await activate(agent) })
  ctx.on('agent-preset/selected', (id, preset) => {
    const agent = ctx.agents.get(id as Agent['id'])
    if (agent && !agent.session.header.parentSession && preset === ROUTER_PRESET) return activate(agent)
    if (agent && preset !== ROUTER_PRESET) {
      for (const dispose of blocked.get(agent) ?? []) dispose()
      blocked.delete(agent)
      return controller.release(id)
    }
  })
  ctx.on('agent/disposed', async ({ agent }) => {
    for (const dispose of blocked.get(agent) ?? []) dispose()
    blocked.delete(agent)
    await controller.release(agent.id)
  })
  ctx.effect(() => async () => {
    await controller.stop()
    for (const disposers of blocked.values()) for (const dispose of disposers) dispose()
    blocked.clear()
  })
  for (const agent of ctx.agents.list()) if (selected(agent)) await activate(agent)
  ctx.logger.info('Superagent installed; select Superagent Router in a new Session to activate this deployment')
}
export type { Deployment, DeploymentConfig } from './deployment.ts'
export * from './core/index.ts'
