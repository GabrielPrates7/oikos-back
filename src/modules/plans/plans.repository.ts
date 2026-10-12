import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import type {
  CandidateKind,
  CandidateSituation,
  CandidateView,
  CategoryRef,
  MonthlyPlan,
  PlanItemContext,
  PlanItemSource,
  PlanItemView,
  PlanKind,
  PlanSourceType,
} from './plans.types.js'

type Db = Pick<PoolClient, 'query'>

// Toda consulta abaixo filtra por user_id do token. Fatura não tem user_id: a posse vem do cartão
// (credit_cards.user_id), sempre via JOIN.

// Escapa % _ \ para o ILIKE tratar o termo como texto literal.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

type LancamentoKind = 'income' | 'expense'

// Colunas de cada tipo de lançamento. A DATA EFETIVA de liquidação (D1 = C) é
// COALESCE(received_date | paid_date, entry_date | expense_date): a data do caixa, com a data do
// lançamento como reserva para legados sem received_date/paid_date.
const LANCAMENTO: Record<
  LancamentoKind,
  { table: string; dateCol: string; settledCol: string; settledDateCol: string; sourceCol: string }
> = {
  income: {
    table: 'income_entries',
    dateCol: 'entry_date',
    settledCol: 'is_received',
    settledDateCol: 'received_date',
    sourceCol: 'income_entry_id',
  },
  expense: {
    table: 'expenses',
    dateCol: 'expense_date',
    settledCol: 'is_paid',
    settledDateCol: 'paid_date',
    sourceCol: 'expense_id',
  },
}

// Regra de PERÍODO de um lançamento no plano do mês (candidatos, vínculo e importação):
//  1) a data do lançamento cai no mês; OU
//  2) já liquidado e a data efetiva de liquidação cai no mês; OU
//  3) pendente atrasado de antes do mês (data < início do mês e < hoje, comparação estrita).
// s/e/t são os placeholders ($n) do início do mês, fim do mês e hoje.
function lancamentoPeriodSql(kind: LancamentoKind, alias: string, s: string, e: string, t: string) {
  const { dateCol, settledCol, settledDateCol } = LANCAMENTO[kind]
  return `(${alias}.${dateCol} BETWEEN ${s} AND ${e}
       OR (${alias}.${settledCol} AND COALESCE(${alias}.${settledDateCol}, ${alias}.${dateCol}) BETWEEN ${s} AND ${e})
       OR (NOT ${alias}.${settledCol} AND ${alias}.${dateCol} < ${s} AND ${alias}.${dateCol} < ${t}))`
}

// Fatura: vencimento no mês OU pagamento (payment_date) no mês.
function invoicePeriodSql(alias: string, s: string, e: string) {
  return `(${alias}.due_date BETWEEN ${s} AND ${e}
       OR EXISTS (SELECT 1 FROM invoice_payments ipx
                  WHERE ipx.invoice_id = ${alias}.id AND ipx.payment_date BETWEEN ${s} AND ${e}
                  AND ipx.canceled_at IS NULL))`
}

const SOURCE_COLUMN: Record<PlanSourceType, string> = {
  income_entry: 'income_entry_id',
  expense: 'expense_id',
  invoice: 'invoice_id',
}

// ---------------------------------------------------------------------------------------------
// Plano (configurações)
// ---------------------------------------------------------------------------------------------

async function findPlan(
  userId: string,
  monthStart: string,
  db: Db = pool,
): Promise<MonthlyPlan | null> {
  const result = await db.query<MonthlyPlan>(
    'SELECT * FROM monthly_plans WHERE user_id = $1 AND month = $2',
    [userId, monthStart],
  )
  return result.rows[0] ?? null
}

// Get-or-create. includeOpeningBalance = null mantém o valor gravado (ou o padrão true ao criar).
async function upsertPlan(
  userId: string,
  monthStart: string,
  includeOpeningBalance: boolean | null,
  db: Db = pool,
): Promise<MonthlyPlan> {
  const result = await db.query<MonthlyPlan>(
    `INSERT INTO monthly_plans (user_id, month, include_opening_balance)
     VALUES ($1, $2, COALESCE($3, true))
     ON CONFLICT (user_id, month)
     DO UPDATE SET include_opening_balance = COALESCE($3, monthly_plans.include_opening_balance)
     RETURNING *`,
    [userId, monthStart, includeOpeningBalance],
  )
  return result.rows[0]
}

// Trava por plano: cria o plano se preciso (ON CONFLICT DO NOTHING) e trava a linha com FOR UPDATE
// até o fim da transação. Duas requisições do mesmo (usuário, mês) — link, import, criação manual —
// passam a executar em série; a segunda enxerga o que a primeira gravou (READ COMMITTED: cada
// instrução lê um retrato novo). Precisa ser a PRIMEIRA instrução da transação.
async function lockPlan(userId: string, monthStart: string, db: Db): Promise<MonthlyPlan> {
  await db.query(
    `INSERT INTO monthly_plans (user_id, month) VALUES ($1, $2)
     ON CONFLICT (user_id, month) DO NOTHING`,
    [userId, monthStart],
  )
  const result = await db.query<MonthlyPlan>(
    'SELECT * FROM monthly_plans WHERE user_id = $1 AND month = $2 FOR UPDATE',
    [userId, monthStart],
  )
  return result.rows[0]
}

// ---------------------------------------------------------------------------------------------
// Linhas do plano (leitura com campos derivados do lançamento/fatura, numa consulta só)
// ---------------------------------------------------------------------------------------------

