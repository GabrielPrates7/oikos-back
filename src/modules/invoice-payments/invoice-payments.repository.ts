import type { PoolClient } from 'pg'
import type { InvoicePayment } from './invoice-payments.types.js'

// Só criação, sempre dentro da transação de invoices.service.payInvoice.
export const invoicePaymentsRepository = {
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
}
