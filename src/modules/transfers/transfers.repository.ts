import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { CreateTransferInput } from './transfers.schema.js'
import type { Transfer } from './transfers.types.js'

export interface TransferFilters {
  accountId?: string
  dateFrom?: string
  dateTo?: string
}

// Compartilhado entre findAllByUser (paginada) e getFilteredSum (agregada, sem
// LIMIT/OFFSET) — as duas precisam do EXATO mesmo WHERE, senão o total/soma não bate com
// as linhas realmente listadas em alguma página.
function buildWhere(userId: string, filters: TransferFilters): { where: string; values: unknown[] } {
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

  return { where: conditions.join(' AND '), values }
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

  // pagination é opcional de propósito: accounts.service.getStatement chama isso sem
  // paginar (precisa de TODAS as linhas do período pra montar o extrato com saldo
  // corrente) — só o controller de listagem (transfers.controller) passa page/pageSize.
  async findAllByUser(
    userId: string,
    filters: TransferFilters = {},
    pagination?: PaginationParams,
  ): Promise<Transfer[]> {
    const { where, values } = buildWhere(userId, filters)
    let limitClause = ''
    if (pagination) {
      const limitIndex = values.push(pagination.pageSize)
      const offsetIndex = values.push((pagination.page - 1) * pagination.pageSize)
      limitClause = ` LIMIT $${limitIndex} OFFSET $${offsetIndex}`
    }

    const result = await pool.query<Transfer>(
      `SELECT * FROM transfers WHERE ${where} ORDER BY transfer_date DESC, created_at DESC${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo WHERE de findAllByUser, sem LIMIT/OFFSET — total (contagem) e sumCents (soma) num
  // único round-trip, já que os dois agregam sobre o mesmo conjunto de linhas filtrado.
  async getFilteredSum(
    userId: string,
    filters: TransferFilters = {},
  ): Promise<{ total: number; sumCents: number }> {
    const { where, values } = buildWhere(userId, filters)
    const result = await pool.query<{ total: number; sum_cents: number }>(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(amount_cents), 0)::int AS sum_cents
       FROM transfers WHERE ${where}`,
      values,
    )
    return { total: result.rows[0].total, sumCents: result.rows[0].sum_cents }
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
