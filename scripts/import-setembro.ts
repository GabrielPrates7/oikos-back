// Script de importação de dados reais — Setembro/2026.
//
// Tudo passa pela API HTTP real (mesma validação e regra de negócio de qualquer uso
// normal do sistema), autenticado como o usuário de verdade via login interativo.
// NUNCA faz INSERT direto no banco, nunca hardcoda credenciais, nunca salva o token em
// disco (fica só em memória, na variável `accessToken`, durante a execução do processo).
//
// Dado real e definitivo — não é cenário de teste, não é pra ser limpo depois.
// NÃO rode duas vezes: cada POST cria uma linha nova, então rodar de novo duplicaria
// categorias, contas, cartões, lançamentos e compras. O script se recusa a rodar se
// detectar que já foi executado antes (categoria "Faculdade" já existente).
//
// Uso: npx tsx scripts/import-setembro.ts

import { createInterface } from 'node:readline/promises'

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api'

let accessToken: string | null = null

// ---------------------------------------------------------------------------
// Prompt interativo (e-mail visível, senha mascarada — sem dependência externa).
// Códigos de controle construídos via fromCharCode, nunca como byte cru no
// arquivo-fonte, pra não depender de como o editor/terminal serializa
// caracteres não-imprimíveis.
// ---------------------------------------------------------------------------

const CTRL_C = String.fromCharCode(3)
const CTRL_D = String.fromCharCode(4)
const BACKSPACE_BS = String.fromCharCode(8)
const BACKSPACE_DEL = String.fromCharCode(127)

async function promptEmail(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const email = await rl.question('E-mail: ')
  rl.close()
  return email.trim()
}

function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    let buffered = ''

    process.stdout.write('Senha: ')

    const isTTY = stdin.isTTY === true
    if (isTTY) stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    function onData(chunk: string) {
      const code = chunk.toString()

      if (code === '\n' || code === '\r' || code === CTRL_D) {
        if (isTTY) stdin.setRawMode(false)
        stdin.removeListener('data', onData)
        stdin.pause()
        process.stdout.write('\n')
        resolve(buffered)
        return
      }

      if (code === CTRL_C) {
        process.stdout.write('\n')
        process.exit(1)
      }

      if (code === BACKSPACE_BS || code === BACKSPACE_DEL) {
        buffered = buffered.slice(0, -1)
        return
      }

      buffered += code
    }

    stdin.on('data', onData)
  })
}

// ---------------------------------------------------------------------------
// Cliente HTTP fino — todas as chamadas passam por aqui, com o token em memória
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    method: string,
    path: string,
  ) {
    super(`${method} ${path} -> ${status}: ${JSON.stringify(body)}`)
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  const json = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    throw new ApiError(res.status, json, method, path)
  }

  return json as T
}

function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ---------------------------------------------------------------------------
// Tipos mínimos das respostas que este script consome
// ---------------------------------------------------------------------------

interface Category {
  id: string
  user_id: string | null
  name: string
  type: 'income' | 'expense'
}

interface Account {
  id: string
  name: string
  initial_balance_cents: number
}

interface CreditCard {
  id: string
  name: string
}

interface Invoice {
  id: string
  credit_card_id: string
  reference_month: string
  status: string
  displayStatus: string
  totalCents: number
}

interface Budget {
  id: string
  category_id: string
  limit_amount_cents: number
  spentCents: number
  percentageUsed: number
}

// ---------------------------------------------------------------------------
// Passo 1: login
// ---------------------------------------------------------------------------

async function login(): Promise<void> {
  console.log('\n==> Passo 1: login')
  const email = await promptEmail()
  const password = await promptPassword()

  const result = await req<{ user: { id: string; name: string }; accessToken: string }>(
    'POST',
    '/auth/login',
    { email, password },
  )
  accessToken = result.accessToken
  console.log(`Login OK — ${result.user.name}`)
}

// ---------------------------------------------------------------------------
// Guarda contra execução duplicada
// ---------------------------------------------------------------------------

