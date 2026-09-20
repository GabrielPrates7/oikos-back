export type ReceiptMethod = 'pix' | 'transfer' | 'cash' | 'other'

export interface IncomeEntry {
  id: string
  user_id: string
  account_id: string
  category_id: string
  description: string
  amount_cents: number
  entry_date: string
  receipt_method: ReceiptMethod
  is_received: boolean
  is_planned: boolean
  received_date: string | null
  // Fase 1: só afeta o sumCents (Total exibido) de Entradas — Saldo Real/extrato de conta
  // e o resto do sistema (Dashboard, Relatórios) continuam somando tudo, de propósito
  // (fase 2 decide o resto, um de cada vez).
  count_in_totals: boolean
  created_at: Date
}
