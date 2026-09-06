import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'

export const createContributionSchema = z.object({
  accountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  contributionDate: isoDateSchema,
})

export type CreateContributionInput = z.infer<typeof createContributionSchema>
