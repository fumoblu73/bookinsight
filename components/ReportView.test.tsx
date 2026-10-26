import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ReportView, { type FullReport } from './ReportView'
import { calcProfitabilityScore, calcRoiEstimate } from '../lib/scoring'
import { prepareRedditCorpus } from '../lib/reddit-corpus'
import type { FilteredBook } from '../lib/types'

function legacyReport(): FullReport {
  const book: FilteredBook & { pages: number } = {
    asin: 'TEST000001', title: 'Meal guide', bsr: 1000, bsrTimestamp: '2026-10-01',
    price: 15, currency: '$', reviewCount: 50, rating: 4, pages: 100,
    selfPublished: true, sponsored: false, royalty: 5,
    estimatedDailySalesMin: 1, estimatedDailySalesMax: 2, pagesEstimated: false,
  }
  const trends = { keyword: 'just add water meals', available: false, timelineData: [], relatedQueries: [], yoyGrowth: 0, peakMonth: null }
  const scoring = calcProfitabilityScore([book], trends, 'basso', 'US')
  return {
    id: 'legacy-report', keyword: trends.keyword, market: 'US', createdAt: '2026-10-01',
    profitabilityScore: scoring.score, scoringBreakdown: scoring,
    keyInsights: [], competitorTarget: book, topBooks: [book],
    passo0: { angolo: 'Practical meals', target_reader: 'Campers', usp: 'Easy rehydration', punti_forza: [], punti_debolezza: [], confidence: 'MEDIA' },
    trends, trendForecast: null,
    painPoints: [
      { pain_point: 'Problema Reddit', F: 3, I: 7, score: 4.3, evidence: 'reddit-evidence-legacy', fonte: 'reddit' },
      { pain_point: 'Problema YouTube', F: 4, I: 6, score: 4.7, evidence: 'youtube-evidence-legacy', fonte: 'youtube' },
    ],
    redditMeta: { available: true, insufficientCorpus: true, threadCount: 3, subredditsUsed: ['camping'] },
    youtubeMeta: { available: true, insufficientCorpus: false, videoCount: 8, totalComments: 26 },
    gapAnalysis: {
      passo1_problemi_non_risolti: { items: [] }, passo2_angoli_mancanti: { items: [] },
      passo4_target_non_servito: { segmento: 'Campers', dimensione: 'N/D' },
      passo5_tesi_libro: { titolo_proposto: 'Meal guide', sottotitolo: '', hook: '', differenziatori: [] },
      gap_inventory_table: [],
    },
    seriesStrategy: {
      verdetto: 'PARTIAL', motivazione_verdetto: 'Test',
      libro_1: { titolo: 'Meal guide', focus: 'Meals', pagine_target: 100, tempo_scrittura_settimane: 4 },
      libro_2: { titolo: '', focus: '', timing: '' }, libro_3: { titolo: '', focus: '', condizione: '' }, strategia_lancio: '', rischi_principali: [],
    },
    roi: calcRoiEstimate(book, 'US'),
    roiNarrative: { blocco_scenario: '', blocco_budget: '', blocco_timeline: '', blocco_verdetto: '' },
    budget: 1000, subNiches: [], complianceCategory: 'DEFAULT', complianceRisk: 'basso',
    voice_data: {
      reddit: { available: true, totalComments: 64, subredditsUsed: ['camping'], posts: [{ title: 'Legacy thread', selftext: '', subreddit: 'camping', score: 1, comments: [{ body: 'reddit-evidence-legacy', score: 1 }] }] },
      youtube: { available: true, totalComments: 26, videos: [{ title: 'Legacy video', viewCount: 100, comments: [{ text: 'youtube-evidence-legacy', likeCount: 1 }] }] },
      reviews: [],
    },
  }
}

test('report legacy senza corpusQuality: rendering completo e fonti/evidenze preservate', () => {
  const report = legacyReport()
  const before = JSON.stringify(report)
  const html = renderToStaticMarkup(<ReportView report={report} />)
  assert.match(html, /Fonte: Reddit/)
  assert.match(html, /Fonte: YouTube/)
  assert.match(html, /reddit-evidence-legacy/)
  assert.match(html, /youtube-evidence-legacy/)
  assert.match(html, /Copertura Reddit limitata/)
  assert.equal(JSON.stringify(report), before)
  assert.equal(report.voice_data?.reddit.totalComments, 64)
})

test('report legacy senza fonte o metadata: rendering senza attribuzioni inventate', () => {
  const report = legacyReport()
  report.painPoints.forEach(p => { delete p.fonte })
  delete report.redditMeta
  delete report.youtubeMeta
  const html = renderToStaticMarkup(<ReportView report={report} />)
  assert.match(html, /reddit-evidence-legacy/)
  assert.match(html, /youtube-evidence-legacy/)
  assert.ok(!html.includes('Fonte: Reddit'))
  assert.ok(!html.includes('Fonte: YouTube'))
})

test('report con un commento: avviso qualitativo isolato visibile insieme alla fonte', () => {
  const report = legacyReport()
  const quality = prepareRedditCorpus({ available: true, posts: [{
    id: 'one', title: 'One thread', selftext: '', score: 1, subreddit: 'camping', createdUtc: 1, month: '2026-10',
    comments: [{ id: 'one-comment', body: 'I cannot rehydrate meals evenly.', score: 1, author: 'reader', createdUtc: 1, month: '2026-10' }],
  }] }).quality
  report.redditMeta = { ...report.redditMeta!, corpusQuality: quality }
  const html = renderToStaticMarkup(<ReportView report={report} />)
  assert.match(html, /Segnale qualitativo isolato/)
  assert.match(html, /non dimostra frequenza elevata né domanda consolidata/)
  assert.match(html, /Fonte: Reddit/)
})
