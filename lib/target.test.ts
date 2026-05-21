/**
 * Test manuali per lib/target.ts — Milestone 2
 * Eseguire con: node --require ts-node/register lib/target.test.ts
 * oppure: npx ts-node lib/target.test.ts
 */

import { buildTargetFinderResult, estimateNicheReviewVelocity, RawCandidate } from './target'

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

// Data nel passato per calcolo età (fuori honeymoon)
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

// ─── Candidato base ───────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<RawCandidate> & { asin: string }): RawCandidate {
  return {
    title: `Libro ${overrides.asin}`,
    price: 14.99,
    currency: 'EUR',
    reviewCount: 50,
    rating: 4.5,
    bsr: 5000,
    pages: 250,
    publishedDate: daysAgo(400), // ~13 mesi fa, fuori honeymoon
    selfPublished: false,
    ...overrides,
  }
}

// ─── Test 1: Gate recensioni — 90 recensioni → sempre ATTACCABILE ─────────────

console.log('\n[1] Gate: 90 recensioni → ATTACCABILE')
{
  // 5 candidati per avere abbastanza dati per la nicchia e le mediane
  const candidates: RawCandidate[] = [
    makeCandidate({ asin: 'A0000001', reviewCount: 90,  rating: 4.5 }),
    makeCandidate({ asin: 'A0000002', reviewCount: 80,  rating: 4.4 }),
    makeCandidate({ asin: 'A0000003', reviewCount: 60,  rating: 4.6 }),
    makeCandidate({ asin: 'A0000004', reviewCount: 70,  rating: 4.3 }),
    makeCandidate({ asin: 'A0000005', reviewCount: 55,  rating: 4.7 }),
  ]
  const result = buildTargetFinderResult(candidates, 'test keyword', 'IT', new Date().toISOString())
  const c = result.candidates.find(c => c.asin === 'A0000001')!
  assert(c !== undefined, 'candidato trovato')
  assert(c.attackability === 'ATTACCABILE', `attackability = ${c.attackability}`)
  assert(c.quadrant !== 'NON_ATTACCABILE', `quadrant non è NON_ATTACCABILE (è ${c.quadrant})`)
}

// ─── Test 2: Gate recensioni — 200 recensioni → NON_ATTACCABILE ───────────────

console.log('\n[2] Gate: 200 recensioni → NON_ATTACCABILE')
{
  const candidates: RawCandidate[] = [
    makeCandidate({ asin: 'B0000001', reviewCount: 200, rating: 4.5 }),
    makeCandidate({ asin: 'B0000002', reviewCount: 80,  rating: 4.4 }),
    makeCandidate({ asin: 'B0000003', reviewCount: 60,  rating: 4.6 }),
    makeCandidate({ asin: 'B0000004', reviewCount: 70,  rating: 4.3 }),
    makeCandidate({ asin: 'B0000005', reviewCount: 55,  rating: 4.7 }),
  ]
  const result = buildTargetFinderResult(candidates, 'test keyword', 'IT', new Date().toISOString())
  const c = result.candidates.find(c => c.asin === 'B0000001')!
  assert(c.attackability === 'NON_ATTACCABILE', `attackability = ${c.attackability}`)
  assert(c.quadrant === 'NON_ATTACCABILE', `quadrant = ${c.quadrant}`)
}

// ─── Test 3: 130 recensioni + 2 fattori → ATTACCABILE_SE_PROMOSSO ─────────────
// Velocità nicchia alta (~20/mese) → monthsToParity = 130/20 = 6.5 → lowReviewVelocity
// rating 4.2 → weakRating
// Entrambi i fattori attivi, nessun veto → promosso

