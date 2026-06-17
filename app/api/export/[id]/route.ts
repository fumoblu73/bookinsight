import { NextRequest, NextResponse } from 'next/server'
import { getReport } from '@/lib/upstash'
import type { FullReport } from '@/components/ReportView'

interface Props { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Props) {
  const { id } = await params
  const record = await getReport(id)
  if (!record?.data) {
    return NextResponse.json({ error: 'Report non trovato' }, { status: 404 })
  }

  const report = record.data as FullReport

  const exportData = {
    meta: {
      id: record.id,
      topic: report.keyword,
      marketplace: report.market,
      score: report.profitabilityScore,
      verdict: report.seriesStrategy?.verdetto ?? null,
      date: record.createdAt,
      entry_difficulty: report.scoringBreakdown?.entryDifficulty ?? null,
      trend_signal: report.scoringBreakdown?.trendSignal ?? null,
    },
    bookmarket: {
      profitability_score: {
        score: report.profitabilityScore,
        breakdown: report.scoringBreakdown,
      },
      competitor_target: report.competitorTarget,
      competitor_analysis: report.passo0,
      top_books: report.topBooks,
      sub_niches: report.subNiches,
      trend_analysis: {
        ...report.trends,
        forecast: report.trendForecast,
      },
      gap_analysis: report.gapAnalysis,
      series_strategy: report.seriesStrategy,
      bonus_suggestions: report.bonus_suggestions ?? null,
      concept_directions: report.concept_directions ?? null,
      investment_roi: {
        ...report.roi,
        narrative: report.roiNarrative,
        budget: report.budget,
      },
    },
    pain_points: report.painPoints,
    voice_data: report.voice_data ?? null,
    ads_intelligence: report.ads_intelligence ?? null,
    analysis_log: record.log ?? null,
  }

  const filename = `bookinsight_${report.keyword.replace(/\s+/g, '_')}_${report.market}.json`
  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
