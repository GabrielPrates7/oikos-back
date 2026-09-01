import { z } from 'zod'

export const monthQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'mês deve estar no formato YYYY-MM')
    .optional(),
})
