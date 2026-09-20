// Duas correções pontuais e independentes:
//   1) Remove a Row B ("Padaria Akitanda Arcos Bra (compra em 28/08)", R$5,40,
//      purchase_date=2026-08-30, PicPay) — duplicata lançada por engano na reconciliação
//      recente (reconciliacao-setembro.ts, fase 6). A Row A ("Padaria Akitanda", R$5,40,
//      purchase_date=2026-08-28) é a original, correta, já paga em agosto, e NÃO é tocada.
//      As duas NÃO compartilham um mesmo trio description+purchase_date+total — description
//      e purchase_date diferem entre as duas (só o total, R$5,40, é igual) — por isso cada
//      Row é localizada pelo seu PRÓPRIO trio exato, mais o id confirmado visualmente na
//      conversa como camada extra de segurança antes do DELETE.
//   2) Marca "Dízimo + Oferta" (R$267,20, Nubank) como não paga — estava is_paid=true,
//      paid_date=null (mesmo padrão de registro antigo já visto nas outras despesas desta
//      reconciliação). Isso só REDUZ o que já conta no saldo do Nubank (deixa de subtrair
//      R$267,20), então não precisa de recalibração — o saldo resultante é o valor
//      verdadeiro, não um desvio a corrigir.
//
// Conferido por leitura direta (read-only) antes de escrever este script:
//   - Row A (id 1bcf92fd..., NÃO apagar): "Padaria Akitanda", R$5,40, purchase_date
//     2026-08-28, createdAt 2026-09-06, sem installment pago.
//   - Row B (id 355c54be..., apagar): "Padaria Akitanda Arcos Bra (compra em 28/08)",
//     R$5,40, purchase_date 2026-08-30, createdAt 2026-09-08 (mais recente que Row A — bate
//     com a premissa de que é a duplicata mais nova), sem installment pago (a exclusão não
//     esbarra na trava de "parcela já paga").
//   - "Dízimo + Oferta": id único, R$267,20, Nubank, is_paid=true, paid_date=null.
//   - Nubank hoje: R$185,38 (calculado). Marcar Dízimo como não paga deve levar pra
//     R$185,38 + R$267,20 = R$452,58 — o script mede de verdade em vez de confiar nessa
//     conta de cabeça.
//
// Mesmo padrão dos scripts anteriores: tudo passa pela API HTTP real, autenticado como o
// usuário de verdade via login interativo no terminal. NUNCA faz DELETE/UPDATE direto no
// banco, nunca hardcoda credenciais, nunca salva o token em disco.
//
// Uso: npx tsx scripts/fix-duplicate-padaria-e-dizimo.ts

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

interface CreditCard {
  id: string
  name: string
}

interface Purchase {
  id: string
  description: string
  total_amount_cents: number
  purchase_date: string
  created_at: string
}

interface Expense {
  id: string
  description: string
  amount_cents: number
}

const EXPECTED_TOTAL_CENTS = 540

// Row A — original, correta, já paga em agosto. NÃO é pra ser apagada. id confirmado
// visualmente pelo usuário na conversa antes de rodar.
const ROW_A_ID = '1bcf92fd-bfa5-4f33-b447-24357e44cfca'
const ROW_A_DESCRIPTION = 'Padaria Akitanda'
const ROW_A_PURCHASE_DATE = '2026-08-28'

// Row B — duplicata lançada por engano na reconciliação recente. É a que será apagada.
// id confirmado visualmente pelo usuário na conversa antes de rodar.
const ROW_B_ID = '355c54be-0be7-4121-b969-e174a4d30dfa'
const ROW_B_DESCRIPTION = 'Padaria Akitanda Arcos Bra (compra em 28/08)'
const ROW_B_PURCHASE_DATE = '2026-08-30'

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
// Passo 2: localizar a duplicata e confirmar que o original continua existindo
// ---------------------------------------------------------------------------

async function findPicPayCardId(): Promise<string> {
  const cards = await fetchAllPages<CreditCard>('/credit-cards?status=all', 'creditCards')
  const picpay = cards.find((c) => c.name === 'PicPay')
  if (!picpay) throw new Error('cartão não encontrado com o nome exato: "PicPay"')
  return picpay.id
}