async function assertNotAlreadyImported(): Promise<void> {
  const { categories } = await req<{ categories: Category[] }>('GET', '/categories')
  const alreadyImported = categories.some(
    (c) => c.name === 'Faculdade' && c.type === 'expense' && c.user_id !== null,
  )
  if (alreadyImported) {
    throw new Error(
      'Categoria "Faculdade" já existe para este usuário — parece que este import já ' +
        'rodou antes. Abortando pra não duplicar tudo. Confirme antes de rodar de novo.',
    )
  }
}

// ---------------------------------------------------------------------------
// Passo 2: categorias novas
// ---------------------------------------------------------------------------

const NEW_CATEGORIES: { name: string; type: 'income' | 'expense' }[] = [
  { name: 'Faculdade', type: 'expense' },
  { name: 'Academia', type: 'expense' },
  { name: 'Corte de Cabelo', type: 'expense' },
  { name: 'Dízimo', type: 'expense' },
  { name: 'Assinaturas', type: 'expense' },
  { name: 'Empréstimo', type: 'expense' },
  { name: 'Moto', type: 'expense' },
  { name: 'Presente', type: 'expense' },
  { name: 'Auto Cuidado', type: 'expense' },
  { name: 'Combustível', type: 'expense' },
  { name: 'Comissão', type: 'income' },
]

async function createCategories(): Promise<void> {
  console.log('\n==> Passo 2: categorias')
  for (const def of NEW_CATEGORIES) {
    await req('POST', '/categories', { name: def.name, type: def.type })
    console.log(`  criada: ${def.name} (${def.type})`)
  }
}

// Uma única leitura depois de criar tudo — cobre categorias novas e padrão (user_id null)
// na mesma chamada, sem precisar de dois mecanismos de lookup diferentes.
async function loadCategoryMap(): Promise<Map<string, string>> {
  const { categories } = await req<{ categories: Category[] }>('GET', '/categories')
  const map = new Map<string, string>()
  for (const category of categories) {
    map.set(`${category.name}::${category.type}`, category.id)
  }
  return map
}

function categoryId(map: Map<string, string>, name: string, type: 'income' | 'expense'): string {
  const id = map.get(`${name}::${type}`)
  if (!id) throw new Error(`categoria não encontrada: ${name} (${type})`)
  return id
}

// ---------------------------------------------------------------------------
// Passo 3: contas
// ---------------------------------------------------------------------------

const ACCOUNT_DEFS: { name: string; bankName: string; initialBalanceCents: number }[] = [
  { name: 'Nubank', bankName: 'Nubank', initialBalanceCents: 28538 },
  { name: 'PicPay', bankName: 'PicPay', initialBalanceCents: 39371 },
  { name: 'Bradesco', bankName: 'Bradesco', initialBalanceCents: 4610 },
]

const TARGET_BALANCE_CENTS: Record<string, number> = {
  Nubank: 28538,
  PicPay: 39371,
  Bradesco: 4610,
}

async function createAccounts(): Promise<Map<string, string>> {
  console.log('\n==> Passo 3: contas')
  const map = new Map<string, string>()
  for (const def of ACCOUNT_DEFS) {
    const { account } = await req<{ account: Account }>('POST', '/accounts', {
      name: def.name,
      bank_name: def.bankName,
      type: 'checking',
      initial_balance_cents: def.initialBalanceCents,
    })
    map.set(def.name, account.id)
    console.log(
      `  criada: ${def.name} (saldo inicial provisório ${centsToBRL(def.initialBalanceCents)})`,
    )
  }
  return map
}

// ---------------------------------------------------------------------------
// Passo 4: cartões
// ---------------------------------------------------------------------------

const CREDIT_CARD_DEFS: {
  name: string
  creditLimitCents: number
  closingDay: number
  dueDay: number
}[] = [
  { name: 'Nubank', creditLimitCents: 765000, closingDay: 16, dueDay: 23 },
  { name: 'PicPay', creditLimitCents: 196600, closingDay: 29, dueDay: 5 },
]

