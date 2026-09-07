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
  created_at: Date
}

export type PurchasePaymentStatus = 'paid' | 'pending'

export interface PurchaseWithCategory extends Purchase {
  category_name: string
  category_icon: string | null
  payment_status: PurchasePaymentStatus
  has_paid_installment: boolean
}
