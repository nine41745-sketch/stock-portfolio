import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import { assertRoleName, buildPublicRoleDependenciesScript, PUBLIC_ROLE_DEPENDENCIES_QUERY } from './public-role-dependencies.mjs'

const PROJECT_REF = /^[a-z0-9]{20}$/
const SERVICE_HOST = ref => `db.${ref}.supabase.co`
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000
const MAX_TIMEOUT_MS = 8 * 60 * 60 * 1000
const MAX_SCHEMA_ACL_BYTES = 256 * 1024

function validateConfig(config) {
  assert.ok(config && typeof config === 'object' && !Array.isArray(config))
  const allowed = ['projectRef', 'host', 'port', 'database', 'username', 'pgPassfile', 'sslRootCert', 'pgDumpPath', 'psqlPath', 'timeoutMs']
  assert.deepEqual(Object.keys(config).sort(), allowed.sort(), 'Unexpected PostgreSQL export configuration')
  assert.match(config.projectRef, PROJECT_REF, 'Invalid Supabase project reference')
  assert.equal(config.host, SERVICE_HOST(config.projectRef), 'Database host does not match the expected project')
  assert.ok(Number.isInteger(config.port) && config.port >= 1 && config.port <= 65535)
  assert.match(config.database, /^[A-Za-z0-9_-]{1,63}$/)
  assert.match(config.username, /^[A-Za-z0-9_.-]{1,128}$/)
  for (const field of ['pgPassfile', 'sslRootCert', 'pgDumpPath', 'psqlPath']) {
    assert.ok(typeof config[field] === 'string' && config[field].length > 0)
    assert.ok(resolve(config[field]) === config[field], `${field} must be an absolute path`)
  }
  assert.ok(Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0 && config.timeoutMs <= MAX_TIMEOUT_MS)
}

export function buildPostgresDumpArguments({ projectRef, host, port, database, username }) {
  assert.match(projectRef, PROJECT_REF)
  assert.equal(host, SERVICE_HOST(projectRef), 'Database host does not match the expected project')
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535)
  assert.match(database, /^[A-Za-z0-9_-]{1,63}$/)
  assert.match(username, /^[A-Za-z0-9_.-]{1,128}$/)
  return [
    '--no-password', '--host', host, '--port', String(port), '--username', username,
    '--dbname', database, '--format=custom', '--schema=public',
  ]
}

// Retained only as a fail-closed guard for obsolete callers. Never execute pg_dumpall.
export function buildPostgresRolesArguments() {
  throw new Error('Global role export is disabled; use scoped public role dependencies')
}

const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`

/** Build a deterministic, bounded schema-ACL restore script from catalog data. */
export function buildPublicSchemaAclScript(entries) {
  assert.ok(Array.isArray(entries) && entries.length <= 512, 'Public schema ACL entries are invalid or exceed the bound')
  const grouped = new Map()
  const grantees = new Set()
  for (const entry of entries) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry))
    assert.deepEqual(Object.keys(entry).sort(), ['grantable', 'grantee', 'grantor', 'privilege'])
    for (const field of ['grantee', 'grantor']) {
      const value = entry[field]
      if (value !== null) assertRoleName(value)
      assert.ok(field === 'grantee' && value === null || typeof value === 'string' && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= 63 && !/[\u0000-\u001f\u007f]/.test(value))
    }
    assert.ok(['USAGE', 'CREATE'].includes(entry.privilege))
    assert.equal(typeof entry.grantable, 'boolean')
    const grantee = entry.grantee === null ? 'PUBLIC' : quoteIdentifier(entry.grantee)
    const grantor = quoteIdentifier(entry.grantor)
    if (entry.grantee !== null) grantees.add(grantee)
    const key = JSON.stringify([grantor, grantee, entry.grantable])
    const group = grouped.get(key) ?? { grantor, grantee, grantable: entry.grantable, privileges: new Set() }
    group.privileges.add(entry.privilege)
    grouped.set(key, group)
  }
  const lines = ['BEGIN;', 'REVOKE ALL ON SCHEMA public FROM PUBLIC;']
  for (const grantee of [...grantees].sort()) lines.push(`REVOKE ALL ON SCHEMA public FROM ${grantee};`)
  for (const group of [...grouped.values()].sort((a, b) => a.grantor.localeCompare(b.grantor) || a.grantee.localeCompare(b.grantee) || Number(a.grantable) - Number(b.grantable))) {
    lines.push(`SET LOCAL ROLE ${group.grantor};`)
    lines.push(`GRANT ${[...group.privileges].sort().join(', ')} ON SCHEMA public TO ${group.grantee}${group.grantable ? ' WITH GRANT OPTION' : ''};`)
    lines.push('RESET ROLE;')
  }
  lines.push('COMMIT;')
  const script = `${lines.join('\n')}\n`
  assert.ok(Buffer.byteLength(script) <= MAX_SCHEMA_ACL_BYTES, 'Public schema ACL script exceeds its bound')
  return script
}

async function assertSafeFile(path, label) {
  const absolute = resolve(path)
  assert.equal(absolute, path, `${label} path must be absolute and normalized`)
  const info = await lstat(absolute)
  assert.ok(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular file`)
  return absolute
}

