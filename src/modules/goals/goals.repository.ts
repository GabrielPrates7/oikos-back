import { pool } from '../../config/database.js'
import type { CreateGoalInput, UpdateGoalInput } from './goals.schema.js'
import type { FinancialGoal } from './goals.types.js'

export const goalsRepository = {
  async create(userId: string, data: CreateGoalInput): Promise<FinancialGoal> {
    const result = await pool.query<FinancialGoal>(
      `INSERT INTO financial_goals (user_id, name, target_amount_cents, target_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, data.name, data.targetAmountCents, data.targetDate],
    )
    return result.rows[0]
  },

  async findAllByUser(userId: string): Promise<FinancialGoal[]> {
    const result = await pool.query<FinancialGoal>(
      'SELECT * FROM financial_goals WHERE user_id = $1 ORDER BY created_at',
      [userId],
    )
    return result.rows
  },

  async findByIdAndUser(id: string, userId: string): Promise<FinancialGoal | null> {
    const result = await pool.query<FinancialGoal>(
      'SELECT * FROM financial_goals WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return result.rows[0] ?? null
  },

  async update(id: string, userId: string, data: UpdateGoalInput): Promise<FinancialGoal | null> {
    const fields: string[] = []
    const values: unknown[] = []
    let index = 1

    if (data.name !== undefined) {
      fields.push(`name = $${index++}`)
      values.push(data.name)
    }
    if (data.targetAmountCents !== undefined) {
      fields.push(`target_amount_cents = $${index++}`)
      values.push(data.targetAmountCents)
    }
    if (data.targetDate !== undefined) {
      fields.push(`target_date = $${index++}`)
      values.push(data.targetDate)
    }

    if (fields.length === 0) {
      return goalsRepository.findByIdAndUser(id, userId)
    }

    values.push(id, userId)
    const result = await pool.query<FinancialGoal>(
      `UPDATE financial_goals SET ${fields.join(', ')} WHERE id = $${index++} AND user_id = $${index} RETURNING *`,
      values,
    )
    return result.rows[0] ?? null
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM financial_goals WHERE id = $1 AND user_id = $2',
      [id, userId],
    )
    return (result.rowCount ?? 0) > 0
  },
}
