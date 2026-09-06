import { ConflictError, NotFoundError } from '../../errors/AppError.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import { contributionsRepository } from './contributions.repository.js'
import type { CreateContributionInput } from './contributions.schema.js'
import type { GoalContribution } from './contributions.types.js'
import { goalsRepository } from './goals.repository.js'

async function assertAccountBelongsToUserAndActive(
  accountId: string,
  userId: string,
): Promise<void> {
  const account = await accountsRepository.findByIdAndUser(accountId, userId)
  if (!account) {
    throw new NotFoundError('conta não encontrada')
  }
  if (account.status === 'archived') {
    throw new ConflictError('conta arquivada, não é possível lançar')
  }
  const balance = await accountsRepository.getBalance(accountId, userId)
  if ((balance?.balanceCents ?? 0) <= 0) {
    throw new ConflictError(
      'esta conta está com saldo zero ou negativo, não é possível registrar um novo lançamento',
    )
  }
}

export const contributionsService = {
  async create(
    userId: string,
    goalId: string,
    data: CreateContributionInput,
  ): Promise<GoalContribution> {
    const goal = await goalsRepository.findByIdAndUser(goalId, userId)
    if (!goal) {
      throw new NotFoundError('meta não encontrada')
    }
    await assertAccountBelongsToUserAndActive(data.accountId, userId)
    return contributionsRepository.create(goalId, data)
  },

  async delete(userId: string, goalId: string, contributionId: string): Promise<void> {
    const goal = await goalsRepository.findByIdAndUser(goalId, userId)
    if (!goal) {
      throw new NotFoundError('meta não encontrada')
    }
    const contribution = await contributionsRepository.findByIdAndGoal(contributionId, goalId)
    if (!contribution) {
      throw new NotFoundError('aporte não encontrado')
    }
    await contributionsRepository.delete(contributionId)
  },
}
