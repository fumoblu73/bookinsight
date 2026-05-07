import Anthropic from '@anthropic-ai/sdk'

// ─── Costanti modelli ─────────────────────────────────────────────────────────

const MODEL_SONNET = 'claude-sonnet-4-6'   // analisi strategica
const MODEL_HAIKU  = 'claude-haiku-4-5'    // estrazione meccanica

// ─── Client (singleton) ──────────────────────────────────────────────────────

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurata')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// ─── Sistema condiviso (cacheable) ───────────────────────────────────────────

const SYSTEM_SONNET = `Sei un esperto analista di mercato KDP (Kindle Direct Publishing) con 10 anni di esperienza. Analizzi nicchie Amazon per identificare opportunità editoriali. Rispondi sempre in italiano. Produci output in formato JSON valido come richiesto, senza testo aggiuntivo prima o dopo il JSON.`

const SYSTEM_HAIKU = `Sei un assistente di estrazione dati per analisi KDP. Il tuo compito è leggere testi e strutturare informazioni in JSON valido. Rispondi sempre con JSON puro, senza testo aggiuntivo.`

// ─── Riconoscimento errori billing Anthropic ─────────────────────────────────

export function isAnthropicBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('billing') ||
    msg.includes('credit') ||
    msg.includes('402') ||
    msg.includes('payment') ||
    msg.includes('overloaded') && msg.includes('quota')
  )
}

// ─── Retry con backoff esponenziale per errori transitori ────────────────────

const RETRYABLE_STATUSES = new Set([429, 500, 503, 529])
const MAX_RETRIES = 3

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const status = (err as { status?: number }).status
      if (!RETRYABLE_STATUSES.has(status ?? 0)) throw err
      if (attempt === MAX_RETRIES) {
        throw new Error(
          status === 529
            ? 'Il servizio AI è momentaneamente sovraccarico. Riprova tra qualche secondo.'
            : `Errore API AI (${status}) dopo ${MAX_RETRIES} tentativi.`
        )
      }
      const delayMs = Math.pow(2, attempt + 1) * 1000  // 2s, 4s, 8s
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

// ─── Helper: parse JSON robusto ───────────────────────────────────────────────

function parseJSON<T>(raw: string): T {
  // Rimuove eventuali backtick/markdown che il modello potrebbe aggiungere
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  // NFC: converte caratteri Unicode decomposti in forme composte corrette
  // es. "a\u0300" (a + combining grave) → "à", prevenendo mojibake nell'output AI
  const normalized = cleaned.normalize('NFC')
  return JSON.parse(normalized) as T
}

// ─── callSonnet ───────────────────────────────────────────────────────────────

export async function callSonnet<T>(userPrompt: string): Promise<T> {
  const client = getClient()

  const response = await callWithRetry(() => client.messages.create({
    model: MODEL_SONNET,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_SONNET,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: userPrompt },
    ],
  }))

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('Sonnet: risposta vuota o formato inatteso')
  }

  return parseJSON<T>(block.text)
}

// ─── callHaiku ────────────────────────────────────────────────────────────────

export async function callHaiku<T>(userPrompt: string): Promise<T> {
  const client = getClient()

  const response = await callWithRetry(() => client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 3072,
    system: [
      {
        type: 'text',
        text: SYSTEM_HAIKU,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: userPrompt },
    ],
  }))

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('Haiku: risposta vuota o formato inatteso')
  }

  return parseJSON<T>(block.text)
}

// ─── Funzioni specifiche per ogni sezione ─────────────────────────────────────

import {
  promptPasso0,
  promptPainPointsReddit,
  promptKeyInsights,
  promptTrendForecast,
  promptGapAnalysis,
  promptSeriesStrategy,
  promptRoiNarrative,
} from './prompts'

import {
  AmazonData,
  TrendsData,
  RedditData,
  YouTubeData,
  PainPoint,
  Market,
} from './types'

import {
  ProfitabilityBreakdown,
  RoiEstimate,
  TrendSignal,
  filterPainPoints,
} from './scoring'

// §3 — Competitor target: angolo, target reader, USP
export interface Passo0Result {
  angolo: string
  target_reader: string
  usp: string
  punti_forza: string[]
  punti_debolezza: string[]
  confidence: 'ALTA' | 'MEDIA' | 'BASSA'
}

export async function runPasso0(amazon: AmazonData): Promise<Passo0Result> {
  return callSonnet<Passo0Result>(promptPasso0(amazon))
}

// §5A — Pain Points da Reddit (Haiku)
interface RawPainPoint {
  pain_point: string
  F: number
  I: number
  S: number
  evidence: string
  fonte: 'reddit'
  tipo?: 'gap_esecuzione' | 'job_confermato'
  linguaggio?: string | null
}

