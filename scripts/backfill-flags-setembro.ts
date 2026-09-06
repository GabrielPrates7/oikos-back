// Backfill de is_essential/is_fixed/receipt_method nos dados reais de Setembro/2026 já
// importados (scripts/import-setembro.ts).
//
// Mesmo padrão do script de import: tudo passa pela API HTTP real, autenticado via login
// interativo no terminal. NUNCA faz UPDATE direto no banco, nunca hardcoda credenciais,
// nunca salva o token em disco (fica só em memória durante a execução).
//
// Uso: npx tsx scripts/backfill-flags-setembro.ts

import { createInterface } from 'node:readline/promises'

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api'

let accessToken: string | null = null

// ---------------------------------------------------------------------------
// Prompt interativo (mesmo código de scripts/import-setembro.ts)
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

function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ---------------------------------------------------------------------------
// Tipos mínimos
// ---------------------------------------------------------------------------

interface Expense {
  id: string
  description: string
  amount_cents: number
  is_essential: boolean
  is_fixed: boolean
}

interface Purchase {
  id: string
  description: string
  total_amount_cents: number
  is_essential: boolean
  is_fixed: boolean
}

interface IncomeEntry {
  id: string
  description: string
  amount_cents: number
  receipt_method: string
}

interface CreditCard {
  id: string
  name: string
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
// Passo 2: backfill das despesas
// ---------------------------------------------------------------------------

// Descrições exatas das 7 despesas que viram fixas.
const FIXED_DESCRIPTIONS = [
  'Boleto Faculdade',
  'Academia Performance Sanitária',
  'Conta VIVO',
  'Corte de cabelo',
  'Dízimo + Oferta',
  'YouTube Premium',
  'Empréstimo Nubank',
]

// Dentre as acima, só esta também vira não-essencial.
const NOT_ESSENTIAL_DESCRIPTIONS = ['YouTube Premium']

async function backfillExpenses(): Promise<void> {
  console.log('\n==> Passo 2: backfill de despesas (isFixed / isEssential)')
  const { expenses } = await req<{ expenses: Expense[] }>('GET', '/expenses')

  for (const description of FIXED_DESCRIPTIONS) {
    const expense = expenses.find((e) => e.description === description)
    if (!expense) {
      throw new Error(`despesa não encontrada com a descrição exata: "${description}"`)
    }

    const body: Record<string, boolean> = { is_fixed: true }
    if (NOT_ESSENTIAL_DESCRIPTIONS.includes(description)) {
      body.is_essential = false
    }

    await req('PUT', `/expenses/${expense.id}`, body)
    const extra = body.is_essential !== undefined ? ', isEssential=false' : ''
    console.log(`  ${description}: isFixed=true${extra}`)
  }
}

// ---------------------------------------------------------------------------
// Passo 3: relatório final
// ---------------------------------------------------------------------------

async function printReport(): Promise<void> {
  console.log('\n==> Passo 3: relatório final (confira visualmente)')

  console.log('\n-- Despesas --')
  const { expenses } = await req<{ expenses: Expense[] }>('GET', '/expenses')
  for (const expense of expenses) {
    console.log(
      `  ${expense.description} (${centsToBRL(expense.amount_cents)}) — essencial=${expense.is_essential}, fixo=${expense.is_fixed}`,
    )
  }

  console.log('\n-- Compras no cartão --')
  const { creditCards } = await req<{ creditCards: CreditCard[] }>(
    'GET',
    '/credit-cards?status=all',
  )
  for (const card of creditCards) {
    const { purchases } = await req<{ purchases: Purchase[] }>(
      'GET',
      `/credit-cards/${card.id}/purchases`,
    )
    for (const purchase of purchases) {
      console.log(
        `  [${card.name}] ${purchase.description} (${centsToBRL(purchase.total_amount_cents)}) — essencial=${purchase.is_essential}, fixo=${purchase.is_fixed}`,
      )
    }
  }

  console.log('\n-- Entradas --')
  const { incomeEntries } = await req<{ incomeEntries: IncomeEntry[] }>('GET', '/income-entries')
  for (const entry of incomeEntries) {
    console.log(
      `  ${entry.description} (${centsToBRL(entry.amount_cents)}) — forma de recebimento=${entry.receipt_method}`,
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

    lastStep = 'passo 2 (backfill de despesas)'
    await backfillExpenses()

    lastStep = 'passo 3 (relatório final)'
    await printReport()

    console.log('\n✔ Backfill concluído com sucesso.')
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
