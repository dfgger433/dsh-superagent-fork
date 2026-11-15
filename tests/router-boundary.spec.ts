import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
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
  const run = vi.fn(async () => ({}))
  const definition = (name: string) => ({ name, description: name, parameters: { type: 'object' as const, properties: {} },
    output: { schema: { type: 'object' as const, additionalProperties: true }, render: () => [] }, execute: run })
  ctx.tools.register(definition('write'))
  ctx.tools.register(definition('bash'))
  let names = new Set<string>()
  const dispose = protectRouter(router, () => names)
  scope.ctx.tools.register(definition('orchestrator_read'))
  scope.ctx.tools.register(definition('orchestrator_fake'))
  scope.ctx.tools.register(definition('pwsh'))
  expect(ctx.tools.schemas(router).map(tool => tool.name)).not.toContain('write')
  const call = (name: string) => ctx.tools.execute({ agent: router, callId: ToolCallId(name), name, arguments: {}, signal: new AbortController().signal })
  expect((await call('orchestrator_read')).isError).toBe(true)
  names = new Set(['orchestrator_read', 'pwsh'])
  expect((await call('orchestrator_read')).isError).toBe(false)
  expect((await call('orchestrator_fake')).isError).toBe(true)
  expect((await call('pwsh')).isError).toBe(true)
  expect(run).toHaveBeenCalledTimes(1)
  dispose()
  await scope.dispose()
})
