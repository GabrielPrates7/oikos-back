// Reconciliação final do saldo Nubank: duas despesas reais confirmadas (churrasco da
// faculdade, rateio com Gabriel Leal e Isis Eduarda) + um ajuste documentado como "não
// identificado" pra fechar a diferença restante.
//
// Mesmo padrão dos scripts anteriores (fix-conta-vivo.ts, reconciliacao-setembro.ts etc.):
// tudo passa pela API HTTP real, autenticado como o usuário de verdade via login interativo
// no terminal. NUNCA faz INSERT direto no banco, nunca hardcoda credenciais, nunca salva o
// token em disco (fica só em memória durante a execução).
//
// Conferido por leitura direta (read-only) antes de escrever este script:
//   Nubank: 45258 centavos (R$452,58) — valor atual, antes destas 3 despesas.
//   PicPay: 3114 (R$31,14) / Bradesco: 4610 (R$46,10) / Carteira física: 26050 (R$260,50) —
//   nenhuma das três deveria ser afetada por esta fase (checagem de regressão no passo 6).
// Efeito líquido calculado das 3 despesas pagas no Nubank:
//   1300 + 1000 + 24420 = 26720 centavos
//   45258 - 26720 = 18538 centavos (R$185,38) — bate exatamente com o valor esperado.
// O script MEDE de verdade em vez de confiar nessa conta de cabeça (passo 5). Se o valor
// medido não bater exatamente com o esperado, ele PARA e reporta a diferença — não ajusta
// initialBalanceCents sozinho, ao contrário de correções anteriores (instrução explícita
// desta fase: qualquer divergência exige investigação manual, não recalibração automática).
//
// Uso: npx tsx scripts/reconciliacao-nubank-final.ts

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
// Tipos mínimos
// ---------------------------------------------------------------------------

interface Account {
  id: string
  name: string
}

interface Category {
  id: string
  name: string
  type: 'income' | 'expense'
}

// ---------------------------------------------------------------------------
// Alvos desta correção
// ---------------------------------------------------------------------------

