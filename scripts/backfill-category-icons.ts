// Backfill de icon nas categorias reais que ainda estão sem emoji.
//
// Mapeamento definitivo passado pela instrução (substitui a tentativa anterior deste script,
// que nunca chegou a rodar — todas as categorias abaixo ainda estão com icon = null). Uma
// ambiguidade resolvida aqui, não explícita na instrução: "Presente" existe como categoria
// de despesa (própria do usuário, sem ícone) E de receita (padrão compartilhada, já com
// 🎁) — o alvo é a de DESPESA, já que é a única das duas que precisa do ícone e é a única
// do grupo (as outras 9 também são despesas próprias, exceto Comissão que é receita).
//
// Mesmo padrão dos scripts anteriores: tudo passa pela API HTTP real, autenticado via login
// interativo no terminal. NUNCA faz UPDATE direto no banco, nunca hardcoda credenciais,
// nunca salva o token em disco (fica só em memória durante a execução).
//
// Uso: npx tsx scripts/backfill-category-icons.ts

import { createInterface } from 'node:readline/promises'

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api'

let accessToken: string | null = null

// ---------------------------------------------------------------------------
// Prompt interativo (mesmo código dos scripts anteriores)
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

// pageSize:100 explícito — /categories pagina por padrão (20 por página) desde a fase de
// paginação; sem isso, uma lista com mais de 20 categorias perderia as últimas.
async function fetchCategories(type: 'expense' | 'income'): Promise<Category[]> {
  const { categories } = await req<{ categories: Category[] }>(
    'GET',
    `/categories?type=${type}&pageSize=100`,
  )
  return categories
}

function iconOrDash(icon: string | null): string {
  return icon ?? '—'
}

// ---------------------------------------------------------------------------
// Tipos mínimos
// ---------------------------------------------------------------------------

interface Category {
  id: string
  name: string
  type: 'income' | 'expense'
  icon: string | null
}

// ---------------------------------------------------------------------------
// Mapeamento definitivo: nome exato -> { tipo, emoji }. Tipo importa porque "Presente"
// existe nos dois (ver comentário no topo do arquivo) — buscar sem separar por tipo
// resolveria pro registro errado.
// ---------------------------------------------------------------------------

interface IconDef {
  type: 'expense' | 'income'
  icon: string
}

const CATEGORY_ICONS: Record<string, IconDef> = {
  Empréstimo: { type: 'expense', icon: '🏦' },
  Academia: { type: 'expense', icon: '💪' },
  Assinaturas: { type: 'expense', icon: '📺' },
  'Auto Cuidado': { type: 'expense', icon: '🧴' },
  Combustível: { type: 'expense', icon: '⛽' },
  'Corte de Cabelo': { type: 'expense', icon: '✂️' },
  Dízimo: { type: 'expense', icon: '🙏' },
  Moto: { type: 'expense', icon: '🏍️' },
  Presente: { type: 'expense', icon: '🎁' },
  Comissão: { type: 'income', icon: '💵' },
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
// Passo 2: backfill dos ícones
// ---------------------------------------------------------------------------

async function backfillCategoryIcons(): Promise<void> {
  console.log('\n==> Passo 2: backfill de ícones das categorias')

  const expenseCategories = await fetchCategories('expense')
  const incomeCategories = await fetchCategories('income')

  for (const [name, { type, icon }] of Object.entries(CATEGORY_ICONS)) {
    const pool = type === 'expense' ? expenseCategories : incomeCategories
    const category = pool.find((c) => c.name === name)
    if (!category) {
      throw new Error(`categoria de ${type} não encontrada com o nome exato: "${name}"`)
    }

    await req('PUT', `/categories/${category.id}`, { icon })
    console.log(`  ${name} (${type}): icon=${icon}`)
  }
}

// ---------------------------------------------------------------------------
// Passo 3: relatório final — confirma via GET que os 10 ícones foram aplicados
// ---------------------------------------------------------------------------

async function printReport(): Promise<void> {
  console.log('\n==> Passo 3: relatório final (confirmando via GET)')

  const expenseCategories = await fetchCategories('expense')
  const incomeCategories = await fetchCategories('income')

  let allOk = true
  for (const [name, { type, icon: expectedIcon }] of Object.entries(CATEGORY_ICONS)) {
    const pool = type === 'expense' ? expenseCategories : incomeCategories
    const category = pool.find((c) => c.name === name)
    const actualIcon = category?.icon ?? null
    const ok = actualIcon === expectedIcon
    allOk &&= ok
    console.log(
      `  ${ok ? 'OK ' : 'FALHOU'} ${name} (${type}): esperado ${expectedIcon}, encontrado ${iconOrDash(actualIcon)}`,
    )
  }

  if (!allOk) {
    throw new Error('nem todos os ícones bateram com o esperado — ver linhas "FALHOU" acima.')
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let lastStep = 'login'
  try {
    await login()

    lastStep = 'passo 2 (backfill de ícones)'
    await backfillCategoryIcons()

    lastStep = 'passo 3 (confirmar via GET)'
    await printReport()

    console.log('\n✔ Backfill concluído e confirmado com sucesso.')
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
