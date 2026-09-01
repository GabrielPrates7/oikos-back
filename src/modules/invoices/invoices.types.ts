export type InvoiceStatus = 'open' | 'closed' | 'paid' | 'overdue'

export interface Invoice {
  id: string
  credit_card_id: string
  reference_month: string
  closing_date: string
  due_date: string
  status: InvoiceStatus
  created_at: Date
  updated_at: Date
}

export interface InvoiceItem {
  installment_number: number
  amount_cents: number
  description: string
}
