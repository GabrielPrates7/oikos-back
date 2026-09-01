import { pool } from '../../config/database.js'
import type { CreateTransferInput } from './transfers.schema.js'
import type { Transfer } from './transfers.types.js'

export interface TransferFilters {
  accountId?: string
  dateFrom?: string
  dateTo?: string
}

export const transfersRepository = {
  async create(userId: string, data: CreateTransferInput): Promise<Transfer> {
    const result = await pool.query<Transfer>(
      `INSERT INTO transfers (user_id, from_account_id, to_account_id, amount_cents, transfer_date, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        data.from_account_id,
        data.to_account_id,
        data.amount_cents,
        data.transfer_date,
        data.description ?? null,
      ],
    )
    return result.rows[0]
  },

  async findAllByUser(userId: string, filters: TransferFilters = {}): Promise<Transfer[]> {
    const conditions = ['user_id = $1']
    const values: unknown[] = [userId]

    if (filters.accountId !== undefined) {
      values.push(filters.accountId)
      conditions.push(`(from_account_id = $${values.length} OR to_account_id = $${values.length})`)
    }
    if (filters.dateFrom !== undefined) {
      values.push(filters.dateFrom)
      conditions.push(`transfer_date >= $${values.length}`)
    }
    if (filters.dateTo !== undefined) {
      values.push(filters.dateTo)
      conditions.push(`transfer_date <= $${values.length}`)
    }

    const result = await pool.query<Transfer>(
      `SELECT * FROM transfers WHERE ${conditions.join(' AND ')} ORDER BY transfer_date DESC, created_at DESC`,
      values,
    )
    return result.rows
  },

  async findByIdAndUser(id: string, userId: string): Promise<Transfer | null> {
    const result = await pool.query<Transfer>(
      'SELECT * FROM transfers WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM transfers WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },
}
