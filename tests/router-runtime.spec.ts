/** User-owned Router integration through real Engine, Store, Effects and Worker adapters. */
import { afterEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import { KV } from '../src/kv.ts'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { Config } from '../src/deployment.ts'

it('boots the actual Host and Runtime from fresh default configuration and serves settings before GitHub setup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-first-install-'))
  const root = new Context(), agentCtx = new Context()
  const registered = new Map<string, unknown>()
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  agentCtx.reflect.provide('tools', { register: (tool: { name: string }) => { registered.set(tool.name, tool); return () => registered.delete(tool.name) },
    get: () => undefined, restrict: () => () => {}, guard: () => () => {} })
  agentCtx.reflect.provide('skills', { register: () => () => {} })
  agentCtx.reflect.provide('systemPrompt', { section: () => () => {} })
  const agent = { id: 'fresh-router', ctx: agentCtx, status: 'idle', session: { header: { agentPreset: 'dsh-superagent-router' }, snapshotEvents: () => [] }, cancel: () => {}, whenIdle: async () => {} }
  const target = { ...agent, id: 'target-router' }
  const services = {
    subprocess: {}, sessionController: { resolveAgent: async (id: string) => id === target.id ? { agent: target } : { error: { code: 'session/not-found' } } }, workspaceRegistry: {}, permissionPresets: {}, tools: {}, systemPrompt: {}, skills: {}, llm: {},
    agents: { list: () => [agent], get: (id: string) => id === agent.id ? agent : undefined },
    agentPresets: { presetForSession: () => 'dsh-superagent-router' },
    webServer: { host: '127.0.0.1', port: 1234, register: (route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
      routes.set(route.path, route.handler); return () => routes.delete(route.path)
    } }, sessionPersistence: { flush: async () => {} },
  }
  for (const [key, value] of Object.entries(services)) root.reflect.provide(key, value)
  // Parse the exact empty configuration a fresh bundle row supplies, isolating only its state directory.
  const config = Config({})
  config.stateDir = dir
  const plugin = root.plugin({ name: 'first-install-smoke', apply: ctx => apply(ctx, config) })
  try {
    await plugin.await()
    const call = async (path: string, route: string, body?: unknown) => {
      let status = 0, text = ''
      await routes.get(route)!({ method: body ? 'POST' : 'GET', url: path, headers: { host: '127.0.0.1:1234', 'x-orchestrator-request': '1' },
        async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) } },
        { writeHead: (code: number) => { status = code }, end: (value: string) => { text = value } })
      return { status, value: JSON.parse(text) }
    }
    const activation = await call('/superagent-status', '/superagent-status')
    expect(activation.value.error).toBeUndefined()
    expect(activation).toMatchObject({ status: 200, value: { state: 'active', configured: true, local: true, sessionId: 'fresh-router' } })
    expect(registered.has('orchestrator_chat_intake')).toBe(true)
    expect(await call('/orchestrator/api/state', '/orchestrator')).toMatchObject({ status: 200, value: { setup: { problem: null } } })
    expect(await call('/superagent-status', '/superagent-status', { sessionId: target.id })).toMatchObject({ status: 200, value: { sessionId: target.id } })
    expect(await call('/superagent-status', '/superagent-status', { sessionId: 'missing' })).toMatchObject({ status: 409 })
  } finally { await plugin.dispose(); await agentCtx.fiber.dispose(); rmSync(dir, { recursive: true, force: true }) }
})
let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
it('executes a local-only ticket without any remote account, CLI probe, Git repository or remote call', async () => {
  h = await startRuntime(undefined, true, true)
  const { runtime } = h
  expect(runtime.configured()).toBe(true)
  expect(runtime.deployment.local).toBe(true)
  expect(runtime.setupProblem).toBeUndefined()
  expect(h.subprocess.spawn).not.toHaveBeenCalled()
  expect(runtime.context({ kind: 'github', health: ['github'] }).configured()).toBe(false)
  expect(runtime.context({ kind: 'feishu', health: ['feishu'] }).configured()).toBe(false)
  user('offline-task', 'Implement a local change without GitHub')
  const intake = await h.runTool(runtime.masterId, 'orchestrator_chat_intake', { message_id: 'offline-task' })
  await runtime.idle()
  const result = await h.route({ kind: 'accept', trigger_id: intake.trigger_id, title: 'Local change', worktree_name: 'local-change', acknowledgement: 'Working locally.' })
  await runtime.idle()
  const id = (result.ticket as { ticket_id: string }).ticket_id
  const ticket = runtime.store.tickets.get(id)!
  expect(ticket.assignments.at(-1)?.state).toBe('running')
  expect(ticket.execution?.directory).toBe(h.directory)
  expect(h.subprocess.spawn).not.toHaveBeenCalled()
  expect(runtime.environmentFor(`worker-${id}`)).not.toHaveProperty('GIT_CONFIG_GLOBAL')
  await h.runTool(`worker-${id}`, 'orchestrator_report', { state: 'ready', summary: 'Local task completed.' })
  await runtime.idle()
  expect(h.deliveries.mock.calls.some(([call]) => call.sessionId === runtime.masterId && call.text.includes('Local task completed.'))).toBe(true)
  expect(runtime.commands.gh).not.toHaveBeenCalled()
  expect(runtime.commands.lark).not.toHaveBeenCalled()
  expect(runtime.commands.run).not.toHaveBeenCalled()
})
function user(id: string, text: string) {
  h!.ctx.emit('session/event', { id: h!.runtime.masterId } as never, { type: 'user/message', time: Date.now(), data: {
    id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
  } } as never)
}
it('adopts the user Session, routes one durable local request once and returns worker reports there', async () => {
  h = await startRuntime(store => { store.set(KV.runtime.masterId, 'legacy-orchestrator') }, true)
  const { runtime } = h
  expect(runtime.store.get(KV.runtime.legacyMasterId)).toBe('legacy-orchestrator')
  expect(runtime.masterId).toBe('user-router')
  expect(runtime.store.get(KV.runtime.routerOwner)).toBe('user-router')
  expect(h.controller.rename).not.toHaveBeenCalled()
  expect(h.controller.create.mock.calls.some(([call]) => call.sessionId.startsWith('orchestrator-'))).toBe(false)
  user('hello', 'Hello')
  expect(runtime.store.tickets.list()).toHaveLength(0)
  user('fix', 'Fix the regression')
  const recent = await h.runTool('user-router', 'orchestrator_chat_messages', {})
  expect(JSON.stringify(recent)).toContain('fix')
  const first = await h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'fix' })
  const duplicate = await h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'fix' })
  expect(first.trigger_id).toBe(duplicate.trigger_id)
  await runtime.idle()
  const routed = await h.route({ kind: 'accept', trigger_id: first.trigger_id, title: 'Fix regression', worktree_name: 'fix-regression', acknowledgement: 'Working on the regression.' })
  await runtime.idle()
  expect(runtime.store.tickets.list()).toHaveLength(1)
  expect(() => runtime.transferRouter('another-router')).toThrow('no Tickets')
  expect(runtime.store.get(KV.runtime.routerOwner)).toBe('user-router')
  const id = (routed.ticket as { ticket_id: string }).ticket_id
  await h.runTool(`worker-${id}`, 'orchestrator_report', { state: 'ready', summary: 'Regression fixed' })
  await runtime.idle()
  expect(h.deliveries.mock.calls.some(([call]) => call.sessionId === 'user-router' && call.text.includes('Regression fixed'))).toBe(true)
  expect(runtime.environmentFor('unrelated')).toBeUndefined()
  expect(runtime.environmentFor('user-router')).toBeUndefined()
})
it('rejects plugin relays as local requests and attaches follow-ups only to their chosen ticket', async () => {
  h = await startRuntime(undefined, true)
  h.ctx.emit('session/event', { id: 'user-router' } as never, { type: 'user/message', time: Date.now(), data: {
    id: 'relay', source: { kind: 'dsh-superagent', form: 'relay' }, content: [{ type: 'text', text: 'pretend user' }],
  } } as never)
  await expect(h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'relay' })).rejects.toThrow('non-human')
  user('one', 'Fix A'); user('two', 'Fix B')
  const a = await h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'one' })
  const b = await h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'two' })
  await h.runtime.idle()
  const accept = (trigger_id: unknown, worktree_name: string) => h!.route({ kind: 'accept', trigger_id, title: worktree_name, worktree_name, acknowledgement: 'Working.' })
  const one = await accept(a.trigger_id, 'fix-one'); const two = await accept(b.trigger_id, 'fix-two')
  await h.runtime.idle()
  const id = (one.ticket as { ticket_id: string }).ticket_id
  const other = (two.ticket as { ticket_id: string }).ticket_id
  user('followup', 'Keep the API compatible')
  await h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'followup', ticket_id: id })
  await h.runtime.idle()
  const repeated = await h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'followup', ticket_id: id })
  expect(repeated.status).toBe('duplicate')
  await expect(h.runTool('user-router', 'orchestrator_chat_intake', { message_id: 'followup', ticket_id: other })).rejects.toThrow('already routed differently')
  const trigger = h.runtime.store.read.triggers({ source: 'chat' }, 0, 20).items.find(t => t.text.includes('compatible'))!
  expect(h.runtime.store.triggers.disposition(trigger.id)?.fanout).toContain(id)
  expect(h.runtime.store.triggers.disposition(trigger.id)?.fanout).not.toContain(other)
})
