import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const paymentMethodSchema = z.enum(['debit', 'cash', 'pix'])

const baseExpenseFields = {
  account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  description: z.string().min(1),
  amount_cents: z.number().int().positive(),
  payment_method: paymentMethodSchema,
  expense_date: isoDateSchema,
  is_essential: z.boolean(),
  is_fixed: z.boolean(),
  is_paid: z.boolean(),
  is_planned: z.boolean(),
  paid_date: isoDateSchema.nullable().optional(),
  // default(true) só se aplica no create (schema base sem .partial()) — omitido, vira
  // true sozinho, sem o front precisar mandar o campo pra manter o comportamento de hoje.
  // No update (.partial() abaixo), omitido continua omitido (não força reset pra true).
  count_in_totals: z.boolean().default(true),
}

// Roda tanto no create (is_paid sempre presente, campo obrigatório na base) quanto no
// update (partial — is_paid pode estar ausente, aí não valida nada aqui: a troca de
// paid_date sozinha, sem tocar em is_paid, é responsabilidade de quem já sabe o estado
// atual da despesa).
function paidDateMatchesIsPaid(data: { is_paid?: boolean; paid_date?: string | null }): boolean {
  if (data.is_paid === undefined) return true
  if (data.is_paid) return data.paid_date !== undefined && data.paid_date !== null
  return data.paid_date === undefined || data.paid_date === null
}

const paidDateRefinement = {
  message: 'paid_date é obrigatório quando is_paid é true, e deve ser nulo/ausente quando is_paid é false',
  path: ['paid_date'],
}

export const createExpenseSchema = z.object(baseExpenseFields).refine(paidDateMatchesIsPaid, paidDateRefinement)

export const updateExpenseSchema = z
  .object(baseExpenseFields)
  .partial()
  .refine(paidDateMatchesIsPaid, paidDateRefinement)

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>
