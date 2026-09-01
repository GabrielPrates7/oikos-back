import { pool } from '../../config/database.js'
import type { CreateCreditCardInput, UpdateCreditCardInput } from './credit-cards.schema.js'
import type { CreditCard, CreditCardStatus } from './credit-cards.types.js'

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

  async findAllByUser(userId: string, status?: CreditCardStatus | 'all'): Promise<CreditCard[]> {
    if (status === 'all') {
      const result = await pool.query<CreditCard>(
        'SELECT * FROM credit_cards WHERE user_id = $1 ORDER BY created_at',
        [userId],
      )
      return result.rows
    }

    const result = await pool.query<CreditCard>(
      'SELECT * FROM credit_cards WHERE user_id = $1 AND status = $2 ORDER BY created_at',
      [userId, status ?? 'active'],
    )
    return result.rows
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
