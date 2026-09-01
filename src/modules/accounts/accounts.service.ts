import { NotFoundError } from '../../errors/AppError.js'
import { accountsRepository } from './accounts.repository.js'
import type { CreateAccountInput, UpdateAccountInput } from './accounts.schema.js'
import type { Account, AccountStatus } from './accounts.types.js'

export type AccountWithBalance = Account & { balanceCents: number }

export const accountsService = {
  async create(userId: string, data: CreateAccountInput): Promise<Account> {
    return accountsRepository.create(userId, data)
  },

  async listByUser(userId: string, status?: AccountStatus | 'all'): Promise<AccountWithBalance[]> {
    const accounts = await accountsRepository.findAllByUser(userId, status)
    // Nesta fase o saldo é sempre igual a initial_balance_cents (ver accounts.repository.getBalance).
    // Evitamos N+1 aqui porque o valor já está na própria linha; isso muda nas Fases 7-9.
    return accounts.map((account) => ({ ...account, balanceCents: account.initial_balance_cents }))
  },

  async getById(id: string, userId: string): Promise<Account> {
    const account = await accountsRepository.findByIdAndUser(id, userId)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }
    return account
  },

  async update(id: string, userId: string, data: UpdateAccountInput): Promise<Account> {
    const account = await accountsRepository.update(id, userId, data)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }
    return account
  },

  async archive(id: string, userId: string): Promise<void> {
    const account = await accountsRepository.archive(id, userId)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }
  },

  async getBalance(
    id: string,
    userId: string,
  ): Promise<{ accountId: string; balanceCents: number }> {
    const balance = await accountsRepository.getBalance(id, userId)
    if (!balance) {
      throw new NotFoundError('conta não encontrada')
    }
    return { accountId: id, balanceCents: balance.balanceCents }
  },
}
