import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as ai from './ai'
import * as storage from './upstash'
import { runPainPointsPhase, runFinalizePhase } from './analyze-phases'
import { buildSocialManifest } from './social-corpus'
import * as prompts from './prompts'
import { GET as exportReport } from '../app/api/export/[id]/route'
import type { AmazonData, PainPoint, RedditData, TrendsData, SocialEvidenceReport } from './types'

test('pipeline e export: provenienza persistita, modalità curated, guasti opzionali e numeri/prompt esistenti invariati', async t => {
  const reddit: RedditData = {
    keyword: 'meals', available: true, insufficientCorpus: true, totalComments: 1, threadCount: 1, subredditsUsed: ['camping'],
    posts: [{ id: 'p1', title: 'Meals', selftext: 'How can I rehydrate meals?', score: 1, subreddit: 'camping', createdUtc: 1, month: '1970-01',
      link: 'https://www.reddit.com/r/camping/comments/p1/meals/', comments: [{
        id: 'c1', author: 'alice', body: 'I cannot rehydrate meals evenly.', score: 1, createdUtc: 1, month: '1970-01',
        provenance: { originalId: 'c1', idStatus: 'original', parentId: 't3_p1', containerId: 'p1' },
      }],
    }],
  }
  const painPoints: PainPoint[] = [
    { id: 'pp1', pain_point: 'Reidratazione irregolare', fonte: 'reddit', F: 3, I: 7, score: 4.3, solvibilita: 'vincolo_formato', requisito_forma: 'Protocollo pratico', evidence: 'Meals uneven' },
    { id: 'pp2', pain_point: 'Problema non selezionato', fonte: 'reddit', F: 2, I: 7, score: 3.7, solvibilita: 'affrontabile', evidence: 'Other' },
  ]
  const book = {
    asin: 'TEST000001', title: 'Meals guide', bsr: 1000, bsrTimestamp: '2026-10-01', price: 15, currency: '$', reviewCount: 50, rating: 4,
    pages: 100, selfPublished: true, sponsored: false, royalty: 5, estimatedDailySalesMin: 1, estimatedDailySalesMax: 2, pagesEstimated: false,
  }
  const amazon: AmazonData = {
    keyword: 'meals', market: 'US', topBooks: [book], rawTop15: [book], subNiches: [], competitorTarget: book, scrapedAt: '2026-10-01',
    ads_intelligence: { available: false, recommendedMonthlyAdBudget: 0, competitorMonthlyRevenueAvg: 0, competitorMonthlyRevenueRange: { min: 0, max: 0 }, competitorCount: 0, weakSampleWarning: true, currency: '$' },
  }
  const trends: TrendsData = { keyword: 'meals', available: false, timelineData: [], relatedQueries: [], yoyGrowth: 0, peakMonth: null }
  t.mock.method(storage, 'cacheGet', async () => null)
  t.mock.method(ai, 'runPasso0', async () => ({ angolo: 'Meals', target_reader: 'Campers', usp: 'Even meals', punti_forza: [], punti_debolezza: [], confidence: 'MEDIA' }))
  t.mock.method(ai, 'runPainPointsReddit', async () => structuredClone(painPoints))
  t.mock.method(ai, 'runSubNicheDetection', async () => [])
  t.mock.method(ai, 'runPainPointsAmazonReviews', async () => ({ painPoints: [], diagnostics: { rawCount: 0, rawSample: [], aiReturnedEmpty: true } }))
  t.mock.method(ai, 'runKeyInsights', async () => [])
  t.mock.method(ai, 'runTrendForecast', async () => null)
  const gapPrompts: string[] = []
  t.mock.method(ai, 'runGapAnalysis', async (...args: Parameters<typeof ai.runGapAnalysis>) => {
    gapPrompts.push(prompts.promptGapAnalysis(...args))
    return {
    passo1_problemi_non_risolti: { items: [] }, passo2_angoli_mancanti: { items: [] },
    passo4_target_non_servito: { segmento: 'Campers', dimensione: 'N/D' },
    passo5_tesi_libro: { titolo_proposto: 'Meals', sottotitolo: '', hook: '', differenziatori: [] }, gap_inventory_table: [],
    }
  })
  t.mock.method(ai, 'runSeriesStrategy', async () => ({
    verdetto: 'PARTIAL', motivazione_verdetto: 'Test', libro_1: { titolo: 'Meals', focus: 'Meals', pagine_target: 100, tempo_scrittura_settimane: 4 },
    libro_2: { titolo: '', focus: '', timing: '' }, libro_3: { titolo: '', focus: '', condizione: '' }, strategia_lancio: '', rischi_principali: [],
  }))
  t.mock.method(ai, 'runRoiNarrative', async () => ({ blocco_scenario: '', blocco_budget: '', blocco_timeline: '', blocco_verdetto: '' }))
  t.mock.method(ai, 'runBonusSuggestions', async () => [])
  t.mock.method(ai, 'runConceptDirections', async () => [])
  t.mock.method(ai, 'runThingsToAvoid', async () => [])
  t.mock.method(ai, 'runPivotSignals', async () => [])
  let fail = false
  t.mock.method(ai, 'callSocialVerification', async (prompt: string) => {
    const data = JSON.parse(prompt.split('DATI:\n')[1])
    return { checks: data.checks.map((c: { recordId: string; painPointId: string; text: string }) => ({
      recordId: c.recordId, painPointId: c.painPointId, verdict: 'supported', reason: 'explicit_problem', problemExpressed: 'yes', referentIdentified: 'yes', problemQuote: c.text,
    })) }
  })
  const attribution = t.mock.method(ai, 'callSocialAttribution', async (prompt: string) => {
    if (fail) throw new Error('Simulated API failure')
    const data = JSON.parse(prompt.split('DATI:\n')[1])
    assert.deepEqual(data.painPoints.map((p: { id: string }) => p.id), ['pp1'])
    return { decisions: data.recordsToReview.map((r: { recordId: string; text: string }) => ({ recordId: r.recordId,
      matches: [{ painPointId: 'pp1', supportType: 'direct', quote: r.text, contextRecordIds: [] }],
    })) }
  })
  const intermediate = await runPainPointsPhase(amazon, trends, reddit, undefined)
  assert.deepEqual(intermediate.socialManifest, buildSocialManifest(reddit))
  const restored = JSON.parse(JSON.stringify(intermediate)) as typeof intermediate
  const before = JSON.stringify(restored)
  const legacy = structuredClone(restored)
  delete legacy.socialManifest
  const legacyResult = await runFinalizePhase(legacy, ['pp1'])
  assert.equal(attribution.mock.callCount(), 0)
  const result = await runFinalizePhase(restored, ['pp1'])
  const report = result.report as Record<string, unknown>
  const oldReport = legacyResult.report as Record<string, unknown>
  const social = report.socialEvidence as SocialEvidenceReport
  assert.deepEqual(Object.keys(social.metrics), ['pp1'])
  assert.deepEqual([social.metrics.pp1.U, social.metrics.pp1.T, social.metrics.pp1.M], [1, 1, 1])
  assert.equal(JSON.stringify(restored), before)
  for (const field of ['profitabilityScore', 'scoringBreakdown', 'painPoints', 'roi', 'seriesStrategy', 'ads_intelligence', 'voice_data']) {
    assert.deepEqual(report[field], oldReport[field], field)
  }
  const voice = report.voice_data as { reddit: { posts: typeof reddit.posts } }
  assert.deepEqual(voice.reddit.posts, reddit.posts)

  // Confronta le due chiamate realmente eseguite dalla finalizzazione.
  assert.equal(gapPrompts.length, 2)
  assert.equal(gapPrompts[0], gapPrompts[1])

  // Persistenza simulata ed export JSON: comprende manifest ed evidenze senza perderne gli ID.
  const saved = JSON.parse(JSON.stringify({ id: 'test', ...report }))
  t.mock.method(storage, 'getReport', async () => ({ id: 'test', keyword: 'meals', market: 'US', status: 'complete', createdAt: '2026-10-01', data: saved }))
  const exported = await exportReport({} as Parameters<typeof exportReport>[0], { params: Promise.resolve({ id: 'test' }) })
  const payload = await exported.json()
  assert.deepEqual(payload.social_evidence, social)
  assert.deepEqual(payload.voice_data.reddit.posts[0].comments[0].provenance, reddit.posts[0].comments[0].provenance)

  fail = true
  const failed = (await runFinalizePhase(restored, ['pp1'])).report as typeof report
  assert.equal((failed.socialEvidence as SocialEvidenceReport).metrics.pp1.status, 'failed')
  assert.deepEqual(failed.roi, report.roi)
  assert.deepEqual(failed.painPoints, report.painPoints)
})
