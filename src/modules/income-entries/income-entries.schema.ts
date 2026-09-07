import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const receiptMethodSchema = z.enum(['pix', 'transfer', 'cash', 'other'])

const baseIncomeEntryFields = {
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  amount_cents: z.number().int().positive(),
  entry_date: isoDateSchema,
  receipt_method: receiptMethodSchema,
  is_received: z.boolean(),
  is_planned: z.boolean(),
  received_date: isoDateSchema.nullable().optional(),
}

// Mesma lógica de expenses.schema (paidDateMatchesIsPaid) — roda no create (is_received
// sempre presente) e no update (partial, pula a validação se is_received não veio).
function receivedDateMatchesIsReceived(data: {
  is_received?: boolean
  received_date?: string | null
}): boolean {
  if (data.is_received === undefined) return true
  if (data.is_received) return data.received_date !== undefined && data.received_date !== null
  return data.received_date === undefined || data.received_date === null
}

const receivedDateRefinement = {
  message:
    'received_date é obrigatório quando is_received é true, e deve ser nulo/ausente quando is_received é false',
  path: ['received_date'],
}

export const createIncomeEntrySchema = z
  .object(baseIncomeEntryFields)
  .refine(receivedDateMatchesIsReceived, receivedDateRefinement)

export const updateIncomeEntrySchema = z
  .object(baseIncomeEntryFields)
  .partial()
  .refine(receivedDateMatchesIsReceived, receivedDateRefinement)

export type CreateIncomeEntryInput = z.infer<typeof createIncomeEntrySchema>
export type UpdateIncomeEntryInput = z.infer<typeof updateIncomeEntrySchema>