export async function runPainPointsReddit(
  keyword: string,
  reddit: RedditData,
  youtube?: YouTubeData,
  market?: Market,
): Promise<PainPoint[]> {
  if ((!reddit.available || reddit.insufficientCorpus) && (!youtube?.available || youtube.insufficientCorpus)) return []

  const raw = await callHaiku<RawPainPoint[]>(
    promptPainPointsReddit(keyword, reddit, youtube, market)
  )

  // Normalizza i campi opzionali e calcola score
  const normalized = raw.map(r => ({
    pain_point: r.pain_point,
    F: Math.min(10, Math.max(1, Math.round(r.F))),
    I: Math.min(10, Math.max(1, Math.round(r.I))),
    S: Math.min(10, Math.max(1, Math.round(r.S))),
    evidence: r.evidence,
    fonte: 'reddit' as const,
    tipo: r.tipo,
    linguaggio: r.linguaggio ?? undefined,
  }))

  return filterPainPoints(normalized)
}

// §1 — Key Insights (Sonnet)
export interface KeyInsight {
  insight: string
  tipo: 'opportunita' | 'rischio' | 'mercato' | 'competitor' | 'trend' | 'suggerimento'
}

export async function runKeyInsights(
  amazon: AmazonData,
  trends: TrendsData,
  reddit: RedditData,
  scoring: ProfitabilityBreakdown,
  painPoints: PainPoint[],
): Promise<KeyInsight[]> {
  return callSonnet<KeyInsight[]>(
    promptKeyInsights(amazon, trends, reddit, scoring, painPoints)
  )
}

// §4B — Trend Forecast (Sonnet)
export interface TrendForecastResult {
  classificazione: TrendSignal
  narrativa: string
  stagionalita: string | null
  query_emergenti: string[]
}

export async function runTrendForecast(
  keyword: string,
  trends: TrendsData,
  trendSignal: TrendSignal,
): Promise<TrendForecastResult | null> {
  if (!trends.available) return null
  return callSonnet<TrendForecastResult>(
    promptTrendForecast(keyword, trends, trendSignal)
  )
}

// §5 — Gap Analysis (Sonnet)
export interface GapAnalysisResult {
  passo1_problemi_non_risolti: { descrizione: string; items: string[] }
  passo2_angoli_mancanti: { descrizione: string; items: string[] }
  passo3_formato_gap: { descrizione: string; items: string[] }
  passo4_target_non_servito: { descrizione: string; segmento: string; dimensione: string }
  passo5_tesi_libro: {
    titolo_proposto: string
    sottotitolo: string
    hook: string
    differenziatori: string[]
  }
  gap_inventory_table: Array<{
    gap: string
    tipo: 'contenuto' | 'formato' | 'target' | 'angolo'
    priorita: 'ALTA' | 'MEDIA' | 'BASSA'
    opportunita: string
  }>
}

export async function runGapAnalysis(
  amazon: AmazonData,
  painPoints: PainPoint[],
  reddit: RedditData,
  userNotes?: string,
  youtube?: YouTubeData,
): Promise<GapAnalysisResult> {
  return callSonnet<GapAnalysisResult>(
    promptGapAnalysis(amazon, painPoints, reddit, userNotes, youtube)
  )
}

// §6 — Series Strategy (Sonnet)
export interface SeriesStrategyResult {
  verdetto: 'INVEST' | 'PARTIAL' | 'PASS'
  motivazione_verdetto: string
  libro_1: { titolo: string; focus: string; pagine_target: number; tempo_scrittura_settimane: number }
  libro_2: { titolo: string; focus: string; timing: string }
  libro_3: { titolo: string; focus: string; condizione: string }
  strategia_lancio: string
  rischi_principali: string[]
}

export async function runSeriesStrategy(
  amazon: AmazonData,
  gapTesi: GapAnalysisResult['passo5_tesi_libro'],
  scoring: ProfitabilityBreakdown,
  roi: RoiEstimate,
): Promise<SeriesStrategyResult> {
  return callSonnet<SeriesStrategyResult>(
    promptSeriesStrategy(amazon, gapTesi, scoring, roi)
  )
}

// §7 — ROI Narrativa (Haiku)
export interface RoiNarrativeResult {
  blocco_scenario: string
  blocco_budget: string
  blocco_timeline: string
  blocco_verdetto: string
}

export async function runRoiNarrative(
  keyword: string,
  market: string,
  roi: RoiEstimate,
  scoring: ProfitabilityBreakdown,
  budget: number,
): Promise<RoiNarrativeResult> {
  return callHaiku<RoiNarrativeResult>(
    promptRoiNarrative(keyword, market, roi, scoring, budget)
  )
}