const ITEM_SELECT = `
  SELECT
    pi.id, pi.kind, pi.planned_date, pi.created_at, pi.updated_at,
    pi.description AS own_description, pi.category_id AS own_category_id,
    pi.planned_amount_cents AS own_amount, pi.is_essential AS own_essential,
    pi.income_entry_id, pi.expense_id, pi.invoice_id,
    ie.description AS ie_description, ie.category_id AS ie_category_id,
    ie.amount_cents AS ie_amount, ie.entry_date, ie.is_received, ie.received_date,
    ie.is_planned AS ie_is_planned,
    ex.description AS ex_description, ex.category_id AS ex_category_id,
    ex.amount_cents AS ex_amount, ex.expense_date, ex.is_paid, ex.paid_date,
    ex.is_planned AS ex_is_planned, ex.is_essential AS ex_essential,
    inv.due_date, inv.reference_month, inv.status AS inv_status,
    cc.id AS card_id, cc.name AS card_name, cc.brand AS card_brand,
    COALESCE(t.total, 0)::int AS inv_total,
    ip.payment_date AS ip_date, ip.amount_cents AS ip_amount,
    c.id AS cat_id, c.name AS cat_name, c.icon AS cat_icon
  FROM plan_items pi
  LEFT JOIN income_entries ie ON ie.id = pi.income_entry_id AND ie.user_id = pi.user_id
  LEFT JOIN expenses ex ON ex.id = pi.expense_id AND ex.user_id = pi.user_id
  LEFT JOIN invoices inv ON inv.id = pi.invoice_id
  LEFT JOIN credit_cards cc ON cc.id = inv.credit_card_id AND cc.user_id = pi.user_id
  LEFT JOIN LATERAL (
    SELECT SUM(amount_cents)::int AS total FROM installments WHERE invoice_id = inv.id
  ) t ON true
  LEFT JOIN invoice_payments ip ON ip.invoice_id = inv.id AND ip.canceled_at IS NULL
  LEFT JOIN categories c ON c.id = COALESCE(pi.category_id, ie.category_id, ex.category_id)
`

interface ItemRow {
  id: string
  kind: PlanKind
  planned_date: string | null
  created_at: Date
  updated_at: Date
  own_description: string | null
  own_category_id: string | null
  own_amount: number | null
  own_essential: boolean | null
  income_entry_id: string | null
  expense_id: string | null
  invoice_id: string | null
  ie_description: string | null
  ie_amount: number | null
  entry_date: string | null
  is_received: boolean | null
  received_date: string | null
  ie_is_planned: boolean | null
  ex_description: string | null
  ex_amount: number | null
  expense_date: string | null
  is_paid: boolean | null
  paid_date: string | null
  ex_is_planned: boolean | null
  ex_essential: boolean | null
  due_date: string | null
  reference_month: string | null
  inv_status: string | null
  card_id: string | null
  card_name: string | null
  card_brand: string | null
  inv_total: number
  ip_date: string | null
  ip_amount: number | null
  cat_id: string | null
  cat_name: string | null
  cat_icon: string | null
}

function toItemView(row: ItemRow): PlanItemView {
  const category: CategoryRef | null = row.cat_id
    ? { id: row.cat_id, name: row.cat_name as string, icon: row.cat_icon }
    : null

  if (row.income_entry_id) {
    const source: PlanItemSource = {
      type: 'income_entry',
      entry_date: row.entry_date as string,
      is_received: row.is_received as boolean,
      received_date: row.received_date,
      is_planned: row.ie_is_planned as boolean,
      current_amount_cents: row.ie_amount as number,
    }
    return base(row, 'income_entry', row.income_entry_id, {
      description: row.ie_description as string,
      amount: row.own_amount as number,
      dynamic: false,
      essential: null,
      category,
      source,
    })
  }
  if (row.expense_id) {
    const source: PlanItemSource = {
      type: 'expense',
      expense_date: row.expense_date as string,
      is_paid: row.is_paid as boolean,
      paid_date: row.paid_date,
      is_planned: row.ex_is_planned as boolean,
      current_amount_cents: row.ex_amount as number,
    }
    return base(row, 'expense', row.expense_id, {
      description: row.ex_description as string,
      amount: row.own_amount as number,
      dynamic: false,
      essential: row.ex_essential,
      category,
      source,
    })
  }
  if (row.invoice_id) {
    const source: PlanItemSource = {
      type: 'invoice',
      due_date: row.due_date as string,
      reference_month: row.reference_month as string,
      status: row.inv_status as string,
      credit_card: {
        id: row.card_id as string,
        name: row.card_name as string,
        brand: row.card_brand,
      },
      paid: row.ip_date
        ? { payment_date: row.ip_date, amount_cents: row.ip_amount as number }
        : null,
    }
    return base(row, 'invoice', row.invoice_id, {
      description: `Fatura ${row.card_name}`,
      amount: row.inv_total,
      dynamic: true,
      essential: null,
      category: null,
      source,
    })
  }
  return base(row, null, null, {
    description: row.own_description as string,
    amount: row.own_amount as number,
    dynamic: false,
    essential: row.own_essential,
    category,
    source: null,
  })
}

