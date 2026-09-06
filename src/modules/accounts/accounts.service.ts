import { NotFoundError } from '../../errors/AppError.js'
import { contributionsRepository } from '../goals/contributions.repository.js'
import { expensesRepository } from '../expenses/expenses.repository.js'
import { incomeEntriesRepository } from '../income-entries/income-entries.repository.js'
import { invoicePaymentsRepository } from '../invoice-payments/invoice-payments.repository.js'
import { transfersRepository } from '../transfers/transfers.repository.js'
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

  async listByUser(userId: string, status?: AccountStatus | 'all'): Promise<AccountWithBalance[]> {
    const accounts = await accountsRepository.findAllByUser(userId, status)
    // Mesmo padrão de dashboard.service.ts: N+1 aceitável aqui porque é a lista de contas
    // de um único usuário (tipicamente poucas linhas), e correção bate antes de otimização.
    return Promise.all(
      accounts.map(async (account) => {
        const balance = await accountsRepository.getBalance(account.id, userId)
        return { ...account, balanceCents: balance?.balanceCents ?? account.initial_balance_cents }
      }),
    )
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
      runningBalanceCents += REDUCES_BALANCE[entry.type] ? -entry.amountCents : entry.amountCents
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
