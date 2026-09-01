import { z } from 'zod'

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'mês deve estar no formato YYYY-MM')

export const byCategoryQuerySchema = z.object({
  month: monthSchema.optional(),
  type: z.enum(['income', 'expense']).default('expense'),
})

export const monthlyEvolutionQuerySchema = z.object({
  monthsBack: z.coerce.number().int().min(1).max(24).default(6),
})

export const comparisonQuerySchema = z.object({
  month1: monthSchema,
  month2: monthSchema,
})