async function createCreditCards(): Promise<Map<string, string>> {
  console.log('\n==> Passo 4: cartões')
  const map = new Map<string, string>()
  for (const def of CREDIT_CARD_DEFS) {
    const { creditCard } = await req<{ creditCard: CreditCard }>('POST', '/credit-cards', {
      name: def.name,
      credit_limit_cents: def.creditLimitCents,
      closing_day: def.closingDay,
      due_day: def.dueDay,
    })
    map.set(def.name, creditCard.id)
    console.log(`  criado: ${def.name}`)
  }
  return map
}

// ---------------------------------------------------------------------------
// Passo 5: entrada
// ---------------------------------------------------------------------------

async function createIncome(accounts: Map<string, string>, categories: Map<string, string>) {
  console.log('\n==> Passo 5: entrada')
  await req('POST', '/income-entries', {
    account_id: accounts.get('Nubank'),
    category_id: categoryId(categories, 'Salário', 'income'),
    description: 'Salário',
    amount_cents: 217198,
    entry_date: '2026-09-05',
  })
  console.log('  Salário lançado na Nubank')
}

// ---------------------------------------------------------------------------
// Passo 6: despesas diretas
// ---------------------------------------------------------------------------

const DIRECT_EXPENSES: {
  account: string
  category: string
  categoryType: 'expense'
  description: string
  amountCents: number
  expenseDate: string
  paymentMethod: 'debit' | 'pix'
}[] = [
  {
    account: 'Bradesco',
    category: 'Faculdade',
    categoryType: 'expense',
    description: 'Boleto Faculdade',
    amountCents: 41200,
    expenseDate: '2026-09-03',
    paymentMethod: 'debit',
  },
  {
    account: 'Nubank',
    category: 'Academia',
    categoryType: 'expense',
    description: 'Academia Performance Sanitária',
    amountCents: 9000,
    expenseDate: '2026-09-04',
    paymentMethod: 'pix',
  },
  {
    account: 'Nubank',
    category: 'Contas',
    categoryType: 'expense',
    description: 'Conta VIVO',
    amountCents: 4400,
    expenseDate: '2026-09-06',
    paymentMethod: 'debit',
  },
  {
    account: 'Nubank',
    category: 'Corte de Cabelo',
    categoryType: 'expense',
    description: 'Corte de cabelo',
    amountCents: 3500,
    expenseDate: '2026-09-07',
    paymentMethod: 'pix',
  },
  {
    account: 'Nubank',
    category: 'Dízimo',
    categoryType: 'expense',
    description: 'Dízimo + Oferta',
    amountCents: 26720,
    expenseDate: '2026-09-08',
    paymentMethod: 'debit',
  },
  {
    account: 'Nubank',
    category: 'Assinaturas',
    categoryType: 'expense',
    description: 'YouTube Premium',
    amountCents: 1690,
    expenseDate: '2026-09-09',
    paymentMethod: 'debit',
  },
  {
    account: 'Nubank',
    category: 'Empréstimo',
    categoryType: 'expense',
    description: 'Empréstimo Nubank',
    amountCents: 56284,
    expenseDate: '2026-09-10',
    paymentMethod: 'debit',
  },
]

async function createDirectExpenses(
  accounts: Map<string, string>,
  categories: Map<string, string>,
) {
  console.log('\n==> Passo 6: despesas diretas')
  for (const def of DIRECT_EXPENSES) {
    await req('POST', '/expenses', {
      account_id: accounts.get(def.account),
      category_id: categoryId(categories, def.category, def.categoryType),
      description: def.description,
      amount_cents: def.amountCents,
      payment_method: def.paymentMethod,
      expense_date: def.expenseDate,
    })
    console.log(`  ${def.description} (${centsToBRL(def.amountCents)}) — ${def.account}`)
  }
}

// ---------------------------------------------------------------------------
// Passo 7: orçamentos
// ---------------------------------------------------------------------------

