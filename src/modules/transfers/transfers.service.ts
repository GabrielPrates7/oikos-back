import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import type { PaginatedResult, PaginationParams } from '../../utils/pagination.js'
import { transfersRepository } from './transfers.repository.js'
import type { TransferFilters } from './transfers.repository.js'
import type { CreateTransferInput } from './transfers.schema.js'
import type { Transfer } from './transfers.types.js'

async function assertAccountBelongsToUser(
  accountId: string,
  userId: string,
  checkBalance: boolean,
): Promise<void> {
  const account = await accountsRepository.findByIdAndUser(accountId, userId)
  if (!account) {
    throw new NotFoundError('conta não encontrada')
  }
  if (account.status === 'archived') {
    throw new ConflictError('conta arquivada, não é possível lançar')
  }
  // Só a conta de ORIGEM é checada — saldo zerado/negativo bloqueia sair dinheiro dela,
  // mas nunca impede que uma conta RECEBA uma transferência.
  if (checkBalance) {
    const balance = await accountsRepository.getBalance(accountId, userId)
    if ((balance?.balanceCents ?? 0) <= 0) {
      throw new ConflictError(
        'esta conta está com saldo zero ou negativo, não é possível registrar um novo lançamento',
      )
    }
  }
}

export const transfersService = {
  async create(userId: string, data: CreateTransferInput): Promise<Transfer> {
    if (data.from_account_id === data.to_account_id) {
      throw new AppError(400, 'conta de origem e destino não podem ser a mesma')
    }

    await assertAccountBelongsToUser(data.from_account_id, userId, true)
    await assertAccountBelongsToUser(data.to_account_id, userId, false)

    return transfersRepository.create(userId, data)
  },

  async listByUser(
    userId: string,
    filters: TransferFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transfer>> {
    const [items, { total, sumCents }] = await Promise.all([
      transfersRepository.findAllByUser(userId, filters, pagination),
      transfersRepository.getFilteredSum(userId, filters),
    ])
    return { items, total, sumCents, page: pagination.page, pageSize: pagination.pageSize }
  },

  async getById(id: string, userId: string): Promise<Transfer> {
    const transfer = await transfersRepository.findByIdAndUser(id, userId)
    if (!transfer) {
      throw new NotFoundError('transferência não encontrada')
    }
    return transfer
  },

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await transfersRepository.delete(id, userId)
    if (!deleted) {
      throw new NotFoundError('transferência não encontrada')
    }
  },
}
