/** The public preset is tool-free; Engine-owned workers receive a separate Agent-scoped composition. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { expect, it } from 'vitest'
import ToolsService from '@deepseek-ai/dsh-tools'
import { ROUTER_PRESET } from '../src/app/sessions.ts'
import { mountWorker, resolveWorkerModulePath, workerModules, SUPERAGENT_PRESET, type WorkerModuleLoader } from '../src/worker-composition.ts'

interface Row { id?: string; name: string; config?: Record<string, unknown> & { plugins?: Row[] } | Row[] }
async function patched(): Promise<Row[]> {
  const cordis = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'))
  const include = cordis.resolve('@deepseek-ai/cordis-plugin-include')
  const { entryListSchema, applyEntryPatches } = await import(include) as {
    entryListSchema: unknown; applyEntryPatches(data: Row[], patches: unknown[], warn: (message: string) => void): Row[] }
  const yaml = await import(createRequire(include).resolve('js-yaml')) as { load(text: string, options: { schema: unknown }): unknown }
  const patches = yaml.load(readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as unknown[]
  const warnings: string[] = []
  const rows = applyEntryPatches([], patches, message => { warnings.push(message) })
  expect(warnings).toEqual([])
  return rows
}
const flat = (rows: readonly Row[]): Row[] => rows.flatMap(row => [row, ...Array.isArray(row.config) ? flat(row.config) : []])

it('publishes exactly one Superagent preset with no inherited shell, filesystem, delegation or other model tools', async () => {
  const rows = await patched()
  expect(rows.map(row => row.id)).toEqual(['dsh-superagent', 'dsh-superagent-router-preset'])
  const presets = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
  expect(presets).toHaveLength(1)
  const preset = presets[0]!.config as { id: string; name: string; plugins: Row[] }
  expect(preset.id).toBe(ROUTER_PRESET)
  expect(preset.id).toBe(SUPERAGENT_PRESET)
  expect(preset.name).toBe('Superagent')
  expect(flat(preset.plugins).map(row => row.name)).toEqual([
    '@deepseek-ai/dsh-time-context', 'cordis:group', '@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-command-compact', '@deepseek-ai/dsh-compaction-tool-result-pruner',
  ])
})
it('keeps execution tools in the internal composition with native shell, bounded waits and the same public preset ID for children', () => {
  for (const platform of ['linux', 'win32'] as const) {
    const modules = workerModules(platform)
    expect(modules.find(row => /-sandbox$/.test(row.name))).toEqual({ name: platform === 'win32' ? '@deepseek-ai/dsh-pwsh-sandbox' : '@deepseek-ai/dsh-bash-sandbox', realm: 'shell', config: { timeoutMs: 5000, maxTimeoutMs: 5000 } })
    expect(modules.find(row => row.name === '@deepseek-ai/dsh-tool-subagent')?.config).toMatchObject({ provider: 'spawn', agentPreset: SUPERAGENT_PRESET })
    for (const name of ['@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-jobs', '@deepseek-ai/dsh-tool-skill']) expect(modules.some(row => row.name === name)).toBe(true)
  }
})
it('resolves Worker packages from the profile package root when the bundled app root has no package', () => {
  const root = mkdtempSync(join(tmpdir(), 'superagent-worker-resolution-'))
  try {
    const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-persona')
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-persona', main: 'lib/index.js' }))
    writeFileSync(join(packageRoot, 'lib', 'index.js'), 'export default {}')
    expect(resolveWorkerModulePath('@deepseek-ai/dsh-persona', [join(root, 'bundled-app'), root])).toBe(join(packageRoot, 'lib', 'index.js'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('mounts worker modules only in the requested Agent scope and shares one private subprocess realm with all shell consumers', async () => {
  const root = new Context(), worker = {}, other = {}
  const scope = createScope(root, worker), ordinary = createScope(root, other)
  const upstream = { spawn: () => {} }
  root.provide('subprocess', upstream as never)
  root.provide('agents', { currentInitiator: () => undefined } as never)
  const active = new Set<string>(), observed: unknown[] = []
  const load: WorkerModuleLoader = async name => ({ apply(ctx: Context) {
    expect(scopeOf(ctx)).toBe(worker)
    ctx.effect(() => { active.add(name); return () => { active.delete(name) } })
    if (/pwsh|bash/.test(name)) observed.push(ctx.get('subprocess'))
  } })
  const dispose = await mountWorker({ ctx: scope.ctx }, load)
  expect(active.size).toBe(workerModules().length)
  expect(observed).toHaveLength(2)
  expect(observed[0]).toBe(observed[1])
  expect(observed[0]).not.toBe(upstream)
  expect(root.get('subprocess')).toBe(upstream)
  expect(ordinary.ctx.get('subprocess')).toBe(upstream)
  await dispose()
  expect(active.size).toBe(0)
  await scope.dispose(); await ordinary.dispose()
})
it('awaits asynchronous plugin activation and rolls back a rejected activation', async () => {
  const root = new Context(), scope = createScope(root, {})
  root.provide('subprocess', {} as never)
  root.provide('agents', {} as never)
  const active = new Set<string>()
  const load: WorkerModuleLoader = async name => ({ async apply(ctx: Context) {
    await Promise.resolve()
    if (name === '@deepseek-ai/dsh-tool-fs') throw new Error('fixture asynchronous activation failure')
    ctx.effect(() => { active.add(name); return () => { active.delete(name) } })
  } })
  await expect(mountWorker({ ctx: scope.ctx }, load)).rejects.toThrow('fixture asynchronous activation failure')
  expect(active.size).toBe(0)
  await scope.dispose()
})
it('registers execution tools through the real ToolsService only for the mounted worker and removes them on disposal', async () => {
  const root = new Context(), worker = {}, ordinary = {}
  root.provide('systemPrompt', { tools: () => {} } as never)
  const tools = new ToolsService(root)
  root.provide('subprocess', {} as never)
  root.provide('agents', {} as never)
  const scope = createScope(root, worker)
  const load: WorkerModuleLoader = async name => ({ inject: ['tools'], apply(ctx: Context) {
    if (name !== '@deepseek-ai/dsh-tool-fs') return
    ctx.tools.register({ name: 'write', description: 'fixture scoped write', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: () => '' }, execute: async () => '' } as unknown as Parameters<ToolsService['register']>[0])
  } })
  expect(tools.get('write', worker)).toBeUndefined()
  const dispose = await mountWorker({ ctx: scope.ctx }, load)
  expect(tools.get('write', worker)?.name).toBe('write')
  expect(tools.get('write', ordinary)).toBeUndefined()
  expect(tools.get('write')).toBeUndefined()
  await dispose()
  expect(tools.get('write', worker)).toBeUndefined()
  await scope.dispose()
})
it('rejects missing required services and rolls back before a worker can be prompted', async () => {
  const root = new Context(), scope = createScope(root, {})
  root.provide('subprocess', {} as never)
  root.provide('agents', {} as never)
  const active = new Set<string>()
  const load: WorkerModuleLoader = async name => name === '@deepseek-ai/dsh-tool-fs'
    ? { inject: ['fixtureMissingWorkerService'], apply() {} }
    : { apply(ctx: Context) { ctx.effect(() => { active.add(name); return () => { active.delete(name) } }) } }
  await expect(mountWorker({ ctx: scope.ctx }, load)).rejects.toThrow('Worker composition is missing services: fixtureMissingWorkerService')
  expect(active.size).toBe(0)
  await scope.dispose()
})
it('rolls back every loaded worker module if any import fails', async () => {
  const root = new Context(), scope = createScope(root, {})
  root.provide('subprocess', {} as never)
  root.provide('agents', {} as never)
  const active = new Set<string>()
  const load: WorkerModuleLoader = async name => {
    if (name === '@deepseek-ai/dsh-tool-fs') throw new Error('fixture import failure')
    return { apply(ctx: Context) { ctx.effect(() => { active.add(name); return () => { active.delete(name) } }) } }
  }
  await expect(mountWorker({ ctx: scope.ctx }, load)).rejects.toThrow('fixture import failure')
  expect(active.size).toBe(0)
  await scope.dispose()
})
