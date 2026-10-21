import assert from 'node:assert/strict'
import test from 'node:test'
import { assertLocalDockerEndpoint } from './qa/database-lp-safety.mjs'
import { existsSync, readFileSync } from 'node:fs'

test('local Windows named pipe and absolute Unix socket accepted without network access', () => {
  for(const p of ['npipe:////./pipe/dockerDesktopLinuxEngine','unix:///var/run/docker.sock']) assert.equal(assertLocalDockerEndpoint(p),p)
})
test('remote named pipes and network/relative/malformed endpoints rejected without contacting Docker', () => {
  for(const p of ['npipe:////server/pipe/docker_engine','npipe://server/pipe/docker_engine','tcp://127.0.0.1:2375','ssh://remote','unix://relative','unix:////server/socket','',null]) assert.throws(()=>assertLocalDockerEndpoint(p))
})
test('manual security migration runs explicitly after legacy bootstrap and is not auto-applied on empty DB', () => {
  const root=new URL('../',import.meta.url)
  assert.equal(existsSync(new URL('supabase/migrations/20261021191552_least_privilege_application_boundary.sql',root)),false)
  assert.equal(existsSync(new URL('supabase/migration_least_privilege_v1.40.0.sql',root)),true)
  const bootstrap=readFileSync(new URL('scripts/qa/bootstrap-local-supabase.sh',root),'utf8')
  const application=bootstrap.lastIndexOf('< supabase/migration_least_privilege_v1.40.0.sql')
  const watchlist=bootstrap.lastIndexOf('< supabase/verify_portfolio_watchlist_v1.35.0.sql')
  const verifier=bootstrap.lastIndexOf('< supabase/verify_least_privilege.sql')
  assert.ok(watchlist>=0 && application>watchlist && verifier>application)
})
