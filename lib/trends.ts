import googleTrends from 'google-trends-api'
import { TrendsData, TrendsDataPoint, RelatedQuery } from './types'

const MONTHS = 60   // 5 anni

// ─── Filtro related queries ───────────────────────────────────────────────────

function filterRelatedQuery(query: string): boolean {
  // Escludi nomi propri (prima lettera maiuscola in ogni parola = probabilmente nome)
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(query)) return false

  // Escludi brand noti
  const brandPattern = /\b(amazon|netflix|youtube|spotify|google|apple|facebook|instagram|tiktok|twitter|reddit|pinterest)\b/i
  if (brandPattern.test(query)) return false

  return true
}

// ─── Calcolo YoY ─────────────────────────────────────────────────────────────

function calcYoY(timeline: TrendsDataPoint[]): number {
  if (timeline.length < 24) return 0
  const recent12 = timeline.slice(-12)
  const prev12   = timeline.slice(-24, -12)
  const avgRecent = recent12.reduce((s, p) => s + p.value, 0) / 12
  const avgPrev   = prev12.reduce((s, p)   => s + p.value, 0) / 12
  if (avgPrev === 0) return 0
  return Math.round(((avgRecent - avgPrev) / avgPrev) * 100)
}

// ─── Parser timeline ──────────────────────────────────────────────────────────

function parseTimeline(raw: unknown): TrendsDataPoint[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<{ formattedTime: string; value: number[] }>).map(item => ({
    date:  item.formattedTime?.slice(0, 7) ?? '',
    value: item.value?.[0] ?? 0,
  }))
}

// ─── Parser related queries ───────────────────────────────────────────────────

function parseRelatedQueries(raw: unknown, timelineYoY: number): RelatedQuery[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>

  const items: Array<{ query: string; value: number }> = []

  // Top queries
  const top = (obj.top as Array<{ query: string; value: number }>) ?? []
  for (const q of top) {
    if (filterRelatedQuery(q.query)) {
      items.push({ query: q.query, value: q.value })
    }
  }

  // Rising queries (valore può essere 'Breakout' o numero)
  const rising = (obj.rising as Array<{ query: string; value: number | string }>) ?? []
  for (const q of rising) {
    if (!filterRelatedQuery(q.query)) continue
    const val = typeof q.value === 'number' ? q.value : 100
    if (!items.find(i => i.query === q.query)) {
      items.push({ query: q.query, value: val })
    }
  }

  return items
    .filter(q => {
      const growthYoY = q.value
      // Escludi: interest < 10 E crescita < 50%
      if (q.value < 10 && growthYoY < 50) return false
      return true
    })
    .map(q => {
      const growthYoY = q.value
      const isEmerging = q.value < 10 && growthYoY >= 50
      return {
        query:      q.query,
        value:      q.value,
        growthYoY,
        isEmerging,
      }
    })
    .slice(0, 10)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchTrendsData(keyword: string): Promise<TrendsData> {
  const endTime = new Date()
  const startTime = new Date()
  startTime.setMonth(startTime.getMonth() - MONTHS)

  try {
    const [interestRes, relatedRes] = await Promise.all([
      googleTrends.interestOverTime({
        keyword,
        startTime,
        endTime,
        granularTimeResolution: false,
      }),
      googleTrends.relatedQueries({ keyword, startTime, endTime }),
    ])

    const interestData = JSON.parse(interestRes) as {
      default: { timelineData: unknown }
    }
    const relatedData = JSON.parse(relatedRes) as {
      default: { rankedList: Array<{ rankedKeyword: unknown }> }
    }

    const timeline = parseTimeline(interestData.default.timelineData)
    const yoyGrowth = calcYoY(timeline)

    const relatedRaw = relatedData.default?.rankedList?.[0]?.rankedKeyword ?? []
    const relatedQueries = parseRelatedQueries({ top: relatedRaw, rising: [] }, yoyGrowth)

    return {
      keyword,
      timelineData: timeline,
      relatedQueries,
      yoyGrowth,
      available: true,
    }
  } catch {
    // Fallback: Trends non disponibile
    return {
      keyword,
      timelineData: [],
      relatedQueries: [],
      yoyGrowth: 0,
      available: false,
    }
  }
}
