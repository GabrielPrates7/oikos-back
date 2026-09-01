import { z } from 'zod'

export const accountTypeSchema = z.enum(['checking', 'savings', 'cash'])

export const accountStatusQuerySchema = z.enum(['active', 'archived', 'all'])

export const createAccountSchema = z.object({
  name: z.string().min(1),
  bank_name: z.string().optional(),
  type: accountTypeSchema,
  initial_balance_cents: z.number().int(),
})

export const updateAccountSchema = createAccountSchema.partial()

export type CreateAccountInput = z.infer<typeof createAccountSchema>
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>
