import { z } from 'zod'

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    // Exigido pelo service (não aqui: o schema não sabe qual é o e-mail atual) só quando
    // `email` está de fato mudando.
    currentPassword: z.string().min(1).optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'informe ao menos name ou email',
  })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
