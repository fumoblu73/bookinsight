import { NextRequest, NextResponse } from 'next/server'
import { AmazonData, TrendsData, Market, PainPoint } from '@/lib/types'
import { ProfitabilityBreakdown, RoiEstimate } from '@/lib/scoring'
import { GapAnalysisResult, Passo0Result, runSeriesStrategy, runRoiNarrative } from '@/lib/ai'
import { updateReport } from '@/lib/upstash'

// Vercel Hobby con Fluid Compute (default apr 2025): max 300s
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const {
    reportId, keyword, market,
    amazonData, trendsData,
    scoring, roi, budget,
    passo0, painPoints,
    keyInsights, trendForecast, gapAnalysis,
    complianceCategory, complianceRisk,
  } = await req.json() as {
    reportId: string
    keyword: string
    market: Market
    amazonData: AmazonData
    trendsData: TrendsData
    scoring: ProfitabilityBreakdown
    roi: RoiEstimate
    budget: number
    passo0: Passo0Result
    painPoints: PainPoint[]
    keyInsights: { insight: string; tipo: string }[]
    trendForecast: unknown
    gapAnalysis: GapAnalysisResult
    complianceCategory: string
    complianceRisk: string
  }

  // ── AI in parallelo: series strategy + roi narrative ──────────────────────
  const [seriesStrategy, roiNarrative] = await Promise.all([
    runSeriesStrategy(amazonData, gapAnalysis.passo5_tesi_libro, scoring, roi),
    runRoiNarrative(keyword, market, roi, scoring, budget),
  ])

  // ── Assembla report finale ─────────────────────────────────────────────────
  const report = {
    id: reportId,
    keyword,
    market,
    createdAt: new Date().toISOString(),
    status: 'complete' as const,
    keyInsights,
    profitabilityScore: scoring.score,
    scoringBreakdown: scoring,
    competitorTarget: amazonData.competitorTarget,
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

  // ── Salva su Redis ─────────────────────────────────────────────────────────
  await updateReport(reportId, {
    status: 'complete',
    profitabilityScore: scoring.score,
    estimatedDailyRevenue: roi.avgMonthlyRevenueMin,
    competitionLevel: scoring.entryDifficulty,
    data: report,
  })

  return NextResponse.json(report)
}
