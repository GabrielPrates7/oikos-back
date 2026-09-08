import { ConflictError, NotFoundError } from '../../errors/AppError.js'
import { contributionsRepository } from '../goals/contributions.repository.js'
import { expensesRepository } from '../expenses/expenses.repository.js'
import { incomeEntriesRepository } from '../income-entries/income-entries.repository.js'
import { invoicePaymentsRepository } from '../invoice-payments/invoice-payments.repository.js'
import { transfersRepository } from '../transfers/transfers.repository.js'
import type { PaginatedResult, PaginationParams } from '../../utils/pagination.js'
import { accountsRepository } from './accounts.repository.js'
import type { CreateAccountInput, UpdateAccountInput } from './accounts.schema.js'
import type { Account, AccountStatus } from './accounts.types.js'

export type AccountWithBalance = Account & { balanceCents: number }

export type StatementEntryType =
  | 'income'
  | 'expense'
  | 'transfer_out'
  | 'transfer_in'
  | 'invoice_payment'
  | 'goal_contribution'

export interface StatementEntry {
  id: string
  type: StatementEntryType
  description: string
  amountCents: number
  date: string
  runningBalanceCents: number
}

export interface AccountStatement {
  openingBalanceCents: number
  closingBalanceCents: number
  entries: StatementEntry[]
}

interface StatementSourceEntry {
  id: string
  type: StatementEntryType
  description: string
  amountCents: number
  date: string
  createdAt: Date
  // false só pra expense pendente (is_paid=false) ou income pendente (is_received=false) —
  // aparecem no extrato como histórico, mas não entram no saldo corrente, pelo mesmo
  // motivo que accounts.repository.getBalance/getBalanceAsOf agora os exclui da soma.
  // Sem isso o saldo de abertura (via getBalanceAsOf, já filtrado) e o saldo de fechamento
  // calculado aqui embaixo divergiriam sempre que houvesse alguma pendência no período.
  affectsBalance: boolean
}

// type -> se reduz (true) ou aumenta (false) o saldo da conta, mesmo sinal usado na
// fórmula de accounts.repository.getBalance.
const REDUCES_BALANCE: Record<StatementEntryType, boolean> = {
  income: false,
  expense: true,
  transfer_out: true,
  transfer_in: false,
  invoice_payment: true,
  goal_contribution: true,
}

