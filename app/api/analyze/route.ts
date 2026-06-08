import { NextRequest } from 'next/server'
import { AmazonData, TrendsData, RedditData, YouTubeData, Market, AnalysisLog } from '@/lib/types'
import { isAnthropicBillingError } from '@/lib/ai'
import { runPainPointsPhase, runFinalizePhase } from '@/lib/analyze-phases'
import { saveReport, updateReport } from '@/lib/upstash'

// Vercel Hobby con Fluid Compute (default apr 2025): max 300s
export const maxDuration = 300


// ─── Helper streaming ─────────────────────────────────────────────────────────

type ProgressEvent      = { type: 'progress'; stage: string }
type DoneEvent          = { type: 'done'; report: unknown }
type ErrorEvent         = { type: 'error'; message: string; errorType?: string }
type StreamEvent        = ProgressEvent | DoneEvent | ErrorEvent

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
        if (isAnthropicBillingError(err)) {
          push({
            type: 'error',
            errorType: 'billing_anthropic',
            message: 'Crediti Anthropic esauriti. Ricarica su console.anthropic.com/settings/billing',
          })
        } else {
          push({ type: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        controller.close()
      }
    },
  })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const {
    keyword, market, amazonData, trendsData, redditData, youtubeData,
    cpc, userNotes,
    plannedPrice, plannedPages, conversionRate,
    costoScrittura, costoCopertina, costoPerRecensione,
  } = await req.json() as {
    keyword: string
    market: Market
    amazonData: AmazonData
    trendsData: TrendsData
    redditData: RedditData
    youtubeData?: YouTubeData
    cpc?: number
    userNotes?: string
    plannedPrice?: number
    plannedPages?: number
    conversionRate?: number
    costoScrittura?: number
    costoCopertina?: number
    costoPerRecensione?: number
  }

  if (!amazonData?.topBooks || amazonData.topBooks.length < 3) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Dati Amazon insufficienti' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } },
    )
  }

  const stream = makeStream(async (push) => {
    const startedAt = new Date().toISOString()

    // ── Phase 1: passo0 + pain points + sub-niche ─────────────────────────
    push({ type: 'progress', stage: 'passo0' })
    const reportId = await saveReport({ keyword, market, status: 'partial_gap' })

    let intermediate: Awaited<ReturnType<typeof runPainPointsPhase>>
    try {
      intermediate = await runPainPointsPhase(amazonData, trendsData, redditData, youtubeData)
    } catch (err) {
      await updateReport(reportId, {
        status: 'failed',
        log: { entries: [], startedAt, completedAt: new Date().toISOString() },
      }).catch(() => {})
      throw err
    }

    // ── Phase 2: insights + gap + strategy + ROI ──────────────────────────
    // onProgress emette gli eventi SSE intermedi (insights, strategy)
    let finalizeResult: Awaited<ReturnType<typeof runFinalizePhase>>
    try {
      finalizeResult = await runFinalizePhase(
        intermediate,
        [],  // backward compat: tutti i pain points selezionati
        { cpc, userNotes, plannedPrice, plannedPages, conversionRate, costoScrittura, costoCopertina, costoPerRecensione },
        (stage) => push({ type: 'progress', stage }),
      )
    } catch (err) {
      await updateReport(reportId, {
        status: 'failed',
        log: {
          entries: intermediate.logEntries,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      }).catch(() => {})
      throw err
    }

    const analysisLog: AnalysisLog = {
      entries: [...intermediate.logEntries, ...finalizeResult.finalizeLogs],
      startedAt,
      completedAt: new Date().toISOString(),
    }

    const report = {
      id: reportId,
      ...finalizeResult.report as Record<string, unknown>,
    }

    const roi = (finalizeResult.report as Record<string, unknown>).roi as { scenarios: { netProfit12m: number }[] } | undefined

    await updateReport(reportId, {
      status: 'complete',
      profitabilityScore: intermediate.scoring.score,
      estimatedDailyRevenue: roi ? roi.scenarios[1].netProfit12m / 12 : undefined,
      competitionLevel: intermediate.scoring.entryDifficulty,
      log: analysisLog,
      data: report,
    })

    push({ type: 'done', report })
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