async function executableVersion(path, label, spawnProcess = spawn) {
  const child = spawnProcess(path, ['--version'], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: safeChildEnvironment(),
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => { if (output.length < 512) output += chunk.slice(0, 512 - output.length) })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, `${label} version check failed`)
  const version = output.trim()
  assert.ok(version.length > 0 && version.length <= 512 && !/[\r\n]/.test(version), `${label} version output is invalid`)
  return version
}

function postgresClientRelease(version, label) {
  const match = version.match(new RegExp(`^${label} \\(PostgreSQL\\) (\\d+(?:\\.\\d+){1,2})(?:\\s|$)`, 'i'))
  assert.ok(match, `${label} did not report a recognized PostgreSQL version`)
  return match[1]
}

function safeChildEnvironment(config = {}) {
  const env = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  if (config.pgPassfile) env.PGPASSFILE = config.pgPassfile
  if (config.sslRootCert) env.PGSSLROOTCERT = config.sslRootCert
  env.PGSSLMODE = 'verify-full'
  return env
}

function processOutputStream(path, args, config, label, spawnProcess = spawn) {
  const output = Readable.from((async function* () {
    const child = spawnProcess(path, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: safeChildEnvironment(config),
    })
    child.stderr.resume()
    const closed = once(child, 'close')
    const timeout = setTimeout(() => child.kill(), config.timeoutMs)
    timeout.unref?.()
    try {
      for await (const chunk of child.stdout) yield chunk
      const [code, signal] = await closed
      if (code !== 0) throw new Error(`${label} failed (${code ?? signal ?? 'unknown'})`)
    } catch {
      child.kill()
      throw new Error(`${label} stream failed`)
    } finally {
      clearTimeout(timeout)
      if (!child.killed) child.kill()
    }
  })(), { objectMode: false, highWaterMark: 64 * 1024 })
  return output
}

/**
 * Creates read-only PostgreSQL component streams. The caller must pipe them
 * directly into the encrypted-set writer. No password is accepted as an
 * argument or inherited from the parent process; libpq reads the external
 * PGPASSFILE path and enforces TLS hostname verification.
 */
