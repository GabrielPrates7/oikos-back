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
import type { CreatePurchaseInput, UpdatePurchaseInput } from './purchases.schema.js'
import type { Purchase, PurchaseWithCategory } from './purchases.types.js'

export interface CreatePurchaseResult {
  purchase: Purchase
  installments: Installment[]
}

async function assertCategoryIsExpenseAndVisible(
  categoryId: string,
  userId: string,
): Promise<void> {
  const category = await categoriesRepository.findByIdVisibleToUser(categoryId, userId)
  if (!category) {
    throw new NotFoundError('categoria não encontrada')
  }
  if (category.type !== 'expense') {
    throw new AppError(400, 'categoria inválida: precisa ser do tipo expense')
  }
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

    await assertCategoryIsExpenseAndVisible(data.category_id, userId)

    // Bug real desde a Fase 11: nunca existiu checagem de limite na criação de compra —
    // o limite disponível só era exibido, nunca aplicado como regra.
    const limit = await creditCardsRepository.getAvailableLimit(data.credit_card_id, userId)
    if (limit && data.total_amount_cents > limit.availableLimitCents) {
      throw new ConflictError('esta compra ultrapassa o limite disponível do cartão')
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

  async update(id: string, userId: string, data: UpdatePurchaseInput): Promise<Purchase> {
    const existing = await purchasesRepository.findByIdAndUser(id, userId)
    if (!existing) {
      throw new NotFoundError('compra não encontrada')
    }

    const isStructuralChange =
      data.credit_card_id !== undefined ||
      data.total_amount_cents !== undefined ||
      data.installments_count !== undefined ||
      data.purchase_date !== undefined

    if (data.category_id !== undefined) {
      await assertCategoryIsExpenseAndVisible(data.category_id, userId)
    }

    if (!isStructuralChange) {
      const updated = await purchasesRepository.update(id, userId, data)
      if (!updated) {
        throw new NotFoundError('compra não encontrada')
      }
      return updated
    }

    // Mudar valor/parcelamento/data/cartão exige apagar as parcelas antigas e gerar novas
    // do zero — mesmo bloqueio da exclusão, e pelo mesmo motivo: uma parcela já paga é um
    // registro financeiro que já aconteceu de verdade, não pode ser desfeito por edição.
    const hasPaid = await purchasesRepository.hasAnyPaidInstallment(id)
    if (hasPaid) {
      throw new ConflictError('esta compra tem parcela já paga e não pode ser alterada')
    }

    const creditCardId = data.credit_card_id ?? existing.credit_card_id
    const creditCard = await creditCardsRepository.findByIdAndUser(creditCardId, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
    if (creditCard.status === 'archived') {
      throw new ConflictError('cartão arquivado')
    }

    const totalAmountCents = data.total_amount_cents ?? existing.total_amount_cents
    const installmentsCount = data.installments_count ?? existing.installments_count
    const purchaseDate = data.purchase_date ?? existing.purchase_date

    const installmentAmounts = splitInstallmentAmounts(totalAmountCents, installmentsCount)
    const initialReferenceMonth = resolveInitialReferenceMonth(purchaseDate, creditCard.closing_day)

    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')

      await installmentsRepository.deleteByPurchaseId(client, id)

      for (let index = 0; index < installmentsCount; index++) {
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

        await installmentsRepository.create(client, {
          purchaseId: id,
          invoiceId: invoice.id,
          installmentNumber,
          amountCents: installmentAmounts[index],
        })
      }

      const updated = await purchasesRepository.update(
        id,
        userId,
        {
          description: data.description,
          category_id: data.category_id,
          is_essential: data.is_essential,
          is_fixed: data.is_fixed,
          credit_card_id: creditCardId,
          total_amount_cents: totalAmountCents,
          installments_count: installmentsCount,
          purchase_date: purchaseDate,
          notes: data.notes,
        },
        client,
      )
      if (!updated) {
        throw new NotFoundError('compra não encontrada')
      }

      await client.query('COMMIT')
      return updated
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  },

  async deletePurchase(id: string, userId: string): Promise<void> {
    const existing = await purchasesRepository.findByIdAndUser(id, userId)
    if (!existing) {
      throw new NotFoundError('compra não encontrada')
    }

    const hasPaid = await purchasesRepository.hasAnyPaidInstallment(id)
    if (hasPaid) {
      throw new ConflictError('esta compra tem parcela já paga e não pode ser excluída')
    }

    // Cascade (ON DELETE CASCADE em installments.purchase_id) cuida das parcelas.
    await purchasesRepository.delete(id, userId)
  },
}
