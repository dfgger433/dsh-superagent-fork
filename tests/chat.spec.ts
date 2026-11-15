import { describe, expect, it, vi } from 'vitest'
import { ChatMessages, chatTools, recentChatMessageIds } from '../src/app/chat.ts'
import { chatTrigger, createChatKind, SOURCE } from '../src/sources/chat.ts'

const event = (seq: number, data: Record<string, unknown>, time = 1_700_000_000_000) => ({ type: 'user/message', seq, time: time + seq, data }) as never
function fixture(events: readonly unknown[]) {
  const handle = { read: vi.fn(async (offset = 0, length = 512) => ({ events: events.slice(offset, offset + length) as never[] })), close: vi.fn(async () => {}) }
  return { handle, context: { sessionPersistence: { flush: vi.fn(async () => {}), open: vi.fn(async () => handle) } } as never }
}

describe('local chat source', () => {
  it('indexes only durable native user messages and returns recent IDs without rescanning', async () => {
    const { context, handle } = fixture([
      event(0, { id: 'real-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Fix it' }] }),
      event(1, { id: 'relay', source: { kind: 'dsh-superagent', form: 'relay' }, content: [{ type: 'text', text: 'ignore' }] }),
      event(2, { id: 'report', source: { kind: 'user', form: 'report' }, content: [{ type: 'text', text: 'ignore' }] }),
      event(3, { id: 'plugin', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'ignore' }] }),
      event(4, { id: 'real-2', source: { kind: 'user' }, content: [{ type: 'text', text: 'Follow up' }] }),
    ])
    const messages = new ChatMessages(context, 'router')
    expect((await messages.read('real-1'))?.text).toBe('Fix it')
    expect(await recentChatMessageIds(messages)).toEqual(['real-2', 'real-1'])
    expect(messages.cachedRecentIds()).toEqual(['real-2', 'real-1'])
    expect(await messages.read('relay')).toBeUndefined()
    expect(handle.read).toHaveBeenCalledTimes(2) // one page plus the terminating empty page
  })

  it('derives a stable direct trigger and refuses empty messages', () => {
    const first = chatTrigger({ id: 'm1', text: 'hello', at: '2026-01-01T00:00:00.000Z' })
    expect(first).toMatchObject({ id: expect.any(String), source: SOURCE, human: true, addressed: 'direct', actor: { id: 'local-operator' }, threads: [{ id: 'm1' }] })
    expect(chatTrigger({ id: 'm1', text: 'hello', at: '2026-01-01T00:00:00.000Z' }).id).toBe(first.id)
    expect(() => chatTrigger({ id: 'm1', text: ' ', at: '2026-01-01T00:00:00.000Z' })).toThrow()
  })

  it('intakes by ID and never accepts caller-supplied text', async () => {
    const { context } = fixture([event(0, { id: 'real', source: { kind: 'user' }, content: [{ type: 'text', text: 'actual' }] })])
    const messages = new ChatMessages(context, 'router')
    const receive = vi.fn(async (trigger, ticketId) => ({ triggerId: trigger.id, ticketId }))
    const result = await chatTools({ messages, receive })[0]!.execute({ message_id: 'real', ticket_id: 'ticket-1' }, new AbortController().signal)
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ text: 'actual' }), 'ticket-1', expect.anything())
    expect(result).toEqual(expect.objectContaining({ ticketId: 'ticket-1' }))
    await expect(chatTools({ messages, receive })[0]!.execute({ message_id: 'fake', ticket_id: undefined }, new AbortController().signal)).rejects.toThrow('Unknown')
    const listed = await chatTools({ messages, receive })[1]!.execute({ limit: 1 }, new AbortController().signal)
    expect(listed).toEqual({ messages: [{ message_id: 'real', at: expect.any(String), preview: 'actual' }] })
  })

  it('routes channel replies through the configured Router callback', async () => {
    const send = vi.fn(async () => 'sent' as const)
    const kind = createChatKind(send)
    await expect(kind.channel!.send({ commands: {} as never }, { id: 'r', channel: { source: SOURCE, thread: 'm', address: { messageId: 'm' } }, text: 'ok', kind: 'reply' })).resolves.toBe('sent')
    expect(send).toHaveBeenCalled()
  })
})
