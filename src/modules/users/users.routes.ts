import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { changePassword, updateProfile } from './users.controller.js'

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.put('/me', updateProfile)
  app.post('/me/change-password', changePassword)
}
