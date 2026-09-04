import { NotFoundError } from '../../errors/AppError.js'
import { creditCardsRepository } from './credit-cards.repository.js'
import type { CreateCreditCardInput, UpdateCreditCardInput } from './credit-cards.schema.js'
import type { CreditCard, CreditCardStatus } from './credit-cards.types.js'

export const creditCardsService = {
  async create(userId: string, data: CreateCreditCardInput): Promise<CreditCard> {
    return creditCardsRepository.create(userId, data)
  },

  async listByUser(userId: string, status?: CreditCardStatus | 'all'): Promise<CreditCard[]> {
    return creditCardsRepository.findAllByUser(userId, status)
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
