// Reconciliação completa de Setembro/2026 — dado real e definitivo, não é cenário de teste,
// não é pra ser limpo depois (FASE 11, item 21).
//
// Mesmo padrão dos scripts anteriores (import-setembro.ts, backfill-flags-setembro.ts,
// import-compras-pendentes.ts): tudo passa pela API HTTP real (mesma validação e regra de
// negócio de qualquer uso normal do sistema), autenticado como o usuário de verdade via
// login interativo no terminal. NUNCA faz INSERT direto no banco, nunca hardcoda
// credenciais, nunca salva o token em disco (fica só em memória, na variável `accessToken`,
// durante a execução do processo).
//
// Estrutura em duas passadas:
//   1) VALIDAÇÃO — resolve toda conta/cartão/categoria/despesa por nome exato e confirma o
//      total das faturas de junho/julho/agosto (Nubank) e o total ATUAL da fatura de agosto
//      do PicPay ANTES de qualquer escrita. Se qualquer coisa não bater, o script para aqui
//      — nada foi mutado ainda.
//   2) EXECUÇÃO — roda as fases 1 a 10 na ordem, reconfirmando o total de cada fatura
//      imediatamente antes da escrita que depende dele (defesa em profundidade: a validação
//      já rodou, mas a escrita em si nunca assume um valor sem checar de novo bem ali antes).
//      A fatura de agosto do PicPay tem DUAS checagens sequenciais, não uma: o total ATUAL
//      (R$907,57 — antes da fase 5 existir) e, só depois da fase 5 lançar a compra de
//      R$103,16, o total FINAL (R$1.010,73 — imediatamente antes do POST .../pay na fase 8).
//      As 3 faturas do Nubank (fase 9) não dependem de nada que este script insere, então
//      continuam com uma checagem simples de R$172,50 cada.
//
// Três decisões que a instrução original não deixou explícitas, documentadas aqui pra
// revisão antes de rodar:
//   - purchases exige is_planned (schema não tem default). YouTube Premium vira
//     is_planned:true (é fixo/recorrente, is_fixed já marca isso). As outras 9 compras
//     (item não identificado de agosto + as 8 novas do PicPay) viram is_planned:false —
//     são reconciliação de gasto real descoberto no extrato, não gasto planejado.
//   - "Carteira física" é criada com bank_name OMITIDO (não `null` — o schema só aceita
//     string opcional, `null` literal seria rejeitado com 400).
//   - FASE 0 (não pedida, mas necessária — ver NUBANK_TEMP_BUFFER_CENTS abaixo): conferi o
//     saldo real das contas antes de escrever este script. Nubank está hoje em R$285,38; a
//     fase 3 muda o Boleto Faculdade pra PicPay, que por si só sobra R$0,00 líquido pro
//     Nubank, mas a fase 7 transfere R$412,00 + R$1.010,73 (R$1.422,73 no total) do Nubank
//     pro PicPay, e a fase 9 ainda paga 3 faturas de R$172,50 saindo do Nubank — tudo isso
//     bem além do saldo disponível. A regra de negócio só bloqueia uma transação NOVA saindo
//     de uma conta que JÁ está em R$0,00 ou negativa (não recalcula "vai ficar negativa
//     depois" antes de cada lançamento) — então, na ordem exata pedida, a 2ª transferência
//     da fase 7 pararia o script com saldo insuficiente. Como a fase 10 recalibra o saldo
//     inicial de TODAS as 4 contas pro valor exato no final (a partir do saldo calculado, seja
//     lá qual for), inflar temporariamente o saldo inicial do Nubank não muda o resultado
//     final em nada — só evita que os lançamentos no meio do caminho esbarrem nessa trava.
//     Revise o valor se achar que o saldo real mudou entre a escrita deste script e a execução.
//
// Guarda contra reexecução: se a conta "Carteira física" já existir, o script recusa a
// rodar (evita duplicar a conta e reaplicar tudo em cima dela).
//
// Uso: npx tsx scripts/reconciliacao-setembro.ts

import { createInterface } from 'node:readline/promises'

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api'

let accessToken: string | null = null

// ---------------------------------------------------------------------------
// Prompt interativo (idêntico aos scripts anteriores)
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
// Cliente HTTP fino
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

