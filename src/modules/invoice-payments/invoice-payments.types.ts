export interface InvoicePayment {
  id: string
  invoice_id: string
  account_id: string
  amount_cents: number
  payment_date: string
  created_at: Date
}

export interface InvoicePaymentForAccountRow {
  id: string
  amount_cents: number
  date: string
  created_at: Date
  card_name: string
}
