import type { PoolClient } from 'pg'
import type { CreatePurchaseInput } from './purchases.schema.js'
import type { Purchase } from './purchases.types.js'

// Fase 11: só criação, sempre dentro da transação de purchases.service.
export const purchasesRepository = {
  async create(client: PoolClient, userId: string, data: CreatePurchaseInput): Promise<Purchase> {
    const result = await client.query<Purchase>(
      `INSERT INTO purchases (user_id, credit_card_id, category_id, description, total_amount_cents, installments_count, purchase_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        data.credit_card_id,
        data.category_id,
        data.description,
        data.total_amount_cents,
        data.installments_count,
        data.purchase_date,
      ],
    )
    return result.rows[0]
  },
}