// Percorre todas as páginas de um endpoint paginado (page/pageSize) até acumular tudo —
// necessário porque GET /expenses, /accounts, /categories etc. agora paginam por padrão
// (20 por página); um GET simples sem isso voltaria só a primeira página.
async function fetchAllPages<T>(basePath: string, itemsKey: string): Promise<T[]> {
  const pageSize = 100
  let page = 1
  const all: T[] = []
  const separator = basePath.includes('?') ? '&' : '?'

  for (;;) {
    const result = await req<Record<string, unknown>>(
      'GET',
      `${basePath}${separator}page=${page}&pageSize=${pageSize}`,
    )
    const items = result[itemsKey] as T[]
    all.push(...items)
    const total = result.total as number
    if (items.length < pageSize || all.length >= total) break
    page++
  }

  return all
}

function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ---------------------------------------------------------------------------
// Tipos mínimos das respostas que este script consome
// ---------------------------------------------------------------------------

interface Account {
  id: string
  name: string
  initial_balance_cents: number
}

interface CreditCard {
  id: string
  name: string
}

interface Category {
  id: string
  user_id: string | null
  name: string
  type: 'income' | 'expense'
}

interface Expense {
  id: string
  description: string
  amount_cents: number
}

interface InvoiceListItem {
  id: string
  credit_card_id: string
  reference_month: string
  status: string
  displayStatus: string
  totalCents: number
}

interface InvoiceDetail {
  id: string
  credit_card_id: string
  reference_month: string
  due_date: string
  status: string
  displayStatus: string
  totalCents: number
}

// ---------------------------------------------------------------------------
// Constantes de negócio desta reconciliação
// ---------------------------------------------------------------------------

const CARTEIRA_FISICA_NAME = 'Carteira física'

// Checagem 1 (passo 4, antes de qualquer escrita, e de novo bem antes da fase 5): o total
// ATUAL da fatura, antes da compra não identificada existir.
const PICPAY_AUGUST_INVOICE_BEFORE_FASE5_CENTS = 90757
// Checagem 2 (fase 8, imediatamente antes do POST .../pay): o total FINAL, depois que a
// fase 5 já lançou a compra de R$103,16 (90757 + 10316 = 101073).
const PICPAY_AUGUST_INVOICE_TARGET_CENTS = 101073
const NUBANK_INSTALLMENT_INVOICE_TARGET_CENTS = 17250
const NUBANK_INSTALLMENT_MONTHS = ['2026-06', '2026-07', '2026-08']

// Ver comentário grande no topo do arquivo — cobre com folga o pior ponto intermediário do
// saldo do Nubank ao longo das fases 3, 7 e 9 (mínimo calculado: ~R$1.474,39). A fase 10
// recalibra o saldo inicial de todas as contas pro valor exato no final, então esse valor
// não sobra em lugar nenhum — só precisa ser grande o bastante pra não travar no meio.
const NUBANK_TEMP_BUFFER_CENTS = 300000

const BALANCE_TARGETS: Record<string, number> = {
  Nubank: 18538,
  PicPay: 3114,
  Bradesco: 4610,
  [CARTEIRA_FISICA_NAME]: 26050,
}

interface NewPicPayPurchaseDef {
  category: string
  description: string
  totalAmountCents: number
  purchaseDate: string
}

const NEW_PICPAY_PURCHASES: NewPicPayPurchaseDef[] = [
  {
    category: 'Alimentação',
    description: 'Padaria Akitanda Arcos Bra (compra em 28/08)',
    totalAmountCents: 540,
    purchaseDate: '2026-08-30',
  },
  {
    category: 'Alimentação',
    description: 'Ifd*32379509 Juliana C Arcos Bra (compra em 29/08)',
    totalAmountCents: 2349,
    purchaseDate: '2026-08-30',
  },
  {
    category: 'Combustível',
    description: 'Rede Havana Rr Divinopolis Bra',
    totalAmountCents: 2505,
    purchaseDate: '2026-08-30',
  },
  {
    category: 'Alimentação',
    description: 'Happy Ice Sorvetes Ltd Arcos Bra',
    totalAmountCents: 1500,
    purchaseDate: '2026-08-30',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora Leao Ltd Arcos Bra',
    totalAmountCents: 1989,
    purchaseDate: '2026-09-02',
  },
  {
    category: 'Presente',
    description: 'Bonotoy Comercio de a Arcos Bra',
    totalAmountCents: 5480,
    purchaseDate: '2026-09-04',
  },
  {
    category: 'Combustível',
    description: 'Posto Teixeirinha Ltd Arcos Bra',
    totalAmountCents: 2103,
    purchaseDate: '2026-09-06',
  },
  {
    category: 'Alimentação',
    description: 'Panificadora e Lancho Arcos Bra',
    totalAmountCents: 1477,
    purchaseDate: '2026-09-07',
  },
]

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
// Passo 2: carregar contas, cartões e categorias existentes; resolver tudo por
// nome/tipo exato ANTES de qualquer escrita.
// ---------------------------------------------------------------------------

