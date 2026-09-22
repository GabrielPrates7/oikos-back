export type PlanKind = 'income' | 'expense'
export type PlanSourceType = 'income_entry' | 'expense' | 'invoice'
export type CandidateKind = 'income' | 'expense' | 'invoice'
export type CandidateSituation = 'pending' | 'overdue' | 'received' | 'paid'

export interface MonthlyPlan {
  id: string
  user_id: string
  month: string // DATE 'YYYY-MM-01'
  include_opening_balance: boolean
  created_at: Date
  updated_at: Date
}

// Resposta da API: o plano sem user_id e com o mês como 'YYYY-MM'. Sem plano gravado: id null e as
// configurações padrão (nada é criado pelo GET).
export interface PlanSettingsView {
  id: string | null
  month: string
  include_opening_balance: boolean
}

export interface CategoryRef {
  id: string
  name: string
  icon: string | null
}

export type PlanItemSource =
  | {
      type: 'income_entry'
      entry_date: string
      is_received: boolean
      received_date: string | null
      is_planned: boolean
      current_amount_cents: number
    }
  | {
      type: 'expense'
      expense_date: string
      is_paid: boolean
      paid_date: string | null
      is_planned: boolean
      current_amount_cents: number
    }
  | {
      type: 'invoice'
      due_date: string
      reference_month: string
      status: string
      credit_card: { id: string; name: string; brand: string | null }
      paid: { payment_date: string; amount_cents: number } | null
    }

export interface PlanItemView {
  id: string
  kind: PlanKind
  source_type: PlanSourceType | null
  source_id: string | null
  description: string
  category: CategoryRef | null
  // Fatura: total ATUAL da fatura (dinâmico, amount_is_dynamic = true); demais: valor gravado.
  planned_amount_cents: number
  amount_is_dynamic: boolean
  planned_date: string | null
  is_essential: boolean | null
  source: PlanItemSource | null
  created_at: Date
  updated_at: Date
}

export interface PlanItemContext {
  id: string
  kind: PlanKind
  source_type: PlanSourceType | null
  plan_month: string // 'YYYY-MM'
}

export interface CandidateView {
  kind: CandidateKind
  id: string
  description: string
  amount_cents: number
  date: string
  is_planned: boolean | null
  situation: CandidateSituation
  settled_date: string | null
  category: CategoryRef | null
  credit_card: { id: string; name: string; brand: string | null } | null
}

export type LinkIgnoredReason =
  'already_in_this_plan' | 'already_in_other_plan' | 'duplicate_in_request' | 'out_of_period'

export interface LinkResult {
  added: PlanItemView[]
  ignored: { type: PlanSourceType; id: string; reason: LinkIgnoredReason }[]
}

export interface ImportSettledCounts {
  added: number
  // Dos que seriam adicionados, quantos são pendências ATRASADAS de meses anteriores.
  overdue_previous_months: number
  skipped_already_in_plan: number
  skipped_settled: number
}

export interface ImportResult {
  dry_run: boolean
  month: string
  sources: {
    planned?: {
      added: number
      overdue_previous_months: number
      income: ImportSettledCounts
      expense: ImportSettledCounts
    }
    invoices?: { added: number; skipped_already_in_plan: number; paid_included: number }
    fixed_previous_month?: { added: number; found: number; skipped_duplicates: number }
  }
  total_added: number
}
