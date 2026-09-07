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
  created_at: Date
}
