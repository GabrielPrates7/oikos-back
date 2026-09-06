import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createGoalSchema = z.object({
  name: z.string().min(1),
  targetAmountCents: z.number().int().positive(),
  targetDate: isoDateSchema,
})

export const updateGoalSchema = createGoalSchema.partial()

export type CreateGoalInput = z.infer<typeof createGoalSchema>
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>
