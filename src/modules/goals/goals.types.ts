export interface FinancialGoal {
  id: string
  user_id: string
  name: string
  target_amount_cents: number
  target_date: string
  created_at: Date
  updated_at: Date
}
