import { pool } from '../../config/database.js'
import { monthRange } from '../../utils/date-range.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { CreateExpenseInput, UpdateExpenseInput } from './expenses.schema.js'
import type { Expense } from './expenses.types.js'

export interface MonthlySummary {
  totalGeralCents: number
  totalPagoCents: number
  totalFaltaPagarCents: number
}

export interface ExpenseFilters {
  accountId?: string
  categoryId?: string
  paymentMethod?: string
  dateFrom?: string
  dateTo?: string
}

// Compartilhado entre findAllByUser (paginada) e getFilteredSum (agregada, sem
// LIMIT/OFFSET) — as duas precisam do EXATO mesmo WHERE, senão o total/soma não bate com
// as linhas realmente listadas em alguma página.
function buildWhere(userId: string, filters: ExpenseFilters): { where: string; values: unknown[] } {
  const optionalFilters: [string, string | undefined][] = [
    ['account_id = ', filters.accountId],
    ['category_id = ', filters.categoryId],
    ['payment_method = ', filters.paymentMethod],
    ['expense_date >= ', filters.dateFrom],
    ['expense_date <= ', filters.dateTo],
  ]
  const active = optionalFilters.filter((entry): entry is [string, string] => entry[1] !== undefined)

  const conditions = ['user_id = $1', ...active.map(([clause], i) => `${clause}$${i + 2}`)]
  const values: unknown[] = [userId, ...active.map(([, value]) => value)]

  return { where: conditions.join(' AND '), values }
}

