import { z } from 'zod'
import { isoDateSchema, notesSchema } from '../../utils/validation.js'

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
  // SEM .default() aqui de propósito. No Zod 4, um .default() dentro de um campo passado por
  // .partial() CONTINUA aplicando o default quando o campo é omitido — então o PUT sem
  // count_in_totals voltava o valor gravado para true (bug corrigido). O default de criação (true)
  // fica só no createSchema, abaixo; no update, omitido = preserva o valor armazenado.
  count_in_totals: z.boolean(),
  // Recorrência ("fixa"). SEM default aqui de propósito: no PUT (.partial()), omitido tem que
  // PRESERVAR o valor gravado; o default false da criação é aplicado no repository.
  is_fixed: z.boolean().optional(),
  // Observação opcional (string ou null). Omitida no PUT preserva; null limpa.
  notes: notesSchema.optional(),
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
  .object({ ...baseIncomeEntryFields, count_in_totals: z.boolean().default(true) })
  .refine(receivedDateMatchesIsReceived, receivedDateRefinement)

export const updateIncomeEntrySchema = z
  .object(baseIncomeEntryFields)
  .partial()
  .refine(receivedDateMatchesIsReceived, receivedDateRefinement)

export type CreateIncomeEntryInput = z.infer<typeof createIncomeEntrySchema>
export type UpdateIncomeEntryInput = z.infer<typeof updateIncomeEntrySchema>
