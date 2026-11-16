// @vitest-environment jsdom
import { act, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, caller, usePoll } from '../src/client/api.ts'
import { apply } from '../src/client/index.tsx'
import { App } from '../src/client/app.tsx'
import { zh } from '../src/client/locales.ts'
import { SettingsSchema } from '../src/policy.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Entry = { options: { name: string; id?: string; key?: string; order?: number; locale?: string; label?: () => string }; component: ComponentType<Record<string, unknown>> }
const t = ((key: keyof typeof zh) => zh[key] ?? key) as never
function fixture(listed: string[]) {
  const entries: Entry[] = []
  const dictionaries: Record<string, unknown> = {}
  const ctx = {
    slots: { inject: (_name: string, register: () => void) => register(), register: (options: Entry['options'], component: Entry['component']) => { entries.push({ options, component }); return () => {} } },
    locale: { register: (ns: string, value: unknown) => { dictionaries[ns] = value; return () => {} }, bind: () => t },
    effect: (effect: () => unknown) => { effect() },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(listed.map(id => [id, {}])) }) }, refresh: vi.fn(async () => {}) },
    uiWorkspace: { openSession: vi.fn() },
    layout: { selectPanel: vi.fn() },
    // Omit config form service so Deployment renders read-only.
    get: () => undefined,
  }
  apply(ctx as never)
  const entry = (name: string) => entries.find(item => item.options.name === name)!
  return { ctx, entries, dictionaries, main: entry('main'), nav: entry('sidebar.panellist') }
}
async function render(entry: Entry, props: Record<string, unknown>) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(<entry.component {...props} />) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { container, dispose: () => { act(() => { root.unmount() }); container.remove() } }
}
const serve = (status: Record<string, unknown> = { state: 'active', sessionId: 'master' }) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const parsed = new URL(url, 'http://127.0.0.1')
  if (parsed.pathname === '/superagent-status') return Response.json(status)
  const path = parsed.pathname.replace(/^\/orchestrator\/(?:global\/|sessions\/[^/]+\/)?api\//, '')
  if (path === 'overview') return Response.json({ problems: [], person: [], executor: { running: 0, queued: 0, maxWorkers: 3, idle: 0 }, flow: { triggers: 0, filtered: 0, judged: 0, accepted: 0, evaluating: 0 }, policyVersion: 'v' })
  if (path === 'state') return Response.json({ masterId: 'master', settings: SettingsSchema.parse({}), revisions: { policy: 0, eval: 0, executor: 0 }, sources: [], policy_version: 'v', health: {}, outgoing: [], load: { running: 0, queued: 0 },
    setup: { machine: { stateDir: '/srv/state', worktreeRoot: '/srv/state/worktrees', blockedCommands: [], promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000 }, problem: null, feishuProblem: null, accounts: null } })
  return Response.json({ error: 'unavailable' }, { status: 503 })
}))
afterEach(() => { vi.unstubAllGlobals() })

it('registers a localized main panel, sidebar entry and Plugin Manager row page, and no settings section', () => {
  const { entries, dictionaries, main, nav } = fixture([])
  expect(entries.map(entry => entry.options.name)).toEqual(['main', 'sidebar.panellist', 'conversation.view', 'plugins.row.config'])
  expect(entries[3]!.options).toMatchObject({ key: 'dsh-superagent#dsh-superagent', locale: 'dshSuperagent' })
  expect(entries[2]!.options).toMatchObject({ id: 'dsh-superagent', label: expect.any(Function), order: 30, locale: 'dshSuperagent' })
  expect(Object.keys(dictionaries)).toEqual(['dshSuperagent'])
  expect(main.options).toMatchObject({ key: 'dsh-superagent', locale: 'dshSuperagent' })
  expect(nav.options).toMatchObject({ id: 'dsh-superagent', order: 10, locale: 'dshSuperagent' })
  expect(nav.options.label?.()).toBe('Superagent')
})

it('shows activation diagnostics instead of falling through to the app when Router activation fails', async () => {
  serve({ state: 'inactive', error: 'stateDir is required' })
  const { main } = fixture([])
  const view = await render(main, { t })
  expect(view.container.textContent).toContain(zh.routerActivationFailed)
  expect(view.container.textContent).toContain('stateDir is required')
  view.dispose()
})

it('registers the Superagent Conversation View and scopes its management API to the current Session', async () => {
  serve({ state: 'active', instances: [{ sessionId: 'session-view', state: 'active' }] })
  const { entries } = fixture(['session-view'])
  const viewEntry = entries.find(entry => entry.options.name === 'conversation.view')!
  expect(viewEntry.options).toMatchObject({ id: 'dsh-superagent', label: expect.any(Function), order: 30 })
  expect(viewEntry.options.label?.()).toBe('Superagent')
  const view = await render(viewEntry, { t, sessionId: 'session-view', inspectCall: undefined, viewRequest: null,
    openView: vi.fn(), completeViewRequest: vi.fn() })
  expect(view.container.textContent).toContain(zh['tab.overview'])
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain('/superagent-status?sessionId=session-view')
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain('/orchestrator/sessions/session-view/api/state')
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).not.toContain('/orchestrator/global/api/state')
  view.dispose()
})

it('drops stored Session Settings routes before rendering or returning', async () => {
  serve()
  sessionStorage.setItem('dsh-superagent/session/session-route/route', JSON.stringify({ route: { page: 'overview' },
    stack: [{ page: 'settings', query: { group: 'source' } }] }))
  const view = await render({ options: { name: 'main' }, component: () => <App t={t}
    sessionId="session-route" sessionOnly openSession={async () => {}} deploymentForm={undefined} /> }, {})
  expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(zh['tab.overview'])
  expect(view.container.textContent).not.toContain(zh['tab.settings'])
  const saved = JSON.parse(sessionStorage.getItem('dsh-superagent/session/session-route/route')!)
  expect(saved.stack).toEqual([])
  view.dispose()
})

