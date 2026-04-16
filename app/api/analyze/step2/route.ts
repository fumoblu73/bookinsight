import { NextRequest, NextResponse } from 'next/server'
import { AmazonData, TrendsData, RedditData, PainPoint } from '@/lib/types'
import { ProfitabilityBreakdown } from '@/lib/scoring'
import { runKeyInsights, runTrendForecast, runGapAnalysis } from '@/lib/ai'

// Vercel Hobby con Fluid Compute (default apr 2025): max 300s
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { amazonData, trendsData, redditData, scoring, painPoints } = await req.json() as {
    amazonData: AmazonData
    trendsData: TrendsData
    redditData: RedditData
    scoring: ProfitabilityBreakdown
    painPoints: PainPoint[]
  }

  // ── Tutti e tre in parallelo: dipendono solo da step1 ─────────────────────
  const [keyInsights, trendForecast, gapAnalysis] = await Promise.all([
    runKeyInsights(amazonData, trendsData, redditData, scoring, painPoints),
    runTrendForecast(amazonData.keyword, trendsData, scoring.trendSignal),
    runGapAnalysis(amazonData, painPoints, redditData),
  ])

  return NextResponse.json({ keyInsights, trendForecast, gapAnalysis })
}
