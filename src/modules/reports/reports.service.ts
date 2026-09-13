import { currentMonthString, monthRange } from '../../utils/date-range.js'
import type { CategoryBreakdownType } from '../dashboard/dashboard.types.js'
import { dashboardRepository } from '../dashboard/dashboard.repository.js'
import { reportsRepository } from './reports.repository.js'
import type {
  EssentialVsSuperfluousTotals,
  FixedVsNonFixedTotals,
  MonthlyEvolutionItem,
} from './reports.repository.js'

function subtractMonths(month: string, count: number): string {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthNum = Number(monthStr)

  const totalMonths = year * 12 + (monthNum - 1) - count
  const newYear = Math.floor(totalMonths / 12)
  const newMonth = (totalMonths % 12) + 1

  return `${newYear}-${String(newMonth).padStart(2, '0')}`
}

function lastNMonths(n: number): string[] {
  const current = currentMonthString()
  const months: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    months.push(subtractMonths(current, i))
  }
  return months
}

// Mesma ideia de lastNMonths, mas terminando num mês arbitrário (o mês do MonthSwitcher do
// Dashboard) em vez de sempre "hoje" — usado por getSpendingTrends.
function lastNMonthsEnding(endMonth: string, n: number): string[] {
  const months: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    months.push(subtractMonths(endMonth, i))
  }
  return months
}

interface CategoryBreakdownItem {
  categoryId: string
  name: string
  icon: string | null
  totalCents: number
}

interface ByCategoryResult {
  month: string
  type: CategoryBreakdownType
  categories: CategoryBreakdownItem[]
}

interface ComparisonCategoryItem {
  categoryId: string
  name: string
  month1Cents: number
  month2Cents: number
  deltaCents: number
}

interface ByAccountItem {
  accountId: string
  name: string
  totalCents: number
}

interface ByAccountResult {
  month: string
  type: 'income' | 'expense'
  accounts: ByAccountItem[]
}

interface ByReceiptMethodItem {
  receiptMethod: string
  totalCents: number
}

interface ByReceiptMethodResult {
  month: string
  methods: ByReceiptMethodItem[]
}

interface EssentialVsSuperfluousResult extends EssentialVsSuperfluousTotals {
  month: string
}

interface FixedVsNonFixedResult extends FixedVsNonFixedTotals {
  month: string
}

interface SpendingTrendPoint {
  month: string
  totalCents: number
  // Média móvel de 3 meses (o próprio mês + até 2 anteriores; nos dois primeiros meses da
  // janela usa só o que existe — 1 ou 2 pontos — em vez de tratar meses fora do período
  // como zero, o que puxaria a média artificialmente pra baixo bem no início da série).
  movingAvgCents: number
}

interface SpendingTrendCategoryItem {
  categoryId: string
  name: string
  icon: string | null
  points: SpendingTrendPoint[]
}

interface SpendingTrendsResult {
  months: string[]
  categories: SpendingTrendCategoryItem[]
}

interface ComparisonResult {
  month1: { month: string; incomeCents: number; expenseCents: number; netCents: number }
  month2: { month: string; incomeCents: number; expenseCents: number; netCents: number }
  delta: {
    incomeCentsDelta: number
    expenseCentsDelta: number
    netCentsDelta: number
  }
  categories: ComparisonCategoryItem[]
}