function base(
  row: ItemRow,
  sourceType: PlanSourceType | null,
  sourceId: string | null,
  extra: {
    description: string
    amount: number
    dynamic: boolean
    essential: boolean | null
    category: CategoryRef | null
    source: PlanItemSource | null
  },
): PlanItemView {
  return {
    id: row.id,
    kind: row.kind,
    source_type: sourceType,
    source_id: sourceId,
    description: extra.description,
    category: extra.category,
    planned_amount_cents: extra.amount,
    amount_is_dynamic: extra.dynamic,
    planned_date: row.planned_date,
    is_essential: extra.essential,
    source: extra.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const ITEM_ORDER = 'ORDER BY pi.kind, pi.planned_date NULLS LAST, pi.created_at, pi.id'

async function listItems(planId: string, userId: string, db: Db = pool): Promise<PlanItemView[]> {
  const result = await db.query<ItemRow>(
    `${ITEM_SELECT} WHERE pi.plan_id = $1 AND pi.user_id = $2 ${ITEM_ORDER}`,
    [planId, userId],
  )
  return result.rows.map(toItemView)
}

async function findItemViewsByIds(
  ids: string[],
  userId: string,
  db: Db = pool,
): Promise<PlanItemView[]> {
  if (ids.length === 0) return []
  const result = await db.query<ItemRow>(
    `${ITEM_SELECT} WHERE pi.id = ANY($1::uuid[]) AND pi.user_id = $2 ${ITEM_ORDER}`,
    [ids, userId],
  )
  return result.rows.map(toItemView)
}

// Tipo da linha e mês do plano — base da regra "o que é editável" e da validação de datas.
async function findItemContext(
  id: string,
  userId: string,
  db: Db = pool,
): Promise<PlanItemContext | null> {
  const result = await db.query<{
    id: string
    kind: PlanKind
    income_entry_id: string | null
    expense_id: string | null
    invoice_id: string | null
    month: string
  }>(
    `SELECT pi.id, pi.kind, pi.income_entry_id, pi.expense_id, pi.invoice_id, mp.month
     FROM plan_items pi
     JOIN monthly_plans mp ON mp.id = pi.plan_id AND mp.user_id = pi.user_id
     WHERE pi.id = $1 AND pi.user_id = $2`,
    [id, userId],
  )
  const row = result.rows[0]
  if (!row) return null
  const sourceType: PlanSourceType | null = row.income_entry_id
    ? 'income_entry'
    : row.expense_id
      ? 'expense'
      : row.invoice_id
        ? 'invoice'
        : null
  return { id: row.id, kind: row.kind, source_type: sourceType, plan_month: row.month.slice(0, 7) }
}

interface ManualItemData {
  kind: PlanKind
  description: string
  category_id: string | null
  planned_amount_cents: number
  planned_date: string | null
  is_essential: boolean | null
}

async function insertManualItem(
  planId: string,
  userId: string,
  data: ManualItemData,
  db: Db = pool,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO plan_items
       (plan_id, user_id, kind, description, category_id, planned_amount_cents, planned_date, is_essential)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      planId,
      userId,
      data.kind,
      data.description,
      data.category_id,
      data.planned_amount_cents,
      data.planned_date,
      data.is_essential,
    ],
  )
  return result.rows[0].id
}

async function updateItemFields(
  id: string,
  userId: string,
  fields: Record<string, unknown>,
  db: Db = pool,
): Promise<boolean> {
  const entries = Object.entries(fields)
  if (entries.length === 0) return true
  // As chaves vêm de uma lista fixa montada no service (nunca do corpo bruto).
  const assignments = entries.map(([column], index) => `${column} = $${index + 1}`)
  const values = entries.map(([, value]) => value)
  values.push(id, userId)
  const result = await db.query(
    `UPDATE plan_items SET ${assignments.join(', ')}
     WHERE id = $${entries.length + 1} AND user_id = $${entries.length + 2}`,
    values,
  )
  return (result.rowCount ?? 0) > 0
}

async function deleteItem(id: string, userId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM plan_items WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ])
  return (result.rowCount ?? 0) > 0
}

// ---------------------------------------------------------------------------------------------
// Vínculo com lançamentos e faturas
// ---------------------------------------------------------------------------------------------

export interface OwnedSource {
  type: PlanSourceType
  id: string
  amount_cents: number | null // null = fatura (valor dinâmico)
  date: string
  settled: boolean
  // Data efetiva de liquidação (lançamento) ou payment_date (fatura); null se não liquidado.
  settled_date: string | null
}

// Só devolve o que pertence ao usuário (fatura: via cartão). Ids alheios ou inexistentes somem.
async function findOwnedSources(
  userId: string,
  ids: Record<PlanSourceType, string[]>,
  db: Db = pool,
): Promise<OwnedSource[]> {
  type Row = {
    id: string
    amount_cents: number
    date: string
    settled: boolean
    settled_date: string | null
  }
  const [income, expenses, invoices] = await Promise.all([
    ids.income_entry.length
      ? db.query<Row>(
          `SELECT id, amount_cents, entry_date AS date, is_received AS settled,
                  CASE WHEN is_received THEN COALESCE(received_date, entry_date) END AS settled_date
           FROM income_entries WHERE user_id = $1 AND id = ANY($2::uuid[])`,
          [userId, ids.income_entry],
        )
      : null,
    ids.expense.length
      ? db.query<Row>(
          `SELECT id, amount_cents, expense_date AS date, is_paid AS settled,
                  CASE WHEN is_paid THEN COALESCE(paid_date, expense_date) END AS settled_date
           FROM expenses WHERE user_id = $1 AND id = ANY($2::uuid[])`,
          [userId, ids.expense],
        )
      : null,
    ids.invoice.length
      ? db.query<Omit<Row, 'amount_cents'>>(
          `SELECT i.id, i.due_date AS date, (i.status = 'paid') AS settled,
                  ip.payment_date AS settled_date
           FROM invoices i
           JOIN credit_cards cc ON cc.id = i.credit_card_id
           LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id AND ip.canceled_at IS NULL
           WHERE cc.user_id = $1 AND i.id = ANY($2::uuid[])`,
          [userId, ids.invoice],
        )
      : null,
  ])
  return [
    ...(income?.rows ?? []).map((r): OwnedSource => ({ type: 'income_entry', ...r })),
    ...(expenses?.rows ?? []).map((r): OwnedSource => ({ type: 'expense', ...r })),
    ...(invoices?.rows ?? []).map((r): OwnedSource => ({
      type: 'invoice',
      amount_cents: null,
      ...r,
    })),
  ]
}

