import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { Invoice, InvoiceItem, InvoiceWithTotal } from './invoices.types.js'

export type InvoiceSort = 'value_asc' | 'value_desc'

export interface InvoiceListFilters {
  creditCardId?: string
  search?: string
  // Número do mês de REFERÊNCIA ('01'..'12'); undefined/'all' = todos os meses. Independente
  // de year e de status (antes esta opção embutia "mês atual + não paga de mês anterior",
  // misturando período e status num só valor).
  month?: string
  // 'YYYY' — restringe ao ano do mês de REFERÊNCIA da fatura (mesmo eixo do filtro de mês).
  year?: string
  // 'unpaid' = fatura ainda não paga; 'paid' = paga.
  status?: 'unpaid' | 'paid'
  // Período de VENCIMENTO (due_date), 'YYYY-MM-DD' inclusivo. Se qualquer um dos dois vier,
  // o intervalo explícito manda e month/year são ignorados (mesma regra de from/to em
  // Entradas/Despesas: quem digita um intervalo pediu aquele intervalo).
  dueFrom?: string
  dueTo?: string
}

// Compartilhado entre findAllByUser (paginada) e getFilteredSum (agregada, sem
// LIMIT/OFFSET) — as duas precisam do EXATO mesmo WHERE, senão o total/soma não bate com
// as linhas realmente listadas em alguma página.
function buildWhere(userId: string, filters: InvoiceListFilters): { where: string; values: unknown[] } {
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

  if (filters.dueFrom !== undefined || filters.dueTo !== undefined) {
    if (filters.dueFrom !== undefined) {
      values.push(filters.dueFrom)
      conditions.push(`i.due_date >= $${values.length}::date`)
    }
    if (filters.dueTo !== undefined) {
      values.push(filters.dueTo)
      conditions.push(`i.due_date <= $${values.length}::date`)
    }
    return { where: conditions.join(' AND '), values }
  }

  if (filters.month !== undefined && filters.month !== 'all') {
    values.push(Number(filters.month))
    conditions.push(`EXTRACT(MONTH FROM i.reference_month) = $${values.length}::int`)
  }

  if (filters.year !== undefined) {
    values.push(Number(filters.year))
    conditions.push(`EXTRACT(YEAR FROM i.reference_month) = $${values.length}::int`)
  }

  // status != 'paid' basta pra "não paga": computeDisplayStatus só devolve 'paid' quando o
  // status bruto já é 'paid' (nunca é derivado de data) — ver invoice-status.util.
  if (filters.status === 'unpaid') conditions.push("i.status != 'paid'")
  if (filters.status === 'paid') conditions.push("i.status = 'paid'")

  return { where: conditions.join(' AND '), values }
}

function buildOrderBy(sort: InvoiceSort): string {
  // total_cents é o alias calculado no próprio SELECT (subquery correlacionada) — Postgres
  // aceita ORDER BY por alias de coluna da mesma query. reference_month DESC como
  // desempate, mesma ordem que já existia antes do sort por valor existir.
  const direction = sort === 'value_asc' ? 'ASC' : 'DESC'
  return `total_cents ${direction}, i.reference_month DESC`
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
    filters: InvoiceListFilters = {},
    pagination?: PaginationParams,
    sort: InvoiceSort = 'value_desc',
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
       ORDER BY ${buildOrderBy(sort)}${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo WHERE de findAllByUser, sem LIMIT/OFFSET (e sem ORDER BY — não importa pra
  // agregação) — total (contagem de faturas) e sumCents (soma dos total_cents de cada
  // fatura, mesma subquery correlacionada da listagem) num único round-trip.
  async getFilteredSum(
    userId: string,
    filters: InvoiceListFilters = {},
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

  // Escrita — parte da transação de invoices.service.cancelPayment. Volta ao status bruto
  // 'open': computeDisplayStatus recalcula sozinho 'overdue'/'closed' comparando due_date/
  // closing_date com hoje, na próxima leitura — nenhuma lógica de status nova aqui.
  async revertToOpen(client: PoolClient, invoiceId: string): Promise<Invoice> {
    const result = await client.query<Invoice>(
      "UPDATE invoices SET status = 'open' WHERE id = $1 RETURNING *",
      [invoiceId],
    )
    return result.rows[0]
  },
}
