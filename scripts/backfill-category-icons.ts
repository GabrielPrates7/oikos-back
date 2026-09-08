// Backfill de icon nas categorias reais criadas sem emoji (scripts/import-setembro.ts,
// NEW_CATEGORIES) — Faculdade, Academia, Corte de Cabelo, Dízimo, Assinaturas, Empréstimo,
// Moto, Auto Cuidado, Combustível, Comissão.
//
// Mesmo padrão do script de import: tudo passa pela API HTTP real, autenticado via login
// interativo no terminal. NUNCA faz UPDATE direto no banco, nunca hardcoda credenciais,
// nunca salva o token em disco (fica só em memória durante a execução).
//
// Uso: npx tsx scripts/backfill-category-icons.ts

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

// Nome exato da categoria -> emoji. Mapeamento escolhido por mim (não veio especificado
// literalmente na instrução) — revise antes de rodar, é só trocar o valor aqui.
const CATEGORY_ICONS: Record<string, string> = {
  Faculdade: '🎓',
  Academia: '🏋️',
  'Corte de Cabelo': '💇',
  Dízimo: '⛪',
  Assinaturas: '📱',
  Empréstimo: '🏦',
  Moto: '🏍️',
  'Auto Cuidado': '🧴',
  Combustível: '⛽',
  Comissão: '💰',
}

async function backfillCategoryIcons(): Promise<void> {
  console.log('\n==> Passo 2: backfill de ícones das categorias')
  const { categories } = await req<{ categories: Category[] }>('GET', '/categories?type=expense')

  for (const [name, icon] of Object.entries(CATEGORY_ICONS)) {
    const category = categories.find((c) => c.name === name)
    if (!category) {
      throw new Error(`categoria não encontrada com o nome exato: "${name}"`)
    }

    await req('PUT', `/categories/${category.id}`, { icon })
    console.log(`  ${name}: icon=${icon}`)
  }
}

// ---------------------------------------------------------------------------
// Passo 3: relatório final
// ---------------------------------------------------------------------------

async function printReport(): Promise<void> {
  console.log('\n==> Passo 3: relatório final (confira visualmente)')
  const { categories } = await req<{ categories: Category[] }>('GET', '/categories?type=expense')
  for (const category of categories) {
    console.log(`  ${category.icon ?? '—'}  ${category.name}`)
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
