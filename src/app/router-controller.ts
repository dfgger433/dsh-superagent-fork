/** Serializes preset-owned deployment activation; definitions alone never start a deployment. */
export interface RouterAgent { id: string }
export interface RouterMount { stop(): Promise<void> }
/** Owns one deployment mount and drains serialized activation before releasing it. */
export class RouterController<A extends RouterAgent = RouterAgent> {
  private chain: Promise<void> = Promise.resolve()
  private current?: { id: string; mount: RouterMount }
  private closed = false
  constructor(private readonly mount: (agent: A) => Promise<RouterMount>, private readonly conflict: (agent: A, owner: string) => void) {}
  use(agent: A): Promise<void> {
    return this.run(async () => {
      if (this.closed) return
      if (this.current) {
        if (this.current.id !== agent.id) this.conflict(agent, this.current.id)
        return
      }
      const mount = await this.mount(agent)
      this.current = { id: agent.id, mount }
    })
  }
  release(id: string): Promise<void> {
    return this.run(async () => {
      if (this.current?.id !== id) return
      const current = this.current; this.current = undefined
      await current.mount.stop()
    })
  }
  stop(): Promise<void> {
    this.closed = true
    return this.run(async () => {
      const current = this.current; this.current = undefined
      await current?.mount.stop()
    })
  }
  status(): { state: 'inactive' | 'active' | 'stopped'; sessionId?: string } {
    return this.current ? { state: 'active', sessionId: this.current.id } : { state: this.closed ? 'stopped' : 'inactive' }
  }
  private run(work: () => Promise<void>): Promise<void> {
    const result = this.chain.then(work)
    this.chain = result.catch(() => {})
    return result
  }
}
