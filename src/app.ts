import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import Fastify from 'fastify'
import { env } from './config/env.js'
import { errorHandler } from './middlewares/errorHandler.js'
import { accountsRoutes } from './modules/accounts/accounts.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { categoriesRoutes } from './modules/categories/categories.routes.js'

export function buildApp() {
  const app = Fastify({ logger: true })

  app.register(fastifyCors, {
    origin: env.corsOrigin,
    credentials: true,
  })

  app.register(fastifyCookie)

  app.setErrorHandler(errorHandler)

  app.get('/health', async () => {
    return { status: 'ok' }
  })

  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(accountsRoutes, { prefix: '/api/accounts' })
  app.register(categoriesRoutes, { prefix: '/api/categories' })

  return app
}
