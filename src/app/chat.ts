/** Durable Router-user message projection and the local-chat intake tool. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { z } from 'zod'
import { chatTrigger, type ChatMessage } from '../sources/chat.ts'
import type { Tool } from './tools/tool.ts'

interface StoredMessage {
  id?: unknown
  content?: unknown
  source?: unknown
}
interface StoredSource { kind?: unknown; plugin?: unknown; form?: unknown; summary?: unknown }

/** Extracts text blocks without accepting model/tool metadata as user text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const text = (item as { type?: unknown; text?: unknown }).text
    return (item as { type?: unknown }).type === 'text' && typeof text === 'string' ? [text] : []
  }).join('').trim()
}

/** True only for a native human prompt written by the Router UI. */
function nativeUser(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false
  const value = source as StoredSource
  // Plugin, relay and report messages are not local operator input.
  return value.kind === 'user' && value.plugin === undefined && value.form === undefined && value.summary === undefined
}

/** Reads the Router's persisted Session log once, then serves indexed reads and recent IDs. */
export class ChatMessages {
  private loaded?: Promise<void>
  private readonly messages = new Map<string, ChatMessage>()
  private readonly order: string[] = []
  private readonly stopListening?: () => void
  constructor(private readonly context: Context, readonly routerId: string) {
    const on = (context as unknown as { on?: (event: string, listener: (session: { id?: unknown }, value: SessionEvent) => void) => (() => void) }).on
    this.stopListening = on?.call(context, 'session/event', (session, event) => {
      if (String(session?.id ?? '') !== this.routerId || event.type !== 'user/message') return
      this.ingest(event)
    })
  }

  /** Unsubscribe from live events when the Runtime disposes this reader. */
  dispose(): void { this.stopListening?.() }

  private ingest(event: SessionEvent): void {
    if (event.type !== 'user/message') return
    const data = event.data as unknown as StoredMessage
    if (!nativeUser(data.source) || typeof data.id !== 'string') return
    const text = textOf(data.content)
    if (!text) return
    if (!this.messages.has(data.id)) this.order.push(data.id)
    this.messages.set(data.id, { id: data.id, text, at: new Date(event.time).toISOString() })
    // A live event can arrive while the initial persistence scan is in flight; keep recent order chronological.
    this.order.sort((left, right) => {
      const at = Date.parse(this.messages.get(left)!.at) - Date.parse(this.messages.get(right)!.at)
      return at || left.localeCompare(right)
    })
  }

  private async load(signal?: AbortSignal): Promise<void> {
    if (!this.loaded) this.loaded = this.scan(signal).catch(error => { this.loaded = undefined; throw error })
    await this.loaded
  }

  private async scan(signal?: AbortSignal): Promise<void> {
    const persistence = this.context.sessionPersistence
    if (!persistence) throw new Error('Session persistence is unavailable')
    await persistence.flush()
    signal?.throwIfAborted()
    const handle = await persistence.open(this.routerId as SessionId, 'read')
    try {
      for (let offset = 0; ; ) {
        signal?.throwIfAborted()
        const page = await handle.read(offset, 512)
        if (!page.events.length) break
        for (const event of page.events) this.ingest(event)
        offset += page.events.length
      }
    } finally { await handle.close() }
  }

  async read(messageId: string, signal?: AbortSignal): Promise<ChatMessage | undefined> {
    await this.load(signal)
    return this.messages.get(messageId)
  }

  /** Synchronous IDs already present in the projection cache; useful for prompt text. */
  cachedRecentIds(limit = 20): string[] {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be positive')
    return this.order.slice(-limit).reverse()
  }

  async recent(limit = 20, signal?: AbortSignal): Promise<ChatMessage[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be positive')
    await this.load(signal)
    return this.cachedRecentIds(limit).map(id => this.messages.get(id)!).filter(Boolean)
  }
}

export interface ChatToolHost {
  readonly messages: ChatMessages
  /** Intake performs Engine receive and, when ticket_id is supplied, explicit attach. */
  receive(trigger: ReturnType<typeof chatTrigger>, ticketId: string | undefined, signal: AbortSignal): Promise<unknown> | unknown
}

/** Returns recent verified IDs for inclusion in the Router prompt. */
export async function recentChatMessageIds(messages: ChatMessages, limit = 20, signal?: AbortSignal): Promise<string[]> {
  return (await messages.recent(limit, signal)).map(message => message.id)
}

/** Main Session tool: accepts only a message ID from ChatMessages and never caller-supplied text. */
export function chatTools(host: ChatToolHost): Tool[] {
  const schema = z.object({ message_id: z.string().trim().min(1), ticket_id: z.string().trim().min(1).optional() }).strict()
  const intake = {
    name: 'orchestrator_chat_intake',
    description: 'Intake one recent real human message from the Router chat by message_id. Read the message from durable history; never provide or paraphrase its text. Use ticket_id only for an explicit follow-up to that ticket. A new work request omits ticket_id. Do not intake ordinary conversation.',
    schema,
    execute: async (raw: unknown, signal: AbortSignal) => {
      const { message_id, ticket_id } = schema.parse(raw)
      const message = await host.messages.read(message_id, signal)
      if (!message) throw new Error('Unknown or non-human chat message_id')
      return host.receive(chatTrigger(message), ticket_id, signal)
    },
  }
  const recentSchema = z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict()
  const recent = {
    name: 'orchestrator_chat_messages',
    description: 'List recent verified human Router chat messages. Use the returned message_id with orchestrator_chat_intake; caller text is never accepted as authority.',
    schema: recentSchema,
    execute: async (raw: unknown, signal: AbortSignal) => {
      const { limit } = recentSchema.parse(raw)
      return { messages: (await host.messages.recent(limit, signal)).map(message => ({ message_id: message.id, at: message.at, preview: message.text.slice(0, 240) })) }
    },
  }
  return [intake, recent]
}
