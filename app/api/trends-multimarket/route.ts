import { NextRequest } from 'next/server'
import { fetchTrendsData } from '@/lib/trends'
import { Market, TrendsDataPoint } from '@/lib/types'

export const maxDuration = 60

const ALL_MARKETS: Market[] = ['US', 'UK', 'DE', 'FR', 'IT', 'ES']
const MONTHS_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

function calcClassification(timeline: TrendsDataPoint[]): { classification: string; peakMonth: string | null } {
  if (timeline.length < 12) return { classification: 'N/A', peakMonth: null }
  const byMonth: number[][] = Array.from({ length: 12 }, () => [])
  for (const dp of timeline) {
    const parts = dp.date.split('-')
    if (parts.length < 2) continue
    const idx = parseInt(parts[1]) - 1
    if (idx >= 0 && idx < 12) byMonth[idx].push(dp.value)
  }
  if (byMonth.filter(m => m.length > 0).length < 10) return { classification: 'N/A', peakMonth: null }
  const rawAvg = byMonth.map(vals =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  )
  const maxVal = Math.max(...rawAvg)
  if (maxVal === 0) return { classification: 'N/A', peakMonth: null }
  const nonZero = rawAvg.filter(v => v > 0)
  const minVal = nonZero.length > 0 ? Math.min(...nonZero) : 0
  const ratio = minVal > 0 ? maxVal / minVal : 1
  const peakIdx = rawAvg.indexOf(maxVal)
  const classification = ratio < 1.4 ? 'EVERGREEN' : ratio < 2.5 ? 'STAGIONALE' : 'TREND'
  return { classification, peakMonth: MONTHS_IT[peakIdx] }
}

export async function POST(req: NextRequest) {
  const { keyword, market } = await req.json() as { keyword: string; market: Market }
  const altMarkets = ALL_MARKETS.filter(m => m !== market)

  const results = await Promise.allSettled(
    altMarkets.map(m => fetchTrendsData(keyword, m))
  )

  const summary = altMarkets.map((m, i) => {
    const result = results[i]
    if (result.status === 'rejected' || !result.value.available) {
      return { market: m, signal: 'N/A', yoyGrowth: 0, classification: 'N/A', peakMonth: null }
    }
    const td = result.value
    const signal = td.yoyGrowth > 5 ? 'CRESCITA' : td.yoyGrowth < -5 ? 'DECLINO' : 'STABILE'
    const { classification, peakMonth } = calcClassification(td.timelineData)
    return { market: m, signal, yoyGrowth: td.yoyGrowth, classification, peakMonth }
  })

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  })
}
