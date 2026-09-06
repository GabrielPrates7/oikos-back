import { pool } from '../../config/database.js'
import { monthRange } from '../../utils/date-range.js'
import { dashboardRepository } from '../dashboard/dashboard.repository.js'

export interface MonthlyEvolutionItem {
  month: string
  incomeCents: number
  expenseCents: number
  netCents: number
}

export interface AccountTotalRow {
  account_id: string
  account_name: string
  total_cents: number
}

export interface ReceiptMethodTotalRow {
  receipt_method: string
  total_cents: number
}

export interface EssentialVsSuperfluousTotals {
  essentialCents: number
  superfluousCents: number
}

export interface FixedVsNonFixedTotals {
  fixedCents: number
  nonFixedCents: number
}

const ACCOUNT_TOTAL_SOURCE: Record<'income' | 'expense', { table: string; dateColumn: string }> = {
  income: { table: 'income_entries', dateColumn: 'entry_date' },
  expense: { table: 'expenses', dateColumn: 'expense_date' },
}

export const reportsRepository = {
  async getMonthlyEvolution(userId: string, monthsList: string[]): Promise<MonthlyEvolutionItem[]> {
    const results: MonthlyEvolutionItem[] = []

    for (const month of monthsList) {
      const { monthStart, monthEnd } = monthRange(month)
      const totals = await dashboardRepository.getMonthlyTotals(userId, monthStart, monthEnd)
      results.push({
        month,
        incomeCents: totals.incomeCents,
        expenseCents: totals.expenseCents,
        netCents: totals.incomeCents - totals.expenseCents,
      })
    }

    return results
  },

  async getTotalByAccount(
    userId: string,
    monthStart: string,
    monthEnd: string,
    type: 'income' | 'expense',
  ): Promise<AccountTotalRow[]> {
    const { table, dateColumn } = ACCOUNT_TOTAL_SOURCE[type]

    // `table`/`dateColumn` vêm de um mapa fixo interno (chaveado por um enum já validado
    // pelo Zod no controller), nunca de input bruto do usuário — não há injeção aqui.
    const result = await pool.query<AccountTotalRow>(
      `SELECT a.id AS account_id, a.name AS account_name, SUM(t.amount_cents)::int AS total_cents
       FROM ${table} t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.user_id = $1 AND t.${dateColumn} BETWEEN $2 AND $3
       GROUP BY a.id, a.name
       ORDER BY total_cents DESC`,
      [userId, monthStart, monthEnd],
    )
    return result.rows
  },

  async getTotalByReceiptMethod(
    userId: string,
    monthStart: string,
    monthEnd: string,
  ): Promise<ReceiptMethodTotalRow[]> {
    const result = await pool.query<ReceiptMethodTotalRow>(
      `SELECT receipt_method, SUM(amount_cents)::int AS total_cents
       FROM income_entries
       WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
       GROUP BY receipt_method
       ORDER BY total_cents DESC`,
      [userId, monthStart, monthEnd],
    )
    return result.rows
  },

  async getEssentialVsSuperfluous(
    userId: string,
    monthStart: string,
    monthEnd: string,
  ): Promise<EssentialVsSuperfluousTotals> {
    // Duas fontes de gasto "de verdade" combinadas antes de agrupar — mesmo padrão de
    // budgets.repository.getSpentAmount: despesa direta do mês + parcela de compra cuja
    // fatura é desse mês de referência (via purchase, já que installments não tem
    // is_essential — só purchases e expenses têm).
    const result = await pool.query<{ is_essential: boolean; total_cents: number }>(
      `SELECT is_essential, SUM(amount_cents)::int AS total_cents
       FROM (
         SELECT is_essential, amount_cents FROM expenses
         WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3
         UNION ALL
         SELECT p.is_essential, i.amount_cents
         FROM installments i
         JOIN invoices inv ON inv.id = i.invoice_id
         JOIN purchases p ON p.id = i.purchase_id
         WHERE p.user_id = $1 AND inv.reference_month = $2
       ) combined
       GROUP BY is_essential`,
      [userId, monthStart, monthEnd],
    )

    let essentialCents = 0
    let superfluousCents = 0
    for (const row of result.rows) {
      if (row.is_essential) {
        essentialCents = row.total_cents
      } else {
        superfluousCents = row.total_cents
      }
    }
    return { essentialCents, superfluousCents }
  },

  async getFixedVsNonFixed(
    userId: string,
    monthStart: string,
    monthEnd: string,
  ): Promise<FixedVsNonFixedTotals> {
    const result = await pool.query<{ is_fixed: boolean; total_cents: number }>(
      `SELECT is_fixed, SUM(amount_cents)::int AS total_cents
       FROM (
         SELECT is_fixed, amount_cents FROM expenses
         WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3
         UNION ALL
         SELECT p.is_fixed, i.amount_cents
         FROM installments i
         JOIN invoices inv ON inv.id = i.invoice_id
         JOIN purchases p ON p.id = i.purchase_id
         WHERE p.user_id = $1 AND inv.reference_month = $2
       ) combined
       GROUP BY is_fixed`,
      [userId, monthStart, monthEnd],
    )

    let fixedCents = 0
    let nonFixedCents = 0
    for (const row of result.rows) {
      if (row.is_fixed) {
        fixedCents = row.total_cents
      } else {
        nonFixedCents = row.total_cents
      }
    }
    return { fixedCents, nonFixedCents }
  },
}
