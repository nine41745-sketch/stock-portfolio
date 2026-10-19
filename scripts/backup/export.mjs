import assert from 'node:assert/strict'
import { createEncryptedBackupSet } from './encrypted-set.mjs'
import { createPostgresBackupStreams } from './postgres-streams.mjs'

/**
 * Export one explicitly identified Supabase PostgreSQL project into an
 * encrypted, versioned set. This function never loads .env files and accepts
 * no password/key value; only the passfile path and public age recipients are
 * provided by its caller. Production execution requires a separately approved
 * operational wrapper and verified local custody for those inputs.
 */
export async function exportPostgresBackupSet({ destination, setName, recipients, connection }, { createStreams = createPostgresBackupStreams } = {}) {
  assert.ok(typeof destination === 'string' && destination.length > 0)
  assert.ok(typeof setName === 'string' && setName.length > 0)
  assert.ok(typeof createStreams === 'function', 'PostgreSQL backup stream factory must be callable')
  const streams = await createStreams(connection)
  let result
  let exportError
  let shutdownError
  let shutdownAttempted = false
  const closeCoordinator = async () => {
    if (shutdownAttempted) {
      if (shutdownError) throw shutdownError
      return
    }
    shutdownAttempted = true
    try { await streams.close() }
    catch (error) {
      shutdownError = new Error('PostgreSQL snapshot coordinator shutdown failed', { cause: error })
      throw shutdownError
    }
  }
  try {
    result = await createEncryptedBackupSet({
      destination,
      setName,
      recipients,
      source: streams.source,
      components: streams.components,
      beforePublish: closeCoordinator,
    })
  } catch (error) {
    exportError = error
  }
  if (!shutdownAttempted) {
    try { await closeCoordinator() }
    catch { /* Reported below with the export failure, if any. */ }
  }
  if (exportError && shutdownError && exportError !== shutdownError) {
    throw new AggregateError([exportError, shutdownError], 'Encrypted PostgreSQL export failed and snapshot coordinator shutdown also failed')
  }
  if (exportError) throw exportError
  if (shutdownError) throw shutdownError
  return result
}
