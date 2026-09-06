import { ConflictError, NotFoundError } from '../../errors/AppError.js'
import { contributionsRepository } from './contributions.repository.js'
import type { GoalContribution } from './contributions.types.js'
import { goalsRepository } from './goals.repository.js'
import type { CreateGoalInput, UpdateGoalInput } from './goals.schema.js'
import type { FinancialGoal } from './goals.types.js'

export interface GoalWithProgress extends FinancialGoal {
  currentAmountCents: number
}

export interface GoalDetail extends GoalWithProgress {
  contributions: GoalContribution[]
}

export const goalsService = {
  async create(userId: string, data: CreateGoalInput): Promise<FinancialGoal> {
    return goalsRepository.create(userId, data)
  },

  async listByUser(userId: string): Promise<GoalWithProgress[]> {
    const goals = await goalsRepository.findAllByUser(userId)
    return Promise.all(
      goals.map(async (goal) => {
        const contributions = await contributionsRepository.findAllByGoal(goal.id)
        const currentAmountCents = contributions.reduce((sum, c) => sum + c.amount_cents, 0)
        return { ...goal, currentAmountCents }
      }),
    )
  },

  async getDetail(userId: string, goalId: string): Promise<GoalDetail> {
    const goal = await goalsRepository.findByIdAndUser(goalId, userId)
    if (!goal) {
      throw new NotFoundError('meta não encontrada')
    }
    const contributions = await contributionsRepository.findAllByGoal(goalId)
    const currentAmountCents = contributions.reduce((sum, c) => sum + c.amount_cents, 0)
    return { ...goal, currentAmountCents, contributions }
  },

  async update(id: string, userId: string, data: UpdateGoalInput): Promise<FinancialGoal> {
    const updated = await goalsRepository.update(id, userId, data)
    if (!updated) {
      throw new NotFoundError('meta não encontrada')
    }
    return updated
  },

  async delete(id: string, userId: string): Promise<void> {
    const goal = await goalsRepository.findByIdAndUser(id, userId)
    if (!goal) {
      throw new NotFoundError('meta não encontrada')
    }
    const hasContributions = await contributionsRepository.existsForGoal(id)
    if (hasContributions) {
      throw new ConflictError('meta com aportes não pode ser excluída')
    }
    await goalsRepository.delete(id, userId)
  },
}