// Origens que já estão em algum plano do usuário: chave `${type}:${id}` -> plan_id.
async function findPlannedSources(
  userId: string,
  ids: Record<PlanSourceType, string[]>,
  db: Db = pool,
): Promise<Map<string, string>> {
  const result = await db.query<{
    plan_id: string
    income_entry_id: string | null
    expense_id: string | null
    invoice_id: string | null
  }>(
    `SELECT plan_id, income_entry_id, expense_id, invoice_id
     FROM plan_items
     WHERE user_id = $1
       AND (income_entry_id = ANY($2::uuid[]) OR expense_id = ANY($3::uuid[])
            OR invoice_id = ANY($4::uuid[]))`,
    [userId, ids.income_entry, ids.expense, ids.invoice],
  )
  const map = new Map<string, string>()
  for (const row of result.rows) {
    if (row.income_entry_id) map.set(`income_entry:${row.income_entry_id}`, row.plan_id)
    if (row.expense_id) map.set(`expense:${row.expense_id}`, row.plan_id)
    if (row.invoice_id) map.set(`invoice:${row.invoice_id}`, row.plan_id)
  }
  return map
}

// Devolve o id da linha criada, ou null se a origem já estava em algum plano (índice único parcial).
async function insertLinkedItem(
  planId: string,
  userId: string,
  source: OwnedSource,
  db: Db = pool,
): Promise<string | null> {
  const column = SOURCE_COLUMN[source.type]
  const kind: PlanKind = source.type === 'income_entry' ? 'income' : 'expense'
  const result = await db.query<{ id: string }>(
    `INSERT INTO plan_items (plan_id, user_id, kind, planned_amount_cents, planned_date, ${column})
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (${column}) WHERE ${column} IS NOT NULL DO NOTHING
     RETURNING id`,
    [planId, userId, kind, source.amount_cents, source.date, source.id],
  )
  return result.rows[0]?.id ?? null
}

// ---------------------------------------------------------------------------------------------
// Candidatos (paginados no servidor)
// ---------------------------------------------------------------------------------------------

interface CandidateFilters {
  kind: CandidateKind
  status: 'pending' | 'all'
  search?: string
  monthStart: string
  monthEnd: string
  today: string
  page: number
  pageSize: number
}

interface CandidateRow {
  id: string
  description: string
  amount_cents: number
  date: string
  is_planned: boolean | null
  settled: boolean
  settled_date: string | null
  cat_id: string | null
  cat_name: string | null
  cat_icon: string | null
  card_id: string | null
  card_name: string | null
  card_brand: string | null
}

// Situação: liquidado; senão atrasado só com data ESTRITAMENTE anterior a hoje; senão pendente.
function situationOf(
  kind: CandidateKind,
  settled: boolean,
  date: string,
  today: string,
): CandidateSituation {
  if (settled) return kind === 'income' ? 'received' : 'paid'
  return date < today ? 'overdue' : 'pending'
}

async function listCandidates(
  userId: string,
  filters: CandidateFilters,
  db: Db = pool,
): Promise<{ items: CandidateView[]; total: number }> {
  const { kind } = filters
  const values: unknown[] = [userId, filters.monthStart, filters.monthEnd]
  let from: string
  let select: string
  let where: string
  let order: string

  if (kind === 'invoice') {
    from = `FROM invoices i
       JOIN credit_cards cc ON cc.id = i.credit_card_id
       LEFT JOIN LATERAL (
         SELECT SUM(amount_cents)::int AS total FROM installments WHERE invoice_id = i.id
       ) t ON true
       LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id AND ip.canceled_at IS NULL`
    select = `i.id, ('Fatura ' || cc.name) AS description, COALESCE(t.total, 0) AS amount_cents,
       i.due_date AS date, NULL::boolean AS is_planned, (i.status = 'paid') AS settled,
       ip.payment_date AS settled_date, NULL::uuid AS cat_id, NULL::text AS cat_name,
       NULL::text AS cat_icon, cc.id AS card_id, cc.name AS card_name, cc.brand AS card_brand`
    where = `cc.user_id = $1 AND ${invoicePeriodSql('i', '$2', '$3')}
       AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.invoice_id = i.id)`
    if (filters.status === 'pending') where += ` AND i.status <> 'paid'`
    if (filters.search) {
      values.push(likePattern(filters.search))
      where += ` AND (cc.name ILIKE $${values.length} ESCAPE '\\')`
    }
    order = 'ORDER BY i.due_date, i.id'
  } else {
    const { table: t, dateCol, settledCol, settledDateCol, sourceCol } = LANCAMENTO[kind]
    values.push(filters.today) // $4 (só nas consultas de lançamentos)
    from = `FROM ${t} r LEFT JOIN categories c ON c.id = r.category_id`
    select = `r.id, r.description, r.amount_cents, r.${dateCol} AS date, r.is_planned,
       r.${settledCol} AS settled,
       CASE WHEN r.${settledCol} THEN COALESCE(r.${settledDateCol}, r.${dateCol}) END AS settled_date,
       c.id AS cat_id, c.name AS cat_name, c.icon AS cat_icon,
       NULL::uuid AS card_id, NULL::text AS card_name, NULL::text AS card_brand`
    where = `r.user_id = $1
       AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.${sourceCol} = r.id)
       AND ${lancamentoPeriodSql(kind, 'r', '$2', '$3', '$4')}`
    if (filters.status === 'pending') where += ` AND NOT r.${settledCol}`
    if (filters.search) {
      values.push(likePattern(filters.search))
      where += ` AND r.description ILIKE $${values.length} ESCAPE '\\'`
    }
    order = `ORDER BY r.${dateCol}, r.id`
  }

  const count = await db.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total ${from} WHERE ${where}`,
    values,
  )
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
  const page = await db.query<CandidateRow>(
    `SELECT ${select} ${from} WHERE ${where} ${order}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )

  const items = page.rows.map((row): CandidateView => ({
    kind,
    id: row.id,
    description: row.description,
    amount_cents: row.amount_cents,
    date: row.date,
    is_planned: row.is_planned,
    situation: situationOf(kind, row.settled, row.date, filters.today),
    settled_date: row.settled_date,
    category: row.cat_id
      ? { id: row.cat_id, name: row.cat_name as string, icon: row.cat_icon }
      : null,
    credit_card: row.card_id
      ? { id: row.card_id, name: row.card_name as string, brand: row.card_brand }
      : null,
  }))
  return { items, total: count.rows[0].total }
}