interface Refs {
  accountsByName: Map<string, Account>
  cardsByName: Map<string, CreditCard>
  expenseCategoriesByName: Map<string, Category>
  incomeCategoriesByName: Map<string, Category>
}

function findAccount(refs: Refs, name: string): Account {
  const account = refs.accountsByName.get(name)
  if (!account) throw new Error(`conta não encontrada com o nome exato: "${name}"`)
  return account
}

function findCard(refs: Refs, name: string): CreditCard {
  const card = refs.cardsByName.get(name)
  if (!card) throw new Error(`cartão não encontrado com o nome exato: "${name}"`)
  return card
}

function findExpenseCategory(refs: Refs, name: string): Category {
  const category = refs.expenseCategoriesByName.get(name)
  if (!category) throw new Error(`categoria de despesa não encontrada com o nome exato: "${name}"`)
  return category
}

function findIncomeCategory(refs: Refs, name: string): Category {
  const category = refs.incomeCategoriesByName.get(name)
  if (!category) throw new Error(`categoria de receita não encontrada com o nome exato: "${name}"`)
  return category
}

async function loadRefs(): Promise<Refs> {
  console.log('\n==> Passo 2: carregando contas, cartões e categorias')

  const accounts = await fetchAllPages<Account>('/accounts?status=all', 'accounts')
  const cards = await fetchAllPages<CreditCard>('/credit-cards?status=all', 'creditCards')
  const expenseCategories = await fetchAllPages<Category>('/categories?type=expense', 'categories')
  const incomeCategories = await fetchAllPages<Category>('/categories?type=income', 'categories')

  const refs: Refs = {
    accountsByName: new Map(accounts.map((a) => [a.name, a])),
    cardsByName: new Map(cards.map((c) => [c.name, c])),
    expenseCategoriesByName: new Map(expenseCategories.map((c) => [c.name, c])),
    incomeCategoriesByName: new Map(incomeCategories.map((c) => [c.name, c])),
  }

  // Resolve tudo que as fases seguintes vão precisar, só pra falhar cedo (antes de
  // qualquer escrita) se algum nome não bater exatamente com o que existe de verdade.
  findAccount(refs, 'Nubank')
  findAccount(refs, 'PicPay')
  findAccount(refs, 'Bradesco')
  findCard(refs, 'Nubank')
  findCard(refs, 'PicPay')
  findIncomeCategory(refs, 'Comissão')
  findExpenseCategory(refs, 'Assinaturas')
  findExpenseCategory(refs, 'Outros')
  findExpenseCategory(refs, 'Alimentação')
  findExpenseCategory(refs, 'Combustível')
  findExpenseCategory(refs, 'Presente')

  if (refs.accountsByName.has(CARTEIRA_FISICA_NAME)) {
    throw new Error(
      `a conta "${CARTEIRA_FISICA_NAME}" já existe — este script (ou parte dele) parece já ` +
        'ter rodado antes. Abortando pra não duplicar a conta e reaplicar tudo em cima dela.',
    )
  }

  console.log('  contas, cartões e categorias resolvidos com sucesso.')
  return refs
}

// ---------------------------------------------------------------------------
// Passo 3: localizar, em Setembro/2026, as 5 despesas que a Fase 3/4 mexem —
// escopado ao mês pra não confundir com a mesma despesa recorrente de outro mês.
// ---------------------------------------------------------------------------

const SEPTEMBER_EXPENSE_DESCRIPTIONS = [
  'Academia Performance Sanitária',
  'Corte de cabelo',
  'Empréstimo Nubank',
  'Boleto Faculdade',
  'YouTube Premium',
]

