import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { CreatePurchaseInput } from './purchases.schema.js'
import type { Purchase, PurchaseWithCategory } from './purchases.types.js'

export const purchasesRepository = {
  // Fase 11: só criação, sempre dentro da transação de purchases.service.
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

  // Nível de compra só — sem parcelas/faturas, isso é histórico "o que foi comprado",
  // não o extrato de fatura (que já existe em invoices/installments).
  async findAllByCard(creditCardId: string): Promise<PurchaseWithCategory[]> {
    const result = await pool.query<PurchaseWithCategory>(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon
       FROM purchases p
       JOIN categories c ON c.id = p.category_id
       WHERE p.credit_card_id = $1
       ORDER BY p.purchase_date DESC`,
      [creditCardId],
    )
    return result.rows
  },
}
