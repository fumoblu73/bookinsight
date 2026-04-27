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
  const { keyword, market, amazonData, trendsData, redditData, youtubeData, cpc, userNotes } = await req.json() as {
    keyword: string
    market: Market
    amazonData: AmazonData
    trendsData: TrendsData
    redditData: RedditData
    youtubeData?: YouTubeData
    cpc?: number
    userNotes?: string
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

    // ── Log entry: Amazon SERP ────────────────────────────────────────────────
    logEntries.push({
      step: 'amazon', label: 'Amazon SERP',
      status: 'ok',
      summary: `${amazonData.rawTop15.length} candidati → ${amazonData.topBooks.length} libri filtrati`,
      details: {
        market,
        candidatesAfterPreFilter: amazonData.rawTop15.length,
        topBooksCount: amazonData.topBooks.length,
        filteredOut: amazonData.rawTop15.length - amazonData.topBooks.length,
        subNiches: amazonData.subNiches.map(s => s.keyword),
        topBooks: amazonData.topBooks.map(b => ({
          asin: b.asin, title: b.title, bsr: b.bsr,
          price: b.price, pages: b.pages ?? 0,
          reviewCount: b.reviewCount, format: b.format ?? '',
        })),
        rawBooks: amazonData.rawTop15.map(b => ({
          asin: b.asin, title: b.title, format: b.format ?? '',
          sponsored: b.sponsored, reviewCount: b.reviewCount,
        })),
      },
    })

    // ── Log entry: Recensioni Amazon ──────────────────────────────────────────
    const reviewsList = amazonData.topBookReviews ?? []
    const totalReviews = reviewsList.reduce((acc, br) => acc + br.reviews.length, 0)
    const emptyASINs = reviewsList.filter(br => br.reviews.length === 0).map(br => br.asin)
    logEntries.push({
      step: 'reviews', label: 'Recensioni Amazon',
      status: totalReviews === 0 ? 'warn' : 'ok',
      summary: totalReviews === 0
        ? `Nessuna recensione raccolta (${reviewsList.length} ASIN tentati)`
        : `${totalReviews} recensioni · ${reviewsList.length} libri`,
      details: {
        booksAttempted: reviewsList.length,
        totalReviews,
        emptyASINs,
        perBook: reviewsList.map(br => ({
          asin: br.asin,
          title: br.bookTitle.slice(0, 60),
          reviewCount: br.reviews.length,
        })),
      },
    })

    // ── Log entry: Reddit ─────────────────────────────────────────────────────
    const postsBySubreddit = redditData.posts.reduce<Record<string, number>>((acc, p) => {
      acc[p.subreddit] = (acc[p.subreddit] ?? 0) + 1; return acc
    }, {})
    const selftextNonEmpty = redditData.posts.filter(p => (p.selftext ?? '').length > 20).length
    const postsWithComments = redditData.posts.filter(p => p.comments.length > 0).length
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
        selftextNonEmpty,
        postsWithComments,
        subredditsUsed: redditData.subredditsUsed,
        postsBySubreddit,
        posts: redditData.posts.map(p => ({
          id: p.id, title: p.title.slice(0, 80), subreddit: p.subreddit,
          score: p.score, selftextLen: (p.selftext ?? '').length,
          commentsLoaded: p.comments.length, month: p.month,
        })),
      },
    })

    // ── Log entry: YouTube ────────────────────────────────────────────────────
    const ytApiKeyPresent = !!process.env.YOUTUBE_API_KEY
    const ytAvailable = youtubeData?.available ?? false
    logEntries.push({
      step: 'youtube', label: 'YouTube',
      status: !ytApiKeyPresent ? 'warn' : !ytAvailable ? 'warn' : 'ok',
      summary: !ytApiKeyPresent
        ? 'YOUTUBE_API_KEY non configurata — dati non disponibili'
        : ytAvailable
          ? `${youtubeData?.videos?.length ?? 0} video · ${youtubeData?.totalComments ?? 0} commenti`
          : 'Dati non disponibili (nessun video o corpus insufficiente)',
      details: {
        apiKeyPresent: ytApiKeyPresent,
        available: ytAvailable,
        insufficientCorpus: youtubeData?.insufficientCorpus ?? true,
        videoCount: youtubeData?.videos?.length ?? 0,
        totalComments: youtubeData?.totalComments ?? 0,
        videos: (youtubeData?.videos ?? []).map(v => ({
          title: v.title.slice(0, 80),
          viewCount: v.viewCount,
          commentCount: v.comments.length,
        })),
      },
    })

    // ── Log entry: Google Trends ──────────────────────────────────────────────
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

    // ── Log entry: Scoring ────────────────────────────────────────────────────
    logEntries.push({
      step: 'scoring', label: 'Scoring redditività',
      status: 'ok',
      summary: `Score ${scoring.score}/100 · difficoltà ${scoring.entryDifficulty} · trend ${scoring.trendSignal}`,
      details: {
        score: scoring.score,
        entryDifficulty: scoring.entryDifficulty,
        trendSignal: scoring.trendSignal,
        components: {
          domanda: `${scoring.demandScore}/10 (peso 30%)`,
          prezzo:  `${scoring.priceScore}/10 (peso 25%) — avg $${scoring.avgPrice} ($${scoring.minPrice}–$${scoring.maxPrice})`,
          competizione: `${scoring.competitionScore}/10 (peso 20%)`,
          trend:   `${scoring.trendScore}/10 (peso 15%)`,
          compliance: `${scoring.complianceScore}/10 (peso 10%) — categoria: ${complianceCategory}`,
        },
        prezzoStats: {
          avg: scoring.avgPrice, min: scoring.minPrice, max: scoring.maxPrice,
        },
        pagineStats: {
          avg: scoring.avgPages, min: scoring.minPages, max: scoring.maxPages,
        },
        avgBsr: scoring.avgBsr,
      },
    })

    // ── Step 1: passo0 + pain points ──────────────────────────────────────────
    push({ type: 'progress', stage: 'passo0' })
    const t1 = Date.now()
    let passo0: Awaited<ReturnType<typeof runPasso0>>
    let painPoints: Awaited<ReturnType<typeof runPainPointsReddit>>
    try {
      ;[passo0, painPoints] = await Promise.all([
        runPasso0(amazonData),
        runPainPointsReddit(keyword, redditData, youtubeData),
      ])
      logEntries.push({
        step: 'passo0', label: 'Analisi competitor (AI)',
        status: 'ok',
        summary: `Angolo: ${passo0.angolo} · Target: ${passo0.target_reader}`,
        durationMs: Date.now() - t1,
        details: {
          angolo: passo0.angolo,
          target_reader: passo0.target_reader,
          usp: passo0.usp,
          punti_forza: passo0.punti_forza,
          punti_debolezza: passo0.punti_debolezza,
        },
      })
      const criticalCount = painPoints.filter(p => p.criticalSignal).length
      const bySource = painPoints.reduce<Record<string, number>>((acc, p) => {
        acc[p.fonte] = (acc[p.fonte] ?? 0) + 1; return acc
      }, {})
      logEntries.push({
        step: 'painpoints', label: 'Pain Points (AI)',
        status: painPoints.length === 0 ? 'warn' : 'ok',
        summary: `${painPoints.length} pain point · ${criticalCount} segnali critici`,
        details: {
          count: painPoints.length,
          criticalSignals: criticalCount,
          bySource,
          list: painPoints.map(p => ({ pain_point: p.pain_point, score: p.score, fonte: p.fonte, criticalSignal: !!p.criticalSignal })),
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logEntries.push({ step: 'passo0', label: 'Analisi competitor (AI)', status: 'error', summary: msg, durationMs: Date.now() - t1, details: {}, error: msg })
      logEntries.push({ step: 'painpoints', label: 'Pain Points (AI)', status: 'error', summary: 'Step saltato per errore passo0', details: {}, error: msg })
      throw err
    }

    // ── Step 2: insights + trend forecast + gap analysis ─────────────────────
    push({ type: 'progress', stage: 'insights' })
    const t2 = Date.now()
    let keyInsights: Awaited<ReturnType<typeof runKeyInsights>>
    let trendForecast: Awaited<ReturnType<typeof runTrendForecast>>
    let gapAnalysis: Awaited<ReturnType<typeof runGapAnalysis>>
    try {
      ;[keyInsights, trendForecast, gapAnalysis] = await Promise.all([
        runKeyInsights(amazonData, trendsData, redditData, scoring, painPoints),
        runTrendForecast(keyword, trendsData, scoring.trendSignal),
        runGapAnalysis(amazonData, painPoints, redditData, userNotes, youtubeData),
      ])
      logEntries.push({
        step: 'insights', label: 'Insight & Gap Analysis (AI)',
        status: 'ok',
        summary: `${keyInsights.length} insight · trend: ${trendForecast?.classificazione ?? 'N/A'}`,
        durationMs: Date.now() - t2,
        details: {
          keyInsightsCount: keyInsights.length,
          trendClassificazione: trendForecast?.classificazione ?? null,
          gapItemsCount: (gapAnalysis.gap_inventory_table as unknown[])?.length ?? 0,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logEntries.push({ step: 'insights', label: 'Insight & Gap Analysis (AI)', status: 'error', summary: msg, durationMs: Date.now() - t2, details: {}, error: msg })
      throw err
    }

    // ── Step 3: series strategy + ROI ─────────────────────────────────────────
    push({ type: 'progress', stage: 'strategy' })
    const t3 = Date.now()
    let seriesStrategy: Awaited<ReturnType<typeof runSeriesStrategy>>
    let roiNarrative: Awaited<ReturnType<typeof runRoiNarrative>>
    try {
      ;[seriesStrategy, roiNarrative] = await Promise.all([
        runSeriesStrategy(amazonData, gapAnalysis.passo5_tesi_libro, scoring, roi),
        runRoiNarrative(keyword, market, roi, scoring, budget),
      ])
      logEntries.push({
        step: 'strategy', label: 'Strategia e ROI (AI)',
        status: 'ok',
        summary: `Verdetto: ${seriesStrategy.verdetto} · Breakeven: ${roi.breakEvenMonths} mesi`,
        durationMs: Date.now() - t3,
        details: {
          verdetto: seriesStrategy.verdetto,
          breakEvenMonths: roi.breakEvenMonths,
          avgMonthlyRevenueMin: roi.avgMonthlyRevenueMin,
          avgMonthlyRevenueMax: roi.avgMonthlyRevenueMax,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logEntries.push({ step: 'strategy', label: 'Strategia e ROI (AI)', status: 'error', summary: msg, durationMs: Date.now() - t3, details: {}, error: msg })
      throw err
    }

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