console.log('\n[3] 130 recensioni + 2 fattori → ATTACCABILE_SE_PROMOSSO')
{
  // Candidati con età 10 mesi e 200 recensioni ciascuno → velocity ~20/mese
  const base: RawCandidate = makeCandidate({ asin: 'X', reviewCount: 200, publishedDate: daysAgo(305) })
  const candidates: RawCandidate[] = [
    { ...base, asin: 'C0000001', reviewCount: 130, rating: 4.2 }, // target: 2 fattori
    { ...base, asin: 'C0000002', reviewCount: 200, rating: 4.5, publishedDate: daysAgo(305) },
    { ...base, asin: 'C0000003', reviewCount: 200, rating: 4.4, publishedDate: daysAgo(305) },
    { ...base, asin: 'C0000004', reviewCount: 200, rating: 4.6, publishedDate: daysAgo(305) },
    { ...base, asin: 'C0000005', reviewCount: 200, rating: 4.3, publishedDate: daysAgo(305) },
  ]
  const result = buildTargetFinderResult(candidates, 'test keyword', 'IT', new Date().toISOString())
  const c = result.candidates.find(c => c.asin === 'C0000001')!

  // Verifica velocità nicchia calcolata
  const nicheVel = result.nicheReviewVelocity
  console.log(`    nicheReviewVelocity = ${nicheVel.toFixed(1)} rec/mese`)
  console.log(`    monthsToParity = ${c.monthsToParity.toFixed(1)} mesi`)
  console.log(`    lowReviewVelocity = ${c.promotionFactors.lowReviewVelocity}`)
  console.log(`    weakRating = ${c.promotionFactors.weakRating}`)
  console.log(`    ratingVeto = ${c.promotionFactors.ratingVeto}`)

  assert(c.promotionFactors.lowReviewVelocity === true, 'fattore 1: lowReviewVelocity = true')
  assert(c.promotionFactors.weakRating === true, 'fattore 2: weakRating = true (rating 4.2 ≤ 4.3)')
  assert(c.promotionFactors.ratingVeto === false, 'nessun veto')
  assert(c.attackability === 'ATTACCABILE_SE_PROMOSSO', `attackability = ${c.attackability}`)
}

// ─── Test 4: 130 recensioni + 1 solo fattore → NON_PROMOSSO ──────────────────
// Velocità nicchia bassa (~5/mese) → monthsToParity = 130/5 = 26 → NO lowReviewVelocity
// rating 4.2 → weakRating = true, ma 1 solo fattore su 2

console.log('\n[4] 130 recensioni + 1 fattore (solo weakRating) → NON_PROMOSSO')
{
  // Candidati con età 40 mesi e 200 recensioni → velocity ~5/mese
  const base: RawCandidate = makeCandidate({ asin: 'X', reviewCount: 200, publishedDate: daysAgo(40 * 30) })
  const candidates: RawCandidate[] = [
    { ...base, asin: 'D0000001', reviewCount: 130, rating: 4.2 }, // 1 fattore
    { ...base, asin: 'D0000002', reviewCount: 200, rating: 4.5, publishedDate: daysAgo(40 * 30) },
    { ...base, asin: 'D0000003', reviewCount: 200, rating: 4.4, publishedDate: daysAgo(40 * 30) },
    { ...base, asin: 'D0000004', reviewCount: 200, rating: 4.6, publishedDate: daysAgo(40 * 30) },
    { ...base, asin: 'D0000005', reviewCount: 200, rating: 4.3, publishedDate: daysAgo(40 * 30) },
  ]
  const result = buildTargetFinderResult(candidates, 'test keyword', 'IT', new Date().toISOString())
  const c = result.candidates.find(c => c.asin === 'D0000001')!

  console.log(`    nicheReviewVelocity = ${result.nicheReviewVelocity.toFixed(1)} rec/mese`)
  console.log(`    monthsToParity = ${c.monthsToParity.toFixed(1)} mesi`)
  console.log(`    lowReviewVelocity = ${c.promotionFactors.lowReviewVelocity}`)
  console.log(`    weakRating = ${c.promotionFactors.weakRating}`)

  assert(c.promotionFactors.lowReviewVelocity === false, 'fattore 1: lowReviewVelocity = false (muro > 8 mesi)')
  assert(c.promotionFactors.weakRating === true, 'fattore 2: weakRating = true')
  assert(c.attackability === 'NON_PROMOSSO', `attackability = ${c.attackability}`)
  assert(c.quadrant === 'NON_ATTACCABILE', `quadrant = ${c.quadrant}`)
}

// ─── Test 5: veto rating → NON_PROMOSSO anche con 2 fattori ──────────────────

