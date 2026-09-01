import { monthRange } from '../../utils/date-range.js'
import { dashboardRepository } from '../dashboard/dashboard.repository.js'

export interface MonthlyEvolutionItem {
  month: string
  incomeCents: number
  expenseCents: number
  netCents: number
}

export const reportsRepository = {
  async getMonthlyEvolution(userId: string, monthsList: string[]): Promise<MonthlyEvolutionItem[]> {
    const results: MonthlyEvolutionItem[] = []

    for (const month of monthsList) {
      const { monthStart, monthEnd } = monthRange(month)
      const totals = await dashboardRepository.getMonthlyTotals(userId, monthStart, monthEnd)
      results.push({
        month,
        incomeCents: totals.incomeCents,
        expenseCents: totals.expenseCents,
        netCents: totals.incomeCents - totals.expenseCents,
      })
    }

    return results
  },
}
