import { pool } from '../../config/database.js'
import type { CreateContributionInput } from './contributions.schema.js'
import type { GoalContribution, GoalContributionForAccountRow } from './contributions.types.js'

export interface ContributionFilters {
  dateFrom?: string
  dateTo?: string
}

export const contributionsRepository = {
  async create(goalId: string, data: CreateContributionInput): Promise<GoalContribution> {
    const result = await pool.query<GoalContribution>(
      `INSERT INTO goal_contributions (goal_id, account_id, amount_cents, contribution_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [goalId, data.accountId, data.amountCents, data.contributionDate],
    )
    return result.rows[0]
  },

  async findAllByGoal(goalId: string): Promise<GoalContribution[]> {
    const result = await pool.query<GoalContribution>(
      'SELECT * FROM goal_contributions WHERE goal_id = $1 ORDER BY contribution_date DESC, created_at DESC',
      [goalId],
    )
    return result.rows
  },

  async existsForGoal(goalId: string): Promise<boolean> {
    const result = await pool.query('SELECT 1 FROM goal_contributions WHERE goal_id = $1 LIMIT 1', [
      goalId,
    ])
    return (result.rowCount ?? 0) > 0
  },

  async findByIdAndGoal(id: string, goalId: string): Promise<GoalContribution | null> {
    const result = await pool.query<GoalContribution>(
      'SELECT * FROM goal_contributions WHERE id = $1 AND goal_id = $2',
      [id, goalId],
    )
    return result.rows[0] ?? null
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM goal_contributions WHERE id = $1', [id])
    return (result.rowCount ?? 0) > 0
  },

  // Aportes debitados de uma conta, pro extrato e pro dashboard. JOIN de volta em accounts
  // confirma posse antes de retornar qualquer linha — mesmo padrão de
  // invoice-payments.repository.findAllForAccount.
  async findAllForAccount(
    accountId: string,
    userId: string,
    filters: ContributionFilters = {},
  ): Promise<GoalContributionForAccountRow[]> {
    const conditions = ['gc.account_id = $1', 'a.user_id = $2']
    const values: unknown[] = [accountId, userId]

    if (filters.dateFrom !== undefined) {
      values.push(filters.dateFrom)
      conditions.push(`gc.contribution_date >= $${values.length}`)
    }
    if (filters.dateTo !== undefined) {
      values.push(filters.dateTo)
      conditions.push(`gc.contribution_date <= $${values.length}`)
    }

    const result = await pool.query<GoalContributionForAccountRow>(
      `SELECT gc.id, gc.amount_cents, gc.contribution_date AS date, gc.created_at, fg.name AS goal_name
       FROM goal_contributions gc
       JOIN accounts a ON a.id = gc.account_id
       JOIN financial_goals fg ON fg.id = gc.goal_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY gc.contribution_date DESC, gc.created_at DESC`,
      values,
    )
    return result.rows
  },
}
