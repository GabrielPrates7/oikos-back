export type PaymentMethod = 'debit' | 'cash' | 'pix'

export interface Expense {
  id: string
  user_id: string
  account_id: string
  category_id: string
  description: string
  amount_cents: number
  payment_method: PaymentMethod
  expense_date: string
  is_essential: boolean
  is_fixed: boolean
  is_paid: boolean
  is_planned: boolean
  paid_date: string | null
  // Fase 1: só afeta o sumCents (Total exibido) de Despesas — Saldo Real/extrato de conta
  // e o resto do sistema (Dashboard, Relatórios) continuam somando tudo, de propósito
  // (fase 2 decide o resto, um de cada vez).
  count_in_totals: boolean
  created_at: Date
}
