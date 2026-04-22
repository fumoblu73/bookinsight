import { NextRequest } from 'next/server'
import { AmazonData, TrendsData, RedditData, YouTubeData, Market, LogEntry, AnalysisLog } from '@/lib/types'
import { calcProfitabilityScore, calcRoiEstimate, calcCompetitiveDynamism } from '@/lib/scoring'
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
  const { keyword, market, amazonData, trendsData, redditData, youtubeData, cpc } = await req.json() as {
    keyword: string
    market: Market
    amazonData: AmazonData
    trendsData: TrendsData
    redditData: RedditData
    youtubeData?: YouTubeData
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
    const competitiveDynamism = calcCompetitiveDynamism(amazonData.rawTop15, amazonData.scrapedAt)
    const reportId = await saveReport({ keyword, market, status: 'partial_gap' })

    const startedAt = new Date().toISOString()
    const logEntries: LogEntry[] = []

    // ── Log entry: Amazon ─────────────────────────────────────────────────────
    logEntries.push({
      step: 'amazon', label: 'Amazon SERP',
      status: 'ok',
      summary: `${amazonData.rawTop15.length} candidati → ${amazonData.topBooks.length} libri filtrati`,
      details: {
        market,
        candidatesAfterPreFilter: amazonData.rawTop15.length,
        topBooksCount: amazonData.topBooks.length,
        subNiches: amazonData.subNiches.map(s => s.keyword),
        topBooks: amazonData.topBooks.map(b => ({
          asin: b.asin, title: b.title, bsr: b.bsr,
          reviewCount: b.reviewCount, format: b.format ?? '',
        })),
        rawBooks: amazonData.rawTop15.map(b => ({
          asin: b.asin, title: b.title, format: b.format ?? '',
          sponsored: b.sponsored, reviewCount: b.reviewCount,
        })),
      },
    })

    // ── Log entry: Reddit ─────────────────────────────────────────────────────
    const postsBySubreddit = redditData.posts.reduce<Record<string, number>>((acc, p) => {
      acc[p.subreddit] = (acc[p.subreddit] ?? 0) + 1; return acc
    }, {})
    logEntries.push({
      step: 'reddit', label: 'Reddit',
      status: !redditData.available ? 'error' : redditData.insufficientCorpus ? 'warn' : 'ok',
      summary: redditData.available
        ? `${redditData.threadCount} thread · ${redditData.totalComments} commenti · ${redditData.subredditsUsed.length} subreddit`
        : 'Nessun dato disponibile',
      details: {
        available: redditData.available,
        insufficientCorpus: redditData.insufficientCorpus,
        threadCount: redditData.threadCount,
        totalComments: redditData.totalComments,
        subredditsUsed: redditData.subredditsUsed,
        postsBySubreddit,
        posts: redditData.posts.map(p => ({
          id: p.id, title: p.title.slice(0, 80), subreddit: p.subreddit,
          score: p.score, commentsLoaded: p.comments.length, month: p.month,
        })),
      },
    })

    // ── Log entry: Trends ─────────────────────────────────────────────────────
    logEntries.push({
      step: 'trends', label: 'Google Trends',
      status: trendsData.available ? 'ok' : 'warn',
      summary: trendsData.available
        ? `${trendsData.timelineData.length} mesi di dati · YoY ${trendsData.yoyGrowth >= 0 ? '+' : ''}${trendsData.yoyGrowth}%`
        : 'Dati non disponibili (query troppo specifica o rate limit)',
      details: {
        available: trendsData.available,
        queryUsed: trendsData.keyword,
        dataPoints: trendsData.timelineData.length,
        yoyGrowth: trendsData.yoyGrowth,
        relatedQueriesCount: trendsData.relatedQueries.length,
        relatedQueries: trendsData.relatedQueries.map(q => q.query),
      },
    })

    // ── Step 1: passo0 + pain points ──────────────────────────────────────────
    push({ type: 'progress', stage: 'passo0' })
    const [passo0, painPoints] = await Promise.all([
      runPasso0(amazonData),
      runPainPointsReddit(keyword, redditData, youtubeData),
    ])

    logEntries.push({
      step: 'passo0', label: 'Analisi competitor (AI)',
      status: 'ok',
      summary: `Angolo: ${passo0.angolo} · Target: ${passo0.target_reader}`,
      details: {
        angolo: passo0.angolo,
        target_reader: passo0.target_reader,
        usp: passo0.usp,
        punti_forza: passo0.punti_forza,
        punti_debolezza: passo0.punti_debolezza,
      },
    })
    const criticalCount = painPoints.filter(p => p.criticalSignal).length
    logEntries.push({
      step: 'painpoints', label: 'Pain Points (AI)',
      status: painPoints.length === 0 ? 'warn' : 'ok',
      summary: `${painPoints.length} pain point · ${criticalCount} segnali critici`,
      details: {
        count: painPoints.length,
        criticalSignals: criticalCount,
        list: painPoints.map(p => ({ pain_point: p.pain_point, score: p.score, criticalSignal: !!p.criticalSignal })),
      },
    })

    // ── Step 2: insights + trend forecast + gap analysis ─────────────────────
    push({ type: 'progress', stage: 'insights' })
    const [keyInsights, trendForecast, gapAnalysis] = await Promise.all([
      runKeyInsights(amazonData, trendsData, redditData, scoring, painPoints),
      runTrendForecast(keyword, trendsData, scoring.trendSignal),
      runGapAnalysis(amazonData, painPoints, redditData),
    ])

    logEntries.push({
      step: 'insights', label: 'Insight & Gap Analysis (AI)',
      status: 'ok',
      summary: `${keyInsights.length} insight · trend: ${trendForecast?.classificazione ?? 'N/A'}`,
      details: {
        keyInsightsCount: keyInsights.length,
        trendClassificazione: trendForecast?.classificazione ?? null,
        gapItemsCount: (gapAnalysis.gap_inventory_table as unknown[])?.length ?? 0,
      },
    })

    // ── Step 3: series strategy + ROI ─────────────────────────────────────────
    push({ type: 'progress', stage: 'strategy' })
    const [seriesStrategy, roiNarrative] = await Promise.all([
      runSeriesStrategy(amazonData, gapAnalysis.passo5_tesi_libro, scoring, roi),
      runRoiNarrative(keyword, market, roi, scoring, budget),
    ])

    logEntries.push({
      step: 'strategy', label: 'Strategia e ROI (AI)',
      status: 'ok',
      summary: `Verdetto: ${seriesStrategy.verdetto} · Breakeven: ${roi.breakEvenMonths} mesi`,
      details: {
        verdetto: seriesStrategy.verdetto,
        breakEvenMonths: roi.breakEvenMonths,
        avgMonthlyRevenueMin: roi.avgMonthlyRevenueMin,
        avgMonthlyRevenueMax: roi.avgMonthlyRevenueMax,
      },
    })

    const analysisLog: AnalysisLog = {
      entries: logEntries,
      startedAt,
      completedAt: new Date().toISOString(),
    }

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
      competitiveDynamism,
      complianceCategory,
      complianceRisk,
      subNiches: amazonData.subNiches,
      voice_data: {
        reddit: {
          posts: redditData.posts.map(p => ({
            title: p.title,
            selftext: p.selftext ?? '',
            subreddit: p.subreddit,
            score: p.score,
            comments: p.comments.map(c => ({ body: c.body, score: c.score })),
          })),
          available: redditData.available,
          totalComments: redditData.totalComments,
          subredditsUsed: redditData.subredditsUsed,
        },
        youtube: youtubeData?.available ? {
          videos: (youtubeData.videos ?? []).map(v => ({
            title: v.title,
            viewCount: v.viewCount,
            comments: v.comments.map(c => ({ text: c.text, likeCount: c.likeCount })),
          })),
          available: youtubeData.available,
          totalComments: youtubeData.totalComments,
        } : null,
        reviews: amazonData.topBookReviews ?? [],
      },
    }

    await updateReport(reportId, {
      status: 'complete',
      profitabilityScore: scoring.score,
      estimatedDailyRevenue: roi.avgMonthlyRevenueMin,
      competitionLevel: scoring.entryDifficulty,
      log: analysisLog,
      data: report,
    })

    push({ type: 'done', report })
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
