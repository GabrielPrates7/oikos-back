export type AccountType = 'checking' | 'savings' | 'cash'
export type AccountStatus = 'active' | 'archived'

export interface Account {
  id: string
  user_id: string
  name: string
  bank_name: string | null
  type: AccountType
  initial_balance_cents: number
  status: AccountStatus
  created_at: Date
  updated_at: Date
}
