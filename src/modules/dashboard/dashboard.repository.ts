import { pool } from '../../config/database.js'
import type {
  CategoryExpenseTotalRow,
  MonthlyTotals,
  RecentExpenseRow,
  RecentIncomeEntryRow,
  RecentTransferRow,
} from './dashboard.types.js'

export const dashboardRepository = {
  async getMonthlyTotals(
    userId: string,
    monthStart: string,
    monthEnd: string,
  ): Promise<MonthlyTotals> {
    const result = await pool.query<{ income_cents: number; expense_cents: number }>(
      `SELECT
         COALESCE((
           SELECT SUM(amount_cents) FROM income_entries
           WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
         ), 0)::int AS income_cents,
         COALESCE((
           SELECT SUM(amount_cents) FROM expenses
           WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3
         ), 0)::int AS expense_cents`,
      [userId, monthStart, monthEnd],
    )
    const row = result.rows[0]
    return { incomeCents: row.income_cents, expenseCents: row.expense_cents }
  },

  async getExpensesByCategory(
    userId: string,
    monthStart: string,
    monthEnd: string,
  ): Promise<CategoryExpenseTotalRow[]> {
    const result = await pool.query<CategoryExpenseTotalRow>(
      `SELECT c.id AS category_id, c.name, c.icon, SUM(e.amount_cents)::int AS total_cents
       FROM expenses e
       JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = $1 AND e.expense_date BETWEEN $2 AND $3
       GROUP BY c.id, c.name, c.icon
       ORDER BY total_cents DESC`,
      [userId, monthStart, monthEnd],
    )
    return result.rows
  },

  async getRecentIncomeEntries(
    userId: string,
    monthStart: string,
    monthEnd: string,
    limit: number,
  ): Promise<RecentIncomeEntryRow[]> {
    const result = await pool.query<RecentIncomeEntryRow>(
      `SELECT ie.id, ie.description, ie.amount_cents, ie.entry_date AS date,
              a.name AS account_name, c.name AS category_name
       FROM income_entries ie
       JOIN accounts a ON a.id = ie.account_id
       JOIN categories c ON c.id = ie.category_id
       WHERE ie.user_id = $1 AND ie.entry_date BETWEEN $2 AND $3
       ORDER BY ie.entry_date DESC, ie.created_at DESC
       LIMIT $4`,
      [userId, monthStart, monthEnd, limit],
    )
    return result.rows
  },

  async getRecentExpenses(
    userId: string,
    monthStart: string,
    monthEnd: string,
    limit: number,
  ): Promise<RecentExpenseRow[]> {
    const result = await pool.query<RecentExpenseRow>(
      `SELECT e.id, e.description, e.amount_cents, e.expense_date AS date,
              a.name AS account_name, c.name AS category_name
       FROM expenses e
       JOIN accounts a ON a.id = e.account_id
       JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = $1 AND e.expense_date BETWEEN $2 AND $3
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $4`,
      [userId, monthStart, monthEnd, limit],
    )
    return result.rows
  },

  async getRecentTransfers(
    userId: string,
    monthStart: string,
    monthEnd: string,
    limit: number,
  ): Promise<RecentTransferRow[]> {
    const result = await pool.query<RecentTransferRow>(
      `SELECT t.id, t.description, t.amount_cents, t.transfer_date AS date,
              fa.name AS from_account_name, ta.name AS to_account_name
       FROM transfers t
       JOIN accounts fa ON fa.id = t.from_account_id
       JOIN accounts ta ON ta.id = t.to_account_id
       WHERE t.user_id = $1 AND t.transfer_date BETWEEN $2 AND $3
       ORDER BY t.transfer_date DESC, t.created_at DESC
       LIMIT $4`,
      [userId, monthStart, monthEnd, limit],
    )
    return result.rows
  },
}
