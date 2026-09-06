export interface GoalContribution {
  id: string
  goal_id: string
  account_id: string
  amount_cents: number
  contribution_date: string
  created_at: Date
}

export interface GoalContributionForAccountRow {
  id: string
  amount_cents: number
  date: string
  created_at: Date
  goal_name: string
}
