import { z } from 'zod'

// Reusado pelos 9 módulos paginados (income-entries, expenses, transfers, invoices, accounts,
// credit-cards, categories, budgets, goals) — os únicos com volume alto o bastante pra
// listagem completa virar um problema. Transferências fica com o padrão já existente
// (nenhuma mudança pedida além disso).
export const paginationQuerySchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}

export interface PaginationParams {
  page: number
  pageSize: number
}

// Módulos com um "total exibido" (soma de amount_cents/balance/etc sobre TODO o filtro, não
// só a página) — income-entries, expenses, transfers, invoices, accounts.
export interface PaginatedResult<T> {
  items: T[]
  total: number
  sumCents: number
  page: number
  pageSize: number
}

// Módulos sem "total exibido" — categories, budgets, goals (e credit-cards, que tem soma
// própria de mais de um campo, então usa um shape específico em vez deste). Não inventa um
// sumCents que a tela nunca teve.
export interface PaginatedList<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
