import { NextRequest, NextResponse } from 'next/server'
import type { TargetInterpretationSummary } from '@/lib/types'
import { runTargetInterpretation } from '@/lib/ai'
import { cacheGet, cacheSet } from '@/lib/upstash'

export const maxDuration = 30

const CACHE_TTL_SECONDS = 60 * 60 * 24  // 24h

function cacheKey(market: string, keyword: string): string {
  return `target-interpretation:v1:${market}:${keyword.toLowerCase().trim()}`
}

export async function POST(req: NextRequest) {
  try {
    const { keyword, market, resultSummary } = await req.json() as {
      keyword?: string
      market?: string
      resultSummary?: TargetInterpretationSummary
    }

    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
    }
    if (!market) {
      return NextResponse.json({ error: 'mercato richiesto' }, { status: 400 })
    }
    if (!resultSummary) {
      return NextResponse.json({ error: 'resultSummary richiesto' }, { status: 400 })
    }

    const kw = keyword.trim()
    const key = cacheKey(market, kw)

    const cached = await cacheGet<{ interpretation: string }>(key)
    if (cached?.interpretation) {
      return NextResponse.json({ interpretation: cached.interpretation, cached: true })
    }

    const interpretation = await runTargetInterpretation(kw, market, resultSummary)

    cacheSet(key, { interpretation }, CACHE_TTL_SECONDS).catch(() => {})

    return NextResponse.json({ interpretation })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
