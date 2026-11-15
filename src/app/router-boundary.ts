/** Fail-closed Router tool boundary, independent of preset inheritance or local tool registrations. */
import type { Agent } from '@deepseek-ai/dsh-agent'

const FORBIDDEN = new Set(['write', 'edit', 'bash', 'pwsh', 'subagent', 'subagent_fork', 'send_message', 'plugin_manager', 'run_code'])
const REFUSED = 'The Router may only use its registered orchestration tools; execute work in a Worker Ticket.'

/**
 * Hide every inherited tool and guard every dispatch by the exact host-owned tool names.
 * `allowed` is read on each call so the coordinator can install the guard before Runtime registration.
 */
export function protectRouter(agent: Pick<Agent, 'ctx'>, allowed: () => ReadonlySet<string>): () => void {
  const releaseMask = agent.ctx.tools.restrict({ allow: [] })
  const releaseGuard = agent.ctx.tools.guard(({ name }) => FORBIDDEN.has(name) || !allowed().has(name) ? REFUSED : undefined)
  return () => { releaseGuard(); releaseMask() }
}