// Busca por description + purchase_date + total_amount_cents (os três juntos, não só
// descrição) e, além disso, confere o id contra o que foi confirmado visualmente na
// conversa — três camadas de checagem antes de deixar qualquer DELETE acontecer.
function findExactPurchase(
  purchases: Purchase[],
  label: string,
  description: string,
  purchaseDate: string,
  expectedId: string,
): Purchase {
  const matches = purchases.filter(
    (p) =>
      p.description === description &&
      p.purchase_date === purchaseDate &&
      p.total_amount_cents === EXPECTED_TOTAL_CENTS,
  )
  if (matches.length !== 1) {
    throw new Error(
      `PARE — esperava exatamente 1 compra "${label}" (description="${description}", ` +
        `purchase_date=${purchaseDate}, total=${centsToBRL(EXPECTED_TOTAL_CENTS)}), encontradas ` +
        `${matches.length}. Não apaguei nada.`,
    )
  }
  const match = matches[0]
  if (match.id !== expectedId) {
    throw new Error(
      `PARE — "${label}" encontrada (id ${match.id}) não bate com o id confirmado na conversa ` +
        `(${expectedId}). Não apaguei nada.`,
    )
  }
  return match
}

async function findRows(picpayCardId: string): Promise<{ rowA: Purchase; rowB: Purchase }> {
  console.log('\n==> Passo 2: localizando Row A (original) e Row B (duplicata)')
  const { purchases } = await req<{ purchases: Purchase[] }>(
    'GET',
    `/credit-cards/${picpayCardId}/purchases`,
  )

  const rowA = findExactPurchase(
    purchases,
    'Row A (original)',
    ROW_A_DESCRIPTION,
    ROW_A_PURCHASE_DATE,
    ROW_A_ID,
  )
  const rowB = findExactPurchase(
    purchases,
    'Row B (duplicata)',
    ROW_B_DESCRIPTION,
    ROW_B_PURCHASE_DATE,
    ROW_B_ID,
  )

  console.log(`  Row A (original — NÃO será apagada): ${rowA.id}`)
  console.log(
    `    description: "${rowA.description}" | purchase_date: ${rowA.purchase_date} | createdAt: ${rowA.created_at}`,
  )
  console.log(`  Row B (duplicata — SERÁ apagada): ${rowB.id}`)
  console.log(
    `    description: "${rowB.description}" | purchase_date: ${rowB.purchase_date} | createdAt: ${rowB.created_at}`,
  )

  // Confere que a premissa "B é a mais recente" realmente bate no createdAt, além da
  // conferência visual que o usuário já fez na conversa.
  if (new Date(rowB.created_at).getTime() <= new Date(rowA.created_at).getTime()) {
    throw new Error(
      'PARE — Row B (que eu ia apagar) não é mais recente que Row A pelo createdAt, o que ' +
        'contradiz a premissa de que B é a duplicata mais nova. Não apaguei nada.',
    )
  }

  return { rowA, rowB }
}

// ---------------------------------------------------------------------------
// Passo 3: excluir a duplicata
// ---------------------------------------------------------------------------

async function deleteDuplicatePurchase(purchaseId: string): Promise<void> {
  console.log('\n==> Passo 3: excluindo a compra duplicada')
  await req('DELETE', `/purchases/${purchaseId}`)
  console.log(`  excluída: ${purchaseId}`)
}

// ---------------------------------------------------------------------------
// Passo 4: confirmar via GET que só sobrou uma ocorrência
// ---------------------------------------------------------------------------

async function verifyOnlyRowARemains(picpayCardId: string): Promise<void> {
  console.log('\n==> Passo 4: confirmando via GET que só resta a Row A agora')
  const { purchases } = await req<{ purchases: Purchase[] }>(
    'GET',
    `/credit-cards/${picpayCardId}/purchases`,
  )

  const stillHasRowB = purchases.some(
    (p) =>
      p.description === ROW_B_DESCRIPTION &&
      p.purchase_date === ROW_B_PURCHASE_DATE &&
      p.total_amount_cents === EXPECTED_TOTAL_CENTS,
  )
  if (stillHasRowB) {
    throw new Error('PARE — Row B ainda aparece na listagem depois do DELETE.')
  }

  const rowAMatches = purchases.filter(
    (p) =>
      p.description === ROW_A_DESCRIPTION &&
      p.purchase_date === ROW_A_PURCHASE_DATE &&
      p.total_amount_cents === EXPECTED_TOTAL_CENTS &&
      p.id === ROW_A_ID,
  )
  if (rowAMatches.length !== 1) {
    throw new Error(
      `PARE — depois do DELETE, esperava exatamente 1 Row A com id ${ROW_A_ID} ` +
        `(encontradas ${rowAMatches.length}).`,
    )
  }

  console.log(`  OK: Row B não aparece mais; Row A (${rowAMatches[0].id}) continua intacta.`)
}

