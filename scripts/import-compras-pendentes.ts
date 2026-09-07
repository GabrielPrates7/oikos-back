// Script de importação de dados reais — 4 compras que faltaram no import original de
// Setembro/2026 (scripts/import-setembro.ts).
//
// Mesmo padrão daquele script: tudo passa pela API HTTP real (mesma validação e regra de
// negócio de qualquer uso normal do sistema), autenticado como o usuário de verdade via
// login interativo. NUNCA faz INSERT direto no banco, nunca hardcoda credenciais, nunca
// salva o token em disco (fica só em memória, na variável `accessToken`, durante a
// execução do processo).
//
// Dado real e definitivo — não é cenário de teste, não é pra ser limpo depois.
// NÃO rode duas vezes: cada POST cria uma linha nova, então rodar de novo duplicaria as
// compras. O script se recusa a rodar se detectar que qualquer uma das 4 descrições já
// existe no histórico do cartão correspondente.
//
// Uso: npx tsx scripts/import-compras-pendentes.ts

import { createInterface } from 'node:readline/promises'

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api'

let accessToken: string | null = null

// ---------------------------------------------------------------------------
// Prompt interativo (e-mail visível, senha mascarada — sem dependência externa).
// Idêntico a import-setembro.ts.
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

interface CreditCard {
  id: string
  name: string
}

interface Purchase {
  id: string
  description: string
  purchase_date: string
}

interface Installment {
  id: string
  invoice_id: string
  installment_number: number
  amount_cents: number
}

interface Invoice {
  id: string
  reference_month: string
}

// ---------------------------------------------------------------------------
// As 4 compras pendentes
// ---------------------------------------------------------------------------

interface PurchaseDef {
  card: string
  category: string
  description: string
  totalAmountCents: number
  installmentsCount: number
  purchaseDate: string
  isEssential: boolean
  isFixed: boolean
}

