import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Setup, setupChanged } from '../src/app/setup.ts'
import { localDeployment } from '../src/deployment.ts'
import { credentialHelper, workerBin, workerGitConfig, workerEnvironment, writeEnvironment } from '../src/infra/environment.ts'
import { cliArgv, mergeEnvironment } from '../src/infra/cli.ts'
import { SettingsSchema, type Settings } from '../src/policy.ts'
import { testMachine } from './fixtures/deployment.ts'
const exec = promisify(execFile)
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'local router ')) })
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) })
const settings = (config: Record<string, string> = {}, enabled = true): Settings => SettingsSchema.parse({ sources: { github: { enabled, config } } })
const setup = (localAllowed = true, context = new Context()) => new Setup({ context, localAllowed, machine: testMachine({ stateDir: dir }), lifetime: new AbortController().signal, restart: vi.fn() })

it('starts a local Router without even accessing the subprocess service and leaves host env unchanged', async () => {
  const before = { ...process.env }, value = setup(), captured = value.commandEnvironment
  expect(await value.run(settings())).toBe(true)
  expect(value.deployment).toMatchObject({ local: true, repository: '', github: { cli: '', login: '', noreply: '' } })
  expect(value.commandEnvironment).toBe(captured)
  expect(captured).not.toHaveProperty('GIT_CONFIG_GLOBAL')
  expect(value.workerEnvironment.PATH?.split(delimiter)[0]).toBe(workerBin(dir))
  for (const name of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_CONFIG_COUNT', 'GIT_ASKPASS', 'GIT_DIR']) expect(value.workerEnvironment).not.toHaveProperty(name)
  expect(await readFile(workerGitConfig(dir), 'utf8')).not.toMatch(/credential|user|insteadOf/)
  await value.checkAccounts('source:github', settings())
  await value.checkAccounts('source:feishu', settings())
  expect(process.env).toEqual(before)
})
it('ignores disabled remote configuration but preserves errors for enabled partial config and legacy setup', async () => {
  expect(await setup().run(settings({ repository: 'acme/widgets', cli: 'missing-gh' }, false))).toBe(true)
  const partial = setup()
  expect(await partial.run(settings({ repository: 'acme/widgets' }))).toBe(false)
  expect(partial.problem?.code).toBe('agentCliUnset')
  const onlyCli = setup()
  expect(await onlyCli.run(settings({ cli: 'missing-gh' }))).toBe(false)
  expect(onlyCli.problem?.code).toBe('repositoryUnset')
  const legacy = setup(false)
  expect(await legacy.run(settings())).toBe(false)
  expect(legacy.problem?.code).toBe('repositoryUnset')
})
it('switches local to remote and back while keeping captured host env references current', async () => {
  const cli = join(dir, 'agent-gh')
  await writeFile(cli, '#!/bin/sh\n', { mode: 0o755 })
  const context = new Context()
  const spawn = vi.fn(({ argv }: { argv: string[] }) => {
    const text = argv[0] === 'git' ? `file:${workerGitConfig(dir)}\0${credentialHelper(cli)}\0`
      : argv[2] === 'user' ? '{"login":"agent-bot","id":7}' : '{"name":"acme/widgets","push":true}'
    return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text }) } } }
  })
  context.provide('subprocess', { spawn } as never)
  const value = setup(true, context), captured = value.commandEnvironment
  expect(await value.run(settings())).toBe(true)
  expect(spawn).not.toHaveBeenCalled()
  expect(await value.run(settings({ cli, repository: 'acme/widgets' }))).toBe(true)
  expect(value.deployment.local).toBeUndefined()
  expect(captured.GIT_CONFIG_GLOBAL).toBe(workerGitConfig(dir))
  expect(value.workerEnvironment.GIT_CONFIG_GLOBAL).toBe(workerGitConfig(dir))
  expect(await readFile(workerGitConfig(dir), 'utf8')).toContain('credential')
  spawn.mockClear()
  expect(await value.run(settings())).toBe(true)
  expect(spawn).not.toHaveBeenCalled()
  expect(captured).not.toHaveProperty('GIT_CONFIG_GLOBAL')
  expect(await readFile(workerGitConfig(dir), 'utf8')).not.toContain('credential')
})
it('restarts on remote enable/disable and account edits but not ordinary execution edits', () => {
  const before = settings()
  expect(setupChanged(before, settings({}, false))).toBe(true)
  expect(setupChanged(before, settings({ cli: 'gh', repository: 'acme/widgets' }))).toBe(true)
  expect(setupChanged(before, { ...before, executor: { ...before.executor, maxWorkers: 2 } })).toBe(false)
  expect(setupChanged(before, { ...before, sources: { ...before.sources, feishu: { enabled: true, config: {} } } })).toBe(true)
})
it('writes harmless local CLI wrappers and retains the user Git configuration and identity in real commands', async () => {
  const userConfig = join(dir, 'user.gitconfig')
  await writeFile(userConfig, '[user]\n name = Local User\n email = local@example.com\n[core]\n abbrev = 12\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', userConfig)
  vi.stubEnv('GIT_AUTHOR_NAME', 'Local Author')
  const before = { ...process.env }
  const deployment = localDeployment(testMachine({ stateDir: dir }))
  await writeEnvironment(deployment, ['personal-gh'])
  await writeEnvironment(deployment, ['personal-gh'])
  const env = mergeEnvironment(process.env, workerEnvironment(dir, process.env.PATH, true))
  expect((await exec('git', ['config', 'user.name'], { cwd: dir, env })).stdout.trim()).toBe('Local User')
  expect((await exec('git', ['config', 'core.abbrev'], { cwd: dir, env })).stdout.trim()).toBe('12')
  expect(env.GIT_AUTHOR_NAME).toBe('Local Author')
  for (const name of ['gh', 'lark-cli', 'personal-gh']) {
    const argv = cliArgv([join(workerBin(dir), name + (process.platform === 'win32' ? '.ps1' : ''))])
    await expect(exec(argv[0]!, argv.slice(1), { cwd: dir, env })).rejects.toMatchObject({ code: 1 })
  }
  expect(process.env).toEqual(before)
}, 30_000)
