import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { CreateIncomeEntryInput, UpdateIncomeEntryInput } from './income-entries.schema.js'
import type { IncomeEntry } from './income-entries.types.js'

export interface IncomeEntryFilters {
  accountId?: string
  categoryId?: string
  dateFrom?: string
  dateTo?: string
}

// Compartilhado entre findAllByUser (paginada) e getFilteredSum (agregada, sem
// LIMIT/OFFSET) — as duas precisam do EXATO mesmo WHERE, senão o total/soma não bate com
// as linhas realmente listadas em alguma página.
function buildWhere(userId: string, filters: IncomeEntryFilters): { where: string; values: unknown[] } {
  const optionalFilters: [string, string | undefined][] = [
    ['account_id = ', filters.accountId],
    ['category_id = ', filters.categoryId],
    ['entry_date >= ', filters.dateFrom],
    ['entry_date <= ', filters.dateTo],
  ]
  const active = optionalFilters.filter((entry): entry is [string, string] => entry[1] !== undefined)

  const conditions = ['user_id = $1', ...active.map(([clause], i) => `${clause}$${i + 2}`)]
  const values: unknown[] = [userId, ...active.map(([, value]) => value)]

  return { where: conditions.join(' AND '), values }
}

export const incomeEntriesRepository = {
  async create(userId: string, data: CreateIncomeEntryInput): Promise<IncomeEntry> {
    const result = await pool.query<IncomeEntry>(
      `INSERT INTO income_entries (user_id, account_id, category_id, description, amount_cents, entry_date, receipt_method, is_received, is_planned, received_date, count_in_totals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        userId,
        data.account_id,
        data.category_id,
        data.description,
        data.amount_cents,
        data.entry_date,
        data.receipt_method,
        data.is_received,
        data.is_planned,
        data.received_date ?? null,
        data.count_in_totals,
      ],
    )
    return result.rows[0]
  },

  // pagination é opcional de propósito: accounts.service.getStatement chama isso sem
  // paginar (precisa de TODAS as linhas do período pra montar o extrato com saldo
  // corrente) — só os controllers de listagem (income-entries.controller) passam page/pageSize.
  async findAllByUser(
    userId: string,
    filters: IncomeEntryFilters = {},
    pagination?: PaginationParams,
  ): Promise<IncomeEntry[]> {
    const { where, values } = buildWhere(userId, filters)
    let limitClause = ''
    if (pagination) {
      const limitIndex = values.push(pagination.pageSize)
      const offsetIndex = values.push((pagination.page - 1) * pagination.pageSize)
      limitClause = ` LIMIT $${limitIndex} OFFSET $${offsetIndex}`
    }

    const result = await pool.query<IncomeEntry>(
      `SELECT * FROM income_entries WHERE ${where} ORDER BY entry_date DESC, created_at DESC${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo WHERE de findAllByUser, sem LIMIT/OFFSET — total (contagem) e sumCents (soma) num
  // único round-trip, já que os dois agregam sobre o mesmo conjunto de linhas filtrado.
  // total conta TODAS as linhas (bate com a paginação, pendente incluída, count_in_totals
  // ou não — a lista mostra tudo, só o SOMATÓRIO muda). sumCents só soma as recebidas E
  // marcadas count_in_totals (CASE WHEN, não filtro no WHERE — precisa continuar contando
  // no `total`/paginação normalmente). Fase 1: só esse sumCents ("Total exibido" de
  // Entradas) respeita count_in_totals — Saldo Real/extrato de conta (accounts.service)
  // não passam por aqui, continuam somando tudo.
  async getFilteredSum(
    userId: string,
    filters: IncomeEntryFilters = {},
  ): Promise<{ total: number; sumCents: number }> {
    const { where, values } = buildWhere(userId, filters)
    const result = await pool.query<{ total: number; sum_cents: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN is_received AND count_in_totals THEN amount_cents ELSE 0 END), 0)::int AS sum_cents
       FROM income_entries WHERE ${where}`,
      values,
    )
    return { total: result.rows[0].total, sumCents: result.rows[0].sum_cents }
  },

  // Anos com pelo menos um lançamento de verdade — popula o filtro "Ano" da UI sem lista
  // fixa arbitrária (ex: usuário novo só veria o ano em que criou a conta, não 2020-2030
  // hardcoded sem dado nenhum).
  async getAvailableYears(userId: string): Promise<number[]> {
    const result = await pool.query<{ year: number }>(
      `SELECT DISTINCT EXTRACT(YEAR FROM entry_date)::int AS year
       FROM income_entries WHERE user_id = $1 ORDER BY year DESC`,
      [userId],
    )
    return result.rows.map((row) => row.year)
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
