import { ConflictError, NotFoundError } from '../../errors/AppError.js'
import { isForeignKeyViolation } from '../../utils/postgres.js'
import { categoriesRepository } from './categories.repository.js'
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema.js'
import type { Category, CategoryType } from './categories.types.js'

export type CategoryWithUsage = Category & { usageCount: number }

export const categoriesService = {
  async create(userId: string, data: CreateCategoryInput): Promise<Category> {
    return categoriesRepository.create(userId, data)
  },

  async listVisibleToUser(userId: string, type?: CategoryType): Promise<CategoryWithUsage[]> {
    const categories = await categoriesRepository.findAllVisibleToUser(userId, type)
    // N+1 aceitável aqui — mesma lógica de accounts.service.listByUser: é a lista de
    // categorias visíveis a um único usuário (tipicamente poucas dezenas de linhas).
    return Promise.all(
      categories.map(async (category) => {
        const usageCount = await categoriesRepository.countUsage(category.id, userId)
        return { ...category, usageCount }
      }),
    )
  },

  async getVisibleById(id: string, userId: string): Promise<Category> {
    const category = await categoriesRepository.findByIdVisibleToUser(id, userId)
    if (!category) {
      throw new NotFoundError('categoria não encontrada')
    }
    return category
  },

  async update(id: string, userId: string, data: UpdateCategoryInput): Promise<Category> {
    const owned = await categoriesRepository.findByIdOwnedByUser(id, userId)
    if (!owned) {
      throw new NotFoundError('categoria não encontrada')
    }
    const updated = await categoriesRepository.update(id, userId, data)
    if (!updated) {
      throw new NotFoundError('categoria não encontrada')
    }
    return updated
  },

  async delete(id: string, userId: string): Promise<void> {
    const owned = await categoriesRepository.findByIdOwnedByUser(id, userId)
    if (!owned) {
      throw new NotFoundError('categoria não encontrada')
    }

    let deleted: boolean
    try {
      deleted = await categoriesRepository.delete(id, userId)
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictError('categoria em uso, não pode ser removida')
      }
      throw error
    }

    if (!deleted) {
      throw new NotFoundError('categoria não encontrada')
    }
  },
}
