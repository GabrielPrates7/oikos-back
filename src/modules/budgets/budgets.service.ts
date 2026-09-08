import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import type { PaginatedList, PaginationParams } from '../../utils/pagination.js'
import { isUniqueViolation } from '../../utils/postgres.js'
import { categoriesRepository } from '../categories/categories.repository.js'
import { budgetsRepository } from './budgets.repository.js'
import type { CreateBudgetInput, UpdateBudgetInput } from './budgets.schema.js'
import type { Budget } from './budgets.types.js'

export interface BudgetWithSpent extends Budget {
  spentCents: number
  percentageUsed: number
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

function withSpent(budget: Budget, spentCents: number): BudgetWithSpent {
  const percentageUsed =
    budget.limit_amount_cents > 0 ? Math.round((spentCents / budget.limit_amount_cents) * 100) : 0
  return { ...budget, spentCents, percentageUsed }
}

export const budgetsService = {
  async create(userId: string, data: CreateBudgetInput): Promise<Budget> {
    await assertCategoryIsExpenseAndVisible(data.categoryId, userId)
    try {
      return await budgetsRepository.create(userId, data)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('já existe orçamento para essa categoria neste mês')
      }
      throw error
    }
  },

  async listByUserAndMonth(
    userId: string,
    referenceMonth: string,
    pagination: PaginationParams,
  ): Promise<PaginatedList<BudgetWithSpent>> {
    const [budgets, total] = await Promise.all([
      budgetsRepository.findAllByUserAndMonth(userId, referenceMonth, pagination),
      budgetsRepository.countByUserAndMonth(userId, referenceMonth),
    ])
    const items = await Promise.all(
      budgets.map(async (budget) => {
        const spentCents = await budgetsRepository.getSpentAmount(
          userId,
          budget.category_id,
          referenceMonth,
        )
        return withSpent(budget, spentCents)
      }),
    )
    return { items, total, page: pagination.page, pageSize: pagination.pageSize }
  },

  async update(id: string, userId: string, data: UpdateBudgetInput): Promise<Budget> {
    if (data.categoryId !== undefined) {
      await assertCategoryIsExpenseAndVisible(data.categoryId, userId)
    }
    try {
      const updated = await budgetsRepository.update(id, userId, data)
      if (!updated) {
        throw new NotFoundError('orçamento não encontrado')
      }
      return updated
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('já existe orçamento para essa categoria neste mês')
      }
      throw error
    }
  },

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await budgetsRepository.delete(id, userId)
    if (!deleted) {
      throw new NotFoundError('orçamento não encontrado')
    }
  },
}
