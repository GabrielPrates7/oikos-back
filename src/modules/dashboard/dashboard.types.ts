export interface MonthlyTotals {
  incomeCents: number
  expenseCents: number
}

export type CategoryBreakdownType = 'income' | 'expense'

export interface CategoryBreakdownRow {
  category_id: string
  name: string
  icon: string | null
  total_cents: number
}

export interface RecentIncomeEntryRow {
  id: string
  description: string
  amount_cents: number
  date: string
  account_name: string
  category_name: string
}

export interface RecentExpenseRow {
  id: string
  description: string
  amount_cents: number
  date: string
  account_name: string
  category_name: string
}

export interface RecentTransferRow {
  id: string
  description: string | null
  amount_cents: number
  date: string
  from_account_name: string
  to_account_name: string
}

export interface RecentInvoicePaymentRow {
  id: string
  amount_cents: number
  date: string
  account_name: string
  card_name: string
}

export interface RecentGoalContributionRow {
  id: string
  amount_cents: number
  date: string
  account_name: string
  goal_name: string
}
