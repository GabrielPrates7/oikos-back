import type { InvoiceStatus } from './invoices.types.js'

export type InvoiceDisplayStatus = InvoiceStatus

/**
 * Deriva o status "de exibição" de uma fatura a partir do status bruto no banco e das
 * datas de fechamento/vencimento. O status bruto só muda pra 'paid' (via pagamento) ou
 * 'closed' (via fechamento manual/job, Fase futura) — 'overdue' nunca é persistido,
 * é sempre calculado na leitura comparando com a data de hoje.
 *
 * Datas trafegam como string 'YYYY-MM-DD' (comparação lexicográfica = cronológica).
 */
export function computeDisplayStatus(
  rawStatus: InvoiceStatus,
  closingDate: string,
  dueDate: string,
  today: string,
): InvoiceDisplayStatus {
  if (rawStatus === 'paid') {
    return 'paid'
  }
  if (today >= dueDate) {
    return 'overdue'
  }
  if (today >= closingDate) {
    return 'closed'
  }
  return 'open'
}
