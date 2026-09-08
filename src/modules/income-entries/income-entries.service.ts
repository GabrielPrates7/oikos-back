import { accountsRepository } from '../accounts/accounts.repository.js'
import { categoriesRepository } from '../categories/categories.repository.js'
import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import type { PaginatedResult, PaginationParams } from '../../utils/pagination.js'
import { incomeEntriesRepository } from './income-entries.repository.js'
import type { IncomeEntryFilters } from './income-entries.repository.js'
import type { CreateIncomeEntryInput, UpdateIncomeEntryInput } from './income-entries.schema.js'
import type { IncomeEntry } from './income-entries.types.js'

async function assertAccountBelongsToUser(accountId: string, userId: string): Promise<void> {
  const account = await accountsRepository.findByIdAndUser(accountId, userId)
  if (!account) {
    throw new NotFoundError('conta não encontrada')
  }
  if (account.status === 'archived') {
    throw new ConflictError('conta arquivada, não é possível lançar')
  }
}

async function assertCategoryIsIncomeAndVisible(categoryId: string, userId: string): Promise<void> {
  const category = await categoriesRepository.findByIdVisibleToUser(categoryId, userId)
  if (!category) {
    throw new NotFoundError('categoria não encontrada')
  }
  if (category.type !== 'income') {
    throw new AppError(400, 'categoria inválida: precisa ser do tipo income')
  }
}

export const incomeEntriesService = {
  async create(userId: string, data: CreateIncomeEntryInput): Promise<IncomeEntry> {
    await assertAccountBelongsToUser(data.account_id, userId)
    await assertCategoryIsIncomeAndVisible(data.category_id, userId)
    return incomeEntriesRepository.create(userId, data)
  },

  async listByUser(
    userId: string,
    filters: IncomeEntryFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<IncomeEntry>> {
    const [items, { total, sumCents }] = await Promise.all([
      incomeEntriesRepository.findAllByUser(userId, filters, pagination),
      incomeEntriesRepository.getFilteredSum(userId, filters),
    ])
    return { items, total, sumCents, page: pagination.page, pageSize: pagination.pageSize }
  },

  async getById(id: string, userId: string): Promise<IncomeEntry> {
    const entry = await incomeEntriesRepository.findByIdAndUser(id, userId)
    if (!entry) {
      throw new NotFoundError('entrada não encontrada')
    }
    return entry
  },

  async update(id: string, userId: string, data: UpdateIncomeEntryInput): Promise<IncomeEntry> {
    if (data.account_id !== undefined) {
      await assertAccountBelongsToUser(data.account_id, userId)
    }
    if (data.category_id !== undefined) {
      await assertCategoryIsIncomeAndVisible(data.category_id, userId)
    }

    const updated = await incomeEntriesRepository.update(id, userId, data)
    if (!updated) {
      throw new NotFoundError('entrada não encontrada')
    }
    return updated
  },

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await incomeEntriesRepository.delete(id, userId)
    if (!deleted) {
      throw new NotFoundError('entrada não encontrada')
    }
  },
}