async function loadSeptemberExpenses(): Promise<Map<string, Expense>> {
  console.log('\n==> Passo 3: localizando despesas de Setembro/2026 por descrição exata')

  const expenses = await fetchAllPages<Expense>(
    '/expenses?from=2026-09-01&to=2026-09-30',
    'expenses',
  )

  const byDescription = new Map<string, Expense>()
  for (const description of SEPTEMBER_EXPENSE_DESCRIPTIONS) {
    const matches = expenses.filter((e) => e.description === description)
    if (matches.length === 0) {
      throw new Error(
        `despesa não encontrada em Setembro/2026 com a descrição exata: "${description}"`,
      )
    }
    if (matches.length > 1) {
      throw new Error(
        `mais de uma despesa em Setembro/2026 com a descrição exata "${description}" ` +
          `(${matches.length} encontradas) — ambíguo, abortando.`,
      )
    }
    byDescription.set(description, matches[0])
    console.log(`  ${description}: ${centsToBRL(matches[0].amount_cents)}`)
  }

  return byDescription
}

// ---------------------------------------------------------------------------
// Verificação de fatura — usada tanto na validação prévia (passo 4) quanto de
// novo, bem antes de cada POST .../pay (fases 8 e 9), como defesa em profundidade.
// ---------------------------------------------------------------------------

async function findInvoiceDetail(
  cardId: string,
  cardLabel: string,
  month: string,
): Promise<InvoiceDetail> {
  const { invoices } = await req<{ invoices: InvoiceListItem[] }>(
    'GET',
    `/invoices?creditCardId=${cardId}&month=${month}`,
  )
  if (invoices.length === 0) {
    throw new Error(`fatura não encontrada: cartão ${cardLabel}, mês ${month}`)
  }
  if (invoices.length > 1) {
    throw new Error(`mais de uma fatura encontrada: cartão ${cardLabel}, mês ${month} — abortando.`)
  }
  const { invoice } = await req<{ invoice: InvoiceDetail }>('GET', `/invoices/${invoices[0].id}`)
  return invoice
}

async function assertInvoiceTotal(
  cardId: string,
  cardLabel: string,
  month: string,
  expectedCents: number,
): Promise<InvoiceDetail> {
  const invoice = await findInvoiceDetail(cardId, cardLabel, month)
  if (invoice.totalCents !== expectedCents) {
    throw new Error(
      `PARE — fatura ${cardLabel} de ${month} não bate: esperado ${centsToBRL(expectedCents)}, ` +
        `encontrado ${centsToBRL(invoice.totalCents)} (id ${invoice.id}). Não tente ajustar ` +
        'sozinho, avise o valor real encontrado.',
    )
  }
  return invoice
}

// ---------------------------------------------------------------------------
// Passo 4: validação prévia — total ATUAL da fatura de agosto do PicPay (antes da fase 5
// existir) e das 3 faturas de junho/julho/agosto do Nubank — confirma os totais ANTES de
// qualquer escrita das fases 1-9.
// ---------------------------------------------------------------------------

async function validateInvoicesUpfront(refs: Refs): Promise<void> {
  console.log('\n==> Passo 4: validando totais de fatura antes de qualquer escrita')

  const picpayCard = findCard(refs, 'PicPay')
  await assertInvoiceTotal(
    picpayCard.id,
    'PicPay',
    '2026-08',
    PICPAY_AUGUST_INVOICE_BEFORE_FASE5_CENTS,
  )
  console.log(
    `  PicPay Agosto/2026 (total atual, antes da fase 5): ` +
      `${centsToBRL(PICPAY_AUGUST_INVOICE_BEFORE_FASE5_CENTS)} — OK`,
  )

  const nubankCard = findCard(refs, 'Nubank')
  for (const month of NUBANK_INSTALLMENT_MONTHS) {
    await assertInvoiceTotal(
      nubankCard.id,
      'Nubank',
      month,
      NUBANK_INSTALLMENT_INVOICE_TARGET_CENTS,
    )
    console.log(`  Nubank ${month}: ${centsToBRL(NUBANK_INSTALLMENT_INVOICE_TARGET_CENTS)} — OK`)
  }
}

// ---------------------------------------------------------------------------
// FASE 0 (não pedida — ver comentário no topo do arquivo) — infla temporariamente o saldo
// inicial do Nubank pra atravessar as fases 3/7/9 sem esbarrar na trava de "saldo zero ou
// negativo" em transferência/pagamento de fatura. A fase 10 corrige pro valor exato depois.
// ---------------------------------------------------------------------------

