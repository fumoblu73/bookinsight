import { NextRequest, NextResponse } from 'next/server'
import { Market, AmazonData, TrendsData, RedditData, YouTubeData } from '@/lib/types'
import { runPainPointsPhase, PainPointsIntermediate } from '@/lib/analyze-phases'
import { cacheSet } from '@/lib/upstash'
import { isAnthropicBillingError } from '@/lib/ai'

// Solo AI (3 chiamate Sonnet): nessun fetching esterno
export const maxDuration = 180

const INTERMEDIATE_TTL_SECONDS = 30 * 60  // 30 minuti

function generateAnalysisId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function POST(req: NextRequest) {
  let body: {
    keyword?: string
    market?: string
    amazonData?: AmazonData
    trendsData?: TrendsData
    redditData?: RedditData
    youtubeData?: YouTubeData
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body JSON non valido' }, { status: 400 })
  }

  const { keyword, market, amazonData, trendsData, redditData, youtubeData } = body

  if (!keyword?.trim()) {
    return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
  }
  if (!['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(market ?? '')) {
    return NextResponse.json({ error: 'market non valido (US|UK|DE|FR|IT|ES)' }, { status: 400 })
  }
  if (!amazonData?.topBooks || amazonData.topBooks.length < 3) {
    return NextResponse.json({ error: 'amazonData insufficiente (< 3 libri filtrati)' }, { status: 422 })
  }

  const kw = keyword.trim()

  // Fallback per segnali opzionali (la UI li manda sempre, ma difendiamoci)
  const effectiveTrends: TrendsData = trendsData ?? {
    keyword: kw, timelineData: [], relatedQueries: [], yoyGrowth: 0, available: false, peakMonth: null,
  }
  const effectiveReddit: RedditData = redditData ?? {
    keyword: kw, posts: [], totalComments: 0, subredditsUsed: [], threadCount: 0, available: false, insufficientCorpus: true,
  }

  try {
    // ── Fase AI: passo0 + pain points + sub-niche ───────────────────────────
    const intermediate: PainPointsIntermediate = await runPainPointsPhase(
      amazonData as AmazonData & { market: Market },
      effectiveTrends,
      effectiveReddit,
      youtubeData,
    )

    // ── Salva snapshot intermedio su Redis ─────────────────────────────────
    const analysisId = generateAnalysisId()
    await cacheSet(`analysis:${analysisId}`, intermediate, INTERMEDIATE_TTL_SECONDS)

    // ── Risposta ────────────────────────────────────────────────────────────
    return NextResponse.json({
      analysisId,
      painPoints: intermediate.painPoints,
      scoring: intermediate.scoring,
      passo0: intermediate.passo0,
      amazonSummary: {
        topBooks: amazonData.topBooks.slice(0, 5),
        keyword: amazonData.keyword,
      },
      trendsSummary: {
        available: effectiveTrends.available,
        yoyGrowth: effectiveTrends.yoyGrowth,
        peakMonth: effectiveTrends.peakMonth ?? null,
      },
      redditSummary: {
        available: effectiveReddit.available,
        postCount: effectiveReddit.threadCount,
        commentCount: effectiveReddit.totalComments,
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