// ---------------------------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------------------------

// 'planned': lançamentos com is_planned = true DENTRO DO PERÍODO do mês (mesma regra dos candidatos:
// data no mês, liquidação no mês ou pendente atrasada). include_settled (padrão true) inclui os já
// recebidos/pagos; false só os pendentes. Uma consulta de contagem (dry_run e relatório) e uma de
// inserção com o MESMO filtro.
async function countPlannedImport(
  kind: LancamentoKind,
  userId: string,
  monthStart: string,
  monthEnd: string,
  today: string,
  includeSettled: boolean,
  db: Db = pool,
): Promise<{
  to_add: number
  already: number
  settled_excluded: number
  overdue_previous: number
}> {
  const { table: t, dateCol, settledCol, sourceCol } = LANCAMENTO[kind]
  const result = await db.query<{
    to_add: number
    already: number
    settled_excluded: number
    overdue_previous: number
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE NOT in_plan AND ($5::boolean OR NOT settled))::int AS to_add,
       COUNT(*) FILTER (WHERE in_plan)::int AS already,
       COUNT(*) FILTER (WHERE NOT in_plan AND NOT $5::boolean AND settled)::int AS settled_excluded,
       COUNT(*) FILTER (WHERE NOT in_plan AND NOT settled AND d < $2)::int AS overdue_previous
     FROM (
       SELECT r.${settledCol} AS settled, r.${dateCol} AS d,
              EXISTS (SELECT 1 FROM plan_items x WHERE x.${sourceCol} = r.id) AS in_plan
       FROM ${t} r
       WHERE r.user_id = $1 AND r.is_planned AND ${lancamentoPeriodSql(kind, 'r', '$2', '$3', '$4')}
     ) s`,
    [userId, monthStart, monthEnd, today, includeSettled],
  )
  return result.rows[0]
}

async function insertPlannedImport(
  kind: LancamentoKind,
  planId: string,
  userId: string,
  monthStart: string,
  monthEnd: string,
  today: string,
  includeSettled: boolean,
  db: Db = pool,
): Promise<number> {
  const { table: t, dateCol, settledCol, sourceCol } = LANCAMENTO[kind]
  const result = await db.query(
    `INSERT INTO plan_items (plan_id, user_id, kind, planned_amount_cents, planned_date, ${sourceCol})
     SELECT $1::uuid, $2::uuid, $3::text, r.amount_cents, r.${dateCol}, r.id
     FROM ${t} r
     WHERE r.user_id = $2 AND r.is_planned AND ${lancamentoPeriodSql(kind, 'r', '$4', '$5', '$6')}
       AND ($7::boolean OR NOT r.${settledCol})
       AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.${sourceCol} = r.id)
     ORDER BY r.${dateCol}, r.id
     ON CONFLICT (${sourceCol}) WHERE ${sourceCol} IS NOT NULL DO NOTHING`,
    [planId, userId, kind, monthStart, monthEnd, today, includeSettled],
  )
  return result.rowCount ?? 0
}

// 'invoices': faturas com vencimento no mês OU pagamento no mês (posse via cartão). Pagas também
// entram (o resultado informa quantas eram pagas).
async function countInvoiceImport(
  userId: string,
  monthStart: string,
  monthEnd: string,
  db: Db = pool,
): Promise<{ to_add: number; already: number; paid_included: number }> {
  const result = await db.query<{ to_add: number; already: number; paid_included: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE NOT in_plan)::int AS to_add,
       COUNT(*) FILTER (WHERE in_plan)::int AS already,
       COUNT(*) FILTER (WHERE NOT in_plan AND paid)::int AS paid_included
     FROM (
       SELECT (i.status = 'paid') AS paid,
              EXISTS (SELECT 1 FROM plan_items x WHERE x.invoice_id = i.id) AS in_plan
       FROM invoices i JOIN credit_cards cc ON cc.id = i.credit_card_id
       WHERE cc.user_id = $1 AND ${invoicePeriodSql('i', '$2', '$3')}
     ) s`,
    [userId, monthStart, monthEnd],
  )
  return result.rows[0]
}

