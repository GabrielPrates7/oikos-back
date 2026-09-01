import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const payInvoiceSchema = z.object({
  accountId: z.string().uuid(),
  paymentDate: isoDateSchema,
  amountCents: z.number().int().positive().optional(),
})

export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>
