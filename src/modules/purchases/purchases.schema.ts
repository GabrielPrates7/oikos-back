import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createPurchaseSchema = z.object({
  credit_card_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  total_amount_cents: z.number().int().positive(),
  installments_count: z.number().int().min(1),
  purchase_date: isoDateSchema,
})

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>
