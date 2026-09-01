// Teste isolado de invoice-status.util.ts (Fase 12), sem banco/HTTP.
// Rodar com: npx tsx scripts/invoice-status.util.test.mjs (a partir de oikos-back/)
// Guardado para reuso na Fase 17 (testes automatizados dos cálculos financeiros).
import { computeDisplayStatus } from '../src/modules/invoices/invoice-status.util.ts'

function assert(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label)
  if (!cond) process.exitCode = 1
}

const closingDate = '2026-08-25'
const dueDate = '2026-09-05'

// caso 1: rawStatus === 'paid' -> sempre 'paid', independente das datas
assert(
  computeDisplayStatus('paid', closingDate, dueDate, '2026-01-01') === 'paid',
  "rawStatus='paid' -> 'paid' mesmo com today muito antes das datas",
)
assert(
  computeDisplayStatus('paid', closingDate, dueDate, '2027-01-01') === 'paid',
  "rawStatus='paid' -> 'paid' mesmo com today muito depois das datas",
)

// caso 2: today antes do closing -> 'open'
assert(
  computeDisplayStatus('open', closingDate, dueDate, '2026-08-24') === 'open',
  'today < closingDate -> open',
)

// caso 3: today === closingDate (limite exato) -> 'closed'
assert(
  computeDisplayStatus('open', closingDate, dueDate, '2026-08-25') === 'closed',
  'today === closingDate (limite exato) -> closed',
)

// caso 4: today entre closing e due -> 'closed'
assert(
  computeDisplayStatus('open', closingDate, dueDate, '2026-08-30') === 'closed',
  'closingDate < today < dueDate -> closed',
)

// caso 5: today === dueDate (limite exato) -> 'overdue'
assert(
  computeDisplayStatus('open', closingDate, dueDate, '2026-09-05') === 'overdue',
  'today === dueDate (limite exato) -> overdue',
)

// caso 6: today depois do due -> 'overdue'
assert(
  computeDisplayStatus('open', closingDate, dueDate, '2026-09-10') === 'overdue',
  'today > dueDate -> overdue',
)

// rawStatus diferente de 'paid' não muda a lógica de datas (ex: 'closed' persistido, mas já venceu)
assert(
  computeDisplayStatus('closed', closingDate, dueDate, '2026-09-10') === 'overdue',
  "rawStatus='closed' mas today > dueDate -> overdue (datas mandam, exceto quando já 'paid')",
)
