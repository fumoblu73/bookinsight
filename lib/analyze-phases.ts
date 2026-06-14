import {
  AmazonData, TrendsData, RedditData, YouTubeData,
  PainPoint, SubNiche, LogEntry, Market,
} from './types'
import {
  ComplianceCategory, ComplianceRisk,
  detectComplianceCategory, getComplianceRisk,
} from './compliance'
import {
  ProfitabilityBreakdown, CompetitiveDynamism,
  calcProfitabilityScore, calcRoiEstimate, calcCompetitiveDynamism, calcRoiPerformance,
} from './scoring'
import {
  Passo0Result, KeyInsight, TrendForecastResult, GapAnalysisResult,
  SeriesStrategyResult, RoiNarrativeResult,
  runPasso0, runPainPointsReddit, runSubNicheDetection,
  runKeyInsights, runTrendForecast, runGapAnalysis,
  runSeriesStrategy, runRoiNarrative, runPainPointsAmazonReviews,
} from './ai'
import { cacheGet } from './upstash'

// ─── Tipi intermedi ───────────────────────────────────────────────────────────

export interface PainPointsIntermediate {
  keyword: string
  market: Market
  amazon: AmazonData
  trends: TrendsData
  reddit: RedditData
  youtube: YouTubeData | undefined
  painPoints: PainPoint[]
  painPointsAmazon: PainPoint[]   // placeholder: runPainPointsAmazonReviews non ancora implementato
  subNiches: SubNiche[]
  complianceRisk: ComplianceRisk
  complianceCategory: ComplianceCategory
  scoring: ProfitabilityBreakdown
  competitiveDynamism: CompetitiveDynamism
  passo0: Passo0Result
  logEntries: LogEntry[]
  timestamp: string
}

export interface FinalizeOptions {
  cpc?: number
  userNotes?: string
  plannedPrice?: number
  plannedPages?: number
  conversionRate?: number
  costoScrittura?: number
  costoCopertina?: number
  costoPerRecensione?: number
}

export interface FinalizeResult {
  report: unknown
  finalizeLogs: LogEntry[]
}

// ─── Phase 1: fetching AI + pain points ──────────────────────────────────────
// Riceve dati già fetchati; esegue passo0, pain points, sub-niche detection.
// Non tocca Redis.

