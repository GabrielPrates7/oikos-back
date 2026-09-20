// Correção pontual: "Conta VIVO" estava lançada como paga no Nubank, mas na verdade foi
// paga via Bradesco (com uma transferência do Nubank cobrindo o valor). Move a despesa pra
// Bradesco/não paga e lança a transferência que efetivamente cobre o pagamento, depois
// recalibra o saldo inicial das duas contas pro valor exato de sempre.
//
// Mesmo padrão dos scripts anteriores (reconciliacao-setembro.ts etc.): tudo passa pela API
// HTTP real, autenticado como o usuário de verdade via login interativo no terminal. NUNCA
// faz INSERT direto no banco, nunca hardcoda credenciais, nunca salva o token em disco.
//
// Conferido por leitura direta (read-only) antes de escrever este script:
//   Nubank: 18538 centavos (R$185,38) — bate com a reconciliação anterior.
//   Bradesco: 4610 centavos (R$46,10) — idem.
//   Conta VIVO: 4400 centavos, is_paid=true, paid_date=null, conta=Nubank.
// Efeito líquido calculado das duas operações:
//   Nubank: PUT (+4400, some da subtração do Nubank) + transferência (-4400) = 0 líquido —
//     deve voltar exatamente pro mesmo valor de antes (18538), sem precisar de ajuste.
//   Bradesco: PUT (+0, despesa não paga não subtrai) + transferência (+4400) = +4400 —
//     vai pra 9010, então PRECISA de um ajuste de -4400 no saldo inicial pra voltar a 4610.
// O script mede de verdade em vez de confiar nessa conta de cabeça — se algo mudou entre
// essa leitura e a execução, o ajuste automático absorve a diferença de qualquer jeito.
//
// Uso: npx tsx scripts/fix-conta-vivo.ts

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
  initial_balance_cents: number
}

interface Expense {
  id: string
  description: string
  amount_cents: number
}

// ---------------------------------------------------------------------------
// Alvos desta correção
// ---------------------------------------------------------------------------

const BRADESCO_TARGET_CENTS = 4610
// "valor esperado da reconciliação anterior" — reconciliacao-setembro.ts deixou o Nubank
// exatamente aqui; se nada mais mexeu nele nesse meio-tempo, deve continuar batendo sozinho.
const NUBANK_TARGET_CENTS = 18538

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
// Passo 2: resolver contas e localizar a despesa "Conta VIVO"
// ---------------------------------------------------------------------------

interface Refs {
  nubank: Account
  bradesco: Account
  contaVivo: Expense
}

async function loadRefs(): Promise<Refs> {
  console.log('\n==> Passo 2: carregando contas e localizando "Conta VIVO"')

  const accounts = await fetchAllPages<Account>('/accounts?status=all', 'accounts')
  const accountsByName = new Map(accounts.map((a) => [a.name, a]))

  const nubank = accountsByName.get('Nubank')
  if (!nubank) throw new Error('conta não encontrada com o nome exato: "Nubank"')
  const bradesco = accountsByName.get('Bradesco')
  if (!bradesco) throw new Error('conta não encontrada com o nome exato: "Bradesco"')

  const expenses = await fetchAllPages<Expense>('/expenses', 'expenses')
  const matches = expenses.filter((e) => e.description === 'Conta VIVO')
  if (matches.length === 0) {
    throw new Error('despesa não encontrada com a descrição exata: "Conta VIVO"')
  }
  if (matches.length > 1) {
    throw new Error(
      `mais de uma despesa com a descrição exata "Conta VIVO" (${matches.length} encontradas) — ` +
        'ambíguo, abortando.',
    )
  }
  const contaVivo = matches[0]
  if (contaVivo.amount_cents !== 4400) {
    console.warn(
      `  aviso: "Conta VIVO" encontrada com ${centsToBRL(contaVivo.amount_cents)}, ` +
        `esperado ${centsToBRL(4400)} — seguindo mesmo assim (match foi por descrição exata).`,
    )
  }

  console.log(`  Nubank: ${nubank.id}`)
  console.log(`  Bradesco: ${bradesco.id}`)
  console.log(`  Conta VIVO: ${contaVivo.id} (${centsToBRL(contaVivo.amount_cents)})`)

  return { nubank, bradesco, contaVivo }
}

// ---------------------------------------------------------------------------
// Passo 3: mover "Conta VIVO" pro Bradesco, não paga
// ---------------------------------------------------------------------------

async function fixContaVivo(refs: Refs): Promise<void> {
  console.log('\n==> Passo 3: movendo "Conta VIVO" pro Bradesco, marcando como não paga')
  await req('PUT', `/expenses/${refs.contaVivo.id}`, {
    account_id: refs.bradesco.id,
    is_paid: false,
    paid_date: null,
  })
  console.log('  feito: conta = Bradesco, is_paid = false, paid_date = null')
}

// ---------------------------------------------------------------------------
// Passo 4: transferência Nubank -> Bradesco
// ---------------------------------------------------------------------------

async function createTransfer(refs: Refs): Promise<void> {
  console.log('\n==> Passo 4: lançando transferência Nubank -> Bradesco')
  await req('POST', '/transfers', {
    from_account_id: refs.nubank.id,
    to_account_id: refs.bradesco.id,
    amount_cents: 4400,
    transfer_date: '2026-09-03',
    description: 'Transferência para pagar Conta VIVO',
  })
  console.log(`  ${centsToBRL(4400)} em 03/09`)
}

// ---------------------------------------------------------------------------
// Passo 5: medir e recalibrar Nubank e Bradesco pro valor exato
// ---------------------------------------------------------------------------

async function recalibrate(account: Account, label: string, targetCents: number): Promise<number> {
  const { balanceCents: calculatedCents } = await req<{ balanceCents: number }>(
    'GET',
    `/accounts/${account.id}/balance`,
  )
  const delta = targetCents - calculatedCents

  if (delta !== 0) {
    const { account: current } = await req<{ account: Account }>('GET', `/accounts/${account.id}`)
    const newInitialBalanceCents = current.initial_balance_cents + delta
    await req('PUT', `/accounts/${account.id}`, { initial_balance_cents: newInitialBalanceCents })
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
  return finalCents
}

async function recalibrateBoth(refs: Refs): Promise<void> {
  console.log('\n==> Passo 5: medindo e recalibrando Nubank e Bradesco')
  await recalibrate(refs.nubank, 'Nubank', NUBANK_TARGET_CENTS)
  await recalibrate(refs.bradesco, 'Bradesco', BRADESCO_TARGET_CENTS)
}

// ---------------------------------------------------------------------------
// Passo 6: relatório final
// ---------------------------------------------------------------------------

async function printFinalReport(refs: Refs): Promise<void> {
  console.log('\n==> Passo 6: relatório final')
  for (const [label, account] of [
    ['Nubank', refs.nubank],
    ['Bradesco', refs.bradesco],
  ] as const) {
    const { balanceCents } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${account.id}/balance`,
    )
    console.log(`  ${label}: ${centsToBRL(balanceCents)}`)
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

    lastStep = 'passo 3 (mover Conta VIVO pro Bradesco)'
    await fixContaVivo(refs)

    lastStep = 'passo 4 (transferência Nubank -> Bradesco)'
    await createTransfer(refs)

    lastStep = 'passo 5 (recalibração)'
    await recalibrateBoth(refs)

    lastStep = 'passo 6 (relatório final)'
    await printFinalReport(refs)

    console.log('\n✔ Correção concluída com sucesso.')
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
