import { NextRequest, NextResponse } from 'next/server'
import { Market, TargetFinderResult, AmazonReview } from '@/lib/types'
import { cacheGet, cacheSet } from '@/lib/upstash'
import { fetchAmazonReviewsApify, calcRecentReviewVelocity } from '@/lib/amazon-reviews'
import { runTargetWeaknesses } from '@/lib/ai'
import { calcTargetViability } from '@/lib/target'

export const maxDuration = 60

const REVIEWS_TTL  = 60 * 60 * 6   // 6h — Apify è costoso, non richamarlo troppo spesso
const PREFETCH_TTL = 60 * 60 * 24  // 24h — allineato alla cache Target Finder

function reviewsCacheKey(market: Market, asin: string): string {
  return `reviews:${market}:${asin}`
}

function prefetchCacheKey(asin: string, market: Market): string {
  // v2: aligned with target cache version bump
  return `prefetch:v2:${asin}:${market}`
}

function targetCacheKey(market: Market, keyword: string): string {
  // v2: must match the key written by app/api/target/route.ts
  return `target:v2:${market}:${keyword.toLowerCase().trim()}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      asin?: string
      market?: Market
      keyword?: string
      userReviewVelocity?: number
      arcReviews?: number
    }

    const { asin, market, keyword, userReviewVelocity, arcReviews } = body

    if (!asin?.trim()) {
      return NextResponse.json({ error: 'asin richiesto' }, { status: 400 })
    }
    if (!['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(market ?? '')) {
      return NextResponse.json({ error: 'mercato non valido' }, { status: 400 })
    }
    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta per recuperare il contesto nicchia' }, { status: 400 })
    }

    // Recupera il Target Finder result dalla cache per ottenere il candidato e nicheReviewVelocity
    const finderResult = await cacheGet<TargetFinderResult>(targetCacheKey(market!, keyword.trim()))
    if (!finderResult) {
      return NextResponse.json(
        { error: `Esegui prima la ricerca Target Finder per "${keyword}" su ${market}` },
        { status: 400 },
      )
    }

    const candidate = finderResult.candidates.find(c => c.asin === asin.trim())
    if (!candidate) {
      return NextResponse.json(
        { error: `ASIN ${asin} non trovato nei risultati per "${keyword}" su ${market}` },
        { status: 404 },
      )
    }

    // Recupera recensioni (cache → Apify)
    const rKey = reviewsCacheKey(market!, asin.trim())
    let reviews = await cacheGet<AmazonReview[]>(rKey)
    if (!reviews) {
      reviews = await fetchAmazonReviewsApify(asin.trim(), market!)
      if (reviews.length > 0) {
        cacheSet(rKey, reviews, REVIEWS_TTL).catch(() => {})
      }
    }

    // Analisi debolezze + velocità recente (in parallelo non possibile: weaknesses dipende da reviews)
    const [weaknesses, recentReviewVelocity] = await Promise.all([
      runTargetWeaknesses(candidate.title, reviews),
      Promise.resolve(calcRecentReviewVelocity(reviews)),
    ])

    const viability = calcTargetViability(
      candidate,
      finderResult.nicheReviewVelocity,
      weaknesses,
      recentReviewVelocity,
      userReviewVelocity,
      arcReviews ?? 0,
    )

    // Opzione A §7 ROI_REANCHOR_PLAN: persisti monthsToParity e arcReviews per /api/analyze
    cacheSet(prefetchCacheKey(asin.trim(), market!), {
      monthsToParity: viability.monthsToParityMoving,
      arcReviews:     viability.assumptions.arcReviews,
    }, PREFETCH_TTL).catch(() => {})

    return NextResponse.json(viability)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