export const expensesRepository = {
  // Anos com pelo menos uma despesa de verdade — popula o filtro "Ano" da UI sem lista fixa
  // arbitrária, mesmo princípio de income-entries.repository.getAvailableYears.
  async getAvailableYears(userId: string): Promise<number[]> {
    const result = await pool.query<{ year: number }>(
      `SELECT DISTINCT EXTRACT(YEAR FROM expense_date)::int AS year
       FROM expenses WHERE user_id = $1 ORDER BY year DESC`,
      [userId],
    )
    return result.rows.map((row) => row.year)
  },


  async create(userId: string, data: CreateExpenseInput): Promise<Expense> {
    const result = await pool.query<Expense>(
      `INSERT INTO expenses (user_id, account_id, category_id, description, amount_cents, payment_method, expense_date, is_essential, is_fixed, is_paid, is_planned, paid_date, count_in_totals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        userId,
        data.account_id,
        data.category_id,
        data.description,
        data.amount_cents,
        data.payment_method,
        data.expense_date,
        data.is_essential,
        data.is_fixed,
        data.is_paid,
        data.is_planned,
        data.paid_date ?? null,
        data.count_in_totals,
      ],
    )
    return result.rows[0]
  },

  // pagination é opcional de propósito: accounts.service.getStatement chama isso sem
  // paginar (precisa de TODAS as linhas do período pra montar o extrato com saldo
  // corrente) — só o controller de listagem (expenses.controller) passa page/pageSize.
  async findAllByUser(
    userId: string,
    filters: ExpenseFilters = {},
    pagination?: PaginationParams,
  ): Promise<Expense[]> {
    const { where, values } = buildWhere(userId, filters)
    let limitClause = ''
    if (pagination) {
      const limitIndex = values.push(pagination.pageSize)
      const offsetIndex = values.push((pagination.page - 1) * pagination.pageSize)
      limitClause = ` LIMIT $${limitIndex} OFFSET $${offsetIndex}`
    }

    const result = await pool.query<Expense>(
      `SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC, created_at DESC${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo WHERE de findAllByUser, sem LIMIT/OFFSET — total (contagem) e sumCents (soma) num
  // único round-trip, já que os dois agregam sobre o mesmo conjunto de linhas filtrado.
  // total conta TODAS as linhas (bate com a paginação, pendente incluída, count_in_totals
  // ou não); sumCents só soma as pagas E marcadas count_in_totals (CASE WHEN, não filtro
  // no WHERE — precisa continuar contando no `total`/paginação normalmente). Hoje esse
  // sumCents não é exibido em Despesas (a UI usa getMonthlySummary abaixo pro "Geral"/"Já
  // pago"/"Falta pagar") — ajustado mesmo assim, por consistência, caso passe a ser usado.
  async getFilteredSum(
    userId: string,
    filters: ExpenseFilters = {},
  ): Promise<{ total: number; sumCents: number }> {
    const { where, values } = buildWhere(userId, filters)
    const result = await pool.query<{ total: number; sum_cents: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN is_paid AND count_in_totals THEN amount_cents ELSE 0 END), 0)::int AS sum_cents
       FROM expenses WHERE ${where}`,
      values,
    )
    return { total: result.rows[0].total, sumCents: result.rows[0].sum_cents }
  },

  async findByIdAndUser(id: string, userId: string): Promise<Expense | null> {
    const result = await pool.query<Expense>(
      'SELECT * FROM expenses WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdateExpenseInput): Promise<Expense | null> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)

    if (entries.length === 0) {
      return expensesRepository.findByIdAndUser(id, userId)
    }

    const fields = entries.map(([key], i) => `${key} = $${i + 1}`)
    const values = entries.map(([, value]) => value)
    values.push(id, userId)

    const result = await pool.query<Expense>(
      `UPDATE expenses SET ${fields.join(', ')} WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },

  // totalPagoCents soma despesas pagas + pagamentos de fatura com due_date no mês;
  // totalFaltaPagarCents soma despesas pendentes + faturas ainda não pagas com due_date no
  // mês (valor total da fatura, via installments). Faturas são escopadas por cc.user_id
  // (dono do cartão), não pela conta que paga, pra ficar consistente entre as duas faces
  // (paga/a pagar) da mesma fatura. Também usado por dashboard.service.getSummary (mesmo
  // conceito de Já pago/Falta pagar, só que parametrizado pelo mês do MonthSwitcher em vez
  // de sempre o mês atual) — reaproveitado direto em vez de duplicar a query.
  //
  // respectCountInTotals (default false, fase 1): só o "Total exibido" de Despesas
  // (expenses.controller → expensesService.getMonthlySummary) passa true. O Dashboard
  // chama este método do repository DIRETO (bypassa o service), sem o parâmetro — continua
  // somando tudo, sem mudança, de propósito (fase 2 decide o resto, um de cada vez).
  async getMonthlySummary(
    userId: string,
    month: string,
    respectCountInTotals = false,
  ): Promise<MonthlySummary> {
    const range = month === 'all' ? null : monthRange(month)
    const dateParams = range ? [userId, range.monthStart, range.monthEnd] : [userId]
    const countCondition = respectCountInTotals ? ' AND count_in_totals' : ''

    const expensesResult = await pool.query<{ paid_cents: number; pending_cents: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN is_paid${countCondition} THEN amount_cents ELSE 0 END), 0)::int AS paid_cents,
         COALESCE(SUM(CASE WHEN NOT is_paid${countCondition} THEN amount_cents ELSE 0 END), 0)::int AS pending_cents
       FROM expenses
       WHERE user_id = $1${range ? ' AND expense_date BETWEEN $2 AND $3' : ''}`,
      dateParams,
    )

    const paidInvoicesResult = await pool.query<{ total_cents: number }>(
      `SELECT COALESCE(SUM(ip.amount_cents), 0)::int AS total_cents
       FROM invoice_payments ip
       JOIN invoices inv ON inv.id = ip.invoice_id
       JOIN credit_cards cc ON cc.id = inv.credit_card_id
       WHERE cc.user_id = $1${range ? ' AND inv.due_date BETWEEN $2 AND $3' : ''}`,
      dateParams,
    )

    const unpaidInvoicesResult = await pool.query<{ total_cents: number }>(
      `SELECT COALESCE(SUM(ins.amount_cents), 0)::int AS total_cents
       FROM installments ins
       JOIN invoices i ON i.id = ins.invoice_id
       JOIN credit_cards cc ON cc.id = i.credit_card_id
       WHERE cc.user_id = $1 AND i.status != 'paid'${range ? ' AND i.due_date BETWEEN $2 AND $3' : ''}`,
      dateParams,
    )

    const totalPagoCents = expensesResult.rows[0].paid_cents + paidInvoicesResult.rows[0].total_cents
    const totalFaltaPagarCents =
      expensesResult.rows[0].pending_cents + unpaidInvoicesResult.rows[0].total_cents

    return {
      totalPagoCents,
      totalFaltaPagarCents,
      totalGeralCents: totalPagoCents + totalFaltaPagarCents,
    }
  },
}