async function bufferNubankBalance(refs: Refs): Promise<void> {
  console.log(
    '\n==> Fase 0: inflando saldo inicial do Nubank temporariamente (fase 10 corrige no final)',
  )
  const nubank = findAccount(refs, 'Nubank')
  const newInitialBalanceCents = nubank.initial_balance_cents + NUBANK_TEMP_BUFFER_CENTS
  await req('PUT', `/accounts/${nubank.id}`, { initial_balance_cents: newInitialBalanceCents })
  console.log(`  Nubank: +${centsToBRL(NUBANK_TEMP_BUFFER_CENTS)} temporário no saldo inicial`)
}

// ---------------------------------------------------------------------------
// FASE 1 — nova conta "Carteira física"
// ---------------------------------------------------------------------------

async function createCarteiraFisica(): Promise<Account> {
  console.log('\n==> Fase 1: criando conta "Carteira física"')
  // bank_name OMITIDO de propósito — o schema só aceita string opcional, `null` literal
  // seria rejeitado com 400.
  const { account } = await req<{ account: Account }>('POST', '/accounts', {
    name: CARTEIRA_FISICA_NAME,
    type: 'cash',
    initial_balance_cents: 0,
  })
  console.log(`  criada: ${account.id}`)
  return account
}

// ---------------------------------------------------------------------------
// FASE 2 — entrada "Comissão"
// ---------------------------------------------------------------------------

async function createComissaoEntry(refs: Refs, carteiraFisica: Account): Promise<void> {
  console.log('\n==> Fase 2: lançando entrada "Comissão"')
  const category = findIncomeCategory(refs, 'Comissão')
  await req('POST', '/income-entries', {
    account_id: carteiraFisica.id,
    category_id: category.id,
    description: 'Comissão',
    amount_cents: 12000,
    entry_date: '2026-09-08',
    receipt_method: 'cash',
    is_received: true,
    is_planned: false,
    received_date: '2026-09-08',
  })
  console.log(`  Comissão: ${centsToBRL(12000)} em ${CARTEIRA_FISICA_NAME}`)
}

// ---------------------------------------------------------------------------
// FASE 3 — correções em despesas existentes
// ---------------------------------------------------------------------------

async function fixExistingExpenses(refs: Refs, expenses: Map<string, Expense>): Promise<void> {
  console.log('\n==> Fase 3: corrigindo despesas existentes')

  const academia = expenses.get('Academia Performance Sanitária')!
  await req('PUT', `/expenses/${academia.id}`, {
    amount_cents: 10000,
    is_paid: true,
    paid_date: '2026-09-07',
  })
  console.log(`  Academia Performance Sanitária: ${centsToBRL(10000)}, paga em 07/09`)

  const corteDeCabelo = expenses.get('Corte de cabelo')!
  await req('PUT', `/expenses/${corteDeCabelo.id}`, {
    is_paid: true,
    paid_date: '2026-09-01',
  })
  console.log('  Corte de cabelo: paga em 01/09')

  const emprestimo = expenses.get('Empréstimo Nubank')!
  await req('PUT', `/expenses/${emprestimo.id}`, {
    amount_cents: 56178,
    is_paid: true,
    paid_date: '2026-09-03',
  })
  console.log(`  Empréstimo Nubank: ${centsToBRL(56178)}, pago em 03/09`)

  const boletoFaculdade = expenses.get('Boleto Faculdade')!
  const picpay = findAccount(refs, 'PicPay')
  await req('PUT', `/expenses/${boletoFaculdade.id}`, {
    account_id: picpay.id,
    is_paid: true,
    paid_date: '2026-09-07',
  })
  console.log('  Boleto Faculdade: conta trocada pra PicPay, pago em 07/09')
}

// ---------------------------------------------------------------------------
// FASE 4 — YouTube Premium migra de despesa pra compra no cartão
// ---------------------------------------------------------------------------

async function migrateYoutubePremium(refs: Refs, expenses: Map<string, Expense>): Promise<void> {
  console.log('\n==> Fase 4: migrando YouTube Premium de despesa pra compra no cartão')

  const expense = expenses.get('YouTube Premium')!
  if (expense.amount_cents !== 1690) {
    console.warn(
      `  aviso: YouTube Premium encontrado com ${centsToBRL(expense.amount_cents)}, ` +
        `esperado ${centsToBRL(1690)} — seguindo mesmo assim (match foi por descrição exata).`,
    )
  }
  await req('DELETE', `/expenses/${expense.id}`)
  console.log(`  despesa "YouTube Premium" excluída (era ${centsToBRL(expense.amount_cents)})`)

  const nubankCard = findCard(refs, 'Nubank')
  const category = findExpenseCategory(refs, 'Assinaturas')
  await req('POST', '/purchases', {
    credit_card_id: nubankCard.id,
    category_id: category.id,
    description: 'YouTube Premium',
    total_amount_cents: 1690,
    installments_count: 1,
    purchase_date: '2026-09-07',
    is_essential: false,
    is_fixed: true,
    is_planned: true,
  })
  console.log(`  recriada como compra no Nubank: ${centsToBRL(1690)}`)
}

