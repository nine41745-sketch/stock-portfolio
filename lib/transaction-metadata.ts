interface MetadataRow { id: string; sync_portfolio: boolean }

export async function loadTransactionMutationFlags(
  ids: string[],
  loadBatch: (ids: string[]) => PromiseLike<{ data: MetadataRow[] | null; error: unknown }>,
): Promise<Map<string, boolean>> {
  const uniqueIds = [...new Set(ids)], flags = new Map<string, boolean>()
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const batch = uniqueIds.slice(offset, offset + 100), requested = new Set(batch)
    const { data, error } = await loadBatch(batch)
    if (error || !data) throw new Error('Transaction metadata unavailable')
    for (const row of data) {
      if (!requested.has(row.id) || typeof row.sync_portfolio !== 'boolean' || flags.has(row.id)) throw new Error('Invalid transaction metadata')
      flags.set(row.id, row.sync_portfolio)
    }
    if (batch.some(id => !flags.has(id))) throw new Error('Incomplete transaction metadata')
  }
  return flags
}
