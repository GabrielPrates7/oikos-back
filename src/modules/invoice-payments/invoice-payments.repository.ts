import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { InvoicePayment, InvoicePaymentForAccountRow } from './invoice-payments.types.js'

export interface InvoicePaymentFilters {
  dateFrom?: string
  dateTo?: string
}

export const invoicePaymentsRepository = {
  // Leitura fora de transação — usada por invoices.service.getDetail pra mostrar data/conta do
  // pagamento ATIVO de uma fatura paga. Com soft-cancel uma fatura pode acumular mais de um
  // registro no histórico (pago -> cancelado -> pago de novo); canceled_at IS NULL + LIMIT 1
  // garante que só o ativo (no máximo um, pelo índice único parcial) é considerado.
  async findByInvoiceId(invoiceId: string): Promise<InvoicePayment | null> {
    const result = await pool.query<InvoicePayment>(
      `SELECT * FROM invoice_payments
       WHERE invoice_id = $1 AND canceled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [invoiceId],
    )
    return result.rows[0] ?? null
  },

  // Pagamentos de fatura debitados de uma conta, pro extrato (accounts.service.getStatement).
  // JOIN de volta em accounts confirma posse antes de retornar qualquer linha, mesmo
  // padrão de defesa embutida usado em accounts.repository.getBalance. Cancelado não é um
  // movimento de caixa (o valor já voltou pra conta) — não entra no extrato.
  async findAllForAccount(
    accountId: string,
    userId: string,
    filters: InvoicePaymentFilters = {},
  ): Promise<InvoicePaymentForAccountRow[]> {
    const conditions = ['ip.account_id = $1', 'a.user_id = $2', 'ip.canceled_at IS NULL']
    const values: unknown[] = [accountId, userId]

    if (filters.dateFrom !== undefined) {
      values.push(filters.dateFrom)
      conditions.push(`ip.payment_date >= $${values.length}`)
    }
    if (filters.dateTo !== undefined) {
      values.push(filters.dateTo)
      conditions.push(`ip.payment_date <= $${values.length}`)
    }

    const result = await pool.query<InvoicePaymentForAccountRow>(
      `SELECT ip.id, ip.amount_cents, ip.payment_date AS date, ip.created_at, cc.name AS card_name
       FROM invoice_payments ip
       JOIN accounts a ON a.id = ip.account_id
       JOIN invoices inv ON inv.id = ip.invoice_id
       JOIN credit_cards cc ON cc.id = inv.credit_card_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ip.payment_date DESC, ip.created_at DESC`,
      values,
    )
    return result.rows
  },

  // Só criação, sempre dentro da transação de invoices.service.payInvoice.
  async create(
    client: PoolClient,
    data: { invoiceId: string; accountId: string; amountCents: number; paymentDate: string },
  ): Promise<InvoicePayment> {
    const result = await client.query<InvoicePayment>(
      `INSERT INTO invoice_payments (invoice_id, account_id, amount_cents, payment_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.invoiceId, data.accountId, data.amountCents, data.paymentDate],
    )
    return result.rows[0]
  },

  // Trava a linha ATIVA (se existir) do pagamento — sempre dentro da transação de
  // invoices.service.cancelPayment. FOR UPDATE: um segundo cancelamento concorrente do MESMO
  // pagamento espera esta transação terminar; ao continuar, canceled_at IS NULL já não bate
  // mais (foi cancelado pela primeira), e o SELECT volta vazio — sem duplo crédito na conta.
  async findActiveByInvoiceIdForUpdate(
    client: PoolClient,
    invoiceId: string,
  ): Promise<InvoicePayment | null> {
    const result = await client.query<InvoicePayment>(
      `SELECT * FROM invoice_payments
       WHERE invoice_id = $1 AND canceled_at IS NULL
       FOR UPDATE`,
      [invoiceId],
    )
    return result.rows[0] ?? null
  },

  // Soft-cancel: marca canceled_at, nunca apaga a linha (auditoria/ledger). Sempre dentro da
  // transação de invoices.service.cancelPayment, depois de findActiveByInvoiceIdForUpdate.
  async cancel(client: PoolClient, id: string): Promise<InvoicePayment> {
    const result = await client.query<InvoicePayment>(
      `UPDATE invoice_payments SET canceled_at = now() WHERE id = $1 RETURNING *`,
      [id],
    )
    return result.rows[0]
  },
}
