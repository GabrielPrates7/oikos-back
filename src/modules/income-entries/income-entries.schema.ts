import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createIncomeEntrySchema = z.object({
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  amount_cents: z.number().int().positive(),
  entry_date: isoDateSchema,
})

export const updateIncomeEntrySchema = createIncomeEntrySchema.partial()

export type CreateIncomeEntryInput = z.infer<typeof createIncomeEntrySchema>
export type UpdateIncomeEntryInput = z.infer<typeof updateIncomeEntrySchema>
