import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { CreditsData } from '@/lib/types'

export const maxDuration = 10

const CREDITS_PER_ANALYSIS = 14
const APIFY_COST_PER_ANALYSIS = 0.47
const CACHE_KEY = 'serpapi:credits'
const CACHE_TTL = 300

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) throw new Error('Upstash: variabili KV mancanti')
  return new Redis({ url, token })
}

export async function GET() {
  try {
    const redis = getRedis()

    // Check cache
    const raw = await redis.get<unknown>(CACHE_KEY)
    if (raw) {
      const cached = typeof raw === 'string' ? JSON.parse(raw) as CreditsData : raw as CreditsData
      return NextResponse.json(cached)
    }

    // Fetch SerpApi account
    const apiKey = process.env.SERPAPI_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'SERPAPI_KEY non configurata' }, { status: 500 })
    }

    const res = await fetch(`https://serpapi.com/account?api_key=${apiKey}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`SerpApi account: ${res.status}`)

    const account = await res.json() as {
      plan_searches_left?: number
    }

    const searchesLeft = account.plan_searches_left ?? 0
    const analysesAvailable = Math.floor(searchesLeft / CREDITS_PER_ANALYSIS)

    // Try Apify balance
    let apifyBalanceUsd: number | null = null
    let apifyAnalysesAvailable: number | null = null
    const apifyToken = process.env.APIFY_TOKEN
    if (apifyToken) {
      try {
        const apifyRes = await fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`, {
          signal: AbortSignal.timeout(5000),
        })
        if (apifyRes.ok) {
          const apifyData = await apifyRes.json() as {
            data?: { availableBalance?: number }
          }
          const balance = apifyData.data?.availableBalance
          if (typeof balance === 'number') {
            apifyBalanceUsd = Math.round(balance * 100) / 100
            apifyAnalysesAvailable = Math.floor(apifyBalanceUsd / APIFY_COST_PER_ANALYSIS)
          }
        }
      } catch {
        // Apify balance not available — ignore
      }
    }

    const data: CreditsData = {
      searchesLeft,
      analysesAvailable,
      creditsPerAnalysis: CREDITS_PER_ANALYSIS,
      apifyBalanceUsd,
      apifyAnalysesAvailable,
      apifyCostPerAnalysis: APIFY_COST_PER_ANALYSIS,
      fetchedAt: new Date().toISOString(),
    }

    await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL })

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
