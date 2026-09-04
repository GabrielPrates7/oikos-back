import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type { InvoicePayment } from './invoice-payments.types.js'

export const invoicePaymentsRepository = {
  // Leitura fora de transação — usada por invoices.service.getDetail pra mostrar
  // data/conta do pagamento numa fatura já paga (invoice_id é UNIQUE, no máximo um).
  async findByInvoiceId(invoiceId: string): Promise<InvoicePayment | null> {
    const result = await pool.query<InvoicePayment>(
      'SELECT * FROM invoice_payments WHERE invoice_id = $1',
      [invoiceId],
    )
    return result.rows[0] ?? null
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
}