const BUDGET_DEFS: { category: string; limitAmountCents: number }[] = [
  { category: 'Transporte', limitAmountCents: 9000 },
  { category: 'Alimentação', limitAmountCents: 12000 },
  { category: 'Lazer', limitAmountCents: 15000 },
]

async function createBudgets(categories: Map<string, string>) {
  console.log('\n==> Passo 7: orçamentos')
  for (const def of BUDGET_DEFS) {
    await req('POST', '/budgets', {
      categoryId: categoryId(categories, def.category, 'expense'),
      referenceMonth: '2026-09',
      limitAmountCents: def.limitAmountCents,
    })
    console.log(`  ${def.category}: limite ${centsToBRL(def.limitAmountCents)}`)
  }
}

// ---------------------------------------------------------------------------
// Passo 8: recalibração de saldo
// ---------------------------------------------------------------------------

async function recalibrateBalances(accounts: Map<string, string>) {
  console.log('\n==> Passo 8: recalibração de saldo')

  for (const [name, accountId] of accounts) {
    const target = TARGET_BALANCE_CENTS[name]
    const { balanceCents: calculated } = await req<{ accountId: string; balanceCents: number }>(
      'GET',
      `/accounts/${accountId}/balance`,
    )
    const delta = target - calculated
    console.log(
      `  ${name}: calculado ${centsToBRL(calculated)}, alvo ${centsToBRL(target)}, delta ${centsToBRL(delta)}`,
    )

    if (delta !== 0) {
      const { account } = await req<{ account: Account }>('GET', `/accounts/${accountId}`)
      const newInitialBalance = account.initial_balance_cents + delta
      await req('PUT', `/accounts/${accountId}`, { initial_balance_cents: newInitialBalance })
      console.log(`    initial_balance_cents ajustado para ${centsToBRL(newInitialBalance)}`)
    }
  }

  console.log('  reconferindo...')
  for (const [name, accountId] of accounts) {
    const target = TARGET_BALANCE_CENTS[name]
    const { balanceCents } = await req<{ accountId: string; balanceCents: number }>(
      'GET',
      `/accounts/${accountId}/balance`,
    )
    if (balanceCents !== target) {
      throw new Error(
        `Recalibração falhou pra ${name}: esperado ${centsToBRL(target)}, obtido ${centsToBRL(balanceCents)}`,
      )
    }
    console.log(`  ${name}: OK (${centsToBRL(balanceCents)})`)
  }
}

// ---------------------------------------------------------------------------
// Passo 9: compra parcelada
// ---------------------------------------------------------------------------

async function createInstallmentPurchase(
  cards: Map<string, string>,
  categories: Map<string, string>,
) {
  console.log('\n==> Passo 9: compra parcelada (Nubank)')
  await req('POST', '/purchases', {
    credit_card_id: cards.get('Nubank'),
    category_id: categoryId(categories, 'Auto Cuidado', 'expense'),
    description: 'Poco X8 Pro Max',
    total_amount_cents: 207000,
    installments_count: 12,
    purchase_date: '2026-06-12',
  })
  console.log('  Poco X8 Pro Max — 12x, total ' + centsToBRL(207000))
}

// ---------------------------------------------------------------------------
// Passo 10: compras à vista no PicPay
// ---------------------------------------------------------------------------