// ---------------------------------------------------------------------------
// Passo 5: localizar "Dízimo + Oferta" e marcar como não paga
// ---------------------------------------------------------------------------

async function fixDizimo(): Promise<Expense> {
  console.log('\n==> Passo 5: localizando "Dízimo + Oferta" e marcando como não paga')

  const expenses = await fetchAllPages<Expense>('/expenses', 'expenses')
  const matches = expenses.filter((e) => e.description === 'Dízimo + Oferta')
  if (matches.length === 0) {
    throw new Error('despesa não encontrada com a descrição exata: "Dízimo + Oferta"')
  }
  if (matches.length > 1) {
    throw new Error(
      `mais de uma despesa com a descrição exata "Dízimo + Oferta" (${matches.length} ` +
        'encontradas) — ambíguo, abortando.',
    )
  }
  const dizimo = matches[0]
  if (dizimo.amount_cents !== 26720) {
    console.warn(
      `  aviso: "Dízimo + Oferta" encontrada com ${centsToBRL(dizimo.amount_cents)}, ` +
        `esperado ${centsToBRL(26720)} — seguindo mesmo assim (match foi por descrição exata).`,
    )
  }

  await req('PUT', `/expenses/${dizimo.id}`, { is_paid: false, paid_date: null })
  console.log(`  feito: ${dizimo.id} (${centsToBRL(dizimo.amount_cents)}) is_paid = false`)
  return dizimo
}

// ---------------------------------------------------------------------------
// Passo 6: relatório final — saldo de Nubank antes/depois, sem recalibração
// ---------------------------------------------------------------------------

async function printFinalReport(nubankBalanceBefore: number): Promise<void> {
  console.log('\n==> Passo 6: relatório final')

  const accounts = await fetchAllPages<{ id: string; name: string }>(
    '/accounts?status=all',
    'accounts',
  )
  const nubank = accounts.find((a) => a.name === 'Nubank')
  if (!nubank) throw new Error('conta não encontrada com o nome exato: "Nubank"')

  const { balanceCents: nubankBalanceAfter } = await req<{ balanceCents: number }>(
    'GET',
    `/accounts/${nubank.id}/balance`,
  )

  console.log(`  Nubank antes: ${centsToBRL(nubankBalanceBefore)}`)
  console.log(`  Nubank depois: ${centsToBRL(nubankBalanceAfter)}`)
  console.log(`  diferença: ${centsToBRL(nubankBalanceAfter - nubankBalanceBefore)}`)
  console.log('  (nenhuma recalibração de saldo inicial foi feita — o valor acima é o saldo real)')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let lastStep = 'login'
  try {
    await login()

    lastStep = 'passo 2 (localizar Row A e Row B)'
    const picpayCardId = await findPicPayCardId()
    const { rowB } = await findRows(picpayCardId)

    lastStep = 'medir saldo do Nubank antes da correção do Dízimo'
    const accountsBefore = await fetchAllPages<{ id: string; name: string }>(
      '/accounts?status=all',
      'accounts',
    )
    const nubankBefore = accountsBefore.find((a) => a.name === 'Nubank')
    if (!nubankBefore) throw new Error('conta não encontrada com o nome exato: "Nubank"')
    const { balanceCents: nubankBalanceBefore } = await req<{ balanceCents: number }>(
      'GET',
      `/accounts/${nubankBefore.id}/balance`,
    )

    lastStep = 'passo 3 (excluir Row B)'
    await deleteDuplicatePurchase(rowB.id)

    lastStep = 'passo 4 (confirmar que só resta Row A)'
    await verifyOnlyRowARemains(picpayCardId)

    lastStep = 'passo 5 (marcar Dízimo como não paga)'
    await fixDizimo()

    lastStep = 'passo 6 (relatório final)'
    await printFinalReport(nubankBalanceBefore)

    console.log('\n✔ Correções concluídas com sucesso.')
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
