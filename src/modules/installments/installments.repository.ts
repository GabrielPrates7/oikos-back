import type { PoolClient } from 'pg'
import type { Installment } from './installments.types.js'

// Fase 11: só criação, sempre dentro da transação de purchases.service. Leitura/listagem
// (ex: detalhe de fatura mostrando as parcelas) é Fase 12.
export const installmentsRepository = {
  async create(
    client: PoolClient,
    data: { purchaseId: string; invoiceId: string; installmentNumber: number; amountCents: number },
  ): Promise<Installment> {
    const result = await client.query<Installment>(
      `INSERT INTO installments (purchase_id, invoice_id, installment_number, amount_cents)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.purchaseId, data.invoiceId, data.installmentNumber, data.amountCents],
    )
    return result.rows[0]
  },

  // Edição estrutural (purchases.service) apaga tudo e gera de novo do zero — sempre
  // dentro da mesma transação, e sempre depois de confirmar via hasAnyPaidInstallment que
  // nenhuma dessas parcelas está numa fatura paga.
  async deleteByPurchaseId(client: PoolClient, purchaseId: string): Promise<void> {
    await client.query('DELETE FROM installments WHERE purchase_id = $1', [purchaseId])
  },
}
