import { pool } from '../../config/database.js'
import type { CreateExpenseInput, UpdateExpenseInput } from './expenses.schema.js'
import type { Expense } from './expenses.types.js'

export interface ExpenseFilters {
  accountId?: string
  categoryId?: string
  paymentMethod?: string
  dateFrom?: string
  dateTo?: string
}

export const expensesRepository = {
  async create(userId: string, data: CreateExpenseInput): Promise<Expense> {
    const result = await pool.query<Expense>(
      `INSERT INTO expenses (user_id, account_id, category_id, description, amount_cents, payment_method, expense_date, is_essential, is_fixed, is_paid, is_planned, paid_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        userId,
        data.account_id,
        data.category_id,
        data.description,
        data.amount_cents,
        data.payment_method,
        data.expense_date,
        data.is_essential,
        data.is_fixed,
        data.is_paid,
        data.is_planned,
        data.paid_date ?? null,
      ],
    )
    return result.rows[0]
  },

  async findAllByUser(userId: string, filters: ExpenseFilters = {}): Promise<Expense[]> {
    const optionalFilters: [string, string | undefined][] = [
      ['account_id = ', filters.accountId],
      ['category_id = ', filters.categoryId],
      ['payment_method = ', filters.paymentMethod],
      ['expense_date >= ', filters.dateFrom],
      ['expense_date <= ', filters.dateTo],
    ]
    const active = optionalFilters.filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    )

    const conditions = ['user_id = $1', ...active.map(([clause], i) => `${clause}$${i + 2}`)]
    const values: unknown[] = [userId, ...active.map(([, value]) => value)]

    const result = await pool.query<Expense>(
      `SELECT * FROM expenses WHERE ${conditions.join(' AND ')} ORDER BY expense_date DESC, created_at DESC`,
      values,
    )
    return result.rows
  },

  async findByIdAndUser(id: string, userId: string): Promise<Expense | null> {
    const result = await pool.query<Expense>(
      'SELECT * FROM expenses WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdateExpenseInput): Promise<Expense | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return expensesRepository.findByIdAndUser(id, userId)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values = entries.map(([, value]) => value)
    values.push(id, userId)

    const result = await pool.query<Expense>(
      `UPDATE expenses SET ${fields.join(', ')} WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },
}
