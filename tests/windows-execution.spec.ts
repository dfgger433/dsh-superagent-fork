import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { apply, inject, scopedSubprocess } from '../src/execution-scope.ts'
import type { Context } from '@deepseek-ai/cordis'
import { Config, executable, machineOf, resolveDeployment, resolveFeishuBot, type Probe } from '../src/deployment.ts'
import { cliArgv, mergeEnvironment, prepareArgv } from '../src/infra/cli.ts'
import { workerEnvironment, writeEnvironment, workerBin } from '../src/infra/environment.ts'
import { Commands } from '../src/infra/commands.ts'
import { ExecutorConfigSchema } from '../src/policy.ts'
import { testDeployment } from './fixtures/deployment.ts'
const exec = promisify(execFile)

it('accepts a fresh bundle configuration without stateDir and does not create storage', () => {
  const config = Config({})
  expect(config.stateDir).toMatch(/[\\/]superagent$/)
  expect(machineOf(config).stateDir).toBe(config.stateDir)
})
it('accepts POSIX, drive and UNC absolute paths and rejects relative paths', () => {
  for (const stateDir of ['/var/state', 'C:\\Agent Data', '\\\\server\\share\\state']) {
    expect(() => Config({ stateDir })).not.toThrow()
    expect(ExecutorConfigSchema.parse({ directory: stateDir }).directory).toBe(stateDir)
  }
  for (const stateDir of ['state', 'C:state', '~/.state']) expect(() => Config({ stateDir })).toThrow()
})
it('selects the native prepare language and quotes CLI script arguments as literals', () => {
  expect(prepareArgv('echo hi', 'linux')).toEqual(['sh', '-c', 'echo hi'])
  expect(prepareArgv('Write-Output hi', 'win32')[0]).toBe('pwsh')
  expect(cliArgv(['C:\\a b\\cli.ps1', "a'b", '$(bad); & x'], 'win32').at(-1)).toContain("@('a''b','$(bad); & x')")
})
it('creates worker environments without changing process.env', () => {
  const before = { ...process.env }
  const env = workerEnvironment('/state', '/usr/bin')
  expect(env.PATH).toBe([workerBin('/state'), '/usr/bin'].join(delimiter))
  expect(env.GH_TOKEN).toBeUndefined()
  expect(process.env).toEqual(before)
})
it('decorates each spawn and terminal independently, preserving tombstones and checking ownership', () => {
  const spawn = vi.fn(), spawnTerminal = vi.fn(), resolveExecutable = vi.fn()
  const upstream = { spawn, spawnTerminal, resolveExecutable } as unknown as SubprocessRuntime
  let environment: Record<string, string | undefined> | undefined = { PATH: '/worker', GH_TOKEN: undefined }
  const scoped = scopedSubprocess(upstream, () => environment)
  const spec = { argv: ['git'], cwd: '/work', env: { CUSTOM: 'value', GH_TOKEN: 'operator' }, graceMs: 1000, stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' } } as Parameters<SubprocessRuntime['spawn']>[0]
  scoped.spawn(spec)
  expect(spawn.mock.calls[0]![0].env).toEqual({ CUSTOM: 'value', PATH: '/worker', GH_TOKEN: undefined })
  expect(spec.env).toEqual({ CUSTOM: 'value', GH_TOKEN: 'operator' })
  environment = { PATH: '/child' }
  scoped.spawnTerminal(spec as unknown as Parameters<SubprocessRuntime['spawnTerminal']>[0])
  expect(spawnTerminal.mock.calls[0]![0].env.PATH).toBe('/child')
  environment = undefined
  expect(() => scoped.spawn(spec)).toThrow('No authorized')
  expect(upstream.spawn).toBe(spawn)
})

it('mounts eagerly without an owner and resolves the current initiator and owner per invocation', () => {
  expect(inject).not.toContain('orchestrator')
  const spawn = vi.fn()
  const upstream = { spawn } as unknown as SubprocessRuntime
  let owner: { environmentFor(id: string): Record<string, string> | undefined } | undefined
  let agent: { id: string } | undefined
  let decorated!: SubprocessRuntime
  const ctx = { root: { get: (name: string) => name === 'subprocess' ? upstream : owner },
    agents: { currentInitiator: () => agent }, provide: (_name: string, value: SubprocessRuntime) => { decorated = value } } as unknown as Context
  apply(ctx)
  const spec = { argv: ['git'], cwd: '/work', graceMs: 1000, stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' } } as Parameters<SubprocessRuntime['spawn']>[0]
  expect(() => decorated.spawn(spec)).toThrow('No authorized')
  agent = { id: 'worker-owned' }
  owner = { environmentFor: id => id === 'worker-owned' ? { PATH: '/owner-one' } : undefined }
  decorated.spawn(spec)
  expect(spawn.mock.calls[0]![0].env.PATH).toBe('/owner-one')
  agent = { id: 'ordinary' }
  expect(() => decorated.spawn(spec)).toThrow('No authorized')
  agent = { id: 'worker-owned' }; owner = undefined
  expect(() => decorated.spawn(spec)).toThrow('No authorized')
})

describe.skipIf(process.platform !== 'win32')('real Windows CLI smoke', () => {
  it('resolves account probes and validates Feishu bot identity using explicit environment overrides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'superagent probes '))
    try {
      const gh = join(dir, 'github account.ps1'), lark = join(dir, 'lark account.ps1')
      await writeFile(gh, `if ($args[1] -eq 'user') { '{"login":"agent-bot","id":7}' } else { '{"name":"acme/widgets","push":true}' }`)
      await writeFile(lark, `if ($env:LARKSUITE_CLI_NO_UPDATE_NOTIFIER -ne '1' -or $env:LARKSUITE_CLI_NO_SKILLS_NOTIFIER -ne '1') { exit 9 }; switch ($args[0]) { auth { '{"appId":"cli_bot","brand":"lark","identities":{"bot":{"status":"ready"}}}' }; config { 'strict-mode: bot' }; api { '{"bot":{"open_id":"ou_bot","app_name":"fixture"}}' } }`)
      const probe: Probe = async (argv, env) => {
        const command = cliArgv(argv)
        return (await exec(command[0]!, command.slice(1), { cwd: dir, env: mergeEnvironment(process.env, env ?? {}) })).stdout
      }
      const machine = machineOf(Config({ stateDir: dir }))
      expect(await resolveDeployment(machine, { repository: 'acme/widgets', cli: gh }, probe)).toMatchObject({ repository: 'acme/widgets', github: { login: 'agent-bot' } })
      expect(await resolveFeishuBot(machine, { cli: lark }, probe)).toMatchObject({ appId: 'cli_bot', botId: 'ou_bot', brand: 'lark' })
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 30_000)
  it('runs configured cmd/ps1 CLIs, worker shim forwarding, prepare, blocking, and git identity with spaces in paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'superagent Windows '))
    const before = { ...process.env }
    try {
      const real = join(dir, 'real tools'); await mkdir(real)
      const ps1 = join(real, 'account.ps1')
      await writeFile(ps1, "if ($args[0] -eq 'auth') { [Console]::WriteLine(\"username=fixture`npassword=fixture-only\"); exit 0 }; [Console]::WriteLine((ConvertTo-Json -InputObject @($args) -Compress))\n")
      const cmd = join(real, 'account.cmd')
      await writeFile(cmd, '@echo off\r\necho cmd-ok\r\n')
      expect(executable('account', real).toLowerCase()).toBe(cmd.toLowerCase())
      const deployment = testDeployment({ stateDir: dir, github: { ...testDeployment().github, cli: ps1 }, feishu: undefined })
      await writeEnvironment(deployment, ['personal-gh'])
      // Repeat verifies ownership of generated cmd and PowerShell files.
      await writeEnvironment(deployment, ['personal-gh'])
      const env = mergeEnvironment(process.env, workerEnvironment(dir))
      const commands = new Commands(() => deployment, workerEnvironment(dir), new AbortController().signal)
      const args = ['space value', "quote'value", '$(throw 1); & x', '中文']
      expect(JSON.parse(await commands.run(ps1, args))).toEqual(args)
      expect((await commands.run(cmd, [])).trim()).toBe('cmd-ok')
      const failing = join(real, 'failing.ps1')
      await writeFile(failing, "throw 'fixture-failure'")
      await expect(commands.run(failing, [])).rejects.toMatchObject({ exitCode: 1 })
      const [pwsh, ...parameters] = prepareArgv('$worker_args = @(' + args.map(value => "'" + value.replaceAll("'", "''") + "'").join(',') + '); & gh @worker_args; exit $LASTEXITCODE')
      expect(JSON.parse((await exec(pwsh!, parameters, { cwd: dir, env })).stdout)).toEqual(args)
      await expect(exec('pwsh', ['-NoProfile', '-File', join(workerBin(dir), 'personal-gh.ps1')], { env })).rejects.toMatchObject({ code: 1 })
      expect((await commands.git(['config', '--get', 'user.useConfigOnly'], dir)).trim()).toBe('true')
      const credential = exec('git', ['credential', 'fill'], { cwd: dir, env })
      credential.child.stdin?.end('protocol=https\nhost=github.com\n\n')
      expect((await credential).stdout).toContain('username=fixture')
      const prepare = prepareArgv("New-Item -ItemType Directory -Path 'prepared workspace' | Out-Null")
      await exec(prepare[0]!, prepare.slice(1), { cwd: dir, env })
      expect(process.env).toEqual(before)
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 30_000)
})
