// Teste isolado de invoice-assignment.util.ts (Fase 11), sem banco/HTTP.
// Rodar com: npx tsx scripts/invoice-assignment.util.test.mjs (a partir de oikos-back/)
// Guardado para reuso na Fase 17 (testes automatizados dos cálculos financeiros).
import {
  resolveInitialReferenceMonth,
  addMonthsToReferenceMonth,
  computeInvoiceDates,
  splitInstallmentAmounts,
} from '../src/modules/purchases/invoice-assignment.util.ts'

function assert(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label)
  if (!cond) process.exitCode = 1
}

// resolveInitialReferenceMonth — exemplo literal da seção 5.4
assert(
  resolveInitialReferenceMonth('2026-08-20', 25) === '2026-08-01',
  'resolveInitialReferenceMonth: dia 20 <= closing 25 -> mesmo mês (2026-08-01)',
)
assert(
  resolveInitialReferenceMonth('2026-08-27', 25) === '2026-09-01',
  'resolveInitialReferenceMonth: dia 27 > closing 25 -> mês seguinte (2026-09-01)',
)
assert(
  resolveInitialReferenceMonth('2026-08-25', 25) === '2026-08-01',
  'resolveInitialReferenceMonth: dia == closing_day (limite) -> mesmo mês',
)
assert(
  resolveInitialReferenceMonth('2026-12-27', 25) === '2027-01-01',
  'resolveInitialReferenceMonth: virada de ano (dezembro -> janeiro seguinte)',
)

// addMonthsToReferenceMonth — virada de ano
assert(
  addMonthsToReferenceMonth('2026-11-01', 0) === '2026-11-01',
  'addMonthsToReferenceMonth: +0 meses = mesmo mês',
)
assert(
  addMonthsToReferenceMonth('2026-11-01', 1) === '2026-12-01',
  'addMonthsToReferenceMonth: novembro +1 = dezembro',
)
assert(
  addMonthsToReferenceMonth('2026-11-01', 2) === '2027-01-01',
  'addMonthsToReferenceMonth: novembro +2 = janeiro/2027 (virada de ano)',
)
assert(
  addMonthsToReferenceMonth('2026-11-01', 3) === '2027-02-01',
  'addMonthsToReferenceMonth: novembro +3 = fevereiro/2027',
)

// computeInvoiceDates — due_day <= closing_day (mês seguinte)
{
  const r = computeInvoiceDates('2026-08-01', 25, 5)
  assert(r.closingDate === '2026-08-25', 'computeInvoiceDates: closing_date = 2026-08-25')
  assert(
    r.dueDate === '2026-09-05',
    'computeInvoiceDates: due_day(5) <= closing_day(25) -> due_date no mês seguinte (2026-09-05)',
  )
}

// computeInvoiceDates — due_day > closing_day (mesmo mês)
{
  const r = computeInvoiceDates('2026-08-01', 5, 15)
  assert(r.closingDate === '2026-08-05', 'computeInvoiceDates: closing_date = 2026-08-05')
  assert(
    r.dueDate === '2026-08-15',
    'computeInvoiceDates: due_day(15) > closing_day(5) -> due_date no mesmo mês (2026-08-15)',
  )
}

// computeInvoiceDates — dia 31 caindo em fevereiro (28 dias, 2026 não é bissexto)
{
  const r = computeInvoiceDates('2026-02-01', 31, 31)
  assert(
    r.closingDate === '2026-02-28',
    `computeInvoiceDates: closing_day 31 clampado pra 28 em fev/2026 (veio ${r.closingDate})`,
  )
  // due_day(31) <= closing_day(31) -> mês seguinte (março, 31 dias, não precisa clampar)
  assert(
    r.dueDate === '2026-03-31',
    `computeInvoiceDates: due_date no mês seguinte, março tem 31 dias (veio ${r.dueDate})`,
  )
}

// computeInvoiceDates — dia 31 caindo em abril (30 dias)
{
  const r = computeInvoiceDates('2026-04-01', 31, 10)
  assert(
    r.closingDate === '2026-04-30',
    `computeInvoiceDates: closing_day 31 clampado pra 30 em abril (veio ${r.closingDate})`,
  )
}

// splitInstallmentAmounts
{
  const amounts = splitInstallmentAmounts(1000, 3)
  assert(
    JSON.stringify(amounts) === JSON.stringify([333, 333, 334]),
    `splitInstallmentAmounts(1000,3) = [333,333,334] (veio ${JSON.stringify(amounts)})`,
  )
  assert(amounts.reduce((a, b) => a + b, 0) === 1000, 'splitInstallmentAmounts(1000,3): soma bate com o total')
}
{
  const amounts = splitInstallmentAmounts(100000, 1)
  assert(JSON.stringify(amounts) === JSON.stringify([100000]), 'splitInstallmentAmounts(100000,1) = [100000] (à vista)')
}
{
  const amounts = splitInstallmentAmounts(10, 3)
  assert(
    JSON.stringify(amounts) === JSON.stringify([3, 3, 4]),
    `splitInstallmentAmounts(10,3) = [3,3,4] (veio ${JSON.stringify(amounts)})`,
  )
}