it('does not call a Session API when that Session is inactive', async () => {
  serve({ state: 'inactive' })
  const { entries } = fixture(['inactive-session'])
  const viewEntry = entries.find(entry => entry.options.name === 'conversation.view')!
  const view = await render(viewEntry, { t, sessionId: 'inactive-session', inspectCall: undefined, viewRequest: null,
    openView: vi.fn(), completeViewRequest: vi.fn() })
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
  expect(urls).toContain('/superagent-status?sessionId=inactive-session')
  expect(urls.some(url => url.includes('/orchestrator/sessions/'))).toBe(false)
  view.dispose()
})

it('opens shared settings in the homepage when a Session problem links to settings', async () => {
  sessionStorage.clear()
  serve({ state: 'active' })
  const baseFetch = fetch
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const response = await baseFetch(url, init)
    if (String(url).endsWith('/overview')) return Response.json({ ...await response.json(), problems: [{ kind: 'no-source' }] })
    return response
  }))
  const { ctx, entries } = fixture(['settings-link'])
  const entry = entries.find(item => item.options.name === 'conversation.view')!
  const view = await render(entry, { t, sessionId: 'settings-link' })
  const button = [...view.container.querySelectorAll('button')].find(item => item.textContent === zh.actionOpenSources)!
  await act(async () => { button.click() })
  expect(ctx.layout.selectPanel).toHaveBeenCalledExactlyOnceWith('dsh-superagent')
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/settings'))).toBe(false)
  expect(view.container.querySelector('.dt-settings')).toBeNull()
  view.dispose()
})

it('uses the profile-wide settings endpoint without selecting or opening a local Session', async () => {
  serve({ state: 'active', instances: [{ sessionId: 'session A', state: 'active' }] })
  const requests = vi.mocked(fetch)
  const { ctx, main } = fixture([])
  const view = await render(main, { t })
  const urls = requests.mock.calls.map(([url]) => String(url))
  expect(urls).toContain('/orchestrator/global/api/state')
  expect(urls.some(url => url.includes('/orchestrator/sessions/'))).toBe(false)
  expect(ctx.uiWorkspace.openSession).not.toHaveBeenCalled()
  expect(view.container.querySelector('select')).toBeNull()
  view.dispose()
})

it('polls one request at a time, keeps the data while new dependencies load, and polls less while hidden', async () => {
  vi.useFakeTimers()
  const calls: { limit: number; done: (value: string[]) => void }[] = []
  let shown: { data?: string[]; limit: number } = { limit: 0 }
  let setLimit = (_limit: number) => {}
  function Harness() {
    const [limit, update] = useState(1)
    setLimit = update
    const { data } = usePoll(() => new Promise<string[]>(done => { calls.push({ limit, done }) }), [limit], 1000)
    shown = { ...data ? { data } : {}, limit }
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
  expect(calls).toHaveLength(1)
  // A slow response holds the next poll back instead of overlapping.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(calls).toHaveLength(1)
  await act(async () => { calls[0]!.done(['a']) })
  expect(shown.data).toEqual(['a'])
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(calls).toHaveLength(2)
  await act(async () => { setLimit(2) })
  expect(shown).toEqual({ data: ['a'], limit: 2 })
  await act(async () => { calls[2]!.done(['a', 'b']) })
  expect(shown.data).toEqual(['a', 'b'])
  // A late response to the superseded request must not replace the newer result.
  await act(async () => { calls[1]!.done(['stale']) })
  expect(shown.data).toEqual(['a', 'b'])
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  await act(async () => { calls[3]!.done(['a', 'b']) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(calls).toHaveLength(4)
  hidden.mockRestore()
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(calls).toHaveLength(5)
  act(() => { root.unmount() })
  vi.useRealTimers()
})

it('tells a dsh-superagent that does not answer from a record it does not have, and words each failure by what failed', async () => {
  const messages = { offline: 'offline', notRunning: 'not running', serverError: (status: number) => `server ${status}`,
    requestFailed: (status: number) => `request ${status}`, setup: () => 'setup', user: ({ code }: { code: string }) => `user ${code}` }
  const call = caller(() => messages)
  const failure = async (answer: () => Promise<Response>) => {
    vi.stubGlobal('fetch', vi.fn(answer))
    const error = await call('GET tickets/:id', { id: 't1' }).then(() => undefined, (thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    const { message, status, missing, details } = error as ApiError
    return { message, status, missing, unreachable: !!details.unreachable }
  }
  expect(await failure(async () => { throw new TypeError('Failed to fetch') })).toEqual({ message: 'offline', status: 0, missing: false,
    unreachable: true })
  // DSH's web server answers an empty 404 while dsh-superagent's routes are unregistered.
  expect(await failure(async () => new Response(null, { status: 404 }))).toEqual({ message: 'not running', status: 404, missing: false,
    unreachable: true })
  expect(await failure(async () => new Response(null, { status: 502 }))).toEqual({ message: 'server 502', status: 502, missing: false,
    unreachable: true })
  expect(await failure(async () => new Response('<html>Bad request</html>', { status: 400 }))).toEqual({ message: 'request 400',
    status: 400, missing: false, unreachable: false })
  expect(await failure(async () => Response.json({ error: 'Unknown ticket', code: 'unknownTicket' }, { status: 404 }))).toEqual({
    message: 'user unknownTicket', status: 404, missing: true, unreachable: false })
})
