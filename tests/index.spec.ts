/** The bundle Host is inert until an actual root Agent selects its Router preset. */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/deployment.ts'
import { apply } from '../src/index.ts'
const runtimes = vi.hoisted(() => [] as { stop: ReturnType<typeof vi.fn>; router: unknown }[])
vi.mock('../src/app/runtime.ts', () => ({ Runtime: class {
  ready = Promise.resolve(); masterId = 'user-session'
  store = { settings: () => ({ paused: false }) }
  stop = vi.fn(async () => {})
  constructor(_ctx: unknown, _machine: unknown, _restart: unknown, readonly router: unknown) { runtimes.push(this) }
  configured() { return true }
} }))
function context() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const cleanups: (() => unknown)[] = []
  const configure = vi.fn(() => () => {})
  const agent = { id: 'user-session', session: { header: { agentPreset: 'dsh-superagent-router' } }, ctx: { tools: { restrict: vi.fn(() => () => {}), guard: vi.fn(() => () => {}) }, systemPrompt: { section: vi.fn(() => () => {}) } } }
  const ctx: any = {
    on: vi.fn((name: string, handler: (...args: any[]) => unknown) => { handlers.set(name, handler) }),
    inject: vi.fn((_services: string[], callback: (child: unknown) => void) => callback({ effect: (effect: () => unknown) => effect(), settings: { configure } })),
    effect: vi.fn((effect: () => unknown) => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => unknown) }),
    fiber: { restart: vi.fn(async () => {}) },
    agents: { list: () => [], get: () => agent },
    get: vi.fn((name: string) => name === 'agentPresets' ? { presetForSession: () => 'dsh-superagent-router' } : undefined),
    logger: { info: vi.fn(), error: vi.fn() },
    webServer: { host: '127.0.0.1', port: 1234, register: vi.fn(() => () => {}) },
  }
  ctx.provide = vi.fn()
  ctx.isolate = () => ctx
  ctx.plugin = vi.fn((plugin: { name?: string; apply(child: unknown): unknown }) => {
    if (plugin.name?.includes('github') || plugin.name?.includes('feishu')) return { await: async () => {}, dispose: async () => {} }
    const childCleanups: (() => Promise<void>)[] = []
    const child = { ...ctx, effect: (fn: () => () => Promise<void>) => { childCleanups.push(fn()) } }
    const result = Promise.resolve(plugin.apply(child)) as Promise<unknown> & { dispose: () => Promise<void> }
    result.dispose = async () => { for (const cleanup of childCleanups) await cleanup() }
    return { await: () => result, dispose: result.dispose }
  })
  return { ctx, handlers, configure, agent, cleanups }
}
it('does not construct Runtime when installed, then adopts the selected user session', async () => {
  runtimes.length = 0
  const { ctx, handlers, configure, agent, cleanups } = context()
  await apply(ctx, Config({ stateDir: '/srv/state' }))
  expect(configure).toHaveBeenCalledWith({ auto: false }, ctx.fiber)
  expect(runtimes).toHaveLength(0)
  await handlers.get('agent/created')!({ agent })
  expect(runtimes).toHaveLength(1)
  expect(runtimes[0]!.router).toBe(agent)
  await handlers.get('agent/disposed')!({ agent })
  expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1)
  for (const cleanup of cleanups) await cleanup()
})
it('does not activate from child agents or other presets', async () => {
  runtimes.length = 0
  const { ctx, handlers, agent } = context()
  await apply(ctx, Config({ stateDir: '/srv/state' }))
  await handlers.get('agent/created')!({ agent: { ...agent, session: { header: { parentSession: 'worker-one' } } } })
  ctx.get.mockReturnValue({ presetForSession: () => 'standard' })
  await handlers.get('agent/created')!({ agent })
  expect(runtimes).toHaveLength(0)
})
it('mounts and unloads through real Cordis Fibers', async () => {
  runtimes.length = 0
  const root = new Context()
  const { agent } = context()
  const live = new Map([[agent.id, agent]])
  root.reflect.provide('agents', { list: () => [...live.values()], get: (id: string) => live.get(id) })
  root.reflect.provide('agentPresets', { presetForSession: () => 'dsh-superagent-router' })
  root.reflect.provide('webServer', { host: '127.0.0.1', port: 1234, register: () => () => {} })
  for (const key of ['sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'llm', 'subprocess']) root.reflect.provide(key, {})
  const plugin = root.plugin({ name: 'test-router-host', apply: child => apply(child, Config({})) })
  await plugin.await()
  expect(runtimes).toHaveLength(1)
  await plugin.dispose()
  expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1)
})
it('refuses obsolete configuration before registering anything', async () => {
  const { ctx } = context()
  await expect(apply(ctx, Config({ stateDir: '/srv/state', github: { cli: 'gh' } } as never))).rejects.toThrow('github (now on the GitHub Source)')
  expect(ctx.on).not.toHaveBeenCalled()
  expect(ctx.inject).not.toHaveBeenCalled()
})
