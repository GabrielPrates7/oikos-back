import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import { categoriesRepository } from '../categories/categories.repository.js'
import { expensesRepository } from './expenses.repository.js'
import type { ExpenseFilters } from './expenses.repository.js'
import type { CreateExpenseInput, UpdateExpenseInput } from './expenses.schema.js'
import type { Expense } from './expenses.types.js'

async function assertAccountBelongsToUser(accountId: string, userId: string): Promise<void> {
  const account = await accountsRepository.findByIdAndUser(accountId, userId)
  if (!account) {
    throw new NotFoundError('conta não encontrada')
  }
  if (account.status === 'archived') {
    throw new ConflictError('conta arquivada, não é possível lançar')
  }
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

export const expensesService = {
  async create(userId: string, data: CreateExpenseInput): Promise<Expense> {
    await assertAccountBelongsToUser(data.account_id, userId)
    await assertCategoryIsExpenseAndVisible(data.category_id, userId)
    return expensesRepository.create(userId, data)
  },

  async listByUser(userId: string, filters: ExpenseFilters): Promise<Expense[]> {
    return expensesRepository.findAllByUser(userId, filters)
  },

  async getById(id: string, userId: string): Promise<Expense> {
    const expense = await expensesRepository.findByIdAndUser(id, userId)
    if (!expense) {
      throw new NotFoundError('despesa não encontrada')
    }
    return expense
  },

  async update(id: string, userId: string, data: UpdateExpenseInput): Promise<Expense> {
    if (data.account_id !== undefined) {
      await assertAccountBelongsToUser(data.account_id, userId)
    }
    if (data.category_id !== undefined) {
      await assertCategoryIsExpenseAndVisible(data.category_id, userId)
    }

    const updated = await expensesRepository.update(id, userId, data)
    if (!updated) {
      throw new NotFoundError('despesa não encontrada')
    }
    return updated
  },

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await expensesRepository.delete(id, userId)
    if (!deleted) {
      throw new NotFoundError('despesa não encontrada')
    }
  },
}
