import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import { categoriesRepository } from '../categories/categories.repository.js'
import { creditCardsRepository } from '../credit-cards/credit-cards.repository.js'
import { installmentsRepository } from '../installments/installments.repository.js'
import type { Installment } from '../installments/installments.types.js'
import { invoicesRepository } from '../invoices/invoices.repository.js'
import {
  addMonthsToReferenceMonth,
  computeInvoiceDates,
  resolveInitialReferenceMonth,
  splitInstallmentAmounts,
} from './invoice-assignment.util.js'
import { purchasesRepository } from './purchases.repository.js'
import type { CreatePurchaseInput } from './purchases.schema.js'
import type { Purchase, PurchaseWithCategory } from './purchases.types.js'

export interface CreatePurchaseResult {
  purchase: Purchase
  installments: Installment[]
}

export const purchasesService = {
  async createPurchase(userId: string, data: CreatePurchaseInput): Promise<CreatePurchaseResult> {
    // Validações de posse/estado são leituras simples contra o pool compartilhado, antes
    // de abrir a transação — a transação abaixo garante atomicidade das ESCRITAS
    // (purchase + faturas + parcelas), que é o requisito de "nenhuma linha órfã".
    const creditCard = await creditCardsRepository.findByIdAndUser(data.credit_card_id, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
    if (creditCard.status === 'archived') {
      throw new ConflictError('cartão arquivado')
    }

    const category = await categoriesRepository.findByIdVisibleToUser(data.category_id, userId)
    if (!category) {
      throw new NotFoundError('categoria não encontrada')
    }
    if (category.type !== 'expense') {
      throw new AppError(400, 'categoria inválida: precisa ser do tipo expense')
    }

    const installmentAmounts = splitInstallmentAmounts(
      data.total_amount_cents,
      data.installments_count,
    )
    const initialReferenceMonth = resolveInitialReferenceMonth(
      data.purchase_date,
      creditCard.closing_day,
    )

    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')

      const purchase = await purchasesRepository.create(client, userId, data)

      const installments: Installment[] = []
      for (let index = 0; index < data.installments_count; index++) {
        const installmentNumber = index + 1
        const referenceMonth =
          index === 0
            ? initialReferenceMonth
            : addMonthsToReferenceMonth(initialReferenceMonth, index)

        let invoice = await invoicesRepository.findByCardAndReferenceMonth(
          client,
          creditCard.id,
          referenceMonth,
        )
        if (!invoice) {
          const { closingDate, dueDate } = computeInvoiceDates(
            referenceMonth,
            creditCard.closing_day,
            creditCard.due_day,
          )
          invoice = await invoicesRepository.create(client, {
            creditCardId: creditCard.id,
            referenceMonth,
            closingDate,
            dueDate,
          })
        }

        const installment = await installmentsRepository.create(client, {
          purchaseId: purchase.id,
          invoiceId: invoice.id,
          installmentNumber,
          amountCents: installmentAmounts[index],
        })
        installments.push(installment)
      }

      await client.query('COMMIT')
      return { purchase, installments }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  },

  async listForCard(userId: string, creditCardId: string): Promise<PurchaseWithCategory[]> {
    const creditCard = await creditCardsRepository.findByIdAndUser(creditCardId, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
    return purchasesRepository.findAllByCard(creditCardId)
  },
}
