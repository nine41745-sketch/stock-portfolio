import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const load = source => import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`)
const { QuickNotesSession } = await load(fs.readFileSync('lib/quick-notes-session.ts', 'utf8'))
const ownerA = '00000000-0000-4000-8000-000000000001', ownerB = '00000000-0000-4000-8000-000000000002'
let user = ownerA, calls = 0, sequence = 0
const rows = new Map()
const nextRevision = () => `2026-10-15T00:00:00.${String(++sequence).padStart(6, '0')}+00:00`
const database = {
  auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
  from(table) {
    calls++
    assert.equal(table, 'scratchpad_notes')
    let operation = 'read', row, filters = {}
    const query = {
      select() { return query },
      eq(key, value) { filters[key] = value; return query },
      insert(value) { operation = 'insert'; row = value; return query },
      update(value) { operation = 'update'; row = value; return query },
      async maybeSingle() {
        if (operation === 'read') return { data: rows.get(filters.user_id) ?? null, error: null }
        assert.equal(row.user_id, user, 'Writes must be bound to the authenticated owner')
        if (operation === 'insert' && rows.has(row.user_id)) return { data: null, error: { code: '23505' } }
        if (operation === 'update') {
          assert.equal(filters.user_id, user)
          if (rows.get(user)?.updated_at !== filters.updated_at) return { data: null, error: null }
        }
        const updated = { ...row, updated_at: nextRevision() }
        rows.set(user, updated)
        return { data: updated, error: null }
      },
    }
    return query
  },
}
globalThis.__scratchpadSecurityMocks = { createClient: async () => database, NextResponse: { json: Response.json } }
const route = await load(`const { createClient, NextResponse } = globalThis.__scratchpadSecurityMocks;\n` + fs.readFileSync('app/api/scratchpad/route.ts', 'utf8').replace(/^import .+$/gm, ''))
delete globalThis.__scratchpadSecurityMocks
const put = body => route.PUT(new Request('http://synthetic.test/api/scratchpad', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const checks = []
const pass = name => checks.push(name)
const noQuery = async (body, status) => {
  const before = calls
  assert.equal((await put(body)).status, status)
  assert.equal(calls, before, 'Rejected request must not reach the table')
}
user = null
assert.equal((await route.GET()).status, 401)
await noQuery({ content: 'denied', expectedRevision: null, userId: ownerA }, 401)
pass('Anonymous GET/PUT rejected before database access')
user = ownerA
for (const body of [{ content: 'legacy write' }, { content: 'legacy write', userId: ownerA }]) await noQuery(body, 428)
pass('Every legacy write without expectedRevision is rejected')
for (const expectedRevision of [undefined, '', '1', 'yesterday', 0, {}, [], '2026-99-99T00:00:00Z']) {
  await noQuery({ content: 'invalid revision', userId: ownerA, expectedRevision }, expectedRevision === undefined ? 428 : 400)
}
pass('Missing/malformed revision cannot fall back to an upsert')
await noQuery({ content: 'missing identity', expectedRevision: null }, 403)
await noQuery({ content: 'wrong identity', userId: ownerB, expectedRevision: null }, 403)
pass('Missing/foreign client identity is rejected')
const initial = await (await route.GET()).json()
assert.deepEqual(initial, { content: '', userId: ownerA, revision: null })
assert.equal((await route.GET()).headers.get('cache-control'), 'no-store')
pass('Empty note read returns owned initial revision without caching')
const inserts = await Promise.all(['first', 'second'].map(content => put({ content, userId: ownerA, expectedRevision: null })))
assert.deepEqual(inserts.map(response => response.status).sort(), [200, 409])
pass('Concurrent first inserts allow one winner and preserve it')
const beforeRace = await (await route.GET()).json()
const updates = await Promise.all(['update A', 'update B'].map(content => put({ content, userId: ownerA, expectedRevision: beforeRace.revision })))
assert.deepEqual(updates.map(response => response.status).sort(), [200, 409])
assert.equal(rows.get(ownerA).content, 'update A')
pass('Actual handler compare-and-swap allows one concurrent update')
await put({ content: 'stale overwrite', userId: ownerA, expectedRevision: beforeRace.revision }).then(response => assert.equal(response.status, 409))
assert.equal(rows.get(ownerA).content, 'update A')
pass('Stale revisions do not replace current text')

const transport = (_url, options) => options?.method === 'PUT' ? put(JSON.parse(options.body)) : route.GET()
const session = new QuickNotesSession(transport, 15)
await session.load()
rows.set(ownerB, { user_id: ownerB, content: 'B private synthetic note', updated_at: nextRevision() })
const aBefore = structuredClone(rows.get(ownerA)), bBefore = structuredClone(rows.get(ownerB))
user = ownerB // Simulate cookies/account changing after the drawer loaded for A.
session.edit('A unsaved draft'); await session.flush()
session.edit('A newer draft'); await session.flush(); session.leave()
assert.deepEqual(rows.get(ownerA), aBefore)
assert.deepEqual(rows.get(ownerB), bBefore)
assert.equal(session.getSnapshot().content, 'A newer draft')
assert.equal(session.getSnapshot().saveStatus, 'error')
pass('Account switch keeps draft and cannot write into either account')

user = ownerA
const conflicting = new QuickNotesSession(transport)
await conflicting.load()
await put({ content: 'another session wins', userId: ownerA, expectedRevision: rows.get(ownerA).updated_at })
conflicting.edit('keep this draft'); await conflicting.flush()
assert.equal(conflicting.getSnapshot().content, 'keep this draft')
assert.equal(rows.get(ownerA).content, 'another session wins')
pass('Session/controller handles real handler conflict without losing draft')
assert(!fs.readFileSync('components/auth/UserSettingsMutationGuard.tsx', 'utf8').includes("pathname === '/api/scratchpad'"), 'Global wrapper must not swallow HTTP status needed by notes security handling')
pass('Global fetch wrapper leaves scratchpad status handling to its client')
console.log(`✓ Scratchpad security ${checks.length}/${checks.length}: actual handler with synthetic DB/Auth mock; no network`)
