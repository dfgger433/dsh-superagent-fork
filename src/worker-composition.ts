/** Worker tools are mounted only after Engine ownership is established, never by a user-selectable preset. */
import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { apply as applyExecutionScope, inject as executionScopeInject } from './execution-scope.ts'

export const SUPERAGENT_PRESET = 'dsh-superagent-router'
export interface WorkerModule { name: string; config?: Record<string, unknown>; realm?: 'shell' | 'delegation' }
/** Package declarations remain data so the running Host installation supplies its own compatible implementations. */
export const workerModules = (platform = process.platform): WorkerModule[] => [
  { name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a coding agent powered by the {{model}} model.' } },
  { name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
  { name: platform === 'win32' ? '@deepseek-ai/dsh-pwsh-sandbox' : '@deepseek-ai/dsh-bash-sandbox', realm: 'shell', config: { timeoutMs: 5000, maxTimeoutMs: 5000 } },
  { name: platform === 'win32' ? '@deepseek-ai/dsh-tool-pwsh' : '@deepseek-ai/dsh-tool-bash', realm: 'shell' },
  { name: '@deepseek-ai/dsh-tool-fs' },
  { name: '@deepseek-ai/dsh-tool-fs-search', realm: 'shell', config: { sampleOverCapGlobResults: false } },
  { name: '@deepseek-ai/dsh-tool-jobs', config: { waitTimeoutMs: 5000, maxWaitTimeoutMs: 5000 } },
  { name: '@deepseek-ai/dsh-skill-filesystem' },
  { name: '@deepseek-ai/dsh-tool-skill' },
  { name: '@deepseek-ai/dsh-tool-subagent-control', realm: 'delegation' },
  { name: '@deepseek-ai/dsh-tool-subagent', realm: 'delegation', config: { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true, agentPreset: SUPERAGENT_PRESET } },
  { name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  { name: '@deepseek-ai/dsh-tool-web', config: { fetch: false, searchTimeoutMs: 60000 } },
]

export type WorkerModuleLoader = (name: string) => Promise<Plugin>
const require = createRequire(import.meta.url)
const loadModule: WorkerModuleLoader = async name => {
  const resolved = require.resolve(name, { paths: [process.env.DSH_INSTALL_DIR ?? import.meta.dirname] })
  const module = await import(pathToFileURL(resolved).href) as { default?: Plugin; apply?: Plugin }
  return (module.default ?? module) as Plugin
}

/** Caller must establish ticket ownership first and dispose before releasing that ownership. Partial mounts roll back. */
export async function mountWorker(agent: Pick<Agent, 'ctx'>, load: WorkerModuleLoader = loadModule): Promise<() => Promise<void>> {
  // The owner is active before children are mounted: a child requiring a parent dependency cannot deadlock its initialization.
  const owner = agent.ctx.plugin(() => {})
  await owner.await()
  const dispose = async () => { await owner.dispose() }
  try {
    const base = owner.ctx
    const shell = base.isolate('shell').isolate('subprocess')
    const delegation = base.isolate('workflowEngine')
    const activate = async (ctx: Context, plugin: Plugin, config?: Record<string, unknown>): Promise<Fiber> => {
      const fiber = ctx.plugin(plugin, config)
      await fiber.await()
      // Cordis permits pending injections; an execution composition must fail before any worker is prompted.
      const missing = Object.keys(fiber.inject).filter(name => fiber.ctx.get(name) === undefined)
      if (missing.length) throw new Error(`Worker composition is missing services: ${missing.join(', ')}`)
      return fiber
    }
    await activate(shell, { apply: applyExecutionScope, inject: executionScopeInject })
    for (const module of workerModules()) {
      await activate(module.realm === 'shell' ? shell : module.realm === 'delegation' ? delegation : base, await load(module.name), module.config)
    }
    return dispose
  } catch (error) {
    await dispose()
    throw error
  }
}
