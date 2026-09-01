import { z } from 'zod'

const dayOfMonthSchema = z.number().int().min(1).max(31)

export const creditCardStatusQuerySchema = z.enum(['active', 'archived', 'all'])

export const createCreditCardSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  credit_limit_cents: z.number().int().positive(),
  closing_day: dayOfMonthSchema,
  due_day: dayOfMonthSchema,
})

export const updateCreditCardSchema = createCreditCardSchema.partial()

export type CreateCreditCardInput = z.infer<typeof createCreditCardSchema>
export type UpdateCreditCardInput = z.infer<typeof updateCreditCardSchema>
