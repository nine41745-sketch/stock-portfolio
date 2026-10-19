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
  const { source, components } = await createPostgresBackupStreams(connection)
  return createEncryptedBackupSet({ destination, setName, recipients, source, components })
}
