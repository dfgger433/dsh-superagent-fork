/** Probes repository and account CLIs, configures the worker execution environment and command shims, and tracks setup readiness. */
import type { Context } from '@deepseek-ai/cordis'
import { UserError } from '../core/index.ts'
import { SETUP_FIELDS, GithubAccountsSchema, localDeployment, resolveDeployment, resolveFeishuBot, workerProbe, type Deployment, type Machine } from '../deployment.ts'
import { agentVariables, localVariables, workerEnvironment, verifyEnvironment, withoutDirectory, workerBin, writeEnvironment } from '../infra/environment.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'

export interface SetupHost {
  readonly context: Context
  readonly machine: Machine
  readonly localAllowed?: boolean
  readonly lifetime: AbortSignal
  restart(): void
}

const setupFields = (settings: Settings, includeEnabled: boolean) =>
  JSON.stringify(Object.entries(SETUP_FIELDS).map(([id, keys]) => [...(includeEnabled ? [settings.sources[id]?.enabled ?? false] : []), ...keys.map(key => settings.sources[id]?.config[key] ?? '')]))
export const setupChanged = (before: Settings, after: Settings, includeEnabled = true): boolean => setupFields(before, includeEnabled) !== setupFields(after, includeEnabled)

/**
 * Resolves the target repository, GitHub account, and optional Feishu bot by probing CLIs, then writes and applies the isolated git and shim environment used by worker processes.
 * `Runtime` runs it at startup to gate orchestration readiness, while `Settings` uses it to validate account changes, update blocked command shims, and schedule restarts.
 */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  feishuProblem?: SetupProblem
  /** PATH with the worker shim directory removed so the host's own CLI calls invoke the real binaries. */
  private readonly path: string
  /** Environment variables pointing agent subprocesses at the isolated git config and command shims. */
  private readonly variables: Record<string, string | undefined>
  private readonly commandVariables: Record<string, string | undefined>
  constructor(private readonly host: SetupHost) {
    this.path = withoutDirectory(process.env.PATH ?? '', workerBin(host.machine.stateDir))
    this.variables = agentVariables(host.machine.stateDir)
    this.commandVariables = { ...this.variables, PATH: this.path }
  }
  /** Host command environment with agent git variables applied and the worker shim directory excluded from PATH. */
  get commandEnvironment(): Record<string, string | undefined> { return this.commandVariables }
  get workerEnvironment(): Record<string, string | undefined> { return workerEnvironment(this.host.machine.stateDir, this.path, !!this.resolved?.local) }
  get deployment(): Deployment {
    if (!this.resolved) throw new Error(`dsh-superagent is waiting for setup: ${this.problem?.detail ?? 'setup has not run'}`)
    return this.resolved
  }
  configured(): boolean { return this.resolved !== undefined }
  /** Resolve deployment accounts and apply the worker environment, recording `SetupError` failures in `problem`/`feishuProblem` and rethrowing unexpected errors. */
  async run(settings: Settings): Promise<boolean> {
    this.resolved = undefined
    this.problem = undefined
    this.feishuProblem = undefined
    try { this.resolved = await this.resolve(settings); return true }
    catch (error) {
      if (!(error instanceof SetupError)) throw error
      this.problem = error.problem
      return false
    }
  }
  /** Trigger a restart to re-run setup, refusing if setup and Feishu are already healthy so running assignments are not interrupted. */
  check(): void {
    if (this.configured() && !this.feishuProblem) throw new UserError('setupComplete')
    this.restart()
  }
  /** Defer the restart to the next macrotask so the current HTTP or tool caller receives its response first. */
  restart(): void { setTimeout(this.host.restart, 0) }
  /** Verify account CLIs for a modified source block before saving, ignoring setup errors belonging to other blocks. */
  async checkAccounts(block: SettingsBlock, settings: Settings): Promise<void> {
    const { machine } = this.host
    if (this.local(settings)) return
    if (this.host.localAllowed && block === 'source:feishu' && !settings.sources.feishu?.enabled) return
    const check = block === 'source:feishu' ? resolveFeishuBot(machine, settings.sources.feishu?.config, this.probe())
      : resolveDeployment(machine, settings.sources.github?.config, this.probe())
    await check.catch((error: unknown) => { if (!(error instanceof SetupError) || error.place === block.slice(7)) throw error })
  }
  async blockCommands(blocked: readonly string[]): Promise<void> {
    if (this.resolved) await writeEnvironment(this.resolved, blocked)
  }
  restore(): void { /* No ambient environment was changed. */ }
  /** Probes CLIs the way worker shells run them, using `stateDir` as `cwd` since it exists even before the repository clone is valid. */
  private probe() {
    const { context, machine, lifetime } = this.host
    return workerProbe(context.subprocess, machine.stateDir, machine.stateDir, lifetime)
  }
  private local(settings: Settings): boolean {
    if (!this.host.localAllowed) return false
    const github = settings.sources.github
    if (!github?.enabled) return true
    const account = GithubAccountsSchema.parse(github.config)
    return !account.repository && !account.cli
  }
  private updateCommandEnvironment(local: boolean): void {
    for (const key of Object.keys(this.commandVariables)) delete this.commandVariables[key]
    Object.assign(this.commandVariables, local ? localVariables() : this.variables, { PATH: this.path })
  }
  private async resolve(settings: Settings): Promise<Deployment> {
    const { context, machine, lifetime } = this.host
    const machineProblem = (error: unknown): never => {
      if (error instanceof SetupError) throw error
      throw new SetupError('environmentFailed', { output: error instanceof Error ? error.message : String(error) })
    }
    if (this.local(settings)) {
      const deployment = localDeployment(machine)
      await writeEnvironment(deployment, settings.executor.blockedCommands).catch(machineProblem)
      this.updateCommandEnvironment(true)
      return deployment
    }
    this.updateCommandEnvironment(false)
    const probe = this.probe()
    const deployment = await resolveDeployment(machine, settings.sources.github?.config, probe)
    const feishu = await resolveFeishuBot(machine, this.host.localAllowed && !settings.sources.feishu?.enabled ? undefined : settings.sources.feishu?.config, probe).catch((error: unknown) => {
      if (!(error instanceof SetupError)) throw error
      this.feishuProblem = error.problem
      context.logger.warn('dsh-superagent leaves Feishu out: %s', error.message)
      return undefined
    })
    const resolved = { ...deployment, ...(feishu ? { feishu } : {}) }
    await writeEnvironment(resolved, settings.executor.blockedCommands).catch(machineProblem)
    await verifyEnvironment(resolved, context.subprocess, lifetime, workerEnvironment(machine.stateDir, this.path)).catch((error: unknown) => {
      this.restore()
      machineProblem(error)
    })
    return resolved
  }
}
