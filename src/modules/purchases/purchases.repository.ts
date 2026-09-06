import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { CreatePurchaseInput, UpdatePurchaseInput } from './purchases.schema.js'
import type { Purchase, PurchaseWithCategory } from './purchases.types.js'

export const purchasesRepository = {
  // Fase 11: só criação, sempre dentro da transação de purchases.service.
  async create(client: PoolClient, userId: string, data: CreatePurchaseInput): Promise<Purchase> {
    const result = await client.query<Purchase>(
      `INSERT INTO purchases (user_id, credit_card_id, category_id, description, total_amount_cents, installments_count, purchase_date, is_essential, is_fixed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        data.credit_card_id,
        data.category_id,
        data.description,
        data.total_amount_cents,
        data.installments_count,
        data.purchase_date,
        data.is_essential,
        data.is_fixed,
      ],
    )
    return result.rows[0]
  },

  async findByIdAndUser(id: string, userId: string): Promise<Purchase | null> {
    const result = await pool.query<Purchase>(
      'SELECT * FROM purchases WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdatePurchaseInput): Promise<Purchase | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return purchasesRepository.findByIdAndUser(id, userId)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values: unknown[] = entries.map(([, value]) => value)
    values.push(id, userId)

    const result = await pool.query<Purchase>(
      `UPDATE purchases SET ${fields.join(', ')} WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  // Nível de compra só — sem parcelas/faturas, isso é histórico "o que foi comprado",
  // não o extrato de fatura (que já existe em invoices/installments). payment_status:
  // 'paid' só quando TODAS as parcelas estão em fatura paga (bool_and sobre o grupo);
  // uma única query agregada, sem N+1 por compra. GROUP BY p.id é suficiente pra liberar
  // p.* inteiro (dependência funcional da chave primária), sem precisar listar cada coluna.
  async findAllByCard(creditCardId: string): Promise<PurchaseWithCategory[]> {
    const result = await pool.query<PurchaseWithCategory>(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon,
              CASE WHEN bool_and(inv.status = 'paid') THEN 'paid' ELSE 'pending' END AS payment_status
       FROM purchases p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN installments i ON i.purchase_id = p.id
       LEFT JOIN invoices inv ON inv.id = i.invoice_id
       WHERE p.credit_card_id = $1
       GROUP BY p.id, c.name, c.icon
       ORDER BY p.purchase_date DESC`,
      [creditCardId],
    )
    return result.rows
  },
}
