import { NextRequest } from 'next/server'
import { AmazonData, TrendsData, RedditData, Market } from '@/lib/types'
import { calcProfitabilityScore, calcRoiEstimate } from '@/lib/scoring'
import { detectComplianceCategory, getComplianceRisk } from '@/lib/compliance'
import {
  runPasso0, runPainPointsReddit,
  runKeyInsights, runTrendForecast, runGapAnalysis,
  runSeriesStrategy, runRoiNarrative,
} from '@/lib/ai'
import { saveReport, updateReport } from '@/lib/upstash'

// Vercel Hobby con Fluid Compute (default apr 2025): max 300s
export const maxDuration = 300

const DEFAULT_BUDGET: Record<Market, number> = {
  US: 1200, UK: 1000, DE: 900, FR: 800, IT: 800, ES: 800,
}

// ─── Helper streaming ─────────────────────────────────────────────────────────

type ProgressEvent = { type: 'progress'; stage: string }
type DoneEvent     = { type: 'done'; report: unknown }
type ErrorEvent    = { type: 'error'; message: string }
type StreamEvent   = ProgressEvent | DoneEvent | ErrorEvent

function makeStream(fn: (push: (e: StreamEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const push = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }
      try {
        await fn(push)
      } catch (err) {
        push({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { keyword, market, amazonData, trendsData, redditData, cpc } = await req.json() as {
    keyword: string
    market: Market
    amazonData: AmazonData
    trendsData: TrendsData
    redditData: RedditData
    cpc?: number
  }

  if (!amazonData?.topBooks || amazonData.topBooks.length < 3) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Dati Amazon insufficienti' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } },
    )
  }

  const stream = makeStream(async (push) => {
    // ── Compliance + scoring (sincroni, istantanei) ───────────────────────────
    const complianceCategory = detectComplianceCategory(keyword)
    const complianceRisk     = getComplianceRisk(complianceCategory)
    const scoring = calcProfitabilityScore(amazonData.topBooks, trendsData, complianceRisk, market)
    const budget  = DEFAULT_BUDGET[market]
    const roi     = calcRoiEstimate(amazonData.topBooks, budget, market)
    const reportId = await saveReport({ keyword, market, status: 'partial_gap' })

    // ── Step 1: passo0 + pain points ──────────────────────────────────────────
    push({ type: 'progress', stage: 'passo0' })
    const [passo0, painPoints] = await Promise.all([
      runPasso0(amazonData),
      runPainPointsReddit(keyword, redditData),
    ])

    // ── Step 2: insights + trend forecast + gap analysis ─────────────────────
    push({ type: 'progress', stage: 'insights' })
    const [keyInsights, trendForecast, gapAnalysis] = await Promise.all([
      runKeyInsights(amazonData, trendsData, redditData, scoring, painPoints),
      runTrendForecast(keyword, trendsData, scoring.trendSignal),
      runGapAnalysis(amazonData, painPoints, redditData),
    ])

    // ── Step 3: series strategy + ROI ─────────────────────────────────────────
    push({ type: 'progress', stage: 'strategy' })
    const [seriesStrategy, roiNarrative] = await Promise.all([
      runSeriesStrategy(amazonData, gapAnalysis.passo5_tesi_libro, scoring, roi),
      runRoiNarrative(keyword, market, roi, scoring, budget),
    ])

    // ── Assembla + salva ──────────────────────────────────────────────────────
    const report = {
      id: reportId, keyword, market,
      createdAt: new Date().toISOString(),
      status: 'complete' as const,
      ...(cpc !== undefined && !isNaN(cpc) && cpc > 0 ? { cpc } : {}),
      keyInsights,
      profitabilityScore: scoring.score,
      scoringBreakdown: scoring,
      competitorTarget: amazonData.competitorTarget,
      topBooks: amazonData.topBooks,
      redditMeta: {
        available: redditData.available,
        insufficientCorpus: redditData.insufficientCorpus,
        threadCount: redditData.threadCount,
        subredditsUsed: redditData.subredditsUsed,
      },
      passo0,
      trends: trendsData,
      trendForecast,
      painPoints,
      gapAnalysis,
      seriesStrategy,
      roi,
      roiNarrative,
      budget,
      amazon: amazonData,
      complianceCategory,
      complianceRisk,
      subNiches: amazonData.subNiches,
    }

    await updateReport(reportId, {
      status: 'complete',
      profitabilityScore: scoring.score,
      estimatedDailyRevenue: roi.avgMonthlyRevenueMin,
      competitionLevel: scoring.entryDifficulty,
      data: report,
    })

    push({ type: 'done', report })
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
