import { pool } from '../../config/database.js'
import type {
  CategoryBreakdownRow,
  CategoryBreakdownType,
  MonthlyTotals,
  RecentExpenseRow,
  RecentGoalContributionRow,
  RecentIncomeEntryRow,
  RecentInvoicePaymentRow,
  RecentTransferRow,
} from './dashboard.types.js'

const CATEGORY_BREAKDOWN_SOURCE: Record<
  CategoryBreakdownType,
  { table: string; dateColumn: string }
> = {
  income: { table: 'income_entries', dateColumn: 'entry_date' },
  expense: { table: 'expenses', dateColumn: 'expense_date' },
}

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

  async getCategoryBreakdown(
    userId: string,
    monthStart: string,
    monthEnd: string,
    type: CategoryBreakdownType,
  ): Promise<CategoryBreakdownRow[]> {
    const { table, dateColumn } = CATEGORY_BREAKDOWN_SOURCE[type]

    // `table`/`dateColumn` vêm de um mapa fixo interno (chaveado por um enum já validado
    // pelo Zod no controller), nunca de input bruto do usuário — não há injeção aqui.
    const result = await pool.query<CategoryBreakdownRow>(
      `SELECT c.id AS category_id, c.name, c.icon, SUM(t.amount_cents)::int AS total_cents
       FROM ${table} t
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1 AND t.${dateColumn} BETWEEN $2 AND $3
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

  async getRecentInvoicePayments(
    userId: string,
    monthStart: string,
    monthEnd: string,
    limit: number,
  ): Promise<RecentInvoicePaymentRow[]> {
    const result = await pool.query<RecentInvoicePaymentRow>(
      `SELECT ip.id, ip.amount_cents, ip.payment_date AS date,
              a.name AS account_name, cc.name AS card_name
       FROM invoice_payments ip
       JOIN accounts a ON a.id = ip.account_id
       JOIN invoices inv ON inv.id = ip.invoice_id
       JOIN credit_cards cc ON cc.id = inv.credit_card_id
       WHERE a.user_id = $1 AND ip.payment_date BETWEEN $2 AND $3
       ORDER BY ip.payment_date DESC, ip.created_at DESC
       LIMIT $4`,
      [userId, monthStart, monthEnd, limit],
    )
    return result.rows
  },

  // Taxa de Poupança do SummaryCards — soma direto por conta do usuário (goal_contributions
  // não tem user_id próprio, só account_id/goal_id, ambos já escopados ao usuário via FK).
  async getMonthlyGoalContributionsTotal(
    userId: string,
    monthStart: string,
    monthEnd: string,
  ): Promise<number> {
    const result = await pool.query<{ total_cents: number }>(
      `SELECT COALESCE(SUM(gc.amount_cents), 0)::int AS total_cents
       FROM goal_contributions gc
       JOIN accounts a ON a.id = gc.account_id
       WHERE a.user_id = $1 AND gc.contribution_date BETWEEN $2 AND $3`,
      [userId, monthStart, monthEnd],
    )
    return result.rows[0].total_cents
  },

  async getRecentGoalContributions(
    userId: string,
    monthStart: string,
    monthEnd: string,
    limit: number,
  ): Promise<RecentGoalContributionRow[]> {
    const result = await pool.query<RecentGoalContributionRow>(
      `SELECT gc.id, gc.amount_cents, gc.contribution_date AS date,
              a.name AS account_name, fg.name AS goal_name
       FROM goal_contributions gc
       JOIN accounts a ON a.id = gc.account_id
       JOIN financial_goals fg ON fg.id = gc.goal_id
       WHERE a.user_id = $1 AND gc.contribution_date BETWEEN $2 AND $3
       ORDER BY gc.contribution_date DESC, gc.created_at DESC
       LIMIT $4`,
      [userId, monthStart, monthEnd, limit],
    )
    return result.rows
  },
}
