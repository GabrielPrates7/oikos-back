export interface Installment {
  id: string
  purchase_id: string
  invoice_id: string
  installment_number: number
  amount_cents: number
  created_at: Date
}
