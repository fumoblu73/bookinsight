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
