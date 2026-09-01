import { pool } from '../../config/database.js'
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

  async findAllVisibleToUser(userId: string, type?: CategoryType): Promise<Category[]> {
    if (type) {
      const result = await pool.query<Category>(
        `SELECT * FROM categories WHERE (user_id = $1 OR user_id IS NULL) AND type = $2 ORDER BY name`,
        [userId, type],
      )
      return result.rows
    }

    const result = await pool.query<Category>(
      `SELECT * FROM categories WHERE user_id = $1 OR user_id IS NULL ORDER BY name`,
      [userId],
    )
    return result.rows
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

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ])
    return (result.rowCount ?? 0) > 0
  },
}
