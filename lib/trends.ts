import { TrendsData, TrendsDataPoint, RelatedQuery, Market } from './types'
import { cacheGet, cacheSet } from './upstash'

const MONTHS = 60  // 5 anni

const FRESH_TTL_SEC  = 60 * 60 * 24          // 24h: cache "fresh", hit immediato
const STALE_TTL_SEC  = 60 * 60 * 24 * 7      // 7 giorni: cache "stale", solo fallback
const FETCH_TIMEOUT_MS = 25_000              // 25s per singola call SerpApi
const RETRY_DELAY_MS   = 1_500               // 1.5s di delay tra tentativi

// Parole generiche da escludere per ottenere la variante corta della keyword
const GENERIC_WORDS = new Set([
  'for', 'beginners', 'beginner', 'guide', 'book', 'complete', 'easy', 'simple',
  'how', 'to', 'the', 'a', 'an', 'and', 'or', 'with', 'your', 'my',
  'introduction', 'intro', 'basics', 'basic', 'advanced', 'ultimate', 'best',
  'step', 'steps', 'tips', 'tricks', 'secrets', 'made', 'fast', 'quick',
  'starter', 'dummies', 'everyone', 'anyone', 'all', 'top', 'great',
  'over', 'under', 'learn', 'learning', 'master', 'mastering',
])

function shortKeyword(keyword: string): string {
  const words = keyword.toLowerCase().split(/\s+/)
  const core = words.filter(w => !GENERIC_WORDS.has(w))
  if (core.length === 0) return keyword.toLowerCase()
  // Use first 2 core words (most generic useful variant)
  return core.slice(0, 2).join(' ')
}

// ─── Conversione data SerpApi → YYYY-MM ──────────────────────────────────────
// SerpApi restituisce date tipo "Jan 2020" o "2020-01-01 2020-01-31"

const MONTH_TO_NUM: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
}

function toYearMonth(raw: string): string {
  if (!raw) return ''

  // Formato già YYYY-MM o YYYY-MM-DD
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7)

  // Cerca l'anno (4 cifre) ovunque nella stringa
  const yearMatch = raw.match(/(\d{4})/)
  if (!yearMatch) return ''
  const year = yearMatch[1]

  // Cerca il PRIMO nome mese (3 lettere) all'inizio della stringa
  // Gestisce: "May 30 - Jun 5, 2021", "Jan 2021", "Apr 18 - 24, 2026"
  const monthMatch = raw.match(/^([A-Za-z]{3})/)
  if (!monthMatch) return ''
  const mon = MONTH_TO_NUM[monthMatch[1].toLowerCase()]
  if (!mon) return ''

  return `${year}-${mon}`
}

// ─── Parametri geo/lingua per Google Trends per mercato ─────────────────────

const MARKET_TRENDS_PARAMS: Record<Market, { geo: string; hl: string }> = {
  US: { geo: 'US', hl: 'en' },
  UK: { geo: 'GB', hl: 'en' },
  DE: { geo: 'DE', hl: 'de' },
  FR: { geo: 'FR', hl: 'fr' },
  IT: { geo: 'IT', hl: 'it' },
  ES: { geo: 'ES', hl: 'es' },
}

// ─── SerpApi fetch (riuso stesso pattern di amazon.ts) ───────────────────────

