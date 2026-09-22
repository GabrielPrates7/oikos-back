import { pool } from '../../config/database.js'
import type { PaginationParams } from '../../utils/pagination.js'
import { DEFAULT_CATEGORIES } from './defaultCategories.js'
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

  // Seed do cadastro (auth.service.ts:register): toda categoria tem dono agora (migration
  // 1790097890432), não existe mais linha compartilhada (user_id NULL) pra herdar por
  // "OR user_id IS NULL" — o usuário novo precisa da sua própria cópia das 17 padrão.
  async seedDefaultsForUser(userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO categories (user_id, name, type, icon)
       SELECT $1, name, type, icon
       FROM unnest($2::text[], $3::text[], $4::text[]) AS d(name, type, icon)`,
      [
        userId,
        DEFAULT_CATEGORIES.map((c) => c.name),
        DEFAULT_CATEGORIES.map((c) => c.type),
        DEFAULT_CATEGORIES.map((c) => c.icon),
      ],
    )
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

    // Toda categoria tem dono desde a migration 1790097890432 — não existe mais linha
    // compartilhada (user_id NULL) pra incluir aqui. "Visível" e "própria" convergiram: esta
    // função e findByIdOwnedByUser fazem a mesma checagem agora (mantidas separadas porque o
    // nome de cada uma ainda documenta a intenção de quem chama — visualização vs. posse).
    const result = await pool.query<Category>(
      `SELECT * FROM categories WHERE user_id = $1${typeClause} ORDER BY name${limitClause}`,
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
      `SELECT COUNT(*)::int AS total FROM categories WHERE user_id = $1${typeClause}`,
      values,
    )
    return result.rows[0].total
  },

  async findByIdVisibleToUser(id: string, userId: string): Promise<Category | null> {
    const result = await pool.query<Category>(
      `SELECT * FROM categories WHERE id = $1 AND user_id = $2`,
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

  // Escopado por usuário: o que interessa aqui é "quantas vezes ESSE usuário usou essa
  // categoria", não o total global entre todos os usuários (que vazaria atividade de
  // terceiros e não diz nada útil pra quem está olhando a própria lista de Categorias).
  // NOTA (fora do escopo desta migração): soma só income_entries/expenses/purchases — não
  // conta budgets nem plan_items, então uma categoria pode aparecer com "0 movimentações"
  // aqui e mesmo assim estar em uso (exclusão falharia com 409 mesmo sem uso aparente).
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
