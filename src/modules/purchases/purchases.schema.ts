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

// Deliberadamente SEM total_amount_cents, installments_count ou credit_card_id (mesma
// decisão da Fase 11): mudar valor, parcelamento ou cartão de uma compra já faturada exigiria
// recalcular parcelas/faturas já geradas, e fazer isso sem essa lógica corromperia dado
// financeiro. Chaves fora deste schema são descartadas pelo Zod (comportamento padrão de
// z.object, sem .strict()) — nunca aplicadas silenciosamente.
export const updatePurchaseSchema = z.object({
  description: z.string().min(1).optional(),
  category_id: z.string().uuid().optional(),
  is_essential: z.boolean().optional(),
  is_fixed: z.boolean().optional(),
})

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>
