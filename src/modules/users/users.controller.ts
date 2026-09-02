import type { FastifyReply, FastifyRequest } from 'fastify'
import { changePasswordSchema, updateProfileSchema } from './users.schema.js'
import { usersService } from './users.service.js'

export async function updateProfile(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = updateProfileSchema.parse(request.body)
  const user = await usersService.updateProfile(request.user!.id, body)
  reply.send({ user })
}

export async function changePassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = changePasswordSchema.parse(request.body)
  await usersService.changePassword(request.user!.id, body.currentPassword, body.newPassword)
  reply.code(204).send()
}
