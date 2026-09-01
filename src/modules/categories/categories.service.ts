import { NotFoundError } from '../../errors/AppError.js'
import { categoriesRepository } from './categories.repository.js'
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema.js'
import type { Category, CategoryType } from './categories.types.js'

export const categoriesService = {
  async create(userId: string, data: CreateCategoryInput): Promise<Category> {
    return categoriesRepository.create(userId, data)
  },

  async listVisibleToUser(userId: string, type?: CategoryType): Promise<Category[]> {
    return categoriesRepository.findAllVisibleToUser(userId, type)
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
    const deleted = await categoriesRepository.delete(id, userId)
    if (!deleted) {
      throw new NotFoundError('categoria não encontrada')
    }
  },
}
