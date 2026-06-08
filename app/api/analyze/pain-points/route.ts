import { NextRequest, NextResponse } from 'next/server'
import { Market } from '@/lib/types'
import { fetchAmazonData } from '@/lib/amazon'
import { fetchTrendsData } from '@/lib/trends'
import { fetchRedditData } from '@/lib/reddit'
import { fetchYouTubeData } from '@/lib/youtube'
import { runPainPointsPhase, PainPointsIntermediate } from '@/lib/analyze-phases'
import { cacheSet } from '@/lib/upstash'
import { isAnthropicBillingError } from '@/lib/ai'

// 3 minuti: fetching parallelo + 3 chiamate AI (passo0, pain points, sub-niche)
export const maxDuration = 300

const INTERMEDIATE_TTL_SECONDS = 30 * 60  // 30 minuti

function generateAnalysisId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function POST(req: NextRequest) {
  let body: { keyword?: string; market?: string; targetAsin?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body JSON non valido' }, { status: 400 })
  }

  const { keyword, market, targetAsin } = body

  if (!keyword?.trim()) {
    return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
  }
  if (!['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(market ?? '')) {
    return NextResponse.json({ error: 'market non valido (US|UK|DE|FR|IT|ES)' }, { status: 400 })
  }

  const kw = keyword.trim()
  const mk = market as Market
  const asin = targetAsin?.trim() || undefined

  try {
    // ── Fetching parallelo ──────────────────────────────────────────────────
    const [amazon, trends, reddit, youtube] = await Promise.all([
      fetchAmazonData(kw, mk, asin),
      fetchTrendsData(kw, mk),
      fetchRedditData(kw),
      fetchYouTubeData(kw, mk),
    ])

    if (!amazon?.topBooks || amazon.topBooks.length < 3) {
      return NextResponse.json({ error: 'Dati Amazon insufficienti (< 3 libri filtrati)' }, { status: 422 })
    }

    // ── Fase AI: passo0 + pain points + sub-niche ───────────────────────────
    const intermediate: PainPointsIntermediate = await runPainPointsPhase(amazon, trends, reddit, youtube)

    // ── Salva snapshot intermedio su Redis ─────────────────────────────────
    const analysisId = generateAnalysisId()
    await cacheSet(`analysis:${analysisId}`, intermediate, INTERMEDIATE_TTL_SECONDS)

    // ── Risposta ────────────────────────────────────────────────────────────
    return NextResponse.json({
      analysisId,
      painPoints: intermediate.painPoints,
      painPointsAmazon: intermediate.painPointsAmazon,
      scoring: intermediate.scoring,
      passo0: intermediate.passo0,
      amazonSummary: {
        topBooks: amazon.topBooks.slice(0, 5),
        keyword: amazon.keyword,
      },
      trendsSummary: {
        available: trends.available,
        yoyGrowth: trends.yoyGrowth,
        peakMonth: trends.peakMonth ?? null,
      },
      redditSummary: {
        available: reddit.available,
        postCount: reddit.threadCount,
        commentCount: reddit.totalComments,
      },
    })
  } catch (err) {
    if (isAnthropicBillingError(err)) {
      return NextResponse.json(
        { error: 'Crediti Anthropic esauriti. Ricarica su console.anthropic.com/settings/billing' },
        { status: 402 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
