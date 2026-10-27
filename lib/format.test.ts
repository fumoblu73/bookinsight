import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatItalianDate, formatItalianNumber, formatReportFileDate } from './format'

test('raggruppamento esplicito anche per i numeri a quattro cifre del collaudo', () => {
  for (const [number, expected] of [[999, '999'], [1040, '1.040'], [2100, '2.100'], [7586, '7.586'], [10000, '10.000']] as const) {
    assert.equal(formatItalianNumber(number), expected)
  }
})

test('decimali e segno mantengono i valori e la precisione richiesti dalle viste', () => {
  assert.equal(formatItalianNumber(-1040.5, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '-1.040,50')
  assert.equal(formatItalianNumber(12.345, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '12,35')
  assert.equal(formatItalianNumber(0), '0')
})

test('date coerenti al cambio di giorno e di ora legale, indipendenti dal fuso del processo', () => {
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' }
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone
      assert.equal(formatItalianDate('2026-10-26T23:30:00Z', options), '27 ottobre 2026')
      assert.equal(formatReportFileDate('2026-10-26T23:30:00Z'), '261027')
      assert.equal(formatItalianDate('2026-07-01T22:30:00Z', options), '02 luglio 2026')
      assert.equal(formatReportFileDate('2026-07-01T22:30:00Z'), '260702')
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
