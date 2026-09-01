// Postgres reporta violação de integridade referencial com códigos diferentes conforme a ação:
// 23503 = foreign_key_violation (caso geral)
// 23001 = restrict_violation (especificamente quando a FK tem ON DELETE/UPDATE RESTRICT,
//          como em income_entries.category_id/account_id — é o código real observado aqui)
const REFERENTIAL_INTEGRITY_VIOLATION_CODES = new Set(['23503', '23001'])

// 23505 = unique_violation (ex: invoice_payments.invoice_id UNIQUE — segunda tentativa de
// pagar a mesma fatura vira erro de constraint, tratado como 409 no service).
const UNIQUE_VIOLATION_CODE = '23505'

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: unknown }).code as string
  }
  return undefined
}

export function isForeignKeyViolation(error: unknown): boolean {
  const code = pgErrorCode(error)
  return code !== undefined && REFERENTIAL_INTEGRITY_VIOLATION_CODES.has(code)
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION_CODE
}
