import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const paymentMethodSchema = z.enum(['debit', 'cash', 'pix'])

export const createExpenseSchema = z.object({
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  amount_cents: z.number().int().positive(),
  payment_method: paymentMethodSchema,
  expense_date: isoDateSchema,
})

export const updateExpenseSchema = createExpenseSchema.partial()

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>
