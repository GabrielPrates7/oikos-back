import type { Pool, PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { CreatePurchaseInput, UpdatePurchaseInput } from './purchases.schema.js'
import type { Purchase, PurchaseWithCategory } from './purchases.types.js'

// update() roda tanto fora de transação (edição simples) quanto dentro de uma (edição
// estrutural, em purchases.service) — aceita pool ou client indistintamente, já que os
// dois expõem a mesma assinatura de .query() usada aqui.
type QueryExecutor = Pool | PoolClient

export const purchasesRepository = {
  // Fase 11: só criação, sempre dentro da transação de purchases.service.
  async create(client: PoolClient, userId: string, data: CreatePurchaseInput): Promise<Purchase> {
    const result = await client.query<Purchase>(
      `INSERT INTO purchases (user_id, credit_card_id, category_id, description, total_amount_cents, installments_count, purchase_date, is_essential, is_fixed, is_planned, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        data.is_planned,
        data.notes ?? null,
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

  async update(
    id: string,
    userId: string,
    data: UpdatePurchaseInput,
    executor: QueryExecutor = pool,
  ): Promise<Purchase | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return purchasesRepository.findByIdAndUser(id, userId)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values: unknown[] = entries.map(([, value]) => value)
    values.push(id, userId)

    const result = await executor.query<Purchase>(
      `UPDATE purchases SET ${fields.join(', ')} WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  // true se QUALQUER parcela dessa compra estiver numa fatura já paga — usado tanto pra
  // bloquear exclusão quanto edição estrutural (valor/parcelamento/data/cartão), já que
  // as duas exigem apagar parcelas que já foram cobradas de verdade.
  async hasAnyPaidInstallment(purchaseId: string): Promise<boolean> {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM installments i
         JOIN invoices inv ON inv.id = i.invoice_id
         WHERE i.purchase_id = $1 AND inv.status = 'paid'
       ) AS exists`,
      [purchaseId],
    )
    return result.rows[0].exists
  },

  // Sem client/transação — a exclusão em si é uma única instrução, e o cascade de
  // installments (ON DELETE CASCADE, ver migration) é resolvido atomicamente pelo próprio
  // Postgres dentro dela.
  async delete(id: string, userId: string): Promise<void> {
    await pool.query('DELETE FROM purchases WHERE id = $1 AND user_id = $2', [id, userId])
  },

  // Nível de compra só — sem parcelas/faturas, isso é histórico "o que foi comprado",
  // não o extrato de fatura (que já existe em invoices/installments). payment_status:
  // 'paid' só quando TODAS as parcelas estão em fatura paga (bool_and sobre o grupo);
  // has_paid_installment: true se QUALQUER parcela estiver (bool_or) — mesma semântica de
  // hasAnyPaidInstallment, exposta aqui pra UI travar os campos estruturais de edição sem
  // precisar de uma chamada extra por compra. installment_months: meses de fatura das
  // parcelas (array_agg DISTINCT), pro filtro Mês/Ano da UI refletir onde a parcela cai de
  // verdade, não só a data da compra. Uma única query agregada, sem N+1.
  // GROUP BY p.id é suficiente pra liberar p.* inteiro (dependência funcional da chave
  // primária), sem precisar listar cada coluna.
  async findAllByCard(creditCardId: string): Promise<PurchaseWithCategory[]> {
    const result = await pool.query<PurchaseWithCategory>(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon,
              CASE WHEN bool_and(inv.status = 'paid') THEN 'paid' ELSE 'pending' END AS payment_status,
              COALESCE(bool_or(inv.status = 'paid'), false) AS has_paid_installment,
              COALESCE(
                array_agg(DISTINCT to_char(inv.reference_month, 'YYYY-MM') ORDER BY to_char(inv.reference_month, 'YYYY-MM'))
                  FILTER (WHERE inv.id IS NOT NULL),
                ARRAY[]::text[]
              ) AS installment_months
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
