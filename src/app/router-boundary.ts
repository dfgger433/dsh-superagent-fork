/** Fail-closed Router tool boundary, independent of preset inheritance or local tool registrations. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'

const FORBIDDEN = new Set(['write', 'edit', 'bash', 'pwsh', 'subagent', 'subagent_fork', 'send_message', 'plugin_manager', 'run_code'])
const REFUSED = 'The Router may only use its registered orchestration tools; execute work in a Worker Ticket.'

/**
 * Hide every inherited tool and guard every dispatch by the exact host-owned tool names.
 * `allowed` is read on each call so the coordinator can install the guard before Runtime registration.
 */
export type RouterToolIdentities = ReadonlyMap<string, Function>
export function protectRouter(agent: Pick<Agent, 'ctx'>, allowed: () => RouterToolIdentities): () => void {
  const releaseMask = agent.ctx.tools.restrict({ allow: [] })
  const releaseGuard = agent.ctx.tools.guard(({ name, agent: caller }) => {
    if (FORBIDDEN.has(name) || !caller || caller !== agent) return REFUSED
    const expected = allowed().get(name)
    const actual = caller.ctx.tools.get(name, scopeOf(caller.ctx))
    return expected && actual?.execute === expected ? undefined : REFUSED
  })
  return () => { releaseGuard(); releaseMask() }
}
