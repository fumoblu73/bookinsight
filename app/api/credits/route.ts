import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { CreditsData } from '@/lib/types'
import { MAX_PRODUCT_CALLS, MAX_BOOKS } from '@/lib/amazon'

export const revalidate = 0

const CACHE_KEY      = 'serpapi:credits:v7'
const APIFY_CACHE_KEY = 'apify:credits:v7'
const CACHE_TTL      = 300  // 5 minuti

// Flusso /analyze: 1 SERP + MAX_PRODUCT_CALLS product detail + MAX_BOOKS recensioni (tutte SerpApi)
const ANALYZE_COST_SERPAPI = 1 + MAX_PRODUCT_CALLS + MAX_BOOKS  // = 14

// Flusso Target Finder: 1 SERP + ~12 product detail (prima pagina dopo pre-filtro, stima media 10–14)
const TARGET_FINDER_COST_SERPAPI = 1 + 12  // = 13

// Viability (Apify): una chiamata reviews per analisi fattibilità bersaglio
const APIFY_VIABILITY_COST_USD = 0.10  // stima conservativa

const EMPTY: CreditsData = {
  total_searches_left: 0, plan_searches_left: 0, searches_per_month: 0,
  plan_name: 'unknown', account_email: '', available: false, cached: false,
  analyzesAvailable: 0, targetFinderAvailable: 0,
  apifyBalanceUsd: 0, apifyAvailable: false,
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
  let serpBase: Omit<CreditsData, 'analyzesAvailable' | 'targetFinderAvailable' | 'apifyBalanceUsd' | 'apifyAvailable'>
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

  // ── Apify balance ─────────────────────────────────────────────────────────
  let apifyBalanceUsd = 0
  let apifyAvailable  = false

  const apifyToken = process.env.APIFY_TOKEN
  if (apifyToken) {
    try {
      const apifyCached = await redis.get<{ balance: number }>( APIFY_CACHE_KEY).catch(() => null)
      if (apifyCached) {
        apifyBalanceUsd = apifyCached.balance
        apifyAvailable  = true
      } else {
        const apifyRes = await fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`, {
          signal: AbortSignal.timeout(5000),
        })
        if (apifyRes.ok) {
          const raw = await apifyRes.json() as { data?: Record<string, unknown> }
          const d = raw.data ?? {}
          const plan = d.plan as Record<string, unknown> | undefined
          const APIFY_MONTHLY_LIMIT: number = (plan?.monthlyUsageCreditsUsd as number | undefined) ?? 5

          let used = 0
          try {
            const usageRes = await fetch(
              `https://api.apify.com/v2/users/me/usage/monthly?token=${apifyToken}`,
              { signal: AbortSignal.timeout(4000) }
            )
            if (usageRes.ok) {
              type ServiceEntry = { amountAfterVolumeDiscountUsd?: number }
              type UsageResponse = { data?: { monthlyServiceUsage?: Record<string, ServiceEntry> } }
              const usageData = await usageRes.json() as UsageResponse
              const services = usageData.data?.monthlyServiceUsage ?? {}
              used = Object.values(services).reduce(
                (sum, s) => sum + (s.amountAfterVolumeDiscountUsd ?? 0), 0
              )
            }
          } catch {
            // silently ignore — used stays 0
          }
          const avail = Math.max(0, APIFY_MONTHLY_LIMIT - used)

          apifyBalanceUsd = Math.round(avail * 100) / 100
          apifyAvailable  = true

          await redis.set(APIFY_CACHE_KEY, { balance: apifyBalanceUsd }, { ex: CACHE_TTL }).catch(() => {})
        }
      }
    } catch {
      console.warn('[credits] Apify balance non disponibile')
    }
  }

  // ── Calcola contatori ─────────────────────────────────────────────────────
  const analyzesAvailable      = Math.floor(totalLeft / ANALYZE_COST_SERPAPI)
  const targetFinderFromSerpApi = Math.floor(totalLeft / TARGET_FINDER_COST_SERPAPI)
  const apifyViabilityAvailable = apifyAvailable
    ? Math.floor(apifyBalanceUsd / APIFY_VIABILITY_COST_USD)
    : Infinity
  const targetFinderAvailable  = Math.min(targetFinderFromSerpApi, apifyViabilityAvailable)

  const result: CreditsData = {
    ...serpBase,
    analyzesAvailable,
    targetFinderAvailable,
    apifyBalanceUsd,
    apifyAvailable,
  }

  try { await redis.set(CACHE_KEY, result, { ex: CACHE_TTL }) } catch {}

  return NextResponse.json(result)
}
