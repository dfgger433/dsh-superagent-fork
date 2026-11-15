/** Subprocess decorator for a dedicated worker shell realm. Never mount in the host realm. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { mergeEnvironment } from './infra/cli.ts'

export const inject = ['agents']
export type ExecutionEnvironment = Record<string, string | undefined>
export interface ExecutionEnvironmentHost { environmentFor(sessionId: string): ExecutionEnvironment | undefined }

/** Calls the environment resolver on every spawn, so a paused/disposed owner cannot retain authority in a closure. */
export function scopedSubprocess(upstream: SubprocessRuntime, environment: () => ExecutionEnvironment | undefined): SubprocessRuntime {
  const required = (): ExecutionEnvironment => {
    const env = environment()
    if (!env) throw new Error('No authorized superagent worker initiates this subprocess')
    return env
  }
  return new Proxy(upstream, {
    get(target, property) {
      if (property === 'spawn' || property === 'spawnTerminal') return (spec: Parameters<SubprocessRuntime['spawn']>[0]) => {
        const env = mergeEnvironment(spec.env ?? {}, required())
        // Ordinary caller variables survive; deployment identity and PATH remain controlled by the owner.
        return (target[property] as SubprocessRuntime['spawn']).call(target, { ...spec, env })
      }
      if (property === 'resolveExecutable') return (command: string, env?: Record<string, string>, signal?: AbortSignal) => {
        const scoped = environment()
        const merged = mergeEnvironment(env ?? {}, scoped ?? {})
        return target.resolveExecutable(command, Object.fromEntries(Object.entries(merged).filter((item): item is [string, string] => item[1] !== undefined)), signal)
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Provider and every shell consumer must share an isolated subprocess realm; the root provider remains untouched. */
export function apply(ctx: Context): void {
  const upstream = ctx.root.get('subprocess') as SubprocessRuntime | undefined
  if (!upstream) throw new Error('The host subprocess provider is unavailable')
  ctx.provide('subprocess', scopedSubprocess(upstream, () => {
    const agent = ctx.agents.currentInitiator()
    const owner = ctx.root.get('orchestrator') as ExecutionEnvironmentHost | undefined
    return agent ? owner?.environmentFor(agent.id) : undefined
  }))
}
