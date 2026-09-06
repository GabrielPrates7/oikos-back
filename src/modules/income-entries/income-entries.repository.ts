import { pool } from '../../config/database.js'
import type { CreateIncomeEntryInput, UpdateIncomeEntryInput } from './income-entries.schema.js'
import type { IncomeEntry } from './income-entries.types.js'

export interface IncomeEntryFilters {
  accountId?: string
  categoryId?: string
  dateFrom?: string
  dateTo?: string
}

export const incomeEntriesRepository = {
  async create(userId: string, data: CreateIncomeEntryInput): Promise<IncomeEntry> {
    const result = await pool.query<IncomeEntry>(
      `INSERT INTO income_entries (user_id, account_id, category_id, description, amount_cents, entry_date, receipt_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        data.account_id,
        data.category_id,
        data.description,
        data.amount_cents,
        data.entry_date,
        data.receipt_method,
      ],
    )
    return result.rows[0]
  },

  async findAllByUser(userId: string, filters: IncomeEntryFilters = {}): Promise<IncomeEntry[]> {
    const optionalFilters: [string, string | undefined][] = [
      ['account_id = ', filters.accountId],
      ['category_id = ', filters.categoryId],
      ['entry_date >= ', filters.dateFrom],
      ['entry_date <= ', filters.dateTo],
    ]
    const active = optionalFilters.filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    )

    const conditions = ['user_id = $1', ...active.map(([clause], i) => `${clause}$${i + 2}`)]
    const values: unknown[] = [userId, ...active.map(([, value]) => value)]

    const result = await pool.query<IncomeEntry>(
      `SELECT * FROM income_entries WHERE ${conditions.join(' AND ')} ORDER BY entry_date DESC, created_at DESC`,
      values,
    )
    return result.rows
  },

  async findByIdAndUser(id: string, userId: string): Promise<IncomeEntry | null> {
    const result = await pool.query<IncomeEntry>(
      'SELECT * FROM income_entries WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(
    id: string,
    userId: string,
    data: UpdateIncomeEntryInput,
  ): Promise<IncomeEntry | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return incomeEntriesRepository.findByIdAndUser(id, userId)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values = entries.map(([, value]) => value)
    values.push(id, userId)

    const result = await pool.query<IncomeEntry>(
      `UPDATE income_entries SET ${fields.join(', ')} WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM income_entries WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },
}
