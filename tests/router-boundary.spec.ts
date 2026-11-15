import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { expect, it, vi } from 'vitest'
import { protectRouter } from '../src/app/router-boundary.ts'

it('hides inherited tools and rejects unapproved same-scope tools by exact name', async () => {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {} } as never)
  new ToolRuntime(ctx)
  const router = {} as Agent
  const scope = createScope(ctx, router)
  Object.assign(router, { ctx: scope.ctx })
  const executions = new Map<string, ReturnType<typeof vi.fn>>()
  const definition = (name: string) => {
    const execute = vi.fn(async () => ({ name })); executions.set(name, execute)
    return { name, description: name, parameters: { type: 'object' as const, properties: {} },
      output: { schema: { type: 'object' as const, additionalProperties: true }, render: () => [] }, execute }
  }
  ctx.tools.register(definition('write'))
  ctx.tools.register(definition('bash'))
  const identities = new Map<string, Function>()
  const dispose = protectRouter(router, () => identities)
  scope.ctx.tools.register(definition('orchestrator_read'))
  scope.ctx.tools.register(definition('orchestrator_fake'))
  scope.ctx.tools.register(definition('pwsh'))
  expect(ctx.tools.schemas(router).map(tool => tool.name)).not.toContain('write')
  const call = (name: string) => ctx.tools.execute({ agent: router, callId: ToolCallId(name), name, arguments: {}, signal: new AbortController().signal })
  expect((await call('orchestrator_read')).isError).toBe(true)
  const approved = scope.ctx.tools.get('orchestrator_read', scopeOf(scope.ctx))!
  const fake = scope.ctx.tools.get('orchestrator_fake', scopeOf(scope.ctx))!
  identities.set('orchestrator_read', fake.execute)
  expect((await call('orchestrator_read')).isError).toBe(true)
  identities.set('orchestrator_read', approved.execute)
  expect((await call('orchestrator_read')).isError).toBe(false)
  expect((await call('orchestrator_fake')).isError).toBe(true)
  identities.set('pwsh', scope.ctx.tools.get('pwsh', scopeOf(scope.ctx))!.execute)
  expect((await call('pwsh')).isError).toBe(true)
  expect(executions.get('orchestrator_read')).toHaveBeenCalledTimes(1)
  expect(executions.get('orchestrator_fake')).not.toHaveBeenCalled()
  expect(executions.get('pwsh')).not.toHaveBeenCalled()
  dispose()
  await scope.dispose()
})
