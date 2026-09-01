export type CategoryType = 'income' | 'expense'

export interface Category {
  id: string
  user_id: string | null
  name: string
  type: CategoryType
  icon: string | null
  created_at: Date
}
