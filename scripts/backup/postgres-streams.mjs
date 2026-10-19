import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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
const MAX_SNAPSHOT_PROTOCOL_BYTES = 4096
const CHILD_CLOSE_GRACE_MS = 5000
const SNAPSHOT_TOKEN = /^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/

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

function assertSnapshotToken(snapshot) {
  assert.equal(typeof snapshot, 'string', 'PostgreSQL snapshot evidence is required')
  assert.ok(snapshot.length <= 128 && SNAPSHOT_TOKEN.test(snapshot), 'Invalid PostgreSQL snapshot evidence')
  return snapshot
}

export function buildPostgresDumpArguments({ projectRef, host, port, database, username }, snapshot) {
  assert.match(projectRef, PROJECT_REF)
  assert.equal(host, SERVICE_HOST(projectRef), 'Database host does not match the expected project')
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535)
  assert.match(database, /^[A-Za-z0-9_-]{1,63}$/)
  assert.match(username, /^[A-Za-z0-9_.-]{1,128}$/)
  assertSnapshotToken(snapshot)
  return [
    '--no-password', '--host', host, '--port', String(port), '--username', username,
    '--dbname', database, '--format=custom', '--schema=public', `--snapshot=${snapshot}`,
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

async function waitForChildClose(closed, timeoutMs = CHILD_CLOSE_GRACE_MS) {
  let timer
  try {
    return await Promise.race([
      closed,
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); timer.unref?.() }),
    ])
  } finally { clearTimeout(timer) }
}

async function terminateAndAwait(child, closed) {
  if (child.exitCode === null && child.signalCode === null) child.kill()
  let result = await waitForChildClose(closed)
  if (result === null) {
    child.kill('SIGKILL')
    result = await waitForChildClose(closed)
  }
  if (result === null) throw new Error('PostgreSQL child process did not terminate')
}

function processOutputStream(path, args, config, label, spawnProcess = spawn, coordinator = null) {
  const state = { failureCode: null }
  const output = Readable.from((async function* () {
    let child
    try {
      coordinator?.assertOpen()
      child = spawnProcess(path, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: safeChildEnvironment(config),
      })
    } catch { throw new Error(`${label} could not start`) }
    child.stderr.resume()
    const closed = once(child, 'close')
    let timedOut = false
    let termination = null
    let cleanupFailed = false
    let failureMessage = null
    const stopChild = async () => {
      try { await terminateAndAwait(child, closed) }
      catch { cleanupFailed = true }
      finally { child.stdout.destroy() }
    }
    const timeout = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      timedOut = true
      termination = stopChild()
    }, config.timeoutMs)
    timeout.unref?.()
    let completed = false
    try {
      for await (const chunk of child.stdout) yield chunk
      const [code, signal] = await closed
      if (code !== 0) failureMessage = `${label} failed (${code ?? signal ?? 'unknown'})`
      else {
        coordinator?.assertOpen()
        completed = true
      }
    } catch {
      if (!timedOut) failureMessage = `${label} stream failed`
    } finally {
      clearTimeout(timeout)
      if (termination) await termination
      else if (!completed) {
        try { await terminateAndAwait(child, closed) }
        catch {
          cleanupFailed = true
          child.stdout.destroy()
        }
      }
    }
    if (cleanupFailed) {
      state.failureCode = 'CLEANUP_FAILED'
      throw new Error(`${timedOut ? `${label} timed out` : failureMessage ?? `${label} failed`}; child cleanup could not be confirmed`)
    }
    if (timedOut) {
      state.failureCode = 'TIMEOUT'
      throw new Error(`${label} timed out`)
    }
    if (failureMessage) {
      state.failureCode = 'PROCESS_FAILED'
      throw new Error(failureMessage)
    }
  })(), { objectMode: false, highWaterMark: 64 * 1024 })
  Object.defineProperty(output, 'postgresProcessFailure', { get: () => state.failureCode })
  return output
}

