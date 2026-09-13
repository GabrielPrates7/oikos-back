import { currentMonthString, monthRange } from '../../utils/date-range.js'
import { accountsRepository } from '../accounts/accounts.repository.js'
import { creditCardsRepository } from '../credit-cards/credit-cards.repository.js'
import { expensesRepository } from '../expenses/expenses.repository.js'
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

// Todos os *Percent do SummaryCards são relativos às entradas do mês (exceto
// patrimonioLiquidoPercent, relativo ao saldo — ver comentário no campo). 0 entradas vira
// 0%, não NaN/Infinity.
function safePercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 100)
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
  // % do total pago no mês (não % do total de despesas por categoria — os itens não somam
  // 100% entre si, cada um é independente, mesma fórmula pedida pro SummaryCards).
  percentOfTotal: number
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
  // Mesmo conceito de expenses.service.getMonthlySummary, só que parametrizado pelo mês que
  // o Dashboard já resolve (não fixo em "mês atual") — jaPagoCents soma despesas pagas do
  // mês + faturas pagas com due_date no mês; faltaPagarCents soma despesas pendentes do mês
  // + faturas não pagas com due_date no mês. Substitui o antigo totalPendingInvoicesCents
  // (que era global, todas as faturas em aberto de sempre, sem filtro de mês).
  jaPagoCents: number
  jaPagoPercent: number
  faltaPagarCents: number
  faltaPagarPercent: number
  lucroCents: number
  lucroMargemPercent: number
  // totalBalanceCents - dívida em aberto de todos os cartões ativos (credit_limit -
  // available_limit de cada um, já calculado em creditCardSummaries).
  patrimonioLiquidoCents: number
  // Não pedido explicitamente na especificação — adicionado pra bater com a barra de
  // progresso da imagem de referência ("≈96%" sob Patrimônio Líquido). Relativo ao saldo
  // total (não às entradas, diferente dos demais *Percent), já que patrimônio líquido é uma
  // métrica de saldo, não de fluxo do mês. Reportado ao usuário para confirmação.
  patrimonioLiquidoPercent: number
  poupancaCents: number
  taxaPoupancaPercent: number
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

    const { totalPagoCents: jaPagoCents, totalFaltaPagarCents: faltaPagarCents } =
      await expensesRepository.getMonthlySummary(userId, resolvedMonth)

    const entradasCents = totals.incomeCents
    const jaPagoPercent = safePercent(jaPagoCents, entradasCents)
    const faltaPagarPercent = safePercent(faltaPagarCents, entradasCents)
    const lucroCents = entradasCents - jaPagoCents
    const lucroMargemPercent = safePercent(lucroCents, entradasCents)

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
    const totalCardDebtCents = creditCardSummaries.reduce(
      (sum, card) => sum + (card.creditLimitCents - card.availableLimitCents),
      0,
    )
    const patrimonioLiquidoCents = totalBalanceCents - totalCardDebtCents
    const patrimonioLiquidoPercent = safePercent(patrimonioLiquidoCents, totalBalanceCents)

    const poupancaCents = await dashboardRepository.getMonthlyGoalContributionsTotal(
      userId,
      monthStart,
      monthEnd,
    )
    const taxaPoupancaPercent = safePercent(poupancaCents, entradasCents)

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
      percentOfTotal: safePercent(row.total_cents, jaPagoCents),
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
      jaPagoCents,
      jaPagoPercent,
      faltaPagarCents,
      faltaPagarPercent,
      lucroCents,
      lucroMargemPercent,
      patrimonioLiquidoCents,
      patrimonioLiquidoPercent,
      poupancaCents,
      taxaPoupancaPercent,
      accounts: accountSummaries,
      creditCards: creditCardSummaries,
      expensesByCategory,
      recentTransactions,
    }
  },
}
