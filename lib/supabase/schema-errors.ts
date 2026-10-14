type SchemaError = { code?: string | null } | null | undefined

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205'])

/** Only classify explicit PostgreSQL/PostgREST missing-object codes as schema drift.
 * Error messages may include table names for unrelated failures such as unique violations.
 */
export function isMissingSchemaError(error: SchemaError): boolean {
  return Boolean(error && MISSING_SCHEMA_CODES.has(String(error.code ?? '')))
}