const PICPAY_PURCHASES: {
  category: string
  description: string
  amountCents: number
  date: string
}[] = [
  {
    category: 'Combustível',
    description: 'Gasolina - Rede Havana Rr Divinopolis',
    amountCents: 1279,
    date: '2026-08-02',
  },
  {
    category: 'Alimentação',
    description: 'Emporio & Sorveteria Arcos',
    amountCents: 1000,
    date: '2026-08-03',
  },
  {
    category: 'Alimentação',
    description: 'Jrm Produtos Mineiros - coca unifor',
    amountCents: 350,
    date: '2026-08-03',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora Leao Ltd',
    amountCents: 292,
    date: '2026-08-06',
  },
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda',
    amountCents: 1200,
    date: '2026-08-07',
  },
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda',
    amountCents: 1725,
    date: '2026-08-07',
  },
  {
    category: 'Presente',
    description: 'Maxpro Franquias - Presente dia dos pais',
    amountCents: 3499,
    date: '2026-08-07',
  },
  { category: 'Alimentação', description: 'Agua Na Boca', amountCents: 2350, date: '2026-08-08' },
  {
    category: 'Alimentação',
    description: 'Lanches Kikao Ltda',
    amountCents: 3100,
    date: '2026-08-09',
  },
  {
    category: 'Alimentação',
    description: 'Rede Havana Rr Divinopolis',
    amountCents: 1720,
    date: '2026-08-09',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora Leao Ltd',
    amountCents: 1095,
    date: '2026-08-11',
  },
  {
    category: 'Alimentação',
    description: 'Hot Dog Dona Rosa Formiga',
    amountCents: 2000,
    date: '2026-08-12',
  },
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda',
    amountCents: 530,
    date: '2026-08-13',
  },
  {
    category: 'Alimentação',
    description: 'Jrm Produtos Mineiros',
    amountCents: 950,
    date: '2026-08-13',
  },
  {
    category: 'Alimentação',
    description: 'Mp *padariasaojud',
    amountCents: 900,
    date: '2026-08-14',
  },
  {
    category: 'Saúde',
    description: 'Drogaria e Perfumaria Arcos',
    amountCents: 2400,
    date: '2026-08-14',
  },
  {
    category: 'Alimentação',
    description: 'Ifd*joao Paulo Teixeir',
    amountCents: 2424,
    date: '2026-08-15',
  },
  {
    category: 'Alimentação',
    description: 'Rede Havana Rr Divinopolis',
    amountCents: 2129,
    date: '2026-08-16',
  },
  {
    category: 'Alimentação',
    description: 'Iarareginavieira',
    amountCents: 1575,
    date: '2026-08-16',
  },
  {
    category: 'Alimentação',
    description: 'Mp *padariasaojud',
    amountCents: 900,
    date: '2026-08-17',
  },
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda',
    amountCents: 1450,
    date: '2026-08-17',
  },
  {
    category: 'Alimentação',
    description: 'Mp *virginia Formiga',
    amountCents: 950,
    date: '2026-08-17',
  },
  { category: 'Alimentação', description: 'Akitanda', amountCents: 530, date: '2026-08-18' },
  {
    category: 'Alimentação',
    description: 'Mp *padariasaojud',
    amountCents: 650,
    date: '2026-08-18',
  },
  {
    category: 'Alimentação',
    description: 'Jrm Produtos Mineiros',
    amountCents: 350,
    date: '2026-08-19',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora Leao Ltd',
    amountCents: 405,
    date: '2026-08-20',
  },
  {
    category: 'Alimentação',
    description: 'DI*google Claude Sao Paulo',
    amountCents: 11000,
    date: '2026-08-22',
  },
  {
    category: 'Alimentação',
    description: 'Posto Teixeirinha Ltd',
    amountCents: 2400,
    date: '2026-08-23',
  },
  {
    category: 'Alimentação',
    description: 'Raia Drogasil Sa',
    amountCents: 6966,
    date: '2026-08-24',
  },
  {
    category: 'Alimentação',
    description: 'Pastelaria da Praca',
    amountCents: 1200,
    date: '2026-08-24',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora Leao Ltd',
    amountCents: 1450,
    date: '2026-08-25',
  },
  {
    category: 'Alimentação',
    description: 'Jrm Produtos Mineiros',
    amountCents: 350,
    date: '2026-08-26',
  },
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda',
    amountCents: 610,
    date: '2026-08-26',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora Leao Ltd',
    amountCents: 1734,
    date: '2026-08-27',
  },
  {
    category: 'Alimentação',
    description: 'Mp *virginia Formiga',
    amountCents: 350,
    date: '2026-08-27',
  },
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda',
    amountCents: 540,
    date: '2026-08-28',
  },
]

