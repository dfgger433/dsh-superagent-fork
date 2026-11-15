/** Owns independently mounted Superagent deployments, serialized per initiating Session. */
export interface RouterAgent { id: string }
export interface RouterMount { stop(): Promise<void> }
export interface RouterInstanceStatus { sessionId: string; state: 'inactive' | 'active' | 'stopped' }
export interface RouterControllerStatus { state: 'inactive' | 'active'; instances: RouterInstanceStatus[] }
/** Same-session operations are ordered; different Sessions can activate and release concurrently. */
export class RouterController<A extends RouterAgent = RouterAgent> {
  private readonly chains = new Map<string, Promise<void>>()
  private readonly instances = new Map<string, RouterMount>()
  private closed = false
  private stopping?: Promise<void>
  constructor(private readonly mount: (agent: A) => RouterMount | Promise<RouterMount>) {}
  use(agent: A): Promise<void> {
    if (this.closed) return Promise.resolve()
    return this.run(agent.id, async () => {
      if (this.closed || this.instances.has(agent.id)) return
      this.instances.set(agent.id, await this.mount(agent))
    })
  }
  release(id: string): Promise<void> {
    if (this.closed) return this.stopping ?? Promise.resolve()
    return this.run(id, async () => {
      const instance = this.instances.get(id)
      if (!instance) return
      this.instances.delete(id)
      await instance.stop()
    })
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.closed = true
    this.stopping = (async () => {
      // No new operations can enter; activations already in progress may still publish their mounts.
      await Promise.allSettled([...this.chains.values()])
      const instances = [...this.instances.values()]
      this.instances.clear()
      const results = await Promise.allSettled(instances.map(instance => Promise.resolve().then(() => instance.stop())))
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length) throw new AggregateError(failures, 'Could not stop every Superagent instance')
    })()
    return this.stopping
  }
  status(id: string): RouterInstanceStatus
  status(): RouterControllerStatus
  status(id?: string): RouterInstanceStatus | RouterControllerStatus {
    if (id !== undefined) return { sessionId: id, state: this.instances.has(id) ? 'active' : this.closed ? 'stopped' : 'inactive' }
    const instances: RouterInstanceStatus[] = [...this.instances.keys()].map(sessionId => ({ sessionId, state: 'active' }))
    return { state: instances.length ? 'active' : 'inactive', instances }
  }
  private run(id: string, work: () => Promise<void>): Promise<void> {
    const result = (this.chains.get(id) ?? Promise.resolve()).then(work)
    const settled = result.catch(() => {})
    this.chains.set(id, settled)
    void settled.then(() => { if (this.chains.get(id) === settled) this.chains.delete(id) })
    return result
  }
}
