import type { PoolClient } from 'pg'
import type { Invoice } from './invoices.types.js'

// Fase 11: só o necessário pra criação de compra (busca fatura existente / cria se não
// existir), sempre dentro da transação de purchases.service. CRUD completo (fechamento,
// pagamento, listagem) e as rotas /api/invoices são Fase 12.
export const invoicesRepository = {
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
}
