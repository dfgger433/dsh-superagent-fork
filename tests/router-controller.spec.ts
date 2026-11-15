/** Independent Session deployments, per-ID races, and teardown while activation is in flight. */
import { expect, it, vi } from 'vitest'
import { RouterController } from '../src/app/router-controller.ts'
import { apply as executionScope } from '../src/execution-scope.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
const gate = () => Promise.withResolvers<void>()

it('mounts each session independently, deduplicates the same session and releases only its instance', async () => {
  const stops = new Map<string, ReturnType<typeof vi.fn>>()
  const mount = vi.fn(async ({ id }: { id: string }) => {
    const stop = vi.fn(async () => {}); stops.set(id, stop); return { stop }
  })
  const controller = new RouterController(mount)
  expect(controller.status()).toEqual({ state: 'inactive', instances: [] })
  await Promise.all([controller.use({ id: 'one' }), controller.use({ id: 'two' }), controller.use({ id: 'one' })])
  expect(mount).toHaveBeenCalledTimes(2)
  expect(controller.status('one')).toEqual({ state: 'active', sessionId: 'one' })
  expect(controller.status().instances).toEqual([{ sessionId: 'one', state: 'active' }, { sessionId: 'two', state: 'active' }])
  await controller.release('absent')
  await controller.release('one')
  expect(stops.get('one')).toHaveBeenCalledTimes(1)
  expect(stops.get('two')).not.toHaveBeenCalled()
  expect(controller.status('two').state).toBe('active')
  await controller.use({ id: 'one' })
  expect(mount).toHaveBeenCalledTimes(3)
  await controller.stop()
  expect(stops.get('one')).toHaveBeenCalledTimes(1)
  expect(stops.get('two')).toHaveBeenCalledTimes(1)
})
it('activates different IDs concurrently and serializes release plus reuse for the same ID', async () => {
  const starts = new Map<string, ReturnType<typeof gate>>([['one', gate()], ['two', gate()]])
  const shutdown = gate()
  const stop = vi.fn(async () => { await shutdown.promise })
  const mount = vi.fn(async ({ id }: { id: string }) => { await starts.get(id)!.promise; return { stop } })
  const controller = new RouterController(mount)
  const first = controller.use({ id: 'one' }), second = controller.use({ id: 'two' })
  await Promise.resolve()
  expect(mount).toHaveBeenCalledTimes(2)
  starts.get('two')!.resolve(); await second
  expect(controller.status('two').state).toBe('active')
  expect(controller.status('one').state).toBe('inactive')
  starts.get('one')!.resolve(); await first
  const released = controller.release('one'), reused = controller.use({ id: 'one' })
  await Promise.resolve(); await Promise.resolve()
  expect(mount).toHaveBeenCalledTimes(2)
  shutdown.resolve(); await Promise.all([released, reused])
  expect(mount).toHaveBeenCalledTimes(3)
  await controller.stop()
})
it('drains all in-flight activations, stops each, and never mounts after unload', async () => {
  const ready = gate(), began = gate()
  const stop = vi.fn(async () => {})
  const mount = vi.fn(async () => { began.resolve(); await ready.promise; return { stop } })
  const controller = new RouterController(mount)
  const starting = controller.use({ id: 'one' })
  await began.promise
  const ending = controller.stop()
  expect(controller.stop()).toBe(ending)
  let ended = false; void ending.then(() => { ended = true })
  await Promise.resolve(); expect(ended).toBe(false)
  ready.resolve(); await Promise.all([starting, ending])
  await controller.use({ id: 'two' }); await controller.release('one')
  expect(mount).toHaveBeenCalledTimes(1)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(controller.status()).toEqual({ state: 'inactive', instances: [] })
  expect(controller.status('one')).toEqual({ state: 'stopped', sessionId: 'one' })
})
it('queues a release behind activation without stopping a different ready instance', async () => {
  const ready = gate(), began = gate()
  const stopOne = vi.fn(async () => {}), stopTwo = vi.fn(async () => {})
  const controller = new RouterController(async ({ id }) => {
    if (id === 'one') { began.resolve(); await ready.promise }
    return { stop: id === 'one' ? stopOne : stopTwo }
  })
  const starting = controller.use({ id: 'one' })
  await began.promise
  const release = controller.release('one')
  await controller.use({ id: 'two' })
  expect(controller.status('two').state).toBe('active')
  ready.resolve(); await Promise.all([starting, release])
  expect(stopOne).toHaveBeenCalledTimes(1)
  expect(stopTwo).not.toHaveBeenCalled()
  expect(controller.status('one').state).toBe('inactive')
  await controller.stop()
})
it('drains successful activations even if another in-flight activation rejects during shutdown', async () => {
  const ready = gate(), began = gate(), stopped = vi.fn(async () => {})
  const controller = new RouterController(async ({ id }) => {
    began.resolve(); await ready.promise
    if (id === 'broken') throw new Error('activation failed')
    return { stop: stopped }
  })
  const good = controller.use({ id: 'good' }), bad = controller.use({ id: 'broken' })
  const rejected = expect(bad).rejects.toThrow('activation failed')
  await began.promise
  const ending = controller.stop()
  ready.resolve(); await Promise.all([good, rejected, ending])
  expect(stopped).toHaveBeenCalledTimes(1)
})
it('recovers each serialization queue after activation failed without affecting another session', async () => {
  const mount = vi.fn().mockRejectedValueOnce(new Error('setup failed')).mockResolvedValue({ stop: vi.fn(async () => {}) })
  const controller = new RouterController(mount)
  await expect(controller.use({ id: 'one' })).rejects.toThrow('setup failed')
  await Promise.all([controller.use({ id: 'one' }), controller.use({ id: 'two' })])
  expect(controller.status().instances).toHaveLength(2)
  await controller.stop()
})
it('attempts every teardown even when one fails and does not retry already stopped instances', async () => {
  const failed = vi.fn(async () => { throw new Error('stop failed') }), succeeded = vi.fn(async () => {})
  const controller = new RouterController(async ({ id }) => ({ stop: id === 'one' ? failed : succeeded }))
  await Promise.all([controller.use({ id: 'one' }), controller.use({ id: 'two' })])
  await expect(controller.stop()).rejects.toThrow('Could not stop every Superagent instance')
  expect(failed).toHaveBeenCalledTimes(1); expect(succeeded).toHaveBeenCalledTimes(1)
  expect(controller.status()).toEqual({ state: 'inactive', instances: [] })
})
it('resolves environment ownership through the shared coordinator for the current initiator', () => {
  const spawn = vi.fn(), upstream = { spawn } as unknown as SubprocessRuntime
  const environments = new Map([['worker-one', { PATH: '/one' }], ['worker-two', { PATH: '/two' }]])
  let initiator = 'worker-one', decorated!: SubprocessRuntime
  const coordinator = { environmentFor: (id: string) => environments.get(id) }
  const context = { root: { get: (name: string) => name === 'subprocess' ? upstream : name === 'superagentCoordinator' ? coordinator : undefined },
    agents: { currentInitiator: () => ({ id: initiator }) }, provide: (_: string, value: SubprocessRuntime) => { decorated = value } } as unknown as Context
  executionScope(context)
  const spec = { argv: ['git'], cwd: '/work', graceMs: 1000, stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' } } as Parameters<SubprocessRuntime['spawn']>[0]
  decorated.spawn(spec)
  initiator = 'worker-two'; decorated.spawn(spec)
  expect(spawn.mock.calls.map(([request]) => request.env.PATH)).toEqual(['/one', '/two'])
  environments.delete('worker-one'); initiator = 'worker-one'
  expect(() => decorated.spawn(spec)).toThrow('No authorized')
})