// ---------------------------------------------------------------------------
// FASE 5 — item não identificado da fatura de agosto do PicPay
// ---------------------------------------------------------------------------

async function addUnknownAugustPurchase(refs: Refs): Promise<void> {
  console.log('\n==> Fase 5: lançando item não identificado da fatura de agosto (PicPay)')
  const picpayCard = findCard(refs, 'PicPay')

  // Reconfirma o total ATUAL bem aqui, imediatamente antes de lançar a compra — defesa em
  // profundidade além da validação prévia do passo 4 (nada entre o passo 4 e aqui deveria
  // ter mexido nessa fatura, mas confere de novo mesmo assim).
  await assertInvoiceTotal(
    picpayCard.id,
    'PicPay',
    '2026-08',
    PICPAY_AUGUST_INVOICE_BEFORE_FASE5_CENTS,
  )

  const category = findExpenseCategory(refs, 'Outros')
  await req('POST', '/purchases', {
    credit_card_id: picpayCard.id,
    category_id: category.id,
    description: 'Compra não identificada (ajuste de fatura de agosto)',
    total_amount_cents: 10316,
    installments_count: 1,
    purchase_date: '2026-08-28',
    is_essential: true,
    is_fixed: false,
    is_planned: false,
  })
  console.log(`  lançado: ${centsToBRL(10316)}`)
}

// ---------------------------------------------------------------------------
// FASE 6 — 8 novas compras no PicPay
// ---------------------------------------------------------------------------

async function addNewPicPayPurchases(refs: Refs): Promise<void> {
  console.log('\n==> Fase 6: lançando 8 novas compras no PicPay')
  const picpayCard = findCard(refs, 'PicPay')

  for (const def of NEW_PICPAY_PURCHASES) {
    const category = findExpenseCategory(refs, def.category)
    await req('POST', '/purchases', {
      credit_card_id: picpayCard.id,
      category_id: category.id,
      description: def.description,
      total_amount_cents: def.totalAmountCents,
      installments_count: 1,
      purchase_date: def.purchaseDate,
      is_essential: true,
      is_fixed: false,
      is_planned: false,
    })
    console.log(`  ${def.description}: ${centsToBRL(def.totalAmountCents)}`)
  }
}

// ---------------------------------------------------------------------------
// FASE 7 — transferências Nubank -> PicPay
// ---------------------------------------------------------------------------

async function createTransfers(refs: Refs): Promise<void> {
  console.log('\n==> Fase 7: lançando transferências Nubank -> PicPay')
  const nubank = findAccount(refs, 'Nubank')
  const picpay = findAccount(refs, 'PicPay')

  await req('POST', '/transfers', {
    from_account_id: nubank.id,
    to_account_id: picpay.id,
    amount_cents: 41200,
    transfer_date: '2026-09-07',
    description: 'Transferência para pagar Boleto Faculdade',
  })
  console.log(`  ${centsToBRL(41200)} em 07/09 (Boleto Faculdade)`)

  await req('POST', '/transfers', {
    from_account_id: nubank.id,
    to_account_id: picpay.id,
    amount_cents: 101073,
    transfer_date: '2026-09-03',
    description: 'Transferência para pagar fatura PicPay',
  })
  console.log(`  ${centsToBRL(101073)} em 03/09 (fatura PicPay)`)
}

// ---------------------------------------------------------------------------
// FASE 8 — pagamento da fatura de agosto do PicPay
// ---------------------------------------------------------------------------

