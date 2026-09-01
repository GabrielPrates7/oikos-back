export interface Purchase {
  id: string
  user_id: string
  credit_card_id: string
  category_id: string
  description: string
  total_amount_cents: number
  installments_count: number
  purchase_date: string
  created_at: Date
}
