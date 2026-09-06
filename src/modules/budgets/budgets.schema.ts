import { z } from 'zod'

export const referenceMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'mês deve estar no formato YYYY-MM')

export const createBudgetSchema = z.object({
  categoryId: z.string().uuid(),
  referenceMonth: referenceMonthSchema,
  limitAmountCents: z.number().int().positive(),
})

export const updateBudgetSchema = createBudgetSchema.partial()

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>
