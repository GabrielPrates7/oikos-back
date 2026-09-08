import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import type { PaginatedResult, PaginationParams } from '../../utils/pagination.js'
import { isUniqueViolation } from '../../utils/postgres.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import { invoicePaymentsRepository } from '../invoice-payments/invoice-payments.repository.js'
import type { InvoicePayment } from '../invoice-payments/invoice-payments.types.js'
import { computeDisplayStatus } from './invoice-status.util.js'
import { invoicesRepository } from './invoices.repository.js'
import type { InvoiceListFilters, InvoiceSort } from './invoices.repository.js'
import type { PayInvoiceInput } from './invoices.schema.js'
import type { Invoice, InvoiceItem } from './invoices.types.js'

export interface InvoiceListItem extends InvoiceWithDisplayStatus {
  totalCents: number
}

function todayISODate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface InvoiceWithDisplayStatus extends Invoice {
  displayStatus: Invoice['status']
}

function withDisplayStatus(invoice: Invoice): InvoiceWithDisplayStatus {
  return {
    ...invoice,
    displayStatus: computeDisplayStatus(
      invoice.status,
      invoice.closing_date,
      invoice.due_date,
      todayISODate(),
    ),
  }
}

export const invoicesService = {
  async listForUser(
    userId: string,
    filters: InvoiceListFilters = {},
    pagination: PaginationParams,
    sort: InvoiceSort = 'value_desc',
  ): Promise<PaginatedResult<InvoiceListItem>> {
    const [invoices, { total, sumCents }] = await Promise.all([
      invoicesRepository.findAllByUser(userId, filters, pagination, sort),
      invoicesRepository.getFilteredSum(userId, filters),
    ])
    const items = invoices.map(({ total_cents, ...invoice }) => ({
      ...withDisplayStatus(invoice),
      totalCents: total_cents,
    }))
    return { items, total, sumCents, page: pagination.page, pageSize: pagination.pageSize }
  },

  async getDetail(
    id: string,
    userId: string,
  ): Promise<
    InvoiceWithDisplayStatus & {
      items: InvoiceItem[]
      totalCents: number
      payment: InvoicePayment | null
    }
  > {
    const invoice = await invoicesRepository.findByIdAndUser(id, userId)
    if (!invoice) {
      throw new NotFoundError('fatura não encontrada')
    }
    const items = await invoicesRepository.findInstallmentsWithPurchaseInfo(id)
    const totalCents = await invoicesRepository.getInvoiceTotal(id)
    const payment =
      invoice.status === 'paid' ? await invoicePaymentsRepository.findByInvoiceId(id) : null
    return { ...withDisplayStatus(invoice), items, totalCents, payment }
  },

  async payInvoice(
    userId: string,
    invoiceId: string,
    data: PayInvoiceInput,
  ): Promise<{ payment: InvoicePayment; invoice: InvoiceWithDisplayStatus }> {
    const invoice = await invoicesRepository.findByIdAndUser(invoiceId, userId)
    if (!invoice) {
      throw new NotFoundError('fatura não encontrada')
    }

    const account = await accountsRepository.findByIdAndUser(data.accountId, userId)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }

    // Saldo ATUAL da conta pagadora, antes deste pagamento — mesma regra usada em
    // expenses/transfers/goal-contributions.
    const balance = await accountsRepository.getBalance(data.accountId, userId)
    if ((balance?.balanceCents ?? 0) <= 0) {
      throw new ConflictError(
        'esta conta está com saldo zero ou negativo, não é possível registrar um novo lançamento',
      )
    }

    const totalCents = await invoicesRepository.getInvoiceTotal(invoiceId)
    if (data.amountCents !== undefined && data.amountCents !== totalCents) {
      throw new AppError(
        400,
        'pagamento parcial não suportado, valor deve ser exatamente o total da fatura',
      )
    }
    const amountToPay = data.amountCents ?? totalCents

    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')

      let payment: InvoicePayment
      try {
        payment = await invoicePaymentsRepository.create(client, {
          invoiceId,
          accountId: data.accountId,
          amountCents: amountToPay,
          paymentDate: data.paymentDate,
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError('fatura já paga')
        }
        throw error
      }

      const updatedInvoice = await invoicesRepository.markAsPaid(client, invoiceId)

      await client.query('COMMIT')
      return { payment, invoice: withDisplayStatus(updatedInvoice) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  },
}
