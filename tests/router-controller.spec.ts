/** Preset use, races and teardown own the one deployment, not preset definition loading. */
import { expect, it, vi } from 'vitest'
import { RouterController } from '../src/app/router-controller.ts'

it('does not mount until used, binds only one session, and resumes after release', async () => {
  const stop = vi.fn(async () => {})
  const mount = vi.fn(async () => ({ stop }))
  const conflict = vi.fn()
  const controller = new RouterController(mount, conflict)
  expect(mount).not.toHaveBeenCalled()
  await Promise.all([controller.use({ id: 'one' }), controller.use({ id: 'two' }), controller.use({ id: 'one' })])
  expect(mount).toHaveBeenCalledTimes(1)
  expect(conflict).toHaveBeenCalledWith({ id: 'two' }, 'one')
  await controller.release('two')
  expect(stop).not.toHaveBeenCalled()
  await controller.release('one')
  expect(stop).toHaveBeenCalledTimes(1)
  await controller.use({ id: 'one' })
  expect(mount).toHaveBeenCalledTimes(2)
  await controller.stop()
  expect(stop).toHaveBeenCalledTimes(2)
})

it('drains an activation already in flight and never mounts after unload', async () => {
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const stop = vi.fn(async () => {})
  const mount = vi.fn(async () => { await gate; return { stop } })
  const controller = new RouterController(mount, vi.fn())
  const starting = controller.use({ id: 'one' })
  await Promise.resolve()
  const ending = controller.stop()
  finish(); await Promise.all([starting, ending])
  await controller.use({ id: 'two' })
  expect(mount).toHaveBeenCalledTimes(1)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(controller.status()).toEqual({ state: 'stopped' })
})

it('recovers its serialization queue after activation failed', async () => {
  const mount = vi.fn().mockRejectedValueOnce(new Error('setup failed')).mockResolvedValue({ stop: vi.fn() })
  const controller = new RouterController(mount, vi.fn())
  await expect(controller.use({ id: 'one' })).rejects.toThrow('setup failed')
  await controller.use({ id: 'one' })
  expect(controller.status()).toEqual({ state: 'active', sessionId: 'one' })
  await controller.stop()
})
