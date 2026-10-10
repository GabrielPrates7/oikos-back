import type { FastifyReply, FastifyRequest } from 'fastify'
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../auth/auth.controller.js'
import { buildExportCsv } from './users.export.js'
import { changePasswordSchema, updateProfileSchema } from './users.schema.js'
import { usersService } from './users.service.js'

export async function updateProfile(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { currentPassword, ...data } = updateProfileSchema.parse(request.body)
  const user = await usersService.updateProfile(request.user!.id, data, currentPassword)
  reply.send({ user })
}

export async function changePassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = changePasswordSchema.parse(request.body)
  await usersService.changePassword(request.user!.id, body.currentPassword, body.newPassword)
  // Mesmo efeito do logout: o refresh token antigo (token_version obsoleto) não serve mais
  // pra nada, então o cookie some junto — o front redireciona pro /login de qualquer forma.
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
  reply.code(204).send()
}

export async function exportData(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const csv = await buildExportCsv(request.user!.id)
  reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="oikos-meus-dados.csv"')
    .send(csv)
}