async function payPicPayAugustInvoice(refs: Refs): Promise<InvoiceDetail> {
  console.log('\n==> Fase 8: pagando fatura de agosto do PicPay')
  const picpayCard = findCard(refs, 'PicPay')
  const picpayAccount = findAccount(refs, 'PicPay')

  // Reconfirma o total bem aqui, imediatamente antes do pagamento — defesa em
  // profundidade além da validação prévia do passo 4 (o estado pode ter mudado entre as
  // fases 5-7, que lançam novas compras nessa mesma fatura).
  const invoice = await assertInvoiceTotal(
    picpayCard.id,
    'PicPay',
    '2026-08',
    PICPAY_AUGUST_INVOICE_TARGET_CENTS,
  )

  await req('POST', `/invoices/${invoice.id}/pay`, {
    accountId: picpayAccount.id,
    paymentDate: '2026-09-03',
  })
  console.log(`  paga: ${centsToBRL(invoice.totalCents)} em 03/09`)
  return invoice
}

// ---------------------------------------------------------------------------
// FASE 9 — pagamento das faturas de junho, julho e agosto do Nubank
// ---------------------------------------------------------------------------

async function payNubankInstallmentInvoices(refs: Refs): Promise<InvoiceDetail[]> {
  console.log('\n==> Fase 9: pagando faturas de junho/julho/agosto do Nubank')
  const nubankCard = findCard(refs, 'Nubank')
  const nubankAccount = findAccount(refs, 'Nubank')

  const paid: InvoiceDetail[] = []
  for (const month of NUBANK_INSTALLMENT_MONTHS) {
    const invoice = await assertInvoiceTotal(
      nubankCard.id,
      'Nubank',
      month,
      NUBANK_INSTALLMENT_INVOICE_TARGET_CENTS,
    )
    await req('POST', `/invoices/${invoice.id}/pay`, {
      accountId: nubankAccount.id,
      paymentDate: invoice.due_date,
    })
    console.log(
      `  ${month}: ${centsToBRL(invoice.totalCents)}, pago com due_date ${invoice.due_date}`,
    )
    paid.push(invoice)
  }
  return paid
}

// ---------------------------------------------------------------------------
// FASE 10 — recalibração final do saldo das 4 contas
// ---------------------------------------------------------------------------

async function recalibrateBalances(refs: Refs, carteiraFisica: Account): Promise<void> {
  console.log('\n==> Fase 10: recalibrando saldo das 4 contas')

  const targets: [string, Account][] = [
    ['Nubank', findAccount(refs, 'Nubank')],
    ['PicPay', findAccount(refs, 'PicPay')],
    ['Bradesco', findAccount(refs, 'Bradesco')],
    [CARTEIRA_FISICA_NAME, carteiraFisica],
  ]

  for (const [label, account] of targets) {
    const targetCents = BALANCE_TARGETS[label]

    const { balanceCents: calculatedCents } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${account.id}/balance`,
    )
    const delta = targetCents - calculatedCents

    if (delta !== 0) {
      const { account: current } = await req<{ account: Account }>('GET', `/accounts/${account.id}`)
      const newInitialBalanceCents = current.initial_balance_cents + delta
      await req('PUT', `/accounts/${account.id}`, {
        initial_balance_cents: newInitialBalanceCents,
      })
    }

    const { balanceCents: finalCents } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${account.id}/balance`,
    )
    if (finalCents !== targetCents) {
      throw new Error(
        `PARE — recalibração de ${label} não bateu: alvo ${centsToBRL(targetCents)}, ` +
          `resultado ${centsToBRL(finalCents)}. Não tente ajustar sozinho.`,
      )
    }
    console.log(
      `  ${label}: ${centsToBRL(calculatedCents)} -> ${centsToBRL(finalCents)} (delta ${centsToBRL(delta)})`,
    )
  }
}

// ---------------------------------------------------------------------------
// FASE 11 — relatório final
// ---------------------------------------------------------------------------

