/**
 * Test manuali per lib/scoring.ts — A1 (calcVerdict)
 * Eseguire con: node --require ts-node/register lib/scoring.test.ts
 * oppure: npx ts-node lib/scoring.test.ts
 */

import { calcVerdict, calcRoiEstimate } from './scoring'
import { FilteredBook } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ FALLITO: ${label}`)
    failed++
  }
}

// ─── calcVerdict: soglie ROI pure, senza score né banda ───────────────────────

console.log('\n[1] Soglie ROI pure (nessuno score, nessuna banda)')
{
  assert(calcVerdict({ baseRatio: 2.5 }).investVerdict === 'INVEST', 'baseRatio 2.5 → INVEST')
  assert(calcVerdict({ baseRatio: 1.5 }).investVerdict === 'PARTIAL', 'baseRatio 1.5 → PARTIAL')
  assert(calcVerdict({ baseRatio: 0.5 }).investVerdict === 'PASS', 'baseRatio 0.5 → PASS')
}

// ─── calcVerdict: confini esatti ───────────────────────────────────────────────

console.log('\n[2] Confini esatti')
{
  assert(calcVerdict({ baseRatio: 2.0 }).investVerdict === 'INVEST', 'baseRatio 2.0 → INVEST')
  assert(calcVerdict({ baseRatio: 1.0 }).investVerdict === 'PARTIAL', 'baseRatio 1.0 → PARTIAL')
  assert(calcVerdict({ baseRatio: 0.99 }).investVerdict === 'PASS', 'baseRatio 0.99 → PASS')
}

// ─── calcVerdict: degrade attivo INVEST → PARTIAL ──────────────────────────────

console.log('\n[3] Degrade attivo: 2.5 + score 45 + DIFFICILE → PARTIAL')
{
  const r = calcVerdict({ baseRatio: 2.5, profitabilityScore: 45, entryDifficulty: 'DIFFICILE' })
  assert(r.investVerdict === 'PARTIAL', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === 'INVEST', `degradedFrom = ${r.degradedFrom}`)
  assert(typeof r.degradeReason === 'string' && r.degradeReason.length > 0, 'degradeReason presente')
}

// ─── calcVerdict: degrade attivo PARTIAL → PASS ────────────────────────────────

console.log('\n[4] Degrade attivo: 1.5 + score 35 + DIFFICILE → PASS')
{
  const r = calcVerdict({ baseRatio: 1.5, profitabilityScore: 35, entryDifficulty: 'DIFFICILE' })
  assert(r.investVerdict === 'PASS', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === 'PARTIAL', `degradedFrom = ${r.degradedFrom}`)
}

// ─── calcVerdict: score sopra soglia → nessun degrade ──────────────────────────

console.log('\n[5] Score sopra soglia: 2.5 + score 55 + DIFFICILE → INVEST, nessun degrade')
{
  const r = calcVerdict({ baseRatio: 2.5, profitabilityScore: 55, entryDifficulty: 'DIFFICILE' })
  assert(r.investVerdict === 'INVEST', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === undefined, 'degradedFrom assente')
}

// ─── calcVerdict: banda non DIFFICILE → nessun degrade ─────────────────────────

console.log('\n[6] Banda MEDIO: 2.5 + score 45 + MEDIO → INVEST, nessun degrade')
{
  const r = calcVerdict({ baseRatio: 2.5, profitabilityScore: 45, entryDifficulty: 'MEDIO' })
  assert(r.investVerdict === 'INVEST', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === undefined, 'degradedFrom assente (MEDIO non arma il degrade)')
}

// ─── calcVerdict: score assente + DIFFICILE → nessun degrade ──────────────────

console.log('\n[7] Score assente + DIFFICILE → nessun degrade')
{
  const r = calcVerdict({ baseRatio: 2.5, entryDifficulty: 'DIFFICILE' })
  assert(r.investVerdict === 'INVEST', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === undefined, 'degradedFrom assente')
}

// ─── calcVerdict: banda assente + score basso → nessun degrade ────────────────

console.log('\n[8] Banda assente + score basso → nessun degrade')
{
  const r = calcVerdict({ baseRatio: 2.5, profitabilityScore: 10 })
  assert(r.investVerdict === 'INVEST', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === undefined, 'degradedFrom assente')
}

// ─── calcVerdict: PASS numerico + score bassissimo + DIFFICILE → resta PASS ────

console.log('\n[9] PASS numerico + score bassissimo + DIFFICILE → resta PASS, nessun degrade')
{
  const r = calcVerdict({ baseRatio: 0.2, profitabilityScore: 5, entryDifficulty: 'DIFFICILE' })
  assert(r.investVerdict === 'PASS', `investVerdict = ${r.investVerdict}`)
  assert(r.degradedFrom === undefined, 'degradedFrom assente (la regola agisce solo su INVEST/PARTIAL)')
}

// ─── calcRoiEstimate: integrazione, caso targetMid === 0 ──────────────────────

console.log('\n[10] calcRoiEstimate: targetMid === 0 → PASS senza degrade')
{
  const target: FilteredBook = {
    asin: 'Z0000000',
    title: 'Target zero vendite',
    bsr: 999_999,
    bsrTimestamp: new Date().toISOString(),
    price: 14.99,
    currency: 'EUR',
    reviewCount: 10,
    rating: 4.0,
    pages: 200,
    selfPublished: false,
    sponsored: false,
    royalty: 3.5,
    estimatedDailySalesMin: 0,
    estimatedDailySalesMax: 0,
    pagesEstimated: false,
  }

  const result = calcRoiEstimate(target, 'IT', {
    profitabilityScore: 5,
    entryDifficulty: 'DIFFICILE',
  })

  assert(result.investVerdict === 'PASS', `investVerdict = ${result.investVerdict}`)
  assert(result.degradedFrom === undefined, 'degradedFrom assente')
  assert(result.degradeReason === undefined, 'degradeReason assente')
}

// ─── Risultato finale ────────────────────────────────────────────────────────

console.log(`\n── Risultato: ${passed} passati, ${failed} falliti ──\n`)
if (failed > 0) process.exit(1)