async function createPicPayPurchases(
  cards: Map<string, string>,
  categories: Map<string, string>,
) {
  console.log(`\n==> Passo 10: ${PICPAY_PURCHASES.length} compras à vista no PicPay`)
  const picpayId = cards.get('PicPay')
  let index = 0
  for (const def of PICPAY_PURCHASES) {
    index += 1
    await req('POST', '/purchases', {
      credit_card_id: picpayId,
      category_id: categoryId(categories, def.category, 'expense'),
      description: def.description,
      total_amount_cents: def.amountCents,
      installments_count: 1,
      purchase_date: def.date,
    })
    console.log(
      `  [${index}/${PICPAY_PURCHASES.length}] ${def.description} (${centsToBRL(def.amountCents)})`,
    )
  }
}

// ---------------------------------------------------------------------------
// Passo 11: relatório final
// ---------------------------------------------------------------------------

async function printReport(accounts: Map<string, string>, cards: Map<string, string>) {
  console.log('\n==> Passo 11: relatório final')

  console.log('\n-- Saldo das contas --')
  for (const [name, accountId] of accounts) {
    const { balanceCents } = await req<{ accountId: string; balanceCents: number }>(
      'GET',
      `/accounts/${accountId}/balance`,
    )
    console.log(`  ${name}: ${centsToBRL(balanceCents)}`)
  }

  console.log('\n-- Limite disponível dos cartões --')
  for (const [name, cardId] of cards) {
    const { availableLimitCents } = await req<{
      creditCardId: string
      availableLimitCents: number
    }>('GET', `/credit-cards/${cardId}/available-limit`)
    console.log(`  ${name}: ${centsToBRL(availableLimitCents)}`)
  }

  console.log('\n-- Orçamentos de Setembro/2026 --')
  const { budgets } = await req<{ budgets: Budget[] }>('GET', '/budgets?month=2026-09')
  for (const budget of budgets) {
    console.log(
      `  limite ${centsToBRL(budget.limit_amount_cents)} · gasto ${centsToBRL(budget.spentCents)} (${budget.percentageUsed}%)`,
    )
  }

  console.log('\n-- Fatura do PicPay --')
  const picpayId = cards.get('PicPay')
  const { invoices } = await req<{ invoices: Invoice[] }>(
    'GET',
    `/invoices?creditCardId=${picpayId}`,
  )
  const picpayTotal = PICPAY_PURCHASES.reduce((sum, p) => sum + p.amountCents, 0)
  for (const invoice of invoices) {
    console.log(
      `  ref. ${invoice.reference_month} · total ${centsToBRL(invoice.totalCents)} · status ${invoice.displayStatus}`,
    )
  }
  console.log(`  (soma local das 36 compras, pra conferência: ${centsToBRL(picpayTotal)})`)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let lastStep = 'login'
  try {
    await login()

    lastStep = 'verificação de execução duplicada'
    await assertNotAlreadyImported()

    lastStep = 'passo 2 (categorias)'
    await createCategories()
    const categories = await loadCategoryMap()

    lastStep = 'passo 3 (contas)'
    const accounts = await createAccounts()

    lastStep = 'passo 4 (cartões)'
    const cards = await createCreditCards()

    lastStep = 'passo 5 (entrada)'
    await createIncome(accounts, categories)

    lastStep = 'passo 6 (despesas diretas)'
    await createDirectExpenses(accounts, categories)

    lastStep = 'passo 7 (orçamentos)'
    await createBudgets(categories)

    lastStep = 'passo 8 (recalibração de saldo)'
    await recalibrateBalances(accounts)

    lastStep = 'passo 9 (compra parcelada)'
    await createInstallmentPurchase(cards, categories)

    lastStep = 'passo 10 (compras à vista no PicPay)'
    await createPicPayPurchases(cards, categories)

    lastStep = 'passo 11 (relatório final)'
    await printReport(accounts, cards)

    console.log('\n✔ Import concluído com sucesso.')
  } catch (error) {
    console.error(`\n✘ FALHOU em: ${lastStep}`)
    if (error instanceof Error) {
      console.error(`  ${error.message}`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  }
}

void main()
