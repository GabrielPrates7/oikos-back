import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createTransferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  transfer_date: isoDateSchema,
  description: z.string().optional(),
})

export type CreateTransferInput = z.infer<typeof createTransferSchema>
