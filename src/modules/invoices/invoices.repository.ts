import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { Invoice, InvoiceItem, InvoiceWithTotal } from './invoices.types.js'

// Compartilhado entre findAllByUser (paginada) e getFilteredSum (agregada, sem
// LIMIT/OFFSET) — as duas precisam do EXATO mesmo WHERE, senão o total/soma não bate com
// as linhas realmente listadas em alguma página.
function buildWhere(
  userId: string,
  filters: { creditCardId?: string; search?: string },
): { where: string; values: unknown[] } {
  const conditions = ['cc.user_id = $1']
  const values: unknown[] = [userId]

  if (filters.creditCardId !== undefined) {
    values.push(filters.creditCardId)
    conditions.push(`i.credit_card_id = $${values.length}`)
  }

  if (filters.search !== undefined) {
    values.push(`%${filters.search}%`)
    conditions.push(`EXISTS (
      SELECT 1 FROM installments ins
      JOIN purchases p ON p.id = ins.purchase_id
      WHERE ins.invoice_id = i.id AND p.description ILIKE $${values.length}
    )`)
  }

  return { where: conditions.join(' AND '), values }
}

export const invoicesRepository = {
  // Fase 11: usadas dentro da transação de purchases.service (find-or-create de fatura).
  async findByCardAndReferenceMonth(
    client: PoolClient,
    creditCardId: string,
    referenceMonth: string,
  ): Promise<Invoice | null> {
    const result = await client.query<Invoice>(
      'SELECT * FROM invoices WHERE credit_card_id = $1 AND reference_month = $2',
      [creditCardId, referenceMonth],
    )
    return result.rows[0] ?? null
  },

  async create(
    client: PoolClient,
    data: { creditCardId: string; referenceMonth: string; closingDate: string; dueDate: string },
  ): Promise<Invoice> {
    const result = await client.query<Invoice>(
      `INSERT INTO invoices (credit_card_id, reference_month, closing_date, due_date, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING *`,
      [data.creditCardId, data.referenceMonth, data.closingDate, data.dueDate],
    )
    return result.rows[0]
  },

  // Fase 12: leitura/listagem — sempre confirmando posse via JOIN em credit_cards.user_id,
  // nunca confiando em id sozinho. total_cents vem via subquery correlacionada (mesmo
  // SUM de getInvoiceTotal) pra listagem não precisar de N+1 fetch por fatura.
  // pagination é opcional de propósito, mesmo padrão dos outros 3 módulos paginados — hoje
  // nada mais no backend chama findAllByUser sem paginar, mas mantém a mesma garantia caso
  // apareça um consumidor interno (relatório, extrato) que precise do conjunto inteiro.
  async findAllByUser(
    userId: string,
    filters: { creditCardId?: string; search?: string } = {},
    pagination?: PaginationParams,
  ): Promise<InvoiceWithTotal[]> {
    const { where, values } = buildWhere(userId, filters)
    let limitClause = ''
    if (pagination) {
      const limitIndex = values.push(pagination.pageSize)
      const offsetIndex = values.push((pagination.page - 1) * pagination.pageSize)
      limitClause = ` LIMIT $${limitIndex} OFFSET $${offsetIndex}`
    }

    const result = await pool.query<InvoiceWithTotal>(
      `SELECT
         i.*,
         COALESCE(
           (SELECT SUM(ins.amount_cents) FROM installments ins WHERE ins.invoice_id = i.id),
           0
         )::int AS total_cents
       FROM invoices i
       JOIN credit_cards cc ON cc.id = i.credit_card_id
       WHERE ${where}
       ORDER BY i.reference_month DESC${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo WHERE de findAllByUser, sem LIMIT/OFFSET — total (contagem de faturas) e sumCents
  // (soma dos total_cents de cada fatura, mesma subquery correlacionada da listagem) num
  // único round-trip.
  async getFilteredSum(
    userId: string,
    filters: { creditCardId?: string; search?: string } = {},
  ): Promise<{ total: number; sumCents: number }> {
    const { where, values } = buildWhere(userId, filters)
    const result = await pool.query<{ total: number; sum_cents: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(
           (SELECT SUM(ins.amount_cents) FROM installments ins WHERE ins.invoice_id = i.id)
         ), 0)::int AS sum_cents
       FROM invoices i
       JOIN credit_cards cc ON cc.id = i.credit_card_id
       WHERE ${where}`,
      values,
    )
    return { total: result.rows[0].total, sumCents: result.rows[0].sum_cents }
  },

  async findByIdAndUser(id: string, userId: string): Promise<Invoice | null> {
    const result = await pool.query<Invoice>(
      `SELECT i.* FROM invoices i
       JOIN credit_cards cc ON cc.id = i.credit_card_id
       WHERE i.id = $1 AND cc.user_id = $2`,
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async findInstallmentsWithPurchaseInfo(invoiceId: string): Promise<InvoiceItem[]> {
    const result = await pool.query<InvoiceItem>(
      `SELECT
         ins.installment_number,
         p.installments_count,
         ins.amount_cents,
         p.description,
         c.name AS category_name,
         c.icon AS category_icon,
         p.is_essential
       FROM installments ins
       JOIN purchases p ON p.id = ins.purchase_id
       JOIN categories c ON c.id = p.category_id
       WHERE ins.invoice_id = $1
       ORDER BY p.purchase_date, ins.installment_number`,
      [invoiceId],
    )
    return result.rows
  },

  async getInvoiceTotal(invoiceId: string): Promise<number> {
    const result = await pool.query<{ total: number }>(
      'SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM installments WHERE invoice_id = $1',
      [invoiceId],
    )
    return result.rows[0].total
  },

  // Escrita — parte da transação de invoices.service.payInvoice.
  async markAsPaid(client: PoolClient, invoiceId: string): Promise<Invoice> {
    const result = await client.query<Invoice>(
      "UPDATE invoices SET status = 'paid' WHERE id = $1 RETURNING *",
      [invoiceId],
    )
    return result.rows[0]
  },
}
