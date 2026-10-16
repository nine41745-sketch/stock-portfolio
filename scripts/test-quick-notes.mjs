import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const compiled = ts.transpileModule(fs.readFileSync('lib/quick-notes-session.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const { QuickNotesSession } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
assert(!fs.readFileSync('components/portfolio/PortfolioDashboard.tsx', 'utf8').includes('/api/scratchpad'), 'Dashboard must share QuickNotesDrawer rather than keep an independent autosave implementation')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let stored = 'existing synthetic note', revision = 'r0', puts = []
const transport = async (_url, options) => {
  if (options?.method !== 'PUT') return json({ content: stored, userId: 'synthetic-user', revision })
  const body = JSON.parse(options.body)
  puts.push(body)
  assert.equal(body.expectedRevision, revision)
  stored = body.content
  revision = `r${puts.length}`
  return json({ ok: true, revision })
}

const note = new QuickNotesSession(transport, 15)
await note.load()
await note.flush()
await wait(25)
assert.equal(puts.length, 0, 'Loading must never write unchanged content')
note.edit('temporary'); note.edit(stored)
await wait(25)
assert.equal(puts.length, 0, 'Reverting an edit before debounce must not write')
note.edit('first'); note.edit('latest')
await wait(25)
assert.deepEqual(puts.map(row => row.content), ['latest'], 'Debounce must coalesce real edits')
await note.flush()
assert.equal(puts.length, 1, 'Already-saved content must not be written twice')

let release, active = 0, maximum = 0
const delayed = new QuickNotesSession(async (url, options) => {
  if (options?.method === 'PUT') {
    active++; maximum = Math.max(maximum, active)
    if (JSON.parse(options.body).content === 'slow') await new Promise(resolve => { release = resolve })
    const response = await transport(url, options)
    active--
    return response
  }
  return transport(url, options)
}, 15)
await delayed.load()
delayed.edit('slow')
const saving = delayed.flush()
await wait(0)
delayed.edit('intermediate'); delayed.edit('newest')
await wait(25)
release()
await saving
assert.equal(maximum, 1, 'Writes must be single-flight even when debounce expires during a request')
assert.deepEqual(puts.slice(-2).map(row => row.content), ['slow', 'newest'])
assert.equal(stored, 'newest', 'A slow response must not overwrite the latest edit')

const failed = new QuickNotesSession(async () => json({ error: 'synthetic load failure' }, 503), 15)
await failed.load()
failed.edit(''); await failed.flush()
assert.equal(failed.getSnapshot().loadFailed, true)
assert.equal(puts.length, 3, 'Load failure must disable saves')

let firstLoad, loads = 0
const stale = new QuickNotesSession(async () => {
  const invocation = ++loads
  if (invocation === 1) await new Promise(resolve => { firstLoad = resolve })
  return json({ content: invocation === 1 ? 'stale' : 'fresh', userId: 'synthetic-user', revision: 'r0' })
})
const loading = stale.load()
await wait(0)
await stale.load()
firstLoad(); await loading
assert.equal(stale.getSnapshot().content, 'fresh', 'Aborted stale loads must not replace current content')

let conflictWrites = 0
const conflict = new QuickNotesSession(async (_url, options) => {
  if (options?.method !== 'PUT') return json({ content: 'original', userId: 'synthetic-user', revision: 'r0' })
  conflictWrites++
  return json({ error: 'changed in another window' }, 409)
}, 15)
await conflict.load(); conflict.edit('preserve my edit'); await conflict.flush()
conflict.edit('still preserve'); await wait(25); await conflict.flush()
assert.equal(conflictWrites, 1, 'Conflict must stop retries with stale revisions')
assert.equal(conflict.getSnapshot().content, 'still preserve')
assert.equal(conflict.getSnapshot().saveStatus, 'error')

delayed.edit('route transition')
delayed.leave()
const nextPage = new QuickNotesSession(transport)
await nextPage.load()
assert.equal(nextPage.getSnapshot().content, 'route transition', 'Navigation must drain edits before the next drawer reads')
assert.equal(puts.length, 4)
console.log('✓ Quick Notes autosave: unchanged, debounce, revert, races, stale loads, load failure, conflict, navigation passed')

for (const status of [401, 403, 428]) {
  let writes = 0
  const guarded = new QuickNotesSession(async (_url, options) => {
    if (options?.method !== 'PUT') return json({ content: 'synthetic original', userId: 'synthetic-user', revision: 'r0' })
    writes++
    return json({ error: 'synthetic guard rejection' }, status)
  }, 15)
  await guarded.load(); guarded.edit('retained draft'); await guarded.flush()
  guarded.edit('retained newer draft'); await wait(25); await guarded.flush(); guarded.leave()
  assert.equal(writes, 1, `${status} must stop stale/account/precondition retries`)
  assert.equal(guarded.getSnapshot().content, 'retained newer draft')
  assert.equal(guarded.getSnapshot().saveStatus, 'error')
}
console.log('✓ Quick Notes preserves drafts and stops automatic writes after 401/403/428')
