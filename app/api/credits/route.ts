import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { CreditsData } from '@/lib/types'

export const revalidate = 0

const CACHE_KEY = 'serpapi:credits:v6'
const CACHE_TTL = 300  // 5 minuti

// Valori calibrati su analisi reale (aprile 2026)
const CREDITS_PER_ANALYSIS = 14       // 1 SERP + 8 product + 5 recensioni (S7-6)
const APIFY_COST_PER_ANALYSIS = 0.29  // $0.77→$1.06 = $0.29/analisi

const EMPTY: CreditsData = {
  total_searches_left: 0, plan_searches_left: 0, searches_per_month: 0,
  plan_name: 'unknown', account_email: '', available: false, cached: false,
  analysesAvailable: 0, apifyBalanceUsd: 0, apifyAnalysesAvailable: 0,
  apifyAvailable: false, analysesMain: 0,
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

  let serpResult: Omit<CreditsData, 'apifyBalanceUsd' | 'apifyAnalysesAvailable' | 'apifyAvailable' | 'analysesMain'>
  try {
    const res = await fetch(`https://serpapi.com/account?api_key=${apiKey}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`SerpApi account: ${res.status}`)
    const data = await res.json() as Record<string, unknown>

    const totalLeft = (data.total_searches_left as number | undefined) ?? 0
    serpResult = {
      total_searches_left:  totalLeft,
      plan_searches_left:   (data.plan_searches_left  as number | undefined) ?? 0,
      searches_per_month:   (data.searches_per_month  as number | undefined) ?? 0,
      plan_name:            (data.plan_name            as string | undefined) ?? 'unknown',
      account_email:        (data.account_email        as string | undefined) ?? '',
      available:            true,
      cached:               false,
      cached_at:            new Date().toISOString(),
      analysesAvailable:    Math.floor(totalLeft / CREDITS_PER_ANALYSIS),
    }
  } catch (err) {
    console.error('[credits] SerpApi fetch fallito:', err)
    return NextResponse.json(EMPTY)
  }

  // ── Apify balance ─────────────────────────────────────────────────────────
  let apifyBalanceUsd = 0
  let apifyAnalysesAvailable = 0
  let apifyAvailable = false

  const apifyToken = process.env.APIFY_TOKEN
  if (apifyToken) {
    try {
      // Try cache first
      const apifyCached = await redis.get<{ balance: number; analyses: number }>('apify:credits:v6').catch(() => null)
      if (apifyCached) {
        apifyBalanceUsd = apifyCached.balance
        apifyAnalysesAvailable = apifyCached.analyses
        apifyAvailable = true
      } else {
        const apifyRes = await fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`, {
          signal: AbortSignal.timeout(5000),
        })
        if (apifyRes.ok) {
          const raw = await apifyRes.json() as { data?: Record<string, unknown> }
          const d = raw.data ?? {}
          // Piano free: limite $5/mese da plan.monthlyUsageCreditsUsd
          const plan = d.plan as Record<string, unknown> | undefined
          const APIFY_MONTHLY_LIMIT: number = (plan?.monthlyUsageCreditsUsd as number | undefined) ?? 5

          // Consumo mensile: endpoint separato /v2/users/me/usage/monthly
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
          apifyAnalysesAvailable = Math.floor(apifyBalanceUsd / APIFY_COST_PER_ANALYSIS)
          apifyAvailable = true

          await redis.set('apify:credits:v6',
            { balance: apifyBalanceUsd, analyses: apifyAnalysesAvailable },
            { ex: CACHE_TTL }
          ).catch(() => {})
        }
      }
    } catch {
      console.warn('[credits] Apify balance non disponibile')
    }
  }

  const result: CreditsData = {
    ...serpResult,
    apifyBalanceUsd,
    apifyAnalysesAvailable,
    apifyAvailable,
    analysesMain: apifyAvailable
      ? Math.min(serpResult.analysesAvailable, apifyAnalysesAvailable)
      : serpResult.analysesAvailable,
  }

  try { await redis.set(CACHE_KEY, result, { ex: CACHE_TTL }) } catch {}

  return NextResponse.json(result)
}
