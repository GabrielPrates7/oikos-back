import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import { AppError, ConflictError, NotFoundError } from '../../errors/AppError.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import type { PaginatedResult, PaginationParams } from '../../utils/pagination.js'
import { transfersRepository } from './transfers.repository.js'
import type { TransferFilters } from './transfers.repository.js'
import type { CreateTransferInput, UpdateTransferInput } from './transfers.schema.js'
import type { Transfer } from './transfers.types.js'

async function assertAccountBelongsToUser(
  accountId: string,
  userId: string,
  checkBalance: boolean,
  db?: Pick<PoolClient, 'query'>,
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
    const balance = await accountsRepository.getBalance(accountId, userId, db)
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

  // Desfaz a transferência antiga e reaplica com os valores novos numa transação, reusando a
  // MESMA validação de create (contas do usuário, não arquivadas, origem com saldo > 0) — só
  // que o saldo da origem é lido DEPOIS de apagar a antiga, dentro da transação, então
  // "com os novos valores" já considera o dinheiro que a antiga tinha tirado da origem. Se
  // qualquer validação falhar, ROLLBACK e a transferência original fica intacta.
  async update(id: string, userId: string, patch: UpdateTransferInput): Promise<Transfer> {
    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')

      const original = await transfersRepository.findByIdForUpdate(client, id, userId)
      if (!original) {
        throw new NotFoundError('transferência não encontrada')
      }

      const next = {
        from_account_id: patch.from_account_id ?? original.from_account_id,
        to_account_id: patch.to_account_id ?? original.to_account_id,
        amount_cents: patch.amount_cents ?? original.amount_cents,
        transfer_date: patch.transfer_date ?? original.transfer_date,
        description:
          patch.description === undefined ? original.description : patch.description || null,
      }
      if (next.from_account_id === next.to_account_id) {
        throw new AppError(400, 'conta de origem e destino não podem ser a mesma')
      }

      await transfersRepository.deleteWithClient(client, id, userId)
      await assertAccountBelongsToUser(next.from_account_id, userId, true, client)
      await assertAccountBelongsToUser(next.to_account_id, userId, false, client)
      const updated = await transfersRepository.insertWithIdentity(client, original, next)

      await client.query('COMMIT')
      return updated
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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
