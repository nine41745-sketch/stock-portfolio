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
export async function exportPostgresBackupSet({ destination, setName, recipients, connection }) {
  assert.ok(typeof destination === 'string' && destination.length > 0)
  assert.ok(typeof setName === 'string' && setName.length > 0)
  const streams = await createPostgresBackupStreams(connection)
  let exportError
  try {
    return await createEncryptedBackupSet({ destination, setName, recipients, source: streams.source, components: streams.components })
  } catch (error) {
    exportError = error
    throw error
  } finally {
    try { await streams.close() }
    catch {
      if (!exportError) throw new Error('PostgreSQL snapshot coordinator shutdown failed')
    }
  }
}