const PURCHASE_DEFS: PurchaseDef[] = [
  {
    card: 'Nubank',
    category: 'Moto',
    description: 'Compra de pneu na moto Arcos',
    totalAmountCents: 34800,
    installmentsCount: 4,
    purchaseDate: '2026-08-28',
    isEssential: true,
    isFixed: false,
  },
  {
    card: 'PicPay',
    category: 'Auto Cuidado',
    description: 'Drogaria e Perfumaria Arcos Bra',
    totalAmountCents: 28794,
    installmentsCount: 3,
    purchaseDate: '2026-08-04',
    isEssential: true,
    isFixed: false,
  },
  {
    card: 'PicPay',
    category: 'Moto',
    description: 'Moto Arcos Arcos Bra',
    totalAmountCents: 51000,
    installmentsCount: 4,
    purchaseDate: '2026-08-07',
    isEssential: true,
    isFixed: false,
  },
  {
    card: 'PicPay',
    category: 'Moto',
    description: 'Mercado Livre - roda da moto',
    totalAmountCents: 24224,
    installmentsCount: 4,
    purchaseDate: '2026-08-07',
    isEssential: true,
    isFixed: false,
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
// Passo 2: carregar categorias e cartões existentes (nada é criado aqui — as
// categorias "Moto" e "Auto Cuidado" e os cartões Nubank/PicPay já existem
// desde o import original de Setembro)
// ---------------------------------------------------------------------------

async function loadCategoryMap(): Promise<Map<string, string>> {
  const { categories } = await req<{ categories: Category[] }>('GET', '/categories')
  const map = new Map<string, string>()
  for (const category of categories) {
    map.set(`${category.name}::${category.type}`, category.id)
  }
  return map
}

function categoryId(map: Map<string, string>, name: string): string {
  const id = map.get(`${name}::expense`)
  if (!id) throw new Error(`categoria não encontrada: ${name} (expense)`)
  return id
}

async function loadCreditCardMap(): Promise<Map<string, string>> {
  const { creditCards } = await req<{ creditCards: CreditCard[] }>(
    'GET',
    '/credit-cards?status=all',
  )
  const map = new Map<string, string>()
  for (const card of creditCards) {
    map.set(card.name, card.id)
  }
  return map
}

function creditCardId(map: Map<string, string>, name: string): string {
  const id = map.get(name)
  if (!id) throw new Error(`cartão não encontrado: ${name}`)
  return id
}

// ---------------------------------------------------------------------------
// Guarda contra execução duplicada — verifica, por cartão, se alguma das
// descrições já existe no histórico de compras antes de criar qualquer coisa.
// ---------------------------------------------------------------------------

async function assertNotAlreadyImported(cards: Map<string, string>): Promise<void> {
  const cardNames = [...new Set(PURCHASE_DEFS.map((def) => def.card))]
  for (const cardName of cardNames) {
    const cardId = creditCardId(cards, cardName)
    const { purchases } = await req<{ purchases: Purchase[] }>(
      'GET',
      `/credit-cards/${cardId}/purchases`,
    )
    const existingDescriptions = new Set(purchases.map((p) => p.description))
    for (const def of PURCHASE_DEFS.filter((d) => d.card === cardName)) {
      if (existingDescriptions.has(def.description)) {
        throw new Error(
          `Compra "${def.description}" já existe no cartão ${cardName} — parece que este ` +
            'import já rodou antes. Abortando pra não duplicar. Confirme antes de rodar de novo.',
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Passo 3: criar as 4 compras
// ---------------------------------------------------------------------------

interface CreatedPurchase {
  def: PurchaseDef
  purchase: { id: string }
  installments: Installment[]
}

async function createPurchases(
  cards: Map<string, string>,
  categories: Map<string, string>,
): Promise<CreatedPurchase[]> {
  console.log('\n==> Passo 3: criando as 4 compras pendentes')
  const created: CreatedPurchase[] = []

  for (const def of PURCHASE_DEFS) {
    const result = await req<{ purchase: { id: string }; installments: Installment[] }>(
      'POST',
      '/purchases',
      {
        credit_card_id: creditCardId(cards, def.card),
        category_id: categoryId(categories, def.category),
        description: def.description,
        total_amount_cents: def.totalAmountCents,
        installments_count: def.installmentsCount,
        purchase_date: def.purchaseDate,
        is_essential: def.isEssential,
        is_fixed: def.isFixed,
      },
    )
    created.push({ def, purchase: result.purchase, installments: result.installments })
    console.log(
      `  ${def.card} — ${def.description} (${centsToBRL(def.totalAmountCents)}, ${def.installmentsCount}x)`,
    )
  }

  return created
}

// ---------------------------------------------------------------------------
// Passo 4: relatório final — pra cada compra, quantas parcelas foram geradas e
// em qual fatura (mês de referência) cada uma caiu, com destaque pra parcela
// 1/N (a "atual", vinculada à data da compra em si).
// ---------------------------------------------------------------------------

async function printReport(created: CreatedPurchase[]): Promise<void> {
  console.log('\n==> Passo 4: relatório final')

  // Cache — várias parcelas de compras diferentes podem cair na mesma fatura.
  const invoiceCache = new Map<string, Invoice>()
  async function getInvoice(invoiceId: string): Promise<Invoice> {
    const cached = invoiceCache.get(invoiceId)
    if (cached) return cached
    const { invoice } = await req<{ invoice: Invoice }>('GET', `/invoices/${invoiceId}`)
    invoiceCache.set(invoiceId, invoice)
    return invoice
  }

  for (const { def, installments } of created) {
    console.log(`\n  ${def.description} (${def.card})`)
    console.log(`    parcelas geradas: ${installments.length}`)

    const sorted = [...installments].sort((a, b) => a.installment_number - b.installment_number)
    for (const installment of sorted) {
      const invoice = await getInvoice(installment.invoice_id)
      const marker = installment.installment_number === 1 ? '  <- parcela atual' : ''
      console.log(
        `    ${installment.installment_number}/${def.installmentsCount} ` +
          `${centsToBRL(installment.amount_cents)} — fatura ${invoice.reference_month}${marker}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let lastStep = 'login'
  try {
    await login()

    lastStep = 'passo 2 (categorias e cartões)'
    const categories = await loadCategoryMap()
    const cards = await loadCreditCardMap()

    lastStep = 'verificação de execução duplicada'
    await assertNotAlreadyImported(cards)

    lastStep = 'passo 3 (criar compras)'
    const created = await createPurchases(cards, categories)

    lastStep = 'passo 4 (relatório final)'
    await printReport(created)

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