console.log('\n[5] Rating > 4.8 → veto, NON_PROMOSSO')
{
  const base: RawCandidate = makeCandidate({ asin: 'X', reviewCount: 200, publishedDate: daysAgo(305) })
  const candidates: RawCandidate[] = [
    { ...base, asin: 'E0000001', reviewCount: 130, rating: 4.9 }, // rating alto → veto
    { ...base, asin: 'E0000002', reviewCount: 200, rating: 4.5, publishedDate: daysAgo(305) },
    { ...base, asin: 'E0000003', reviewCount: 200, rating: 4.4, publishedDate: daysAgo(305) },
    { ...base, asin: 'E0000004', reviewCount: 200, rating: 4.6, publishedDate: daysAgo(305) },
    { ...base, asin: 'E0000005', reviewCount: 200, rating: 4.3, publishedDate: daysAgo(305) },
  ]
  const result = buildTargetFinderResult(candidates, 'test keyword', 'IT', new Date().toISOString())
  const c = result.candidates.find(c => c.asin === 'E0000001')!

  assert(c.promotionFactors.ratingVeto === true, 'ratingVeto = true (rating 4.9 > 4.8)')
  assert(c.attackability === 'NON_PROMOSSO', `attackability = ${c.attackability} (veto blocca promozione)`)
}

// ─── Test 6: stima velocità nicchia esclude honeymoon ────────────────────────

console.log('\n[6] estimateNicheReviewVelocity esclude libri in honeymoon')
{
  const candidates = [
    { reviewCount: 300, publishedDate: daysAgo(10) },   // honeymoon → escluso
    { reviewCount: 120, publishedDate: daysAgo(400) },  // ~10 mesi → 12/mese
    { reviewCount: 100, publishedDate: daysAgo(500) },  // ~16 mesi → 6/mese
  ]
  const { velocity } = estimateNicheReviewVelocity(candidates)
  // Mediana di [12/mese, 6/mese] = 9/mese (il libro honeymoon è escluso)
  console.log(`    velocity stimata = ${velocity.toFixed(1)} rec/mese (attesa ~9)`)
  assert(velocity > 5 && velocity < 15, `velocity ragionevole (${velocity.toFixed(1)})`)

  // Verifica che il libro honeymoon (300 rec) non distorca verso l'alto
  const velocityWithHoneymoon = 300 / (10 / 30.44)
  assert(velocity < velocityWithHoneymoon, 'honeymoon non conta nella stima')
}

// ─── Test 7: fallback velocità nicchia ───────────────────────────────────────

console.log('\n[7] Nessun candidato valido → fallback 6 rec/mese')
{
  const candidates = [
    { reviewCount: 100, publishedDate: daysAgo(10) }, // honeymoon
    { reviewCount: 80 },                              // no data
  ]
  const { velocity, warning } = estimateNicheReviewVelocity(candidates)
  assert(velocity === 6, `velocity fallback = ${velocity}`)
  assert(warning !== undefined, 'warning presente')
}

// ─── Test 8: suggested — max 3 da quadrante IDEALE ───────────────────────────

console.log('\n[8] suggested: massimo 3 candidati IDEALE')
{
  // Setup con più candidati attaccabili e dati completi per formare quadranti
  const pub = daysAgo(400)
  const candidates: RawCandidate[] = Array.from({ length: 8 }, (_, i) => ({
    asin: `F000000${i + 1}`,
    title: `Libro ${i + 1}`,
    price: 14.99,
    currency: 'EUR',
    reviewCount: 40 + i * 5,
    rating: 4.5,
    bsr: 1000 + i * 500,
    pages: 250,
    publishedDate: pub,
    selfPublished: false,
    imageUrl: undefined,
  }))
  const result = buildTargetFinderResult(candidates, 'test', 'IT', new Date().toISOString())
  assert(result.suggested.length <= 3, `suggested.length = ${result.suggested.length} (≤ 3)`)
  assert(result.candidates.length === 8, `candidates.length = ${result.candidates.length}`)
}

// ─── Risultato finale ────────────────────────────────────────────────────────

console.log(`\n── Risultato: ${passed} passati, ${failed} falliti ──\n`)
if (failed > 0) process.exit(1)