function createSnapshotCoordinator(psqlPath, connection, config, spawnProcess) {
  const marker = `SP_SNAPSHOT_READY_${randomBytes(16).toString('hex')}__`
  const args = [
    '--no-password', '--host', connection.host, '--port', String(connection.port), '--username', connection.username,
    '--dbname', connection.database, '--set=ON_ERROR_STOP=1', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet',
  ]
  let child
  try {
    child = spawnProcess(psqlPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: safeChildEnvironment(config),
    })
  } catch { throw new Error('PostgreSQL snapshot coordinator could not start') }
  assert.ok(child.stdin && child.stdout, 'PostgreSQL snapshot coordinator pipes are unavailable')

  let closedResult = null
  let protocolBuffer = ''
  let protocolBytes = 0
  const protocolLines = []
  let settled = false
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const closed = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closedResult = { code, signal }
      resolve(closedResult)
      if (!settled) failReady()
    })
    child.once('error', () => {
      closedResult = { code: null, signal: null, error: true }
      resolve(closedResult)
      if (!settled) failReady()
    })
  })
  const failReady = () => {
    if (settled) return
    settled = true
    rejectReady(new Error('PostgreSQL snapshot export failed'))
  }
  const acceptLine = line => {
    if (line !== marker) return false
    if (protocolLines.length !== 1 || !SNAPSHOT_TOKEN.test(protocolLines[0]) || protocolLines[0].length > 128) {
      failReady()
      return true
    }
    const snapshotToken = protocolLines[0]
    protocolBuffer = ''
    protocolLines.length = 0
    if (!settled) { settled = true; resolveReady(snapshotToken) }
    return true
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    protocolBytes += Buffer.byteLength(chunk)
    if (protocolBytes > MAX_SNAPSHOT_PROTOCOL_BYTES) { failReady(); child.kill(); return }
    protocolBuffer += chunk
    const lines = protocolBuffer.split('\n')
    protocolBuffer = lines.pop()
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '')
      if (acceptLine(line)) break
      protocolLines.push(line)
      if (protocolLines.length > 2) { failReady(); child.kill(); break }
    }
  })
  child.stdout.on('error', failReady)
  const timeout = setTimeout(() => { failReady(); child.kill() }, config.timeoutMs)
  timeout.unref?.()
  const command = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n\\echo ${marker}\n`
  try {
    child.stdin.write(command, error => { if (error) { failReady(); child.kill() } })
  } catch { failReady(); child.kill() }

  let closeOperation = null
  const coordinator = {
    async waitUntilReady() {
      try { return await ready }
      catch (error) { clearTimeout(timeout); await terminateAndAwait(child, closed).catch(() => {}); throw error }
    },
    assertOpen() {
      if (closedResult || child.exitCode !== null || child.signalCode !== null) throw new Error('PostgreSQL snapshot coordinator is no longer active')
    },
    close() {
      if (closeOperation) return closeOperation
      closeOperation = (async () => {
        clearTimeout(timeout)
        if (!closedResult && child.exitCode === null && child.signalCode === null) {
          try { child.stdin.end('\\q\n') } catch { child.kill() }
        }
        let result = await waitForChildClose(closed)
        if (result === null) {
          child.kill()
          result = await waitForChildClose(closed)
        }
        if (result === null) {
          child.kill('SIGKILL')
          result = await waitForChildClose(closed)
        }
        if (result === null) throw new Error('PostgreSQL snapshot coordinator did not terminate')
        if (result.error || result.code !== 0) throw new Error('PostgreSQL snapshot coordinator shutdown failed')
      })()
      return closeOperation
    },
  }
  return { coordinator, waitUntilReady: coordinator.waitUntilReady() }
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
  const { coordinator, waitUntilReady } = createSnapshotCoordinator(psqlPath, connection, common, spawnProcess)
  try {
    const snapshot = await waitUntilReady
    coordinator.assertOpen()
    return {
      source: {
        projectRef: config.projectRef,
        schema: 'public',
        capturedAt: new Date().toISOString(),
        pgDumpVersion,
        psqlVersion,
        serverVersion: 'NOT_QUERIED',
        rolesDumpVersion: 'public-role-dependencies-v1 (snapshot-imported catalog query)',
        snapshot: 'Coordinated pg_export_snapshot imported by all public dump and catalog consumers',
      },
      components: [
        { name: 'database-public', stream: processOutputStream(pgDumpPath, buildPostgresDumpArguments(connection, snapshot), common, 'pg_dump', spawnProcess, coordinator) },
        { name: 'public-role-dependencies', stream: publicRoleDependenciesStream(psqlPath, connection, common, snapshot, spawnProcess, coordinator) },
        { name: 'public-schema-acl', stream: publicSchemaAclStream(psqlPath, connection, common, snapshot, spawnProcess, coordinator) },
      ],
      close: () => coordinator.close(),
    }
  } catch (error) {
    try { await coordinator.close() }
    catch {
      throw new AggregateError(
        [error, new Error('PostgreSQL snapshot coordinator shutdown failed')],
        'PostgreSQL snapshot setup failed and coordinator shutdown also failed',
      )
    }
    throw error
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

function snapshotImportQuery(query, snapshot) {
  assertSnapshotToken(snapshot)
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '${snapshot}';\n${query}\nCOMMIT;\n`
}

function publicSchemaAclStream(psqlPath, connection, config, snapshot, spawnProcess = spawn, coordinator) {
  const args = [
    '--no-password', '--host', connection.host, '--port', String(connection.port), '--username', connection.username,
    '--dbname', connection.database, '--set=ON_ERROR_STOP=1', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--command', snapshotImportQuery(PUBLIC_SCHEMA_ACL_QUERY, snapshot),
  ]
  const source = processOutputStream(psqlPath, args, config, 'psql public-schema ACL query', spawnProcess, coordinator)
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

function publicRoleDependenciesStream(psqlPath, connection, config, snapshot, spawnProcess, coordinator) {
  const args = [
    '--no-password', '--host', connection.host, '--port', String(connection.port), '--username', connection.username,
    '--dbname', connection.database, '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--quiet',
    '--command', snapshotImportQuery(PUBLIC_ROLE_DEPENDENCIES_QUERY, snapshot),
  ]
  const source = processOutputStream(psqlPath, args, config, 'psql public role dependencies', spawnProcess, coordinator)
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