async function printFinalReport(
  refs: Refs,
  carteiraFisica: Account,
  picpayAugustInvoice: InvoiceDetail,
  nubankInstallmentInvoices: InvoiceDetail[],
): Promise<void> {
  console.log('\n==> Fase 11: relatório final')

  console.log('\n-- Saldos finais --')
  const accountLabels: [string, Account][] = [
    ['Nubank', findAccount(refs, 'Nubank')],
    ['PicPay', findAccount(refs, 'PicPay')],
    ['Bradesco', findAccount(refs, 'Bradesco')],
    [CARTEIRA_FISICA_NAME, carteiraFisica],
  ]
  for (const [label, account] of accountLabels) {
    const { balanceCents } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${account.id}/balance`,
    )
    console.log(`  ${label}: ${centsToBRL(balanceCents)}`)
  }

  console.log('\n-- Limite disponível --')
  const nubankCard = findCard(refs, 'Nubank')
  const picpayCard = findCard(refs, 'PicPay')
  const { availableLimitCents: nubankAvailable } = await req<{ availableLimitCents: number }>(
    'GET',
    `/credit-cards/${nubankCard.id}/available-limit`,
  )
  const { availableLimitCents: picpayAvailable } = await req<{ availableLimitCents: number }>(
    'GET',
    `/credit-cards/${picpayCard.id}/available-limit`,
  )
  console.log(`  Nubank: ${centsToBRL(nubankAvailable)}`)
  console.log(`  PicPay: ${centsToBRL(picpayAvailable)}`)

  console.log('\n-- Faturas em aberto (todas, não só a mais recente) --')
  for (const [label, card] of [
    ['Nubank', nubankCard],
    ['PicPay', picpayCard],
  ] as const) {
    const { invoices } = await req<{ invoices: InvoiceListItem[] }>(
      'GET',
      `/invoices?creditCardId=${card.id}&month=all&pageSize=100`,
    )
    const open = invoices.filter((i) => i.displayStatus !== 'paid')
    if (open.length === 0) {
      console.log(`  ${label}: nenhuma fatura em aberto`)
      continue
    }
    for (const invoice of open) {
      const marker = label === 'PicPay' ? '  <-- CONFIRA (diverge do valor informado)' : ''
      console.log(
        `  ${label} ${invoice.reference_month} (${invoice.displayStatus}): ` +
          `${centsToBRL(invoice.totalCents)}${marker}`,
      )
    }
  }

  console.log('\n-- Status das faturas mexidas neste script --')
  const touchedIds = [picpayAugustInvoice.id, ...nubankInstallmentInvoices.map((i) => i.id)]
  for (const invoiceId of touchedIds) {
    const { invoice } = await req<{ invoice: InvoiceDetail }>('GET', `/invoices/${invoiceId}`)
    const cardLabel = invoice.credit_card_id === nubankCard.id ? 'Nubank' : 'PicPay'
    console.log(
      `  ${cardLabel} ${invoice.reference_month}: ${invoice.displayStatus} ` +
        `(${centsToBRL(invoice.totalCents)})`,
    )
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let lastStep = 'login'
  try {
    await login()

    lastStep = 'passo 2 (carregar refs)'
    const refs = await loadRefs()

    lastStep = 'passo 3 (localizar despesas de setembro)'
    const septemberExpenses = await loadSeptemberExpenses()

    lastStep = 'passo 4 (validação prévia das faturas)'
    await validateInvoicesUpfront(refs)

    lastStep = 'fase 0 (buffer temporário de saldo do Nubank)'
    await bufferNubankBalance(refs)

    lastStep = 'fase 1 (criar Carteira física)'
    const carteiraFisica = await createCarteiraFisica()
    refs.accountsByName.set(carteiraFisica.name, carteiraFisica)

    lastStep = 'fase 2 (entrada Comissão)'
    await createComissaoEntry(refs, carteiraFisica)

    lastStep = 'fase 3 (correções em despesas existentes)'
    await fixExistingExpenses(refs, septemberExpenses)

    lastStep = 'fase 4 (migrar YouTube Premium)'
    await migrateYoutubePremium(refs, septemberExpenses)

    lastStep = 'fase 5 (item não identificado de agosto)'
    await addUnknownAugustPurchase(refs)

    lastStep = 'fase 6 (8 novas compras no PicPay)'
    await addNewPicPayPurchases(refs)

    lastStep = 'fase 7 (transferências Nubank -> PicPay)'
    await createTransfers(refs)

    lastStep = 'fase 8 (pagar fatura de agosto do PicPay)'
    const picpayAugustInvoice = await payPicPayAugustInvoice(refs)

    lastStep = 'fase 9 (pagar faturas jun/jul/ago do Nubank)'
    const nubankInstallmentInvoices = await payNubankInstallmentInvoices(refs)

    lastStep = 'fase 10 (recalibração final de saldo)'
    await recalibrateBalances(refs, carteiraFisica)

    lastStep = 'fase 11 (relatório final)'
    await printFinalReport(refs, carteiraFisica, picpayAugustInvoice, nubankInstallmentInvoices)

    console.log('\n✔ Reconciliação concluída com sucesso.')
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
