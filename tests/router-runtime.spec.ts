/** User-owned Router integration through real Engine, Store, Effects and Worker adapters. */
import { afterEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import { KV } from '../src/kv.ts'
let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
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
  const id = (routed.ticket as { ticket_id: string }).ticket_id
  await h.runTool(`worker-${id}`, 'orchestrator_report', { state: 'ready', summary: 'Regression fixed' })
  await runtime.idle()
  expect(h.deliveries.mock.calls.some(([call]) => call.sessionId === 'user-router' && call.text.includes('Regression fixed'))).toBe(true)
  expect(runtime.environmentFor('unrelated')).toBeUndefined()
  expect(runtime.environmentFor('user-router')).toBeDefined()
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
