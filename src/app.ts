import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import Fastify from 'fastify'
import { env } from './config/env.js'
import { errorHandler } from './middlewares/errorHandler.js'
import { accountsRoutes } from './modules/accounts/accounts.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { categoriesRoutes } from './modules/categories/categories.routes.js'
import { creditCardsRoutes } from './modules/credit-cards/credit-cards.routes.js'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'
import { expensesRoutes } from './modules/expenses/expenses.routes.js'
import { incomeEntriesRoutes } from './modules/income-entries/income-entries.routes.js'
import { invoicesRoutes } from './modules/invoices/invoices.routes.js'
import { purchasesRoutes } from './modules/purchases/purchases.routes.js'
import { reportsRoutes } from './modules/reports/reports.routes.js'
import { transfersRoutes } from './modules/transfers/transfers.routes.js'

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
  app.register(incomeEntriesRoutes, { prefix: '/api/income-entries' })
  app.register(expensesRoutes, { prefix: '/api/expenses' })
  app.register(transfersRoutes, { prefix: '/api/transfers' })
  app.register(creditCardsRoutes, { prefix: '/api/credit-cards' })
  app.register(purchasesRoutes, { prefix: '/api/purchases' })
  app.register(invoicesRoutes, { prefix: '/api/invoices' })
  app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  app.register(reportsRoutes, { prefix: '/api/reports' })

  return app
}