async function insertInvoiceImport(
  planId: string,
  userId: string,
  monthStart: string,
  monthEnd: string,
  db: Db = pool,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO plan_items (plan_id, user_id, kind, planned_amount_cents, planned_date, invoice_id)
     SELECT $1::uuid, $2::uuid, 'expense', NULL::integer, i.due_date, i.id
     FROM invoices i JOIN credit_cards cc ON cc.id = i.credit_card_id
     WHERE cc.user_id = $2 AND ${invoicePeriodSql('i', '$3', '$4')}
       AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.invoice_id = i.id)
     ORDER BY i.due_date, i.id
     ON CONFLICT (invoice_id) WHERE invoice_id IS NOT NULL DO NOTHING`,
    [planId, userId, monthStart, monthEnd],
  )
  return result.rowCount ?? 0
}

export interface FixedSourceRow {
  kind: PlanKind
  description: string
  category_id: string
  amount_cents: number
  date: string
  is_essential: boolean | null
}

// 'fixed_previous_month': lançamentos is_fixed do mês anterior (entradas e despesas). Compras no
// cartão (purchases.is_fixed) não entram: viram fatura, que tem sua própria fonte.
async function findFixedOfMonth(
  userId: string,
  monthStart: string,
  monthEnd: string,
  db: Db = pool,
): Promise<FixedSourceRow[]> {
  const result = await db.query<FixedSourceRow>(
    `SELECT kind, description, category_id, amount_cents, date, is_essential FROM (
       SELECT 'income'::text AS kind, ie.description, ie.category_id, ie.amount_cents,
              ie.entry_date AS date, NULL::boolean AS is_essential, ie.id
       FROM income_entries ie
       WHERE ie.user_id = $1 AND ie.is_fixed AND ie.entry_date BETWEEN $2 AND $3
       UNION ALL
       SELECT 'expense'::text, e.description, e.category_id, e.amount_cents,
              e.expense_date, e.is_essential, e.id
       FROM expenses e
       WHERE e.user_id = $1 AND e.is_fixed AND e.expense_date BETWEEN $2 AND $3
     ) s
     ORDER BY date, kind, id`,
    [userId, monthStart, monthEnd],
  )
  return result.rows
}

// Chaves (descrição, categoria, valor) do que o import 'planned' ADICIONARIA. Só o dry_run usa: no
// import real a deduplicação das fixas lê as linhas já inseridas.
async function listPlannedImportKeys(
  kind: LancamentoKind,
  userId: string,
  monthStart: string,
  monthEnd: string,
  today: string,
  includeSettled: boolean,
  db: Db = pool,
): Promise<{ description: string; category_id: string; amount_cents: number }[]> {
  const { table: t, settledCol, sourceCol } = LANCAMENTO[kind]
  const result = await db.query<{ description: string; category_id: string; amount_cents: number }>(
    `SELECT r.description, r.category_id, r.amount_cents
     FROM ${t} r
     WHERE r.user_id = $1 AND r.is_planned AND ${lancamentoPeriodSql(kind, 'r', '$2', '$3', '$4')}
       AND ($5::boolean OR NOT r.${settledCol})
       AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.${sourceCol} = r.id)`,
    [userId, monthStart, monthEnd, today, includeSettled],
  )
  return result.rows
}

// ---------------------------------------------------------------------------------------------
// Resumo (Bloco B): saldo por data efetiva (D1 = C) e agregados
// ---------------------------------------------------------------------------------------------

// Conversão explícita: SUM/COUNT em bigint chegam do driver pg como string.
export function toCents(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value)
}

// MESMA união de fontes de movimento do accounts.getBalance (entradas recebidas, despesas pagas,
// transferências de saída e de entrada, pagamentos de fatura e aportes em metas), agora com a DATA
// EFETIVA de cada movimento e restrita às contas ATIVAS do usuário — o mesmo conjunto que o "Saldo
// Real" do Dashboard soma. signed: + entra no caixa, - sai. Toda linha filtra por user_id via conta.
const MOVEMENTS_CTE = `
  WITH acc AS (
    SELECT id, initial_balance_cents FROM accounts WHERE user_id = $1 AND status = 'active'
  ),
  mv AS (
    SELECT 'income'::text AS kind, COALESCE(ie.received_date, ie.entry_date) AS d,
           ie.amount_cents::bigint AS signed
    FROM income_entries ie JOIN acc ON acc.id = ie.account_id
    WHERE ie.is_received AND ie.count_in_totals = true
    UNION ALL
    SELECT 'expense', COALESCE(e.paid_date, e.expense_date), -e.amount_cents::bigint
    FROM expenses e JOIN acc ON acc.id = e.account_id
    WHERE e.is_paid AND e.count_in_totals = true
    UNION ALL
    SELECT 'transfer', t.transfer_date, -t.amount_cents::bigint
    FROM transfers t JOIN acc ON acc.id = t.from_account_id
    UNION ALL
    SELECT 'transfer', t.transfer_date, t.amount_cents::bigint
    FROM transfers t JOIN acc ON acc.id = t.to_account_id
    UNION ALL
    SELECT 'invoice', ip.payment_date, -ip.amount_cents::bigint
    FROM invoice_payments ip JOIN acc ON acc.id = ip.account_id
    WHERE ip.canceled_at IS NULL
    UNION ALL
    SELECT 'goal', gc.contribution_date, -gc.amount_cents::bigint
    FROM goal_contributions gc JOIN acc ON acc.id = gc.account_id
  )`
// Saldo TOTAL (contas ativas) com todos os movimentos de data efetiva ANTERIOR a beforeDate. Com uma
// data no futuro distante devolve o saldo real de hoje (igual à soma de accounts.getBalance).
async function getTotalBalanceAsOf(
  userId: string,
  beforeDate: string,
  db: Db = pool,
): Promise<number> {
  const result = await db.query<{ balance: string }>(
    `${MOVEMENTS_CTE}
     SELECT ((SELECT COALESCE(SUM(initial_balance_cents), 0) FROM acc)
             + COALESCE(SUM(signed) FILTER (WHERE d < $2), 0))::bigint AS balance
     FROM mv`,
    [userId, beforeDate],
  )
  return toCents(result.rows[0].balance)
}

export interface MovementAggregates {
  initial: number
  before_net: number // movimentos com data efetiva < dia 1
  received: number
  expenses_paid: number
  invoice_payments: number
  goal_contributions: number
  transfers_net: number // entra - sai nas contas ativas na janela (0 entre contas ativas)
  after_net: number // movimentos da data efetiva >= after_from (liquidados depois da janela)
  all_net: number
}

// Um único agregado: abertura, janela realizada [monthStart, windowTo] e tudo depois da janela.
async function getMovementAggregates(
  userId: string,
  monthStart: string,
  windowTo: string,
  afterFrom: string,
  db: Db = pool,
): Promise<MovementAggregates> {
  const result = await db.query<Record<keyof MovementAggregates, string>>(
    `${MOVEMENTS_CTE}
     SELECT
       (SELECT COALESCE(SUM(initial_balance_cents), 0) FROM acc)::bigint AS initial,
       COALESCE(SUM(signed) FILTER (WHERE d < $2), 0)::bigint AS before_net,
       COALESCE(SUM(signed) FILTER (WHERE kind = 'income' AND d BETWEEN $2 AND $3), 0)::bigint AS received,
       COALESCE(-SUM(signed) FILTER (WHERE kind = 'expense' AND d BETWEEN $2 AND $3), 0)::bigint AS expenses_paid,
       COALESCE(-SUM(signed) FILTER (WHERE kind = 'invoice' AND d BETWEEN $2 AND $3), 0)::bigint AS invoice_payments,
       COALESCE(-SUM(signed) FILTER (WHERE kind = 'goal' AND d BETWEEN $2 AND $3), 0)::bigint AS goal_contributions,
       COALESCE(SUM(signed) FILTER (WHERE kind = 'transfer' AND d BETWEEN $2 AND $3), 0)::bigint AS transfers_net,
       COALESCE(SUM(signed) FILTER (WHERE d >= $4), 0)::bigint AS after_net,
       COALESCE(SUM(signed), 0)::bigint AS all_net
     FROM mv`,
    [userId, monthStart, windowTo, afterFrom],
  )
  const row = result.rows[0]
  return {
    initial: toCents(row.initial),
    before_net: toCents(row.before_net),
    received: toCents(row.received),
    expenses_paid: toCents(row.expenses_paid),
    invoice_payments: toCents(row.invoice_payments),
    goal_contributions: toCents(row.goal_contributions),
    transfers_net: toCents(row.transfers_net),
    after_net: toCents(row.after_net),
    all_net: toCents(row.all_net),
  }
}

// Variação líquida do caixa por dia dentro da janela realizada (linha do tempo realizada).
async function getDailyNet(
  userId: string,
  monthStart: string,
  windowTo: string,
  db: Db = pool,
): Promise<Map<string, number>> {
  const result = await db.query<{ d: string; net: string }>(
    `${MOVEMENTS_CTE}
     SELECT d, SUM(signed)::bigint AS net FROM mv
     WHERE d BETWEEN $2 AND $3
     GROUP BY d ORDER BY d`,
    [userId, monthStart, windowTo],
  )
  return new Map(result.rows.map((row) => [row.d, toCents(row.net)]))
}

export interface CategoryAmount {
  category_id: string
  name: string
  icon: string | null
  total: number
}

// Realizado por categoria = EXATAMENTE a lógica de budgets.getSpentAmount, agrupada: despesas com
// expense_date no mês (pagas e pendentes, qualquer conta) + parcelas de faturas com reference_month
// igual ao mês. Em uma consulta só (a de Orçamentos roda uma por categoria).
async function getCategorySpent(
  userId: string,
  monthStart: string,
  monthEnd: string,
  db: Db = pool,
): Promise<CategoryAmount[]> {
  const result = await db.query<{
    category_id: string
    name: string
    icon: string | null
    total: string
  }>(
    `SELECT c.id AS category_id, c.name, c.icon, s.total
     FROM (
       SELECT category_id, SUM(amount)::bigint AS total FROM (
         SELECT e.category_id, e.amount_cents AS amount
         FROM expenses e
         WHERE e.user_id = $1 AND e.expense_date BETWEEN $2 AND $3
           AND e.count_in_totals = true
         UNION ALL
         SELECT p.category_id, i.amount_cents
         FROM installments i
         JOIN invoices inv ON inv.id = i.invoice_id
         JOIN purchases p ON p.id = i.purchase_id
         WHERE p.user_id = $1 AND inv.reference_month = $2
       ) x GROUP BY category_id
     ) s JOIN categories c ON c.id = s.category_id`,
    [userId, monthStart, monthEnd],
  )
  return result.rows.map((row) => ({ ...row, total: toCents(row.total) }))
}

// Parcelas por categoria das faturas INCLUÍDAS no plano (lado planejado da comparação por
// categoria). mismatch = fatura com reference_month diferente do mês do plano.
async function getInvoiceInstallmentsByCategory(
  planId: string,
  userId: string,
  monthStart: string,
  db: Db = pool,
): Promise<(CategoryAmount & { mismatch: boolean })[]> {
  const result = await db.query<{
    category_id: string
    name: string
    icon: string | null
    mismatch: boolean
    total: string
  }>(
    `SELECT p.category_id, c.name, c.icon, (inv.reference_month <> $3::date) AS mismatch,
            SUM(i.amount_cents)::bigint AS total
     FROM plan_items pi
     JOIN invoices inv ON inv.id = pi.invoice_id
     JOIN credit_cards cc ON cc.id = inv.credit_card_id AND cc.user_id = $2
     JOIN installments i ON i.invoice_id = inv.id
     JOIN purchases p ON p.id = i.purchase_id
     JOIN categories c ON c.id = p.category_id
     WHERE pi.plan_id = $1 AND pi.user_id = $2
     GROUP BY p.category_id, c.name, c.icon, (inv.reference_month <> $3::date)`,
    [planId, userId, monthStart],
  )
  return result.rows.map((row) => ({ ...row, total: toCents(row.total) }))
}

export interface NotInPlanAlerts {
  pending_income_count: number
  pending_income_cents: number
  pending_expense_count: number
  pending_expense_cents: number
  invoices_count: number
  invoices_cents: number
}

// "Fora do plano": pendentes (do mês ou atrasados) e faturas a pagar com vencimento no mês que NÃO
// estão em nenhum plano — mesma base dos candidatos com status=pending.
async function getNotInPlanAlerts(
  userId: string,
  monthStart: string,
  monthEnd: string,
  today: string,
  db: Db = pool,
): Promise<NotInPlanAlerts> {
  const pending = (kind: LancamentoKind) => {
    const { table, settledCol, sourceCol } = LANCAMENTO[kind]
    return `FROM ${table} r
       WHERE r.user_id = $1 AND NOT r.${settledCol} AND r.count_in_totals = true
         AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.${sourceCol} = r.id)
         AND ${lancamentoPeriodSql(kind, 'r', '$2', '$3', '$4')}`
  }
  const result = await db.query<Record<keyof NotInPlanAlerts, string>>(
    `SELECT
       (SELECT COUNT(*) ${pending('income')})::bigint AS pending_income_count,
       (SELECT COALESCE(SUM(r.amount_cents), 0) ${pending('income')})::bigint AS pending_income_cents,
       (SELECT COUNT(*) ${pending('expense')})::bigint AS pending_expense_count,
       (SELECT COALESCE(SUM(r.amount_cents), 0) ${pending('expense')})::bigint AS pending_expense_cents,
       (SELECT COUNT(*)
          FROM invoices i JOIN credit_cards cc ON cc.id = i.credit_card_id
          WHERE cc.user_id = $1 AND i.status <> 'paid' AND i.due_date BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.invoice_id = i.id))::bigint AS invoices_count,
       (SELECT COALESCE(SUM(ins.amount_cents), 0)
          FROM invoices i
          JOIN credit_cards cc ON cc.id = i.credit_card_id
          JOIN installments ins ON ins.invoice_id = i.id
          WHERE cc.user_id = $1 AND i.status <> 'paid' AND i.due_date BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM plan_items x WHERE x.invoice_id = i.id))::bigint AS invoices_cents`,
    [userId, monthStart, monthEnd, today],
  )
  const row = result.rows[0]
  return {
    pending_income_count: toCents(row.pending_income_count),
    pending_income_cents: toCents(row.pending_income_cents),
    pending_expense_count: toCents(row.pending_expense_count),
    pending_expense_cents: toCents(row.pending_expense_cents),
    invoices_count: toCents(row.invoices_count),
    invoices_cents: toCents(row.invoices_cents),
  }
}

export interface PendingBeforeMonth {
  income_cents: number
  expense_cents: number
  invoice_cents: number
  count: number
}

// Pendências REAIS do sistema (não só linhas do plano) ainda não liquidadas com data de lançamento /
// vencimento ANTERIOR ao início do mês: entradas e despesas das contas ativas (o mesmo conjunto do
// saldo, D6) e faturas não pagas dos cartões do usuário (total das parcelas). Serve de aviso no mês
// futuro: a abertura só reflete o que já foi liquidado, então estas pendências não estão nela.
async function getPendingBeforeMonth(
  userId: string,
  monthStart: string,
  db: Db = pool,
): Promise<PendingBeforeMonth> {
  const result = await db.query<Record<keyof PendingBeforeMonth, string>>(
    `WITH acc AS (SELECT id FROM accounts WHERE user_id = $1 AND status = 'active')
     SELECT
       (SELECT COALESCE(SUM(ie.amount_cents), 0) FROM income_entries ie JOIN acc ON acc.id = ie.account_id
         WHERE ie.user_id = $1 AND NOT ie.is_received AND ie.entry_date < $2 AND ie.count_in_totals = true)::bigint AS income_cents,
       (SELECT COALESCE(SUM(e.amount_cents), 0) FROM expenses e JOIN acc ON acc.id = e.account_id
         WHERE e.user_id = $1 AND NOT e.is_paid AND e.expense_date < $2 AND e.count_in_totals = true)::bigint AS expense_cents,
       (SELECT COALESCE(SUM(ins.amount_cents), 0)
         FROM invoices i
         JOIN credit_cards cc ON cc.id = i.credit_card_id
         JOIN installments ins ON ins.invoice_id = i.id
         WHERE cc.user_id = $1 AND i.status <> 'paid' AND i.due_date < $2)::bigint AS invoice_cents,
       ((SELECT COUNT(*) FROM income_entries ie JOIN acc ON acc.id = ie.account_id
         WHERE ie.user_id = $1 AND NOT ie.is_received AND ie.entry_date < $2 AND ie.count_in_totals = true)
       + (SELECT COUNT(*) FROM expenses e JOIN acc ON acc.id = e.account_id
         WHERE e.user_id = $1 AND NOT e.is_paid AND e.expense_date < $2 AND e.count_in_totals = true)
       + (SELECT COUNT(*) FROM invoices i JOIN credit_cards cc ON cc.id = i.credit_card_id
         WHERE cc.user_id = $1 AND i.status <> 'paid' AND i.due_date < $2))::bigint AS count`,
    [userId, monthStart],
  )
  const row = result.rows[0]
  return {
    income_cents: toCents(row.income_cents),
    expense_cents: toCents(row.expense_cents),
    invoice_cents: toCents(row.invoice_cents),
    count: toCents(row.count),
  }
}

export const plansRepository = {
  findPlan,
  upsertPlan,
  lockPlan,
  listItems,
  findItemViewsByIds,
  findItemContext,
  insertManualItem,
  updateItemFields,
  deleteItem,
  findOwnedSources,
  findPlannedSources,
  insertLinkedItem,
  listCandidates,
  countPlannedImport,
  insertPlannedImport,
  countInvoiceImport,
  insertInvoiceImport,
  findFixedOfMonth,
  listPlannedImportKeys,
  getTotalBalanceAsOf,
  getMovementAggregates,
  getDailyNet,
  getCategorySpent,
  getInvoiceInstallmentsByCategory,
  getNotInPlanAlerts,
  getPendingBeforeMonth,
}
