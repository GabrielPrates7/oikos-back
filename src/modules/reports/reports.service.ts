import { currentMonthString, monthRange } from '../../utils/date-range.js'
import type { CategoryBreakdownType } from '../dashboard/dashboard.types.js'
import { dashboardRepository } from '../dashboard/dashboard.repository.js'
import { reportsRepository } from './reports.repository.js'
import type { MonthlyEvolutionItem } from './reports.repository.js'

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
}
