import { z } from 'zod'

// Reusado pelos 4 módulos paginados (income-entries, expenses, transfers, invoices) — os
// únicos com volume alto o bastante pra listagem completa virar um problema. Contas,
// cartões, categorias, orçamentos e metas ficam de fora de propósito.
export const paginationQuerySchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}

export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  sumCents: number
  page: number
  pageSize: number
}