export async function createPostgresBackupStreams(config, options = {}) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options))
  assert.deepEqual(Object.keys(options), options.spawnProcess ? ['spawnProcess'] : [], 'Unexpected PostgreSQL process adapter')
  const spawnProcess = options.spawnProcess ?? spawn
  assert.equal(typeof spawnProcess, 'function')
  validateConfig(config)
  const pgPassfile = await assertSafeFile(config.pgPassfile, 'PGPASSFILE')
  const sslRootCert = await assertSafeFile(config.sslRootCert, 'PostgreSQL CA certificate')
  const pgDumpPath = await assertSafeFile(config.pgDumpPath, 'pg_dump')
  const psqlPath = await assertSafeFile(config.psqlPath, 'psql')
  const pgDumpVersion = await executableVersion(pgDumpPath, 'pg_dump', spawnProcess)
  const psqlVersion = await executableVersion(psqlPath, 'psql', spawnProcess)
  const pgDumpRelease = postgresClientRelease(pgDumpVersion, 'pg_dump')
  const psqlRelease = postgresClientRelease(psqlVersion, 'psql')
  assert.ok(pgDumpRelease === psqlRelease, 'PostgreSQL client versions must match')
  const common = { ...config, pgPassfile, sslRootCert }
  const connection = { projectRef: config.projectRef, host: config.host, port: config.port, database: config.database, username: config.username }
  return {
    source: {
      projectRef: config.projectRef,
      schema: 'public',
      capturedAt: new Date().toISOString(),
      pgDumpVersion,
      psqlVersion,
      serverVersion: 'NOT_QUERIED',
      rolesDumpVersion: 'public-role-dependencies-v1 (psql catalog query)',
      snapshot: 'pg_dump public snapshot; scoped role dependencies and schema ACL captured separately',
    },
    components: [
      { name: 'database-public', stream: processOutputStream(pgDumpPath, buildPostgresDumpArguments(connection), common, 'pg_dump', spawnProcess) },
      { name: 'public-role-dependencies', stream: publicRoleDependenciesStream(psqlPath, connection, common, spawnProcess) },
      { name: 'public-schema-acl', stream: publicSchemaAclStream(psqlPath, connection, common, spawnProcess) },
    ],
  }
}

const PUBLIC_SCHEMA_ACL_QUERY = `SELECT coalesce(json_agg(jsonb_build_object(
  'grantee', CASE a.grantee WHEN 0 THEN NULL ELSE pg_get_userbyid(a.grantee) END,
  'grantor', pg_get_userbyid(a.grantor),
  'privilege', a.privilege_type,
  'grantable', a.is_grantable
) ORDER BY a.grantee, a.privilege_type, a.is_grantable), '[]'::json)::text
FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
WHERE n.nspname = 'public';`

function publicSchemaAclStream(psqlPath, connection, config, spawnProcess = spawn) {
  const args = [
    '--no-password', '--host', connection.host, '--port', String(connection.port), '--username', connection.username,
    '--dbname', connection.database, '--set=ON_ERROR_STOP=1', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--command', PUBLIC_SCHEMA_ACL_QUERY,
  ]
  const source = processOutputStream(psqlPath, args, config, 'psql public-schema ACL query', spawnProcess)
  const chunks = []
  let bytes = 0
  return Readable.from((async function* () {
    try {
      for await (const chunk of source) {
        bytes += chunk.length
        if (bytes > MAX_SCHEMA_ACL_BYTES) throw new Error('Public schema ACL metadata exceeds its bound')
        chunks.push(Buffer.from(chunk))
      }
      const entries = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      yield Buffer.from(buildPublicSchemaAclScript(entries))
    } catch { throw new Error('Public schema ACL stream failed') }
    finally { for (const chunk of chunks) chunk.fill(0); chunks.length = 0 }
  })(), { objectMode: false, highWaterMark: 64 * 1024 })
}

function publicRoleDependenciesStream(psqlPath, connection, config, spawnProcess) {
  const args = [
    '--no-password', '--host', connection.host, '--port', String(connection.port), '--username', connection.username,
    '--dbname', connection.database, '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--quiet',
    '--command', PUBLIC_ROLE_DEPENDENCIES_QUERY,
  ]
  const source = processOutputStream(psqlPath, args, config, 'psql public role dependencies', spawnProcess)
  const chunks = []
  let bytes = 0
  return Readable.from((async function* () {
    try {
      for await (const chunk of source) {
        bytes += chunk.length
        if (bytes > MAX_SCHEMA_ACL_BYTES) throw new Error('Role dependencies exceed bound')
        chunks.push(Buffer.from(chunk))
      }
      yield Buffer.from(buildPublicRoleDependenciesScript(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
    } catch { throw new Error('Public role dependency stream failed') }
    finally { for (const chunk of chunks) chunk.fill(0); chunks.length = 0 }
  })(), { objectMode: false, highWaterMark: 64 * 1024 })
}
