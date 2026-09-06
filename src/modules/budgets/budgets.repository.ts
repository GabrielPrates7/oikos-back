import { pool } from '../../config/database.js'
import { monthRange } from '../../utils/date-range.js'
import type { CreateBudgetInput, UpdateBudgetInput } from './budgets.schema.js'
import type { Budget } from './budgets.types.js'

export const budgetsRepository = {
  async create(userId: string, data: CreateBudgetInput): Promise<Budget> {
    const { monthStart } = monthRange(data.referenceMonth)
    const result = await pool.query<Budget>(
      `INSERT INTO budgets (user_id, category_id, reference_month, limit_amount_cents)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, data.categoryId, monthStart, data.limitAmountCents],
    )
    return result.rows[0]
  },

  async findAllByUserAndMonth(userId: string, referenceMonth: string): Promise<Budget[]> {
    const { monthStart } = monthRange(referenceMonth)
    const result = await pool.query<Budget>(
      `SELECT * FROM budgets WHERE user_id = $1 AND reference_month = $2 ORDER BY created_at`,
      [userId, monthStart],
    )
    return result.rows
  },

  async findByIdAndUser(id: string, userId: string): Promise<Budget | null> {
    const result = await pool.query<Budget>(
      'SELECT * FROM budgets WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdateBudgetInput): Promise<Budget | null> {
    const fields: string[] = []
    const values: unknown[] = []
    let index = 1

    if (data.categoryId !== undefined) {
      fields.push(`category_id = $${index++}`)
      values.push(data.categoryId)
    }
    if (data.referenceMonth !== undefined) {
      fields.push(`reference_month = $${index++}`)
      values.push(monthRange(data.referenceMonth).monthStart)
    }
    if (data.limitAmountCents !== undefined) {
      fields.push(`limit_amount_cents = $${index++}`)
      values.push(data.limitAmountCents)
    }

    if (fields.length === 0) {
      return budgetsRepository.findByIdAndUser(id, userId)
    }

    values.push(id, userId)
    const result = await pool.query<Budget>(
      `UPDATE budgets SET ${fields.join(', ')} WHERE id = $${index++} AND user_id = $${index} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },

  // Soma despesas diretas + parcelas de compra no cartão (mesma categoria, mesmo mês de
  // referência da fatura) — as duas fontes de gasto "de verdade" numa única query, nunca
  // calculado no cliente.
  async getSpentAmount(userId: string, categoryId: string, referenceMonth: string): Promise<number> {
    const { monthStart, monthEnd } = monthRange(referenceMonth)
    const result = await pool.query<{ spent_cents: number }>(
      `SELECT (
         COALESCE((
           SELECT SUM(amount_cents) FROM expenses
           WHERE user_id = $1 AND category_id = $2 AND expense_date BETWEEN $3 AND $4
         ), 0)
         + COALESCE((
           SELECT SUM(i.amount_cents)
           FROM installments i
           JOIN invoices inv ON inv.id = i.invoice_id
           JOIN purchases p ON p.id = i.purchase_id
           WHERE p.user_id = $1 AND p.category_id = $2 AND inv.reference_month = $5
         ), 0)
       )::int AS spent_cents`,
      [userId, categoryId, monthStart, monthEnd, monthStart],
    )
    return result.rows[0]?.spent_cents ?? 0
  },
}
