import { z } from 'zod'

export const categoryTypeSchema = z.enum(['income', 'expense'])

export const createCategorySchema = z.object({
  name: z.string().min(1),
  type: categoryTypeSchema,
  icon: z.string().optional(),
})

// type não é editável depois de criada — de propósito, não faz parte deste schema.
export const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().optional(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
