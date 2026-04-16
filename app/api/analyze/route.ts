import { NextRequest, NextResponse } from 'next/server'
import { AmazonData, TrendsData, RedditData } from '@/lib/types'
import { Market } from '@/lib/types'
import {
  calcProfitabilityScore,
  calcRoiEstimate,
} from '@/lib/scoring'
import {
  detectComplianceCategory,
  getComplianceRisk,
} from '@/lib/compliance'
import {
  runPasso0,
  runPainPointsReddit,
  runKeyInsights,
  runTrendForecast,
  runGapAnalysis,
  runSeriesStrategy,
  runRoiNarrative,
} from '@/lib/ai'
import { saveReport, updateReport } from '@/lib/upstash'

export const maxDuration = 60

// Budget default per mercato (scrittura + copertina + ads 3 mesi)
const DEFAULT_BUDGET: Record<Market, number> = {
  US: 1200, UK: 1000, DE: 900, IT: 800, ES: 800,
}

export async function POST(req: NextRequest) {
  const { amazon, trends, reddit } = await req.json() as {
    amazon: AmazonData
    trends: TrendsData
    reddit: RedditData
  }

  if (!amazon || !amazon.topBooks || amazon.topBooks.length < 3) {
    return NextResponse.json({ error: 'Dati Amazon insufficienti' }, { status: 400 })
  }

  const market = amazon.market
  const keyword = amazon.keyword

  // Salva subito un record parziale per tracciare l'avanzamento
  const reportId = await saveReport({
    keyword,
    market,
    status: 'partial_gap',
  })

  try {
    // ── Compliance ────────────────────────────────────────────────────────────
    const complianceCategory = detectComplianceCategory(keyword)
    const complianceRisk = getComplianceRisk(complianceCategory)

    // ── Scoring deterministico ────────────────────────────────────────────────
    const scoring = calcProfitabilityScore(amazon.topBooks, trends, complianceRisk, market)
    const budget = DEFAULT_BUDGET[market]
    const roi = calcRoiEstimate(amazon.topBooks, budget, market)

    // ── AI in parallelo: pain points + passo0 ─────────────────────────────────
    const [painPoints, passo0] = await Promise.all([
      runPainPointsReddit(keyword, reddit),
      runPasso0(amazon),
    ])

    // ── AI in parallelo: insights + trend forecast ────────────────────────────
    const [keyInsights, trendForecast] = await Promise.all([
      runKeyInsights(amazon, trends, reddit, scoring, painPoints),
      runTrendForecast(keyword, trends, scoring.trendSignal),
    ])

    // ── Gap Analysis (sequenziale — dipende da pain points) ───────────────────
    const gapAnalysis = await runGapAnalysis(amazon, painPoints, reddit)

    // ── AI in parallelo: series strategy + roi narrative ──────────────────────
    const [seriesStrategy, roiNarrative] = await Promise.all([
      runSeriesStrategy(amazon, gapAnalysis.passo5_tesi_libro, scoring, roi),
      runRoiNarrative(keyword, market, roi, scoring, budget),
    ])

    // ── Assembla report finale ────────────────────────────────────────────────
    const report = {
      id: reportId,
      keyword,
      market,
      createdAt: new Date().toISOString(),
      status: 'complete' as const,

      // §1
      keyInsights,

      // §2
      profitabilityScore: scoring.score,
      scoringBreakdown: scoring,

      // §3
      competitorTarget: amazon.competitorTarget,
      passo0,

      // §4
      trends,
      trendForecast,

      // §5
      painPoints,
      gapAnalysis,

      // §6
      seriesStrategy,

      // §7
      roi,
      roiNarrative,
      budget,

      // Meta
      amazon,
      complianceCategory,
      complianceRisk,
      subNiches: amazon.subNiches,
    }

    // Salva report completo su Redis
    await updateReport(reportId, {
      status: 'complete',
      profitabilityScore: scoring.score,
      estimatedDailyRevenue: roi.avgMonthlyRevenueMin,
      competitionLevel: scoring.entryDifficulty,
      data: report,
    })

    return NextResponse.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'

    // Aggiorna stato a failed su Redis
    await updateReport(reportId, { status: 'failed' }).catch(() => {})

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