export async function runPainPointsPhase(
  amazon: AmazonData,
  trends: TrendsData,
  reddit: RedditData,
  youtube: YouTubeData | undefined,
): Promise<PainPointsIntermediate> {
  const keyword = amazon.keyword
  const market  = amazon.market

  const complianceCategory = detectComplianceCategory(keyword)
  const complianceRisk     = getComplianceRisk(complianceCategory)
  const scoring = calcProfitabilityScore(amazon.topBooks, trends, complianceRisk, market)
  const competitiveDynamism = calcCompetitiveDynamism(amazon.rawTop15, amazon.scrapedAt)

  const logEntries: LogEntry[] = []

  // ── Log: Amazon SERP ─────────────────────────────────────────────────────
  logEntries.push({
    step: 'amazon', label: 'Amazon SERP',
    status: 'ok',
    summary: `${amazon.rawTop15.length} candidati → ${amazon.topBooks.length} libri filtrati`,
    details: {
      market,
      candidatesAfterPreFilter: amazon.rawTop15.length,
      topBooksCount: amazon.topBooks.length,
      filteredOut: amazon.rawTop15.length - amazon.topBooks.length,
      subNiches: amazon.subNiches.map(s => s.keyword),
      topBooks: amazon.topBooks.map(b => ({
        asin: b.asin, title: b.title, bsr: b.bsr,
        price: b.price, pages: b.pages ?? 0,
        reviewCount: b.reviewCount, format: b.format ?? '',
      })),
      rawBooks: amazon.rawTop15.map(b => ({
        asin: b.asin, title: b.title, format: b.format ?? '',
        sponsored: b.sponsored, reviewCount: b.reviewCount,
      })),
    },
  })

  // ── Log: Recensioni Amazon ────────────────────────────────────────────────
  const reviewsList = amazon.topBookReviews ?? []
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

  // ── Log: Reddit ───────────────────────────────────────────────────────────
  const postsBySubreddit = reddit.posts.reduce<Record<string, number>>((acc, p) => {
    acc[p.subreddit] = (acc[p.subreddit] ?? 0) + 1; return acc
  }, {})
  const selftextNonEmpty = reddit.posts.filter(p => (p.selftext ?? '').length > 20).length
  const postsWithComments = reddit.posts.filter(p => p.comments.length > 0).length
  logEntries.push({
    step: 'reddit', label: 'Reddit',
    status: !reddit.available ? 'error' : reddit.insufficientCorpus ? 'warn' : 'ok',
    summary: reddit.available
      ? `${reddit.threadCount} thread · ${reddit.totalComments} commenti · ${reddit.subredditsUsed.length} subreddit`
      : 'Nessun dato disponibile',
    details: {
      available: reddit.available,
      insufficientCorpus: reddit.insufficientCorpus,
      threadCount: reddit.threadCount,
      totalComments: reddit.totalComments,
      selftextNonEmpty,
      postsWithComments,
      subredditsUsed: reddit.subredditsUsed,
      postsBySubreddit,
      posts: reddit.posts.map(p => ({
        id: p.id, title: p.title.slice(0, 80), subreddit: p.subreddit,
        score: p.score, selftextLen: (p.selftext ?? '').length,
        commentsLoaded: p.comments.length, month: p.month,
      })),
    },
  })

  // ── Log: YouTube ──────────────────────────────────────────────────────────
  const ytApiKeyPresent = !!process.env.YOUTUBE_API_KEY
  const ytAvailable = youtube?.available ?? false
  logEntries.push({
    step: 'youtube', label: 'YouTube',
    status: !ytApiKeyPresent ? 'warn' : !ytAvailable ? 'warn' : 'ok',
    summary: !ytApiKeyPresent
      ? 'YOUTUBE_API_KEY non configurata — dati non disponibili'
      : ytAvailable
        ? `${youtube?.videos?.length ?? 0} video · ${youtube?.totalComments ?? 0} commenti`
        : 'Dati non disponibili (nessun video o corpus insufficiente)',
    details: {
      apiKeyPresent: ytApiKeyPresent,
      available: ytAvailable,
      insufficientCorpus: youtube?.insufficientCorpus ?? true,
      videoCount: youtube?.videos?.length ?? 0,
      totalComments: youtube?.totalComments ?? 0,
      videos: (youtube?.videos ?? []).map(v => ({
        title: v.title.slice(0, 80),
        viewCount: v.viewCount,
        commentCount: v.comments.length,
      })),
    },
  })

  // ── Log: Google Trends ────────────────────────────────────────────────────
  logEntries.push({
    step: 'trends', label: 'Google Trends',
    status: trends.available ? 'ok' : 'warn',
    summary: trends.available
      ? `${trends.timelineData.length} mesi di dati · YoY ${trends.yoyGrowth >= 0 ? '+' : ''}${trends.yoyGrowth}%`
      : 'Dati non disponibili (query troppo specifica o rate limit)',
    details: {
      available: trends.available,
      queryUsed: trends.keyword,
      dataPoints: trends.timelineData.length,
      yoyGrowth: trends.yoyGrowth,
      relatedQueriesCount: trends.relatedQueries.length,
      relatedQueries: trends.relatedQueries.map(q => q.query),
    },
  })

  // ── Log: Scoring ──────────────────────────────────────────────────────────
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
      prezzoStats: { avg: scoring.avgPrice, min: scoring.minPrice, max: scoring.maxPrice },
      pagineStats: { avg: scoring.avgPages, min: scoring.minPages, max: scoring.maxPages },
      avgBsr: scoring.avgBsr,
    },
  })

  // ── AI: passo0 + pain points + sub-niche detection (in parallelo) ─────────
  const t1 = Date.now()
  let passo0: Passo0Result
  let painPoints: PainPoint[]
  let aiSubNiches: Awaited<ReturnType<typeof runSubNicheDetection>>
  let unifiedSubNiches: SubNiche[] = amazon.subNiches

  try {
    ;[passo0, painPoints, aiSubNiches] = await Promise.all([
      runPasso0(amazon),
      runPainPointsReddit(keyword, reddit, youtube, market),
      runSubNicheDetection(amazon.rawTop15, keyword, market),
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
    if (aiSubNiches.length > 0) {
      unifiedSubNiches = aiSubNiches
        .map(s => {
          const book = amazon.rawTop15.find(b => b.asin === s.asin)
          if (!book || book.bsr === 0) return null
          return { keyword: s.keyword, bsr: book.bsr, reviewCount: book.reviewCount, vulnerable: book.reviewCount < 100 }
        })
        .filter((s): s is SubNiche => s !== null)
        .sort((a, b) => a.bsr - b.bsr)
    } else {
      logEntries.push({
        step: 'subNiches', label: 'Sub-nicchie',
        status: 'warn',
        summary: 'AI sub-niche detection vuota: fallback su detectSubNiches algoritmica',
        details: { fallbackCount: amazon.subNiches.length, fallbackKeywords: amazon.subNiches.map(s => s.keyword) },
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logEntries.push({ step: 'passo0', label: 'Analisi competitor (AI)', status: 'error', summary: msg, durationMs: Date.now() - t1, details: {}, error: msg })
    logEntries.push({ step: 'painpoints', label: 'Pain Points (AI)', status: 'error', summary: 'Step saltato per errore passo0', details: {}, error: msg })
    throw err
  }

  let painPointsAmazon: PainPoint[] = []
  try {
    painPointsAmazon = await runPainPointsAmazonReviews(
      keyword,
      amazon.topBookReviews ?? [],
      market,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logEntries.push({
      step: 'reviews',
      label: 'Pain Points da Recensioni Amazon (AI)',
      status: 'warn',
      summary: `Estrazione pain points fallita: ${msg}`,
      details: {},
    })
  }

  const reviewsLogEntry = logEntries.find(e => e.step === 'reviews' && e.label === 'Recensioni Amazon')
  if (reviewsLogEntry) {
    reviewsLogEntry.details.amazonPainPointsExtracted = painPointsAmazon.length
  }

  return {
    keyword,
    market,
    amazon,
    trends,
    reddit,
    youtube,
    painPoints,
    painPointsAmazon,
    subNiches: unifiedSubNiches,
    complianceRisk,
    complianceCategory,
    scoring,
    competitiveDynamism,
    passo0,
    logEntries,
    timestamp: new Date().toISOString(),
  }
}

// ─── Phase 2: insights + gap + strategy + ROI ────────────────────────────────
// Riceve lo stato intermedio + gli id dei pain point selezionati dall'utente.
// selectedPainPointIds vuoto = usa tutti (backward compat).

export async function runFinalizePhase(
  intermediate: PainPointsIntermediate,
  selectedPainPointIds: string[],
  options: FinalizeOptions = {},
  onProgress?: (stage: 'insights' | 'strategy') => void,
): Promise<FinalizeResult> {
  const {
    cpc, userNotes, plannedPrice, plannedPages, conversionRate,
    costoScrittura, costoCopertina, costoPerRecensione,
  } = options

  const { amazon, trends, reddit, youtube, scoring, passo0, subNiches, complianceCategory, complianceRisk, competitiveDynamism } = intermediate

  // Filtra pain points: se selectedPainPointIds è vuoto usa tutti
  const activePainPoints = selectedPainPointIds.length > 0
    ? intermediate.painPoints.filter(p => p.id && selectedPainPointIds.includes(p.id))
    : intermediate.painPoints

  // Prefetch Target Finder (opzionale, per ROI accurato)
  const prefetch = await cacheGet<{ monthsToParity: number; arcReviews: number }>(
    `prefetch:${amazon.competitorTarget.asin}:${amazon.market}`
  )

  const roi = calcRoiEstimate(amazon.competitorTarget, amazon.market, {
    ...(cpc              !== undefined && !isNaN(cpc)              && cpc > 0              ? { cpc }              : {}),
    ...(plannedPrice     !== undefined && !isNaN(plannedPrice)     && plannedPrice > 0     ? { plannedPrice }     : {}),
    ...(plannedPages     !== undefined && !isNaN(plannedPages)     && plannedPages > 0     ? { plannedPages }     : {}),
    ...(conversionRate   !== undefined && !isNaN(conversionRate)   && conversionRate > 0   ? { conversionRate }   : {}),
    ...(costoScrittura   !== undefined && !isNaN(costoScrittura)                           ? { costoScrittura }   : {}),
    ...(costoCopertina   !== undefined && !isNaN(costoCopertina)                           ? { costoCopertina }   : {}),
    ...(costoPerRecensione !== undefined && !isNaN(costoPerRecensione)                     ? { costoPerRecensione } : {}),
    ...(prefetch ? { monthsToParity: prefetch.monthsToParity, arcReviews: prefetch.arcReviews } : {}),
  })

  const adsIntelligence = {
    ...amazon.ads_intelligence,
    roi_performance: calcRoiPerformance(
      amazon.ads_intelligence,
      scoring.avgPrice,
      scoring.avgPages,
      amazon.market,
      {
        ...(plannedPrice     !== undefined && !isNaN(plannedPrice)     && plannedPrice > 0     ? { plannedPrice }     : {}),
        ...(plannedPages     !== undefined && !isNaN(plannedPages)     && plannedPages > 0     ? { plannedPages }     : {}),
        ...(costoCopertina   !== undefined && !isNaN(costoCopertina)                           ? { costoCopertina }   : {}),
        ...(costoPerRecensione !== undefined && !isNaN(costoPerRecensione)                     ? { costoPerRecensione } : {}),
        ...(prefetch ? { arcReviews: prefetch.arcReviews } : {}),
      }
    ),
  }

  const finalizeLogs: LogEntry[] = []

  // ── Step: insights + trend forecast + gap analysis ────────────────────────
  onProgress?.('insights')
  const t2 = Date.now()
  let keyInsights: KeyInsight[]
  let trendForecast: TrendForecastResult | null
  let gapAnalysis: GapAnalysisResult
  try {
    ;[keyInsights, trendForecast, gapAnalysis] = await Promise.all([
      runKeyInsights(amazon, trends, reddit, scoring, activePainPoints, subNiches),
      runTrendForecast(intermediate.keyword, trends, scoring.trendSignal),
      runGapAnalysis(amazon, activePainPoints, reddit, userNotes, youtube),
    ])
    finalizeLogs.push({
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
    finalizeLogs.push({ step: 'insights', label: 'Insight & Gap Analysis (AI)', status: 'error', summary: msg, durationMs: Date.now() - t2, details: {}, error: msg })
    throw err
  }

  // ── Step: series strategy + ROI narrative ─────────────────────────────────
  onProgress?.('strategy')
  const t3 = Date.now()
  let seriesStrategy: SeriesStrategyResult
  let roiNarrative: RoiNarrativeResult
  try {
    ;[seriesStrategy, roiNarrative] = await Promise.all([
      runSeriesStrategy(amazon, gapAnalysis.passo5_tesi_libro, scoring, roi),
      runRoiNarrative(intermediate.keyword, intermediate.market, roi, scoring),
    ])
    finalizeLogs.push({
      step: 'strategy', label: 'Strategia e ROI (AI)',
      status: 'ok',
      summary: `Verdetto: ${seriesStrategy.verdetto} · Breakeven: ${roi.scenarios[1].breakEvenMonths} mesi`,
      durationMs: Date.now() - t3,
      details: {
        verdetto: seriesStrategy.verdetto,
        investVerdict: roi.investVerdict,
        breakEvenMonths: roi.scenarios[1].breakEvenMonths,
        netProfit12mBase: roi.scenarios[1].netProfit12m,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finalizeLogs.push({ step: 'strategy', label: 'Strategia e ROI (AI)', status: 'error', summary: msg, durationMs: Date.now() - t3, details: {}, error: msg })
    throw err
  }

  const report = {
    keyword: intermediate.keyword,
    market: intermediate.market,
    createdAt: new Date().toISOString(),
    status: 'complete' as const,
    ...(cpc !== undefined && !isNaN(cpc) && cpc > 0 ? { cpc } : {}),
    keyInsights,
    profitabilityScore: scoring.score,
    scoringBreakdown: scoring,
    competitorTarget: amazon.competitorTarget,
    topBooks: amazon.topBooks,
    redditMeta: {
      available: reddit.available,
      insufficientCorpus: reddit.insufficientCorpus,
      threadCount: reddit.threadCount,
      subredditsUsed: reddit.subredditsUsed,
    },
    passo0,
    trends,
    trendForecast,
    painPoints: activePainPoints,
    gapAnalysis,
    seriesStrategy,
    roi,
    roiNarrative,
    budget: roi.params.budgetProduzione,
    amazon,
    ads_intelligence: adsIntelligence,
    competitiveDynamism,
    complianceCategory,
    complianceRisk,
    subNiches,
    voice_data: {
      reddit: {
        posts: reddit.posts.map(p => ({
          title: p.title,
          selftext: p.selftext ?? '',
          subreddit: p.subreddit,
          score: p.score,
          comments: p.comments.map(c => ({ body: c.body, score: c.score })),
        })),
        available: reddit.available,
        totalComments: reddit.totalComments,
        subredditsUsed: reddit.subredditsUsed,
      },
      youtube: youtube?.available ? {
        videos: (youtube.videos ?? []).map(v => ({
          title: v.title,
          viewCount: v.viewCount,
          comments: v.comments.map(c => ({ text: c.text, likeCount: c.likeCount })),
        })),
        available: youtube.available,
        totalComments: youtube.totalComments,
      } : null,
      reviews: amazon.topBookReviews ?? [],
    },
  }

  return { report, finalizeLogs }
}
