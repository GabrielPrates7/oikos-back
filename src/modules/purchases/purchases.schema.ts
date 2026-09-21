import { z } from 'zod'
import { isoDateSchema, notesSchema } from '../../utils/validation.js'

export const createPurchaseSchema = z.object({
  credit_card_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  total_amount_cents: z.number().int().positive(),
  installments_count: z.number().int().min(1),
  purchase_date: isoDateSchema,
  is_essential: z.boolean(),
  is_fixed: z.boolean(),
  is_planned: z.boolean(),
  // Observação opcional (string ou null); omitida = sem observação.
  notes: notesSchema.optional(),
})

// Campos estruturais (credit_card_id, total_amount_cents, installments_count,
// purchase_date) agora são aceitos aqui — mudar qualquer um deles faz purchases.service
// apagar as parcelas antigas e gerar novas do zero (reaproveitando invoice-assignment.util,
// mesma lógica da Fase 11), bloqueado se a compra já tiver parcela paga. Chaves fora deste
// schema são descartadas pelo Zod (comportamento padrão de z.object, sem .strict()) — nunca
// aplicadas silenciosamente.
export const updatePurchaseSchema = z.object({
  description: z.string().min(1).optional(),
  category_id: z.string().uuid().optional(),
  is_essential: z.boolean().optional(),
  is_fixed: z.boolean().optional(),
  credit_card_id: z.string().uuid().optional(),
  total_amount_cents: z.number().int().positive().optional(),
  installments_count: z.number().int().min(1).optional(),
  purchase_date: isoDateSchema.optional(),
  // Omitida preserva; null limpa. NÃO é campo estrutural: editável mesmo com parcela já paga.
  notes: notesSchema.optional(),
})

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>