async function serpApiFetchOnce(qs: string): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://serpapi.com/search?${qs}`, { signal: controller.signal })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200)
      throw new Error(`SerpApi ${res.status}: ${body}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

async function serpApiFetch(params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) throw new Error('SERPAPI_KEY non configurata')
  // SerpApi google_trends rifiuta '+' come spazio (URLSearchParams default); encodeURIComponent usa '%20' (RFC 3986)
  const qs = Object.entries({ ...params, api_key: apiKey })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  // Tentativo 1
  try {
    return await serpApiFetchOnce(qs)
  } catch (err1) {
    const msg1 = err1 instanceof Error ? err1.message : String(err1)
    // Retry solo su errori "ritentabili": timeout/abort, 5xx, network failure, rate limit
    const isRetryable =
      msg1.includes('aborted') ||
      msg1.includes('SerpApi 5') ||
      msg1.includes('SerpApi 429') ||
      msg1.includes('fetch failed') ||
      msg1.includes('ECONNRESET') ||
      msg1.includes('ETIMEDOUT')
    if (!isRetryable) throw err1

    console.warn(`[trends] serpApi retry after error: ${msg1.slice(0, 120)}`)
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))

    // Tentativo 2 (final)
    return await serpApiFetchOnce(qs)
  }
}

// ─── Filtro related queries ───────────────────────────────────────────────────

function filterRelatedQuery(query: string): boolean {
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(query)) return false
  const brandPattern = /\b(amazon|netflix|youtube|spotify|google|apple|facebook|instagram|tiktok|twitter|reddit|pinterest)\b/i
  if (brandPattern.test(query)) return false
  return true
}

// ─── Calcolo mese di picco stagionale ────────────────────────────────────────

const MONTH_NAMES_IT = [
  'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre',
]

function calcPeakMonth(timeline: TrendsDataPoint[]): string | null {
  if (!timeline.length) return null
  const byMonth: Record<string, number[]> = {}
  for (const dp of timeline) {
    const month = dp.date?.slice(5, 7)  // "YYYY-MM" → "MM"
    if (!month) continue
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(dp.value)
  }
  let bestMonth = '', bestAvg = -1
  for (const [m, vals] of Object.entries(byMonth)) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    if (avg > bestAvg) { bestAvg = avg; bestMonth = m }
  }
  if (!bestMonth) return null
  const idx = parseInt(bestMonth, 10) - 1
  return MONTH_NAMES_IT[idx] ?? null
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

export async function fetchTrendsData(keyword: string, market: Market = 'US'): Promise<TrendsData> {
  const endDate   = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - MONTHS)

  // SerpApi usa formato "YYYY-MM-DD YYYY-MM-DD"
  const dateRange = `${startDate.toISOString().slice(0, 10)} ${endDate.toISOString().slice(0, 10)}`

  const trendsQuery = shortKeyword(keyword)
  const { geo, hl } = MARKET_TRENDS_PARAMS[market]

  // ── Cache lookup: fresh hit → ritorna subito ──────────────────────────────
  const cacheKey = `trends:${market}:${trendsQuery}`
  const cached = await cacheGet<TrendsData>(cacheKey)
  if (cached && cached.available) {
    return cached
  }

  try {
    // Due chiamate in parallelo: timeline + related queries
    const [timelineSettled, relatedSettled] = await Promise.allSettled([
      serpApiFetch({ engine: 'google_trends', q: trendsQuery, date: dateRange, data_type: 'TIMESERIES', geo, hl }),
      serpApiFetch({ engine: 'google_trends', q: trendsQuery, date: dateRange, data_type: 'RELATED_QUERIES', geo, hl }),
    ])

    const timelineRaw = timelineSettled.status === 'fulfilled' ? timelineSettled.value : null
    const relatedRaw  = relatedSettled.status  === 'fulfilled' ? relatedSettled.value  : null

    // ── Parse timeline ────────────────────────────────────────────────────────
    const timelineRes = timelineRaw as {
      interest_over_time?: {
        timeline_data?: Array<{
          date?: string
          values?: Array<{ extracted_value?: number }>
        }>
      }
    } | null

    const timeline: TrendsDataPoint[] = (timelineRes?.interest_over_time?.timeline_data ?? [])
      .map(item => ({
        date:  toYearMonth(item.date ?? ''),
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
    } | null

    const topItems    = relatedRes?.related_queries?.top    ?? []
    const risingItems = relatedRes?.related_queries?.rising ?? []

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

    const result: TrendsData = {
      keyword,
      timelineData:   timeline,
      relatedQueries: relatedQueries.slice(0, 10),
      yoyGrowth,
      available:  timeline.length > 0,
      peakMonth:  calcPeakMonth(timeline),
    }

    // ── Salva in cache fresh (TTL 24h) ─────────────────────────────────────
    if (result.available) {
      await cacheSet(cacheKey, result, FRESH_TTL_SEC)
      // Mantieni una copia "stale" più duratura come fallback per il prossimo 504
      await cacheSet(`${cacheKey}:stale`, result, STALE_TTL_SEC)
    }

    return result
  } catch (err) {
    console.error(`[trends] fetchTrendsData failed for "${trendsQuery}" (original: "${keyword}"):`, err)

    // ── Fallback: prova la cache "stale" ─────────────────────────────────────
    const stale = await cacheGet<TrendsData>(`${cacheKey}:stale`)
    if (stale && stale.available) {
      console.warn(`[trends] using stale cache fallback for "${trendsQuery}"`)
      return { ...stale, staleData: true }
    }

    // ── Nessuna cache: ritorna vuoto come prima ───────────────────────────────
    return {
      keyword,
      timelineData:   [],
      relatedQueries: [],
      yoyGrowth:      0,
      available:      false,
      peakMonth:      null,
    }
  }
}
