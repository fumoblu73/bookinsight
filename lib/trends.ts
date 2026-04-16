import { TrendsData, TrendsDataPoint, RelatedQuery } from './types'

const MONTHS = 60  // 5 anni

// ─── SerpApi fetch (riuso stesso pattern di amazon.ts) ───────────────────────

async function serpApiFetch(params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) throw new Error('SERPAPI_KEY non configurata')
  const qs = new URLSearchParams({ ...params, api_key: apiKey }).toString()
  const res = await fetch(`https://serpapi.com/search?${qs}`)
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// ─── Filtro related queries ───────────────────────────────────────────────────

function filterRelatedQuery(query: string): boolean {
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(query)) return false
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

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchTrendsData(keyword: string): Promise<TrendsData> {
  const endDate   = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - MONTHS)

  // SerpApi usa formato "YYYY-MM-DD YYYY-MM-DD"
  const dateRange = `${startDate.toISOString().slice(0, 10)} ${endDate.toISOString().slice(0, 10)}`

  try {
    // Due chiamate in parallelo: timeline + related queries
    const [timelineRaw, relatedRaw] = await Promise.all([
      serpApiFetch({ engine: 'google_trends', q: keyword, date: dateRange, data_type: 'TIMESERIES' }),
      serpApiFetch({ engine: 'google_trends', q: keyword, date: dateRange, data_type: 'RELATED_QUERIES' }),
    ])

    // ── Parse timeline ────────────────────────────────────────────────────────
    const timelineRes = timelineRaw as {
      interest_over_time?: {
        timeline_data?: Array<{
          date?: string
          values?: Array<{ extracted_value?: number }>
        }>
      }
    }

    const timeline: TrendsDataPoint[] = (timelineRes.interest_over_time?.timeline_data ?? [])
      .map(item => ({
        date:  (item.date ?? '').slice(0, 7),   // "Jan 2020" → usato solo per display
        value: item.values?.[0]?.extracted_value ?? 0,
      }))
      .filter(p => p.date !== '')

    const yoyGrowth = calcYoY(timeline)

    // ── Parse related queries ─────────────────────────────────────────────────
    const relatedRes = relatedRaw as {
      related_queries?: {
        top?:    Array<{ query?: string; extracted_value?: number }>
        rising?: Array<{ query?: string; extracted_value?: number }>
      }
    }

    const topItems    = relatedRes.related_queries?.top    ?? []
    const risingItems = relatedRes.related_queries?.rising ?? []

    const seen = new Set<string>()
    const relatedQueries: RelatedQuery[] = []

    for (const item of [...topItems, ...risingItems]) {
      const q = item.query ?? ''
      if (!q || seen.has(q)) continue
      if (!filterRelatedQuery(q)) continue
      seen.add(q)
      const value = item.extracted_value ?? 0
      relatedQueries.push({
        query:      q,
        value,
        growthYoY:  value,
        isEmerging: value < 10,
      })
    }

    return {
      keyword,
      timelineData:   timeline,
      relatedQueries: relatedQueries.slice(0, 10),
      yoyGrowth,
      available: timeline.length > 0,
    }
  } catch {
    return {
      keyword,
      timelineData:   [],
      relatedQueries: [],
      yoyGrowth:      0,
      available:      false,
    }
  }
}
