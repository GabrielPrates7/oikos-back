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
  created_at: Date
}
