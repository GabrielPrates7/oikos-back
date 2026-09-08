import { ConflictError, NotFoundError } from '../../errors/AppError.js'
import type { PaginationParams } from '../../utils/pagination.js'
import { creditCardsRepository } from './credit-cards.repository.js'
import type { CreateCreditCardInput, UpdateCreditCardInput } from './credit-cards.schema.js'
import type { CreditCard, CreditCardStatus } from './credit-cards.types.js'

export interface PaginatedCreditCards {
  items: CreditCard[]
  total: number
  sumCreditLimitCents: number
  sumAvailableLimitCents: number
  page: number
  pageSize: number
}

export const creditCardsService = {
  async create(userId: string, data: CreateCreditCardInput): Promise<CreditCard> {
    return creditCardsRepository.create(userId, data)
  },

  async listByUser(
    userId: string,
    status: CreditCardStatus | 'all' | undefined,
    pagination: PaginationParams,
  ): Promise<PaginatedCreditCards> {
    const [items, { total, sumCreditLimitCents, sumAvailableLimitCents }] = await Promise.all([
      creditCardsRepository.findAllByUser(userId, status, pagination),
      creditCardsRepository.getFilteredSum(userId, status),
    ])
    return {
      items,
      total,
      sumCreditLimitCents,
      sumAvailableLimitCents,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  },

  async getById(id: string, userId: string): Promise<CreditCard> {
    const creditCard = await creditCardsRepository.findByIdAndUser(id, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
    return creditCard
  },

  async update(id: string, userId: string, data: UpdateCreditCardInput): Promise<CreditCard> {
    const creditCard = await creditCardsRepository.update(id, userId, data)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
    return creditCard
  },

  async archive(id: string, userId: string): Promise<void> {
    const creditCard = await creditCardsRepository.archive(id, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
  },

  async activate(id: string, userId: string): Promise<void> {
    const creditCard = await creditCardsRepository.activate(id, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
  },

  // Diferente de archive (soft delete, sempre permitido): aqui a linha some de verdade do
  // banco, então só é permitido quando não há nenhuma compra vinculada.
  async deletePermanently(id: string, userId: string): Promise<void> {
    const creditCard = await creditCardsRepository.findByIdAndUser(id, userId)
    if (!creditCard) {
      throw new NotFoundError('cartão não encontrado')
    }
    const hasMovement = await creditCardsRepository.hasAnyMovement(id)
    if (hasMovement) {
      throw new ConflictError(
        'este cartão tem compras vinculadas e não pode ser excluído — arquive em vez disso',
      )
    }
    await creditCardsRepository.deletePermanently(id, userId)
  },

  async getAvailableLimit(
    id: string,
    userId: string,
  ): Promise<{ creditCardId: string; availableLimitCents: number }> {
    const limit = await creditCardsRepository.getAvailableLimit(id, userId)
    if (!limit) {
      throw new NotFoundError('cartão não encontrado')
    }
    return { creditCardId: id, availableLimitCents: limit.availableLimitCents }
  },
}
