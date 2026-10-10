import { pool } from '../../config/database.js'

// Formata centavos como reais ("1234" -> "R$ 12,34"), sem depender de Intl (o valor final é
// texto puro dentro de um CSV, não precisa de locale nenhum além da vírgula decimal).
function centsToBRL(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const reais = Math.floor(abs / 100)
  const centavos = String(abs % 100).padStart(2, '0')
  const reaisFormatted = reais.toLocaleString('pt-BR')
  return `${sign}R$ ${reaisFormatted},${centavos}`
}

// "YYYY-MM-DD" -> "DD/MM/AAAA", sem passar por Date (evita bug de fuso horário — mesmo
// princípio já seguido no resto do backend, ver config/database.ts).
function formatDateBR(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

// Escapa um campo pro formato CSV (RFC 4180): aspas duplicadas, campo entre aspas se tiver
// vírgula, aspas ou quebra de linha.
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(',') + '\r\n'
}

interface ExportRow {
  tipo: string
  data: string
  descricao: string
  categoria: string
  conta: string
  valor: string
}

export async function buildExportCsv(userId: string): Promise<string> {
  const incomeResult = await pool.query<{
    description: string
    amount_cents: number
    entry_date: string
    category_name: string | null
    account_name: string | null
  }>(
    `SELECT ie.description, ie.amount_cents, ie.entry_date,
            c.name AS category_name, a.name AS account_name
     FROM income_entries ie
     LEFT JOIN categories c ON c.id = ie.category_id
     LEFT JOIN accounts a ON a.id = ie.account_id
     WHERE ie.user_id = $1
     ORDER BY ie.entry_date, ie.created_at`,
    [userId],
  )

  const expensesResult = await pool.query<{
    description: string
    amount_cents: number
    expense_date: string
    category_name: string | null
    account_name: string | null
  }>(
    `SELECT e.description, e.amount_cents, e.expense_date,
            c.name AS category_name, a.name AS account_name
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN accounts a ON a.id = e.account_id
     WHERE e.user_id = $1
     ORDER BY e.expense_date, e.created_at`,
    [userId],
  )

  const transfersResult = await pool.query<{
    description: string | null
    amount_cents: number
    transfer_date: string
    from_account_name: string | null
    to_account_name: string | null
  }>(
    `SELECT t.description, t.amount_cents, t.transfer_date,
            fa.name AS from_account_name, ta.name AS to_account_name
     FROM transfers t
     LEFT JOIN accounts fa ON fa.id = t.from_account_id
     LEFT JOIN accounts ta ON ta.id = t.to_account_id
     WHERE t.user_id = $1
     ORDER BY t.transfer_date, t.created_at`,
    [userId],
  )

  const rows: ExportRow[] = [
    ...incomeResult.rows.map((row) => ({
      tipo: 'Entrada',
      data: formatDateBR(row.entry_date),
      descricao: row.description,
      categoria: row.category_name ?? 'Categoria removida',
      conta: row.account_name ?? 'Conta removida',
      valor: centsToBRL(row.amount_cents),
    })),
    ...expensesResult.rows.map((row) => ({
      tipo: 'Despesa',
      data: formatDateBR(row.expense_date),
      descricao: row.description,
      categoria: row.category_name ?? 'Categoria removida',
      conta: row.account_name ?? 'Conta removida',
      valor: centsToBRL(row.amount_cents),
    })),
    ...transfersResult.rows.map((row) => ({
      tipo: 'Transferência',
      data: formatDateBR(row.transfer_date),
      descricao: row.description ?? '',
      categoria: '',
      conta: `${row.from_account_name ?? 'Conta removida'} → ${row.to_account_name ?? 'Conta removida'}`,
      valor: centsToBRL(row.amount_cents),
    })),
  ].sort((a, b) => {
    // Ordena por data (DD/MM/AAAA -> AAAA-MM-DD só pra comparar).
    const toIso = (d: string) => d.split('/').reverse().join('-')
    return toIso(a.data).localeCompare(toIso(b.data))
  })

  // BOM UTF-8 no início: sem ele, Excel no Windows abre acentos/emoji quebrados.
  let csv = '﻿'
  csv += csvRow(['Tipo', 'Data', 'Descrição', 'Categoria', 'Conta', 'Valor'])
  for (const row of rows) {
    csv += csvRow([row.tipo, row.data, row.descricao, row.categoria, row.conta, row.valor])
  }
  return csv
}
