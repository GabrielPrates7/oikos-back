import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

// Mês do plano na URL: 'YYYY-MM' (janeiro a dezembro, ano de 2000 a 2100).
export const planMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês deve estar no formato YYYY-MM')
  .refine((value) => {
    const year = Number(value.slice(0, 4))
    return year >= 2000 && year <= 2100
  }, 'ano fora do intervalo suportado (2000 a 2100)')

const INT4_MAX = 2_147_483_647

const plannedAmountSchema = z.number().int().positive().max(INT4_MAX)

const descriptionSchema = z.string().trim().min(1).max(200)

export const monthParamsSchema = z.object({ month: planMonthSchema })
export const itemIdParamsSchema = z.object({ id: z.string().uuid() })

export const updateSettingsSchema = z.strictObject({
  include_opening_balance: z.boolean(),
})

// Linha manual. is_essential só faz sentido em despesa (o service rejeita em entrada). Datas: o
// service confere que caem dentro do mês do plano.
export const createManualItemSchema = z.strictObject({
  kind: z.enum(['income', 'expense']),
  description: descriptionSchema,
  category_id: z.string().uuid().nullish(),
  planned_amount_cents: plannedAmountSchema,
  planned_date: isoDateSchema.nullish(),
  is_essential: z.boolean().nullish(),
})

// Edição: todos opcionais; quais campos valem depende do tipo da linha (manual, vinculada ou
// fatura) — o service devolve 400 para campo não editável.
export const updateItemSchema = z
  .strictObject({
    description: descriptionSchema,
    category_id: z.string().uuid().nullable(),
    planned_amount_cents: plannedAmountSchema,
    planned_date: isoDateSchema.nullable(),
    is_essential: z.boolean().nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'informe ao menos um campo' })

export const linkItemsSchema = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        type: z.enum(['income_entry', 'expense', 'invoice']),
        id: z.string().uuid(),
      }),
    )
    .min(1)
    .max(100),
})

export const candidatesQuerySchema = z.object({
  kind: z.enum(['income', 'expense', 'invoice']),
  status: z.enum(['pending', 'all']).default('pending'),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const importSchema = z.strictObject({
  sources: z
    .array(z.enum(['planned', 'invoices', 'fixed_previous_month']))
    .min(1)
    .refine((list) => new Set(list).size === list.length, { message: 'fontes repetidas' }),
  include_settled: z.boolean().default(true),
  dry_run: z.boolean().default(false),
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>
export type CreateManualItemInput = z.infer<typeof createManualItemSchema>
export type UpdateItemInput = z.infer<typeof updateItemSchema>
export type LinkItemsInput = z.infer<typeof linkItemsSchema>
export type CandidatesQuery = z.infer<typeof candidatesQuerySchema>
export type ImportInput = z.infer<typeof importSchema>
