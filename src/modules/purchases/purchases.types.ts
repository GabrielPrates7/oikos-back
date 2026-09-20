export interface Purchase {
  id: string
  user_id: string
  credit_card_id: string
  category_id: string
  description: string
  total_amount_cents: number
  installments_count: number
  purchase_date: string
  is_essential: boolean
  is_fixed: boolean
  is_planned: boolean
  created_at: Date
}

export type PurchasePaymentStatus = 'paid' | 'pending'

export interface PurchaseWithCategory extends Purchase {
  category_name: string
  category_icon: string | null
  payment_status: PurchasePaymentStatus
  has_paid_installment: boolean
  // Meses ('YYYY-MM', ordenados, sem repetir) das faturas onde existe parcela desta compra —
  // uma compra parcelada tem UMA purchase_date mas parcelas em vários meses/anos.
  installment_months: string[]
}