export const reportsService = {
  async getByCategory(
    userId: string,
    month: string | undefined,
    type: CategoryBreakdownType,
  ): Promise<ByCategoryResult> {
    const resolvedMonth = month ?? currentMonthString()
    const { monthStart, monthEnd } = monthRange(resolvedMonth)

    const rows = await dashboardRepository.getCategoryBreakdown(userId, monthStart, monthEnd, type)

    return {
      month: resolvedMonth,
      type,
      categories: rows.map((row) => ({
        categoryId: row.category_id,
        name: row.name,
        icon: row.icon,
        totalCents: row.total_cents,
      })),
    }
  },

  async getMonthlyEvolution(userId: string, monthsBack: number): Promise<MonthlyEvolutionItem[]> {
    const months = lastNMonths(monthsBack)
    return reportsRepository.getMonthlyEvolution(userId, months)
  },

  async getComparison(userId: string, month1: string, month2: string): Promise<ComparisonResult> {
    const range1 = monthRange(month1)
    const range2 = monthRange(month2)

    const [totals1, totals2] = await Promise.all([
      dashboardRepository.getMonthlyTotals(userId, range1.monthStart, range1.monthEnd),
      dashboardRepository.getMonthlyTotals(userId, range2.monthStart, range2.monthEnd),
    ])

    const [breakdown1, breakdown2] = await Promise.all([
      dashboardRepository.getCategoryBreakdown(
        userId,
        range1.monthStart,
        range1.monthEnd,
        'expense',
      ),
      dashboardRepository.getCategoryBreakdown(
        userId,
        range2.monthStart,
        range2.monthEnd,
        'expense',
      ),
    ])

    const categoriesMap = new Map<string, ComparisonCategoryItem>()
    for (const row of breakdown1) {
      categoriesMap.set(row.category_id, {
        categoryId: row.category_id,
        name: row.name,
        month1Cents: row.total_cents,
        month2Cents: 0,
        deltaCents: 0,
      })
    }
    for (const row of breakdown2) {
      const existing = categoriesMap.get(row.category_id)
      if (existing) {
        existing.month2Cents = row.total_cents
      } else {
        categoriesMap.set(row.category_id, {
          categoryId: row.category_id,
          name: row.name,
          month1Cents: 0,
          month2Cents: row.total_cents,
          deltaCents: 0,
        })
      }
    }
    const categories = Array.from(categoriesMap.values()).map((category) => ({
      ...category,
      deltaCents: category.month2Cents - category.month1Cents,
    }))

    const net1 = totals1.incomeCents - totals1.expenseCents
    const net2 = totals2.incomeCents - totals2.expenseCents

    return {
      month1: {
        month: month1,
        incomeCents: totals1.incomeCents,
        expenseCents: totals1.expenseCents,
        netCents: net1,
      },
      month2: {
        month: month2,
        incomeCents: totals2.incomeCents,
        expenseCents: totals2.expenseCents,
        netCents: net2,
      },
      delta: {
        incomeCentsDelta: totals2.incomeCents - totals1.incomeCents,
        expenseCentsDelta: totals2.expenseCents - totals1.expenseCents,
        netCentsDelta: net2 - net1,
      },
      categories,
    }
  },

  async getByAccount(
    userId: string,
    month: string | undefined,
    type: 'income' | 'expense',
  ): Promise<ByAccountResult> {
    const resolvedMonth = month ?? currentMonthString()
    const { monthStart, monthEnd } = monthRange(resolvedMonth)

    const rows = await reportsRepository.getTotalByAccount(userId, monthStart, monthEnd, type)

    return {
      month: resolvedMonth,
      type,
      accounts: rows.map((row) => ({
        accountId: row.account_id,
        name: row.account_name,
        totalCents: row.total_cents,
      })),
    }
  },

  async getByReceiptMethod(
    userId: string,
    month: string | undefined,
  ): Promise<ByReceiptMethodResult> {
    const resolvedMonth = month ?? currentMonthString()
    const { monthStart, monthEnd } = monthRange(resolvedMonth)

    const rows = await reportsRepository.getTotalByReceiptMethod(userId, monthStart, monthEnd)

    return {
      month: resolvedMonth,
      methods: rows.map((row) => ({
        receiptMethod: row.receipt_method,
        totalCents: row.total_cents,
      })),
    }
  },

  async getEssentialVsSuperfluous(
    userId: string,
    month: string | undefined,
  ): Promise<EssentialVsSuperfluousResult> {
    const resolvedMonth = month ?? currentMonthString()
    const { monthStart, monthEnd } = monthRange(resolvedMonth)

    const totals = await reportsRepository.getEssentialVsSuperfluous(userId, monthStart, monthEnd)

    return { month: resolvedMonth, ...totals }
  },

  async getFixedVsNonFixed(
    userId: string,
    month: string | undefined,
  ): Promise<FixedVsNonFixedResult> {
    const resolvedMonth = month ?? currentMonthString()
    const { monthStart, monthEnd } = monthRange(resolvedMonth)

    const totals = await reportsRepository.getFixedVsNonFixed(userId, monthStart, monthEnd)

    return { month: resolvedMonth, ...totals }
  },

  // Só as N categorias com maior variância de gasto nos últimos `monthsBack` meses (não
  // todas) — a análise de "Tendências de Gastos Mensais" do Dashboard existe pra destacar
  // onde o gasto anda mais instável, não pra repetir o breakdown de categoria já mostrado
  // em "Despesas por categoria" logo acima na mesma tela.
  async getSpendingTrends(
    userId: string,
    month: string | undefined,
    monthsBack: number,
  ): Promise<SpendingTrendsResult> {
    const resolvedMonth = month ?? currentMonthString()
    const months = lastNMonthsEnding(resolvedMonth, monthsBack)

    const breakdownsByMonth = await Promise.all(
      months.map((m) => {
        const { monthStart, monthEnd } = monthRange(m)
        return dashboardRepository.getCategoryBreakdown(userId, monthStart, monthEnd, 'expense')
      }),
    )

    const categoryMap = new Map<string, { name: string; icon: string | null; totals: number[] }>()
    breakdownsByMonth.forEach((rows, monthIndex) => {
      for (const row of rows) {
        if (!categoryMap.has(row.category_id)) {
          categoryMap.set(row.category_id, {
            name: row.name,
            icon: row.icon,
            totals: new Array(months.length).fill(0),
          })
        }
        categoryMap.get(row.category_id)!.totals[monthIndex] = row.total_cents
      }
    })

    const withVariance = Array.from(categoryMap.entries()).map(([categoryId, data]) => {
      const mean = data.totals.reduce((sum, value) => sum + value, 0) / data.totals.length
      const variance =
        data.totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / data.totals.length
      return { categoryId, ...data, variance }
    })

    const topCategories = withVariance.sort((a, b) => b.variance - a.variance).slice(0, 4)

    const categories: SpendingTrendCategoryItem[] = topCategories.map((category) => ({
      categoryId: category.categoryId,
      name: category.name,
      icon: category.icon,
      points: months.map((m, index) => {
        // Janela de até 3 meses terminando no mês atual do loop — nos dois primeiros meses
        // da série usa só o que existe (1 ou depois 2 pontos), nunca zero-preenchido.
        const window = category.totals.slice(Math.max(0, index - 2), index + 1)
        const movingAvgCents = Math.round(
          window.reduce((sum, value) => sum + value, 0) / window.length,
        )
        return { month: m, totalCents: category.totals[index], movingAvgCents }
      }),
    }))

    return { months, categories }
  },
}
