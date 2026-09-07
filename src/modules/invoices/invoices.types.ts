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

export interface InvoiceWithTotal extends Invoice {
  total_cents: number
}

export interface InvoiceItem {
  installment_number: number
  installments_count: number
  amount_cents: number
  description: string
  category_name: string
  category_icon: string | null
  is_essential: boolean
}
