import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createPurchaseSchema = z.object({
  credit_card_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  total_amount_cents: z.number().int().positive(),
  installments_count: z.number().int().min(1),
  purchase_date: isoDateSchema,
  is_essential: z.boolean(),
  is_fixed: z.boolean(),
})

// Só essencial/fixo são editáveis por enquanto — mudar conta/cartão/valor de uma compra já
// faturada teria efeito em cascata sobre parcelas/faturas já geradas, fora do escopo daqui.
export const updatePurchaseSchema = z.object({
  is_essential: z.boolean().optional(),
  is_fixed: z.boolean().optional(),
})

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>
