import { currentMonthString, monthRange } from '../../utils/date-range.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import { creditCardsRepository } from '../credit-cards/credit-cards.repository.js'
import { dashboardRepository } from './dashboard.repository.js'

function resolveMonthRange(month?: string): {
  month: string
  monthStart: string
  monthEnd: string
} {
  const resolvedMonth = month ?? currentMonthString()
  const { monthStart, monthEnd } = monthRange(resolvedMonth)
  return { month: resolvedMonth, monthStart, monthEnd }
}

interface AccountSummary {
  id: string
  name: string
  balanceCents: number
}

interface CreditCardSummary {
  id: string
  name: string
  creditLimitCents: number
  availableLimitCents: number
}

interface CategoryExpenseSummary {
  categoryId: string
  name: string
  icon: string | null
  totalCents: number
}

type TransactionType = 'income' | 'expense' | 'transfer' | 'invoice_payment' | 'goal_contribution'

interface RecentTransaction {
  type: TransactionType
  id: string
  description: string
  amountCents: number
  date: string
  accountName: string
  categoryName?: string
}

export interface DashboardSummary {
  month: string
  totals: {
    incomeCents: number
    expenseCents: number
    netCents: number
  }
  totalBalanceCents: number
  totalPendingInvoicesCents: number
  accounts: AccountSummary[]
  creditCards: CreditCardSummary[]
  expensesByCategory: CategoryExpenseSummary[]
  recentTransactions: RecentTransaction[]
}

const RECENT_TRANSACTIONS_PER_TYPE = 5
const RECENT_TRANSACTIONS_TOTAL = 10

export const dashboardService = {
  async getSummary(userId: string, month?: string): Promise<DashboardSummary> {
    const { month: resolvedMonth, monthStart, monthEnd } = resolveMonthRange(month)

    const totals = await dashboardRepository.getMonthlyTotals(userId, monthStart, monthEnd)
    const netCents = totals.incomeCents - totals.expenseCents

    const accounts = await accountsRepository.findAllByUser(userId)
    const accountSummaries: AccountSummary[] = await Promise.all(
      accounts.map(async (account) => {
        const balance = await accountsRepository.getBalance(account.id, userId)
        return { id: account.id, name: account.name, balanceCents: balance?.balanceCents ?? 0 }
      }),
    )
    const totalBalanceCents = accountSummaries.reduce(
      (sum, account) => sum + account.balanceCents,
      0,
    )

    const totalPendingInvoicesCents = await dashboardRepository.getTotalUnpaidInvoices(userId)

    const creditCards = await creditCardsRepository.findAllByUser(userId)
    const creditCardSummaries: CreditCardSummary[] = await Promise.all(
      creditCards.map(async (card) => {
        const limit = await creditCardsRepository.getAvailableLimit(card.id, userId)
        return {
          id: card.id,
          name: card.name,
          creditLimitCents: card.credit_limit_cents,
          availableLimitCents: limit?.availableLimitCents ?? 0,
        }
      }),
    )

    const expensesByCategoryRows = await dashboardRepository.getCategoryBreakdown(
      userId,
      monthStart,
      monthEnd,
      'expense',
    )
    const expensesByCategory: CategoryExpenseSummary[] = expensesByCategoryRows.map((row) => ({
      categoryId: row.category_id,
      name: row.name,
      icon: row.icon,
      totalCents: row.total_cents,
    }))

    const [
      recentIncome,
      recentExpenses,
      recentTransfers,
      recentInvoicePayments,
      recentGoalContributions,
    ] = await Promise.all([
      dashboardRepository.getRecentIncomeEntries(
        userId,
        monthStart,
        monthEnd,
        RECENT_TRANSACTIONS_PER_TYPE,
      ),
      dashboardRepository.getRecentExpenses(
        userId,
        monthStart,
        monthEnd,
        RECENT_TRANSACTIONS_PER_TYPE,
      ),
      dashboardRepository.getRecentTransfers(
        userId,
        monthStart,
        monthEnd,
        RECENT_TRANSACTIONS_PER_TYPE,
      ),
      dashboardRepository.getRecentInvoicePayments(
        userId,
        monthStart,
        monthEnd,
        RECENT_TRANSACTIONS_PER_TYPE,
      ),
      dashboardRepository.getRecentGoalContributions(
        userId,
        monthStart,
        monthEnd,
        RECENT_TRANSACTIONS_PER_TYPE,
      ),
    ])

    const normalized: RecentTransaction[] = [
      ...recentIncome.map((row): RecentTransaction => ({
        type: 'income',
        id: row.id,
        description: row.description,
        amountCents: row.amount_cents,
        date: row.date,
        accountName: row.account_name,
        categoryName: row.category_name,
      })),
      ...recentExpenses.map((row): RecentTransaction => ({
        type: 'expense',
        id: row.id,
        description: row.description,
        amountCents: row.amount_cents,
        date: row.date,
        accountName: row.account_name,
        categoryName: row.category_name,
      })),
      ...recentTransfers.map((row): RecentTransaction => ({
        type: 'transfer',
        id: row.id,
        description: row.description ?? 'Transferência',
        amountCents: row.amount_cents,
        date: row.date,
        accountName: `${row.from_account_name} → ${row.to_account_name}`,
      })),
      ...recentInvoicePayments.map((row): RecentTransaction => ({
        type: 'invoice_payment',
        id: row.id,
        description: `Fatura ${row.card_name}`,
        amountCents: row.amount_cents,
        date: row.date,
        accountName: row.account_name,
      })),
      ...recentGoalContributions.map((row): RecentTransaction => ({
        type: 'goal_contribution',
        id: row.id,
        description: `Aporte para ${row.goal_name}`,
        amountCents: row.amount_cents,
        date: row.date,
        accountName: row.account_name,
      })),
    ]

    const recentTransactions = normalized
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, RECENT_TRANSACTIONS_TOTAL)

    return {
      month: resolvedMonth,
      totals: {
        incomeCents: totals.incomeCents,
        expenseCents: totals.expenseCents,
        netCents,
      },
      totalBalanceCents,
      totalPendingInvoicesCents,
      accounts: accountSummaries,
      creditCards: creditCardSummaries,
      expensesByCategory,
      recentTransactions,
    }
  },
}