export const accountsService = {
  async create(userId: string, data: CreateAccountInput): Promise<Account> {
    return accountsRepository.create(userId, data)
  },

  async listByUser(
    userId: string,
    status: AccountStatus | 'all' | undefined,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<AccountWithBalance>> {
    const [accounts, { total, sumCents }] = await Promise.all([
      accountsRepository.findAllByUser(userId, status, pagination),
      accountsRepository.getFilteredSum(userId, status),
    ])
    // Mesmo padrão de dashboard.service.ts: N+1 aceitável aqui porque é uma página de
    // contas de um único usuário (no máximo pageSize linhas), e correção bate antes de
    // otimização.
    const items = await Promise.all(
      accounts.map(async (account) => {
        const balance = await accountsRepository.getBalance(account.id, userId)
        return { ...account, balanceCents: balance?.balanceCents ?? account.initial_balance_cents }
      }),
    )
    return { items, total, sumCents, page: pagination.page, pageSize: pagination.pageSize }
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

  async activate(id: string, userId: string): Promise<void> {
    const account = await accountsRepository.activate(id, userId)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }
  },

  // Diferente de archive (soft delete, sempre permitido): aqui a linha some de verdade do
  // banco, então só é permitido quando não há nenhum lançamento vinculado — senão viraria
  // FK quebrada ou perda silenciosa de histórico financeiro.
  async deletePermanently(id: string, userId: string): Promise<void> {
    const account = await accountsRepository.findByIdAndUser(id, userId)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }
    const hasMovement = await accountsRepository.hasAnyMovement(id)
    if (hasMovement) {
      throw new ConflictError(
        'esta conta tem lançamentos vinculados e não pode ser excluída — arquive em vez disso',
      )
    }
    await accountsRepository.deletePermanently(id, userId)
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

  async getStatement(
    userId: string,
    accountId: string,
    from?: string,
    to?: string,
  ): Promise<AccountStatement> {
    const account = await accountsRepository.findByIdAndUser(accountId, userId)
    if (!account) {
      throw new NotFoundError('conta não encontrada')
    }

    const openingBalanceCents = from
      ? ((await accountsRepository.getBalanceAsOf(accountId, userId, from))?.balanceCents ?? 0)
      : account.initial_balance_cents

    const [incomeRows, expenseRows, transferRows, invoicePaymentRows, goalContributionRows] =
      await Promise.all([
        incomeEntriesRepository.findAllByUser(userId, { accountId, dateFrom: from, dateTo: to }),
        expensesRepository.findAllByUser(userId, { accountId, dateFrom: from, dateTo: to }),
        transfersRepository.findAllByUser(userId, { accountId, dateFrom: from, dateTo: to }),
        invoicePaymentsRepository.findAllForAccount(accountId, userId, {
          dateFrom: from,
          dateTo: to,
        }),
        contributionsRepository.findAllForAccount(accountId, userId, { dateFrom: from, dateTo: to }),
      ])

    const sourceEntries: StatementSourceEntry[] = [
      ...incomeRows.map(
        (row): StatementSourceEntry => ({
          id: row.id,
          type: 'income',
          description: row.description,
          amountCents: row.amount_cents,
          date: row.entry_date,
          createdAt: row.created_at,
          affectsBalance: row.is_received,
        }),
      ),
      ...expenseRows.map(
        (row): StatementSourceEntry => ({
          id: row.id,
          type: 'expense',
          description: row.description,
          amountCents: row.amount_cents,
          date: row.expense_date,
          createdAt: row.created_at,
          affectsBalance: row.is_paid,
        }),
      ),
      ...transferRows.map((row): StatementSourceEntry => {
        const isOutgoing = row.from_account_id === accountId
        return {
          id: row.id,
          type: isOutgoing ? 'transfer_out' : 'transfer_in',
          description:
            row.description ?? (isOutgoing ? 'Transferência enviada' : 'Transferência recebida'),
          amountCents: row.amount_cents,
          date: row.transfer_date,
          createdAt: row.created_at,
          affectsBalance: true,
        }
      }),
      ...invoicePaymentRows.map(
        (row): StatementSourceEntry => ({
          id: row.id,
          type: 'invoice_payment',
          description: `Fatura ${row.card_name}`,
          amountCents: row.amount_cents,
          date: row.date,
          createdAt: row.created_at,
          affectsBalance: true,
        }),
      ),
      ...goalContributionRows.map(
        (row): StatementSourceEntry => ({
          id: row.id,
          type: 'goal_contribution',
          description: `Aporte para ${row.goal_name}`,
          amountCents: row.amount_cents,
          date: row.date,
          createdAt: row.created_at,
          affectsBalance: true,
        }),
      ),
    ]

    sourceEntries.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date < b.date ? -1 : 1
      }
      return a.createdAt.getTime() - b.createdAt.getTime()
    })

    let runningBalanceCents = openingBalanceCents
    const entries: StatementEntry[] = sourceEntries.map((entry) => {
      if (entry.affectsBalance) {
        runningBalanceCents += REDUCES_BALANCE[entry.type] ? -entry.amountCents : entry.amountCents
      }
      return {
        id: entry.id,
        type: entry.type,
        description: entry.description,
        amountCents: entry.amountCents,
        date: entry.date,
        runningBalanceCents,
      }
    })

    const closingBalanceCents =
      entries.length > 0 ? entries[entries.length - 1].runningBalanceCents : openingBalanceCents

    entries.reverse()

    return { openingBalanceCents, closingBalanceCents, entries }
  },
}
