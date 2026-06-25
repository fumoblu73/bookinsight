import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { CreditsData } from '@/lib/types'
import { MAX_PRODUCT_CALLS, MAX_BOOKS } from '@/lib/amazon'

export const revalidate = 0

const CACHE_KEY       = 'serpapi:credits:v8'
const APIFY_CACHE_KEY = 'apify:credits:v8'
const CACHE_TTL       = 300  // 5 minuti

// Flusso /analyze: 1 SERP + MAX_PRODUCT_CALLS product detail + MAX_BOOKS recensioni (tutte SerpApi)
const ANALYZE_COST_SERPAPI = 1 + MAX_PRODUCT_CALLS + MAX_BOOKS  // = 14

// Flusso Target Finder: 1 SERP + ~12 product detail (prima pagina dopo pre-filtro, stima media 10–14)
const TARGET_FINDER_COST_SERPAPI = 1 + 12  // = 13

// Viability (Apify): una chiamata reviews per analisi fattibilità bersaglio
const APIFY_VIABILITY_COST_USD = 0.10  // stima conservativa, usato altrove per stime

const EMPTY: CreditsData = {
  total_searches_left: 0, plan_searches_left: 0, searches_per_month: 0,
  plan_name: 'unknown', account_email: '', available: false, cached: false,
  analyzesAvailable: 0, targetFinderAvailable: 0,
  apifyBalanceUsd: 0, apifyAvailable: false,
  apifyState: 'unknown',
  apifyPrepaidUsd: 0, apifyCapUsd: 0, apifyUsedUsd: 0,
  apifyOverageUsd: 0, apifyMarginToCapUsd: 0,
}

type ApifyBlock = {
  apifyAvailable: boolean
  apifyState: 'ok' | 'overage' | 'capped' | 'unknown'
  apifyPrepaidUsd: number
  apifyCapUsd: number
  apifyUsedUsd: number
  apifyOverageUsd: number
  apifyMarginToCapUsd: number
  apifyBalanceUsd: number
}

export async function GET(): Promise<NextResponse<CreditsData>> {
  const redis = Redis.fromEnv()

  // ── Cache check ───────────────────────────────────────────────────────────
  try {
    const cached = await redis.get<CreditsData>(CACHE_KEY)
    if (cached) return NextResponse.json({ ...cached, cached: true })
  } catch {
    console.warn('[credits] Redis non disponibile, fallback diretto')
  }

  // ── SerpApi account ───────────────────────────────────────────────────────
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) return NextResponse.json(EMPTY)

  let totalLeft = 0
  let serpBase: Omit<CreditsData, 'analyzesAvailable' | 'targetFinderAvailable' | 'apifyBalanceUsd' | 'apifyAvailable' | 'apifyState' | 'apifyPrepaidUsd' | 'apifyCapUsd' | 'apifyUsedUsd' | 'apifyOverageUsd' | 'apifyMarginToCapUsd'>
  try {
    const res = await fetch(`https://serpapi.com/account?api_key=${apiKey}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`SerpApi account: ${res.status}`)
    const data = await res.json() as Record<string, unknown>

    totalLeft = (data.total_searches_left as number | undefined) ?? 0
    serpBase = {
      total_searches_left:  totalLeft,
      plan_searches_left:   (data.plan_searches_left  as number | undefined) ?? 0,
      searches_per_month:   (data.searches_per_month  as number | undefined) ?? 0,
      plan_name:            (data.plan_name            as string | undefined) ?? 'unknown',
      account_email:        (data.account_email        as string | undefined) ?? '',
      available:            true,
      cached:               false,
      cached_at:            new Date().toISOString(),
    }
  } catch (err) {
    console.error('[credits] SerpApi fetch fallito:', err)
    return NextResponse.json(EMPTY)
  }

  // ── Apify 3-state balance ─────────────────────────────────────────────────
  const apifyToken = process.env.APIFY_TOKEN
  let apifyBlock: ApifyBlock = {
    apifyAvailable: false,
    apifyState: 'unknown',
    apifyPrepaidUsd: 0, apifyCapUsd: 0, apifyUsedUsd: 0,
    apifyOverageUsd: 0, apifyMarginToCapUsd: 0,
    apifyBalanceUsd: 0,
  }

  if (apifyToken) {
    try {
      const cached = await redis.get<ApifyBlock>(APIFY_CACHE_KEY).catch(() => null)
      if (cached) {
        apifyBlock = cached
      } else {
        // Chiama /users/me per prepaid e /users/me/limits per cap + used
        const [meRes, limitsRes] = await Promise.all([
          fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`, { signal: AbortSignal.timeout(5000) }),
          fetch(`https://api.apify.com/v2/users/me/limits?token=${apifyToken}`, { signal: AbortSignal.timeout(5000) }),
        ])

        let prepaid = 29  // fallback
        if (meRes.ok) {
          const raw = await meRes.json() as { data?: { plan?: Record<string, unknown> } }
          const plan = raw.data?.plan ?? {}
          prepaid = (plan.monthlyUsageCreditsUsd as number | undefined) ?? 29
        }

        let cap = 50   // fallback
        let used = 0
        if (limitsRes.ok) {
          type LimitsResponse = {
            data?: {
              limits?: { maxMonthlyUsageUsd?: number }
              current?: { monthlyUsageUsd?: number }
            }
          }
          const raw = await limitsRes.json() as LimitsResponse
          cap  = raw.data?.limits?.maxMonthlyUsageUsd  ?? 50
          used = raw.data?.current?.monthlyUsageUsd    ?? 0
        }

        const overage     = Math.round(Math.max(0, used - prepaid) * 100) / 100
        const marginToCap = Math.round(Math.max(0, cap - used)     * 100) / 100
        const usedRound   = Math.round(used    * 100) / 100
        const prepaidR    = Math.round(prepaid * 100) / 100
        const capR        = Math.round(cap     * 100) / 100

        let apifyState: 'ok' | 'overage' | 'capped'
        if (used >= cap)     apifyState = 'capped'
        else if (used >= prepaid) apifyState = 'overage'
        else                 apifyState = 'ok'

        apifyBlock = {
          apifyAvailable:    true,
          apifyState,
          apifyPrepaidUsd:   prepaidR,
          apifyCapUsd:       capR,
          apifyUsedUsd:      usedRound,
          apifyOverageUsd:   overage,
          apifyMarginToCapUsd: marginToCap,
          apifyBalanceUsd:   marginToCap,  // retrocompatibilità: saldo = margine al tetto
        }

        await redis.set(APIFY_CACHE_KEY, apifyBlock, { ex: CACHE_TTL }).catch(() => {})
      }
    } catch {
      console.warn('[credits] Apify balance non disponibile')
    }
  }

  // ── Calcola contatori ─────────────────────────────────────────────────────
  const analyzesAvailable      = Math.floor(totalLeft / ANALYZE_COST_SERPAPI)
  const targetFinderFromSerpApi = Math.floor(totalLeft / TARGET_FINDER_COST_SERPAPI)
  // Apify blocca SOLO se capped. In overage/ok non limita il contatore.
  const apifyViabilityAvailable = !apifyBlock.apifyAvailable
    ? Infinity
    : apifyBlock.apifyState === 'capped'
      ? 0
      : Infinity
  const targetFinderAvailable = Math.min(targetFinderFromSerpApi, apifyViabilityAvailable)

  const result: CreditsData = {
    ...serpBase,
    analyzesAvailable,
    targetFinderAvailable,
    ...apifyBlock,
  }

  try { await redis.set(CACHE_KEY, result, { ex: CACHE_TTL }) } catch {}

  return NextResponse.json(result)
}
