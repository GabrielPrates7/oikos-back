import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema.js'
import type { Category, CategoryType } from './categories.types.js'

export const categoriesRepository = {
  async create(userId: string, data: CreateCategoryInput): Promise<Category> {
    const result = await pool.query<Category>(
      `INSERT INTO categories (user_id, name, type, icon)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, data.name, data.type, data.icon ?? null],
    )
    return result.rows[0]
  },

  // pagination é opcional de propósito, mesmo padrão dos outros módulos paginados — hoje
  // nada mais no backend chama findAllVisibleToUser sem paginar (nenhuma validação interna
  // usa isso, elas checam uma categoria por vez via findByIdVisibleToUser), mas mantém a
  // mesma garantia caso apareça um consumidor futuro que precise do conjunto inteiro.
  async findAllVisibleToUser(
    userId: string,
    type?: CategoryType,
    pagination?: PaginationParams,
  ): Promise<Category[]> {
    const values: unknown[] = [userId]
    let typeClause = ''
    if (type) {
      values.push(type)
      typeClause = ` AND type = $${values.length}`
    }
    let limitClause = ''
    if (pagination) {
      const limitIndex = values.push(pagination.pageSize)
      const offsetIndex = values.push((pagination.page - 1) * pagination.pageSize)
      limitClause = ` LIMIT $${limitIndex} OFFSET $${offsetIndex}`
    }

    const result = await pool.query<Category>(
      `SELECT * FROM categories WHERE (user_id = $1 OR user_id IS NULL)${typeClause} ORDER BY name${limitClause}`,
      values,
    )
    return result.rows
  },

  // Mesmo filtro de findAllVisibleToUser, sem LIMIT/OFFSET — só contagem, categorias não
  // têm "total exibido".
  async countVisibleToUser(userId: string, type?: CategoryType): Promise<number> {
    const values: unknown[] = [userId]
    let typeClause = ''
    if (type) {
      values.push(type)
      typeClause = ` AND type = $${values.length}`
    }
    const result = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM categories WHERE (user_id = $1 OR user_id IS NULL)${typeClause}`,
      values,
    )
    return result.rows[0].total
  },

  async findByIdVisibleToUser(id: string, userId: string): Promise<Category | null> {
    const result = await pool.query<Category>(
      `SELECT * FROM categories WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async findByIdOwnedByUser(id: string, userId: string): Promise<Category | null> {
    const result = await pool.query<Category>(
      `SELECT * FROM categories WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdateCategoryInput): Promise<Category | null> {
    const fields: string[] = []
    const values: unknown[] = []
    let index = 1

    if (data.name !== undefined) {
      fields.push(`name = $${index++}`)
      values.push(data.name)
    }
    if (data.icon !== undefined) {
      fields.push(`icon = $${index++}`)
      values.push(data.icon)
    }

    if (fields.length === 0) {
      return categoriesRepository.findByIdOwnedByUser(id, userId)
    }

    values.push(id, userId)
    const result = await pool.query<Category>(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = $${index++} AND user_id = $${index} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  // Escopado por usuário mesmo pra categoria padrão (user_id IS NULL, compartilhada) — o
  // que interessa aqui é "quantas vezes ESSE usuário usou essa categoria", não o total
  // global entre todos os usuários (que vazaria atividade de terceiros e não diz nada útil
  // pra quem está olhando a própria lista de Categorias).
  async countUsage(categoryId: string, userId: string): Promise<number> {
    const result = await pool.query<{ count: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM income_entries WHERE category_id = $1 AND user_id = $2)
         + (SELECT COUNT(*) FROM expenses WHERE category_id = $1 AND user_id = $2)
         + (SELECT COUNT(*) FROM purchases WHERE category_id = $1 AND user_id = $2)
       )::int AS count`,
      [categoryId, userId],
    )
    return result.rows[0].count
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },
}
