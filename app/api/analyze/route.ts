import { NextRequest, NextResponse } from 'next/server'
import { AmazonData, TrendsData, RedditData, Market } from '@/lib/types'
import { calcProfitabilityScore, calcRoiEstimate } from '@/lib/scoring'
import { detectComplianceCategory, getComplianceRisk } from '@/lib/compliance'
import { runPasso0, runPainPointsReddit } from '@/lib/ai'
import { saveReport } from '@/lib/upstash'

// Vercel Hobby con Fluid Compute (default apr 2025): max 300s
// Senza Fluid Compute (legacy): default 10s, max configurabile 60s
export const maxDuration = 60

const DEFAULT_BUDGET: Record<Market, number> = {
  US: 1200, UK: 1000, DE: 900, IT: 800, ES: 800,
}

export async function POST(req: NextRequest) {
  const { keyword, market, amazonData, trendsData, redditData } = await req.json() as {
    keyword: string
    market: Market
    amazonData: AmazonData
    trendsData: TrendsData
    redditData: RedditData
  }

  if (!amazonData?.topBooks || amazonData.topBooks.length < 3) {
    return NextResponse.json({ error: 'Dati Amazon insufficienti' }, { status: 400 })
  }

  // ── Compliance + scoring (sincroni) ────────────────────────────────────────
  const complianceCategory = detectComplianceCategory(keyword)
  const complianceRisk = getComplianceRisk(complianceCategory)
  const scoring = calcProfitabilityScore(amazonData.topBooks, trendsData, complianceRisk, market)
  const budget = DEFAULT_BUDGET[market]
  const roi = calcRoiEstimate(amazonData.topBooks, budget, market)

  // Salva record parziale su Redis per tracciare l'analisi
  const reportId = await saveReport({ keyword, market, status: 'partial_gap' })

  // ── AI in parallelo: passo0 + pain points ──────────────────────────────────
  const [passo0, painPoints] = await Promise.all([
    runPasso0(amazonData),
    runPainPointsReddit(keyword, redditData),
  ])

  return NextResponse.json({
    reportId,
    scoring,
    roi,
    budget,
    complianceCategory,
    complianceRisk,
    passo0,
    painPoints,
  })
}
