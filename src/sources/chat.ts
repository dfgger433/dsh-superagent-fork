/** Local Router chat Source: admits only durable human messages from the orchestrator Session. */
import { z } from 'zod'
import { key, type ChannelRef, type OutboundMessage, type ScopeResult, type Trigger } from '../core/index.ts'
import type { SourceKind } from './kind.ts'
import type { SourceHost } from './host.ts'

export const SOURCE = 'chat'
export const LOCAL_OPERATOR = 'local-operator'

export interface ChatMessage {
  id: string
  text: string
  at: string
  /** The Router's local operator identity. This is deliberately not read from untrusted message content. */
  actor?: string
}

export const chatThread = (messageId: string) => ({ source: SOURCE, id: messageId }) as const
export const chatChannel = (messageId: string): ChannelRef => ({ source: SOURCE, thread: messageId, address: { messageId } })

/** Converts a verified persisted Router user message to a domain Trigger. */
export function chatTrigger(message: ChatMessage): Trigger {
  const id = message.id.trim()
  const text = message.text.trim()
  if (!id) throw new Error('Chat message has no id')
  if (!text) throw new Error('Chat message has no text')
  if (!message.at) throw new Error('Chat message has no timestamp')
  return {
    id: key(SOURCE, id), source: SOURCE, threads: [chatThread(id)],
    actor: { source: SOURCE, id: LOCAL_OPERATOR }, human: true, addressed: 'direct', at: message.at,
    text, channel: chatChannel(id), meta: { local: true, messageId: id, actor: LOCAL_OPERATOR },
  }
}

export type ChatReply = (message: OutboundMessage) => Promise<'sent' | 'gone'>

const ChatConfigSchema = z.object({}).strict()
export type ChatConfig = z.infer<typeof ChatConfigSchema>

const chatScope = ({ meta }: { meta: Record<string, unknown> }): ScopeResult =>
  meta.local === true && typeof meta.messageId === 'string' ? { listened: true, observed: false, row: 'operator' } : { listened: false, reason: 'chat_not_local' }

/** Creates an isolated Source kind whose channel replies steer one Router Session. */
export function createChatKind(send: ChatReply): SourceKind<ChatConfig> {
  return {
    kind: SOURCE,
    title: { zh: '本地聊天', en: 'Local chat' },
    description: { zh: '接收 Router 主会话中已持久化的真实用户消息。', en: 'Receives durable human messages from the Router Session.' },
    schema: ChatConfigSchema,
    fields: [],
    health: [],
    scope: chatScope,
    channel: {
      send: (_host, message) => send(message),
      link: _address => ({ url: '', label: { zh: '本地聊天', en: 'Local chat' } }),
    },
    policy: {
      schema: z.object({ allowed: z.array(z.object({ id: z.string() }).strict()).default([]) }).strict(),
      fields: [],
      explicit: { zh: '本地操作员消息。', en: 'Local operator messages.' },
    },
  }
}
/** Safe default for tests and deployments that do not configure reply delivery. */
export const chatKind = createChatKind(async () => 'gone')
export const name = 'dsh-superagent-chat'
export const inject = ['orchestrator']
export function apply(ctx: { orchestrator: SourceHost; effect(work: () => () => unknown): unknown }): void {
  ctx.effect(() => { const dispose = ctx.orchestrator.sources.register(chatKind); return () => dispose() })
}
