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

const SYSTEM_SONNET_TEXT = `Sei un esperto analista di mercato KDP (Kindle Direct Publishing) con 10 anni di esperienza. Analizzi nicchie Amazon per identificare opportunità editoriali. Rispondi sempre in italiano con testo in prosa naturale, diretta e consulenziale.`

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

// ─── callSonnetText ───────────────────────────────────────────────────────────

async function callSonnetText(userPrompt: string): Promise<string> {
  const client = getClient()

  const response = await callWithRetry(() => client.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_SONNET_TEXT,
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

  return block.text.trim()
}

// ─── callHaiku ────────────────────────────────────────────────────────────────

export async function callHaiku<T>(userPrompt: string, options?: { temperature?: number }): Promise<T> {
  const client = getClient()

  const response = await callWithRetry(() => client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 3072,
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
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
  promptTargetWeaknesses,
  promptTargetInterpretation,
} from './prompts'

import {
  AmazonData,
  TrendsData,
  RedditData,
  YouTubeData,
  PainPoint,
  AmazonReview,
  Market,
  SubNiche,
  TargetWeakness,
  TargetInterpretationSummary,
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

// §5A — Pain Points da Reddit (Sonnet)
interface RawPainPoint {
  pain_point: string
  F: number
  I: number
  S: number
  num_fonti?: number
  evidence: string
  fonte: 'reddit'
  tipo?: 'gap_esecuzione' | 'job_confermato'
  linguaggio?: string | null
  evidence_quotes?: string[]
  voice_phrases?: string[]
  emotional_register?: string
  context?: string
}

export async function runPainPointsReddit(
  keyword: string,
  reddit: RedditData,
  youtube?: YouTubeData,
  market?: Market,
): Promise<PainPoint[]> {
  if ((!reddit.available || reddit.insufficientCorpus) && (!youtube?.available || youtube.insufficientCorpus)) return []

  const raw = await callSonnet<RawPainPoint[]>(
    promptPainPointsReddit(keyword, reddit, youtube, market),
  )

  const validRegisters = ['frustrazione', 'rabbia', 'ansia', 'rassegnazione', 'desiderio', 'confusione', 'orgoglio', 'neutro']

  // Normalizza i campi opzionali e calcola score
  const normalized = raw.map(r => {
    const F_raw = Math.min(10, Math.max(1, Math.round(r.F)))
    // Hard cap: se fonte singola, F non può superare 4
    const F = (r.num_fonti ?? 1) <= 1 ? Math.min(F_raw, 4) : F_raw

    const cleanVoicePhrases = (r.voice_phrases ?? [])
      .filter(p => typeof p === 'string' && p.trim().length >= 2 && p.trim().length <= 100)
      .map(p => p.trim())
      .filter((p, i, arr) => arr.indexOf(p) === i)
      .slice(0, 5)

    const cleanEvidenceQuotes = (r.evidence_quotes ?? [])
      .filter(q => typeof q === 'string' && q.trim().length >= 10 && q.trim().length <= 200)
      .map(q => q.trim())
      .slice(0, 4)

    const emotional_register = (r.emotional_register && validRegisters.includes(r.emotional_register))
      ? r.emotional_register as PainPoint['emotional_register']
      : undefined

    return {
      pain_point: r.pain_point,
      F,
      I: Math.min(10, Math.max(1, Math.round(r.I))),
      S: Math.min(10, Math.max(1, Math.round(r.S))),
      evidence: r.evidence,
      fonte: 'reddit' as const,
      tipo: r.tipo,
      linguaggio: r.linguaggio ?? undefined,
      evidence_quotes: cleanEvidenceQuotes.length > 0 ? cleanEvidenceQuotes : undefined,
      voice_phrases: cleanVoicePhrases.length > 0 ? cleanVoicePhrases : undefined,
      emotional_register,
      context: r.context?.trim() || undefined,
    }
  })

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
  overrideSubNiches?: SubNiche[],
): Promise<KeyInsight[]> {
  return callSonnet<KeyInsight[]>(
    promptKeyInsights(amazon, trends, reddit, scoring, painPoints, overrideSubNiches)
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

// §2 — Sub-niche detection semantica (Haiku) ─────────────────────────────────

export type SubNicheAI = { keyword: string; asin: string }

export async function runSubNicheDetection(
  rawBooks: Array<{ asin: string; title: string; subtitle?: string; bsr: number; reviewCount: number; price: number; pages?: number; rating: number }>,
  mainKeyword: string,
  market: Market,
): Promise<SubNicheAI[]> {
  const bookList = rawBooks
    .filter(b => b.bsr > 0)
    .slice(0, 15)
    .map(b => {
      const sub   = b.subtitle ? ` — ${b.subtitle}` : ''
      const price = b.price > 0 ? ` | $${b.price.toFixed(2)}` : ''
      const pages = b.pages    ? ` | ${b.pages} pag` : ''
      return `${b.asin} | BSR ${b.bsr.toLocaleString()} | ${b.reviewCount} rec | ${b.rating.toFixed(1)} ★${price}${pages} | ${b.title}${sub}`
    })
    .join('\n')

  const prompt = `Stai analizzando i libri più venduti su Amazon per la keyword principale: "${mainKeyword}" (mercato ${market}).

Libri nella SERP (ASIN | BSR | Recensioni | Rating | Prezzo | Pagine | Titolo — Sottotitolo):
${bookList}

Identifica 3-5 sub-nicchie semantiche DISTINTE — varianti tematiche, angoli specifici o target reader specifici che emergono da questi titoli e sottotitoli, ma che sono DIVERSI dalla keyword principale.

Usa tutti i dati disponibili per identificare le sub-nicchie:
- Titolo e sottotitolo rivelano il tema esplicito.
- Prezzo e pagine distinguono tra varianti dello stesso tema (es. manuale corposo per esperti vs guida snella per principianti possono essere sub-nicchie diverse pur con titoli simili).
- Rating medio segnala sub-nicchie "ben servite" (rating alti, lettori soddisfatti) vs "mal servite" (rating bassi, opportunità).
- Numero di recensioni indica l'affollamento della sub-nicchia: libri con poche recensioni in una sub-nicchia sono segnale che quella variante può essere ancora aggredibile.

Priorizza sub-nicchie con almeno un libro a basso numero di recensioni (< 100) — sono quelle dove un nuovo entrante può posizionarsi più facilmente.

Regole:
- Ogni sub-nicchia: keyword di 2-4 parole, concreta e ricercabile su Amazon
- NON usare "${mainKeyword}" o varianti dirette (es. se mainKeyword è "stoicism", non usare "stoic guide")
- Usa la stessa lingua dei titoli (mercato ${market})
- Scegli angoli semanticamente rilevanti e distinti tra loro
- Per ogni sub-nicchia indica l'ASIN del libro più rappresentativo tra quelli elencati

Output JSON puro senza markdown:
[{"keyword": "...", "asin": "..."}]`

  try {
    return await callHaiku<SubNicheAI[]>(prompt)
  } catch {
    return []
  }
}

// Milestone 5 — Target Weaknesses (Haiku)
export async function runTargetWeaknesses(
  bookTitle: string,
  reviews: AmazonReview[],
): Promise<TargetWeakness[]> {
  if (reviews.length < 3) return []
  try {
    return await callHaiku<TargetWeakness[]>(
      promptTargetWeaknesses(bookTitle, reviews),
      { temperature: 0.2 },
    )
  } catch {
    return []
  }
}

// Target Interpretation (Sonnet — prosa libera)
export async function runTargetInterpretation(
  keyword: string,
  market: string,
  summary: TargetInterpretationSummary,
): Promise<string> {
  return callSonnetText(promptTargetInterpretation(keyword, market, summary))
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
): Promise<RoiNarrativeResult> {
  return callHaiku<RoiNarrativeResult>(
    promptRoiNarrative(keyword, market, roi, scoring)
  )
}
