// Postgres reporta violação de integridade referencial com códigos diferentes conforme a ação:
// 23503 = foreign_key_violation (caso geral)
// 23001 = restrict_violation (especificamente quando a FK tem ON DELETE/UPDATE RESTRICT,
//          como em income_entries.category_id/account_id — é o código real observado aqui)
const REFERENTIAL_INTEGRITY_VIOLATION_CODES = new Set(['23503', '23001'])

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    REFERENTIAL_INTEGRITY_VIOLATION_CODES.has((error as { code?: unknown }).code as string)
  )
}
