import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import { categoriesRepository } from '../categories/categories.repository.js'
import type { PaginatedResult, PaginationParams } from '../../utils/pagination.js'
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
  // Saldo ATUAL da conta, antes deste lançamento — não é "isso deixaria negativa", é "já
  // está zerada ou negativa agora". Uma conta positiva aceita um lançamento maior que o
  // saldo normalmente (fica negativa depois, permitido); só bloqueia quem já está em 0/negativo.
  const balance = await accountsRepository.getBalance(accountId, userId)
  if ((balance?.balanceCents ?? 0) <= 0) {
    throw new ConflictError(
      'esta conta está com saldo zero ou negativo, não é possível registrar um novo lançamento',
    )
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

  async listByUser(
    userId: string,
    filters: ExpenseFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Expense>> {
    const [items, { total, sumCents }] = await Promise.all([
      expensesRepository.findAllByUser(userId, filters, pagination),
      expensesRepository.getFilteredSum(userId, filters),
    ])
    return { items, total, sumCents, page: pagination.page, pageSize: pagination.pageSize }
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
