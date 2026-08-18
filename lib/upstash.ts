import { Redis } from '@upstash/redis'
import { ReportRecord, ReportStatus, Market } from './types'

// ─── Client ───────────────────────────────────────────────────────────────────

let _redis: Redis | null = null

function getRedis(): Redis {
  if (!_redis) {
    const url   = process.env.KV_REST_API_URL
    const token = process.env.KV_REST_API_TOKEN
    if (!url || !token) throw new Error('Upstash: KV_REST_API_URL o KV_REST_API_TOKEN mancanti')
    _redis = new Redis({ url, token })
  }
  return _redis
}

// ─── Cache generica ──────────────────────────────────────────────────────────
// cacheGet / cacheSet / cacheDel sono OPPORTUNISTICI: un guasto di Redis non
// deve rompere le route che li usano come cache (trends, target). Loggano però
// sempre, perché un guasto silenzioso è indistinguibile da un cache miss.
// Per i dati OBBLIGATORI (snapshot analysis:*) usare le varianti Strict, che
// propagano l'errore invece di mascherarlo da "chiave assente".

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return await cacheGetStrict<T>(key)
  } catch (err) {
    console.warn(`[upstash] cacheGet fallita su "${key}":`, err instanceof Error ? err.message : err)
    return null
  }
}

/** Come cacheGet, ma lancia se Redis non risponde. null = chiave realmente assente. */
export async function cacheGetStrict<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  const raw = await redis.get<string>(key)
  if (!raw) return null
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
}

/** Ritorna true se la scrittura è andata a buon fine. Non lancia mai. */
export async function cacheSet(key: string, value: unknown, exSeconds: number): Promise<boolean> {
  try {
    const redis = getRedis()
    await redis.set(key, JSON.stringify(value), { ex: exSeconds })
    return true
  } catch (err) {
    console.warn(`[upstash] cacheSet fallita su "${key}":`, err instanceof Error ? err.message : err)
    return false
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(key)
  } catch (err) {
    console.warn(`[upstash] cacheDel fallita su "${key}":`, err instanceof Error ? err.message : err)
  }
}

/** Verifica che Redis risponda in lettura e scrittura. Non lancia mai. */
export async function redisHealthy(): Promise<boolean> {
  try {
    const redis = getRedis()
    const probe = `health:${Date.now()}`
    await redis.set(probe, '1', { ex: 30 })
    await redis.del(probe)
    return true
  } catch (err) {
    console.warn('[upstash] health check fallito:', err instanceof Error ? err.message : err)
    return false
  }
}

// ─── Chiavi Redis ─────────────────────────────────────────────────────────────
// report:{id}         → JSON del ReportRecord completo
// reports:index       → ZSET scored by createdAt (timestamp ms) → id

const KEY_INDEX = 'reports:index'
const KEY_REPORT = (id: string) => `report:${id}`

// ─── ID generazione ──────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── Salva report ─────────────────────────────────────────────────────────────

export async function saveReport(params: {
  keyword: string
  market: Market
  status: ReportStatus
  profitabilityScore?: number
  estimatedDailyRevenue?: number
  competitionLevel?: string
  data?: unknown
}): Promise<string> {
  const redis = getRedis()
  const id = generateId()
  const now = new Date().toISOString()

  const record: ReportRecord = {
    id,
    keyword: params.keyword,
    market: params.market,
    createdAt: now,
    status: params.status,
    profitabilityScore: params.profitabilityScore,
    estimatedDailyRevenue: params.estimatedDailyRevenue,
    competitionLevel: params.competitionLevel,
    data: params.data,
  }

  const pipeline = redis.pipeline()
  pipeline.set(KEY_REPORT(id), JSON.stringify(record), { ex: 60 * 60 * 24 * 90 }) // 90 giorni
  pipeline.zadd(KEY_INDEX, { score: Date.now(), member: id })
  await pipeline.exec()

  // Mantieni max 50 report: rimuove i più vecchi
  await redis.zremrangebyrank(KEY_INDEX, 0, -51)

  return id
}

// ─── Aggiorna report esistente ────────────────────────────────────────────────

export async function updateReport(id: string, patch: Partial<Omit<ReportRecord, 'id' | 'createdAt'>>): Promise<void> {
  const redis = getRedis()
  const existing = await getReport(id)
  if (!existing) throw new Error(`Report ${id} non trovato`)

  const updated: ReportRecord = { ...existing, ...patch }
  await redis.set(KEY_REPORT(id), JSON.stringify(updated), { ex: 60 * 60 * 24 * 90 })
}

// ─── Recupera report singolo ──────────────────────────────────────────────────

export async function getReport(id: string): Promise<ReportRecord | null> {
  const redis = getRedis()
  const raw = await redis.get<string>(KEY_REPORT(id))
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) as ReportRecord : raw as ReportRecord
}

// ─── Lista report (più recenti prima) ────────────────────────────────────────

export async function listReports(limit = 20): Promise<ReportRecord[]> {
  const redis = getRedis()

  // ZREVRANGE: dal più recente al più vecchio
  const ids = await redis.zrange(KEY_INDEX, 0, limit - 1, { rev: true })
  if (!ids || ids.length === 0) return []

  const records = await Promise.all(
    ids.map(id => getReport(String(id)))
  )

  return records
    .filter((r): r is ReportRecord => r !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// ─── Elimina report ───────────────────────────────────────────────────────────

export async function deleteReport(id: string): Promise<void> {
  const redis = getRedis()
  const pipeline = redis.pipeline()
  pipeline.del(KEY_REPORT(id))
  pipeline.zrem(KEY_INDEX, id)
  await pipeline.exec()
}
