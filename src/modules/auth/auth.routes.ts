import fastifyRateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { login, logout, me, refresh, register } from './auth.controller.js'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyRateLimit, { global: false })

  app.post('/register', register)

  app.post('/login', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, login)

  app.post('/refresh', refresh)

  app.post('/logout', logout)

  app.get('/me', { preHandler: authenticate }, me)
}
