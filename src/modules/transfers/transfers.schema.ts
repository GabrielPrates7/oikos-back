import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createTransferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  transfer_date: isoDateSchema,
  description: z.string().optional(),
})

// PUT /transfers/:id — parcial (campos omitidos mantêm o valor atual). description aceita
// null/'' pra permitir LIMPAR a descrição, coisa que o schema de criação não precisa (lá
// omitir já significa "sem descrição").
export const updateTransferSchema = createTransferSchema
  .partial()
  .extend({ description: z.string().nullable().optional() })

export type CreateTransferInput = z.infer<typeof createTransferSchema>
export type UpdateTransferInput = z.infer<typeof updateTransferSchema>