const NUBANK_EXPECTED_CENTS = 18538 // R$185,38 — calculado, ver comentário no topo do arquivo
const REGRESSION_TARGETS: Record<string, number> = {
  PicPay: 3114, // R$31,14
  Bradesco: 4610, // R$46,10
  'Carteira física': 26050, // R$260,50
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
// Passo 2: resolver conta Nubank e categorias Lazer/Outros
// ---------------------------------------------------------------------------

interface Refs {
  nubank: Account
  lazer: Category
  outros: Category
  regressionAccounts: Account[]
}

async function loadRefs(): Promise<Refs> {
  console.log('\n==> Passo 2: carregando conta Nubank e categorias Lazer/Outros')

  const accounts = await fetchAllPages<Account>('/accounts?status=all', 'accounts')
  const accountsByName = new Map(accounts.map((a) => [a.name, a]))

  const nubank = accountsByName.get('Nubank')
  if (!nubank) throw new Error('conta não encontrada com o nome exato: "Nubank"')

  const regressionAccounts: Account[] = []
  for (const name of Object.keys(REGRESSION_TARGETS)) {
    const account = accountsByName.get(name)
    if (!account) throw new Error(`conta não encontrada com o nome exato: "${name}"`)
    regressionAccounts.push(account)
  }

  const expenseCategories = await fetchAllPages<Category>('/categories?type=expense', 'categories')
  const lazer = expenseCategories.find((c) => c.name === 'Lazer')
  if (!lazer) throw new Error('categoria de despesa não encontrada com o nome exato: "Lazer"')
  const outros = expenseCategories.find((c) => c.name === 'Outros')
  if (!outros) throw new Error('categoria de despesa não encontrada com o nome exato: "Outros"')

  console.log(`  Nubank: ${nubank.id}`)
  console.log(`  Lazer: ${lazer.id}`)
  console.log(`  Outros: ${outros.id}`)

  return { nubank, lazer, outros, regressionAccounts }
}

// ---------------------------------------------------------------------------
// Passo 3: lançar as três despesas
// ---------------------------------------------------------------------------

async function createExpenses(refs: Refs): Promise<void> {
  console.log('\n==> Passo 3: lançando as três despesas no Nubank')

  await req('POST', '/expenses', {
    account_id: refs.nubank.id,
    category_id: refs.lazer.id,
    description: 'Gabriel Leal De Oliveira (churrasco faculdade)',
    amount_cents: 1300,
    payment_method: 'pix',
    expense_date: '2026-09-03',
    is_essential: false,
    is_fixed: false,
    is_paid: true,
    is_planned: false,
    paid_date: '2026-09-03',
  })
  console.log(`  1/3: Gabriel Leal De Oliveira (churrasco faculdade) — ${centsToBRL(1300)}`)

  await req('POST', '/expenses', {
    account_id: refs.nubank.id,
    category_id: refs.lazer.id,
    description: 'Isis Eduarda Ferreira (churrasco faculdade)',
    amount_cents: 1000,
    payment_method: 'pix',
    expense_date: '2026-09-03',
    is_essential: false,
    is_fixed: false,
    is_paid: true,
    is_planned: false,
    paid_date: '2026-09-03',
  })
  console.log(`  2/3: Isis Eduarda Ferreira (churrasco faculdade) — ${centsToBRL(1000)}`)

  await req('POST', '/expenses', {
    account_id: refs.nubank.id,
    category_id: refs.outros.id,
    description: 'Ajuste não identificado — reconciliação de saldo de setembro',
    amount_cents: 24420,
    payment_method: 'debit',
    expense_date: '2026-09-03',
    is_essential: true,
    is_fixed: false,
    is_paid: true,
    is_planned: false,
    paid_date: '2026-09-03',
  })
  console.log(`  3/3: Ajuste não identificado — ${centsToBRL(24420)}`)
}

// ---------------------------------------------------------------------------
// Passo 4: medir o Nubank — sem recalibrar, só confirmar ou parar
// ---------------------------------------------------------------------------

async function checkNubank(refs: Refs): Promise<void> {
  console.log('\n==> Passo 4: medindo o saldo do Nubank (sem ajustar automaticamente)')
  const { balanceCents } = await req<{ balanceCents: number }>(
    'GET',
    `/accounts/${refs.nubank.id}/balance`,
  )

  if (balanceCents !== NUBANK_EXPECTED_CENTS) {
    const deltaCents = balanceCents - NUBANK_EXPECTED_CENTS
    throw new Error(
      `PARE — saldo do Nubank não bateu exatamente.\n` +
        `  Esperado: ${centsToBRL(NUBANK_EXPECTED_CENTS)}\n` +
        `  Encontrado: ${centsToBRL(balanceCents)}\n` +
        `  Diferença: ${centsToBRL(deltaCents)} (${deltaCents > 0 ? 'a mais' : 'a menos'})\n` +
        `  Nenhum ajuste de initialBalanceCents foi feito — investigação manual necessária.`,
    )
  }
  console.log(`  Nubank: ${centsToBRL(balanceCents)} — bate exatamente com o esperado.`)
}

// ---------------------------------------------------------------------------
// Passo 5: checagem de regressão (PicPay, Bradesco, Carteira física)
// ---------------------------------------------------------------------------

async function checkRegression(refs: Refs): Promise<void> {
  console.log('\n==> Passo 5: checagem de regressão (contas que não deveriam ter mudado)')
  let allOk = true
  for (const account of refs.regressionAccounts) {
    const target = REGRESSION_TARGETS[account.name]
    const { balanceCents } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${account.id}/balance`,
    )
    const ok = balanceCents === target
    allOk &&= ok
    console.log(
      `  ${ok ? 'OK ' : 'FALHOU'} ${account.name}: esperado ${centsToBRL(target)}, encontrado ${centsToBRL(balanceCents)}`,
    )
  }
  if (!allOk) {
    throw new Error('regressão detectada — ver linhas "FALHOU" acima. Investigação manual necessária.')
  }
}

// ---------------------------------------------------------------------------
// Passo 6: relatório final
// ---------------------------------------------------------------------------

async function printFinalReport(refs: Refs): Promise<void> {
  console.log('\n==> Passo 6: relatório final')
  const { balanceCents: nubankFinal } = await req<{ balanceCents: number }>(
    'GET',
    `/accounts/${refs.nubank.id}/balance`,
  )
  console.log(`  Nubank: ${centsToBRL(nubankFinal)}`)
  for (const account of refs.regressionAccounts) {
    const { balanceCents } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${account.id}/balance`,
    )
    console.log(`  ${account.name}: ${centsToBRL(balanceCents)}`)
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

    lastStep = 'passo 3 (lançar as três despesas)'
    await createExpenses(refs)

    lastStep = 'passo 4 (medir Nubank)'
    await checkNubank(refs)

    lastStep = 'passo 5 (checagem de regressão)'
    await checkRegression(refs)

    lastStep = 'passo 6 (relatório final)'
    await printFinalReport(refs)

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
