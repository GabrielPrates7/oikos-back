import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { CreateCreditCardInput, UpdateCreditCardInput } from './credit-cards.schema.js'
import type { CreditCard, CreditCardStatus } from './credit-cards.types.js'

// Compartilhado entre findAllByUser (paginada) e getFilteredSum (agregada, sem
// LIMIT/OFFSET) — as duas precisam do EXATO mesmo filtro de status.
function buildStatusClause(
  status: CreditCardStatus | 'all' | undefined,
  values: unknown[],
  alias = '',
): string {
  if (status === 'all') return ''
  values.push(status ?? 'active')
  return ` AND ${alias}status = $${values.length}`
}

export const creditCardsRepository = {
  async create(userId: string, data: CreateCreditCardInput): Promise<CreditCard> {
    const result = await pool.query<CreditCard>(
      `INSERT INTO credit_cards (user_id, name, brand, credit_limit_cents, closing_day, due_day)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        data.name,
        data.brand ?? null,
        data.credit_limit_cents,
        data.closing_day,
        data.due_day,
      ],
    )
    return result.rows[0]
  },

  // pagination é opcional de propósito: dashboard.service soma limite/disponível de TODOS
  // os cartões (nunca paginado) — só o controller de listagem (credit-cards.controller)
  // passa page/pageSize.
  async findAllByUser(
    userId: string,
    status?: CreditCardStatus | 'all',
    pagination?: PaginationParams,
  ): Promise<CreditCard[]> {
    const values: unknown[] = [userId]
    const statusClause = buildStatusClause(status, values)
    let limitClause = ''
    if (pagination) {
      const limitIndex = values.push(pagination.pageSize)
      const offsetIndex = values.push((pagination.page - 1) * pagination.pageSize)
      limitClause = ` LIMIT $${limitIndex} OFFSET $${offsetIndex}`
    }

    const result = await pool.query<CreditCard>(
      `SELECT * FROM credit_cards WHERE user_id = $1${statusClause} ORDER BY created_at${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo filtro de findAllByUser, sem LIMIT/OFFSET — total (contagem), soma do limite total
  // (coluna direta) e soma do disponível (mesma fórmula de getAvailableLimit, agregada) num
  // único round-trip. Duas somas porque CartoesList mostra "Limite total" e "Disponível
  // total" lado a lado (não cabe no PaginatedResult<T> genérico, que só tem um sumCents).
  async getFilteredSum(
    userId: string,
    status?: CreditCardStatus | 'all',
  ): Promise<{ total: number; sumCreditLimitCents: number; sumAvailableLimitCents: number }> {
    const values: unknown[] = [userId]
    const statusClause = buildStatusClause(status, values, 'cc.')
    const result = await pool.query<{
      total: number
      sum_credit_limit_cents: number
      sum_available_limit_cents: number
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(cc.credit_limit_cents), 0)::int AS sum_credit_limit_cents,
         COALESCE(SUM(
           cc.credit_limit_cents - COALESCE((
             SELECT SUM(i.amount_cents)
             FROM installments i
             JOIN invoices inv ON inv.id = i.invoice_id
             WHERE inv.credit_card_id = cc.id AND inv.status != 'paid'
           ), 0)
         ), 0)::int AS sum_available_limit_cents
       FROM credit_cards cc
       WHERE cc.user_id = $1${statusClause}`,
      values,
    )
    return {
      total: result.rows[0].total,
      sumCreditLimitCents: result.rows[0].sum_credit_limit_cents,
      sumAvailableLimitCents: result.rows[0].sum_available_limit_cents,
    }
  },

  async findByIdAndUser(id: string, userId: string): Promise<CreditCard | null> {
    const result = await pool.query<CreditCard>(
      'SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(
    id: string,
    userId: string,
    data: UpdateCreditCardInput,
  ): Promise<CreditCard | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return creditCardsRepository.findByIdAndUser(id, userId)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values = entries.map(([, value]) => value)
    values.push(id, userId)

    const result = await pool.query<CreditCard>(
      `UPDATE credit_cards SET ${fields.join(', ')} WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async archive(id: string, userId: string): Promise<CreditCard | null> {
    const result = await pool.query<CreditCard>(
      "UPDATE credit_cards SET status = 'archived' WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async activate(id: string, userId: string): Promise<CreditCard | null> {
    const result = await pool.query<CreditCard>(
      "UPDATE credit_cards SET status = 'active' WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  // Só purchases importa aqui — installments/invoices/invoice_payments dependem de purchases
  // via FK (ON DELETE...), então se não há purchase não há nada mais vinculado ao cartão.
  async hasAnyMovement(id: string): Promise<boolean> {
    const result = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM purchases WHERE credit_card_id = $1) AS exists',
      [id],
    )
    return result.rows[0].exists
  },

  // Exclusão de verdade (não archive) — só chamada pelo service depois de confirmar posse
  // e ausência de compra vinculada.
  async deletePermanently(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM credit_cards WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },

  async getAvailableLimit(
    id: string,
    userId: string,
  ): Promise<{ availableLimitCents: number } | null> {
    // Fórmula completa da seção 5.3 do documento técnico. Subquery agregada (não LEFT JOIN
    // em paralelo) pra não multiplicar linhas. O filtro por cc.user_id = $2 já confirma
    // posse antes de calcular.
    const result = await pool.query<{ available_limit_cents: number }>(
      `SELECT
         (
           cc.credit_limit_cents
           - COALESCE((
               SELECT SUM(i.amount_cents)
               FROM installments i
               JOIN invoices inv ON inv.id = i.invoice_id
               WHERE inv.credit_card_id = cc.id AND inv.status != 'paid'
             ), 0)
         )::int AS available_limit_cents
       FROM credit_cards cc
       WHERE cc.id = $1 AND cc.user_id = $2`,
      [id, userId],
    )
    const row = result.rows[0]
    if (!row) {
      return null
    }
    return { availableLimitCents: row.available_limit_cents }
  },
}
