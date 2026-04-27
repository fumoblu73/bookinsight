'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import ReportView from '@/components/ReportView'
import type { FullReport } from '@/components/ReportView'
import type { AmazonData, FilteredBook, Market, YouTubeData, CreditsData } from '@/lib/types'

// Ogni stage corrisponde a un evento reale emesso dal server o a una fetch completata
type Stage =
  | 'idle'
  | 'loading_amazon'        // fetch /api/amazon in corso
  | 'awaiting_validation'   // Amazon done, utente sceglie competitor target
  | 'loading_signals'       // attesa trends+reddit (già avviati in background)
  | 'loading_passo0'        // server: passo0 + pain points (stream event: passo0)
  | 'loading_insights'      // server: insights + trend + gap (stream event: insights)
  | 'loading_strategy'      // server: strategy + ROI (stream event: strategy)
  | 'done'
  | 'error'

const STAGE_LABELS: Record<Stage, string> = {
  idle:                 '',
  loading_amazon:       'Raccolta dati Amazon…',
  awaiting_validation:  'Scegli il competitor target',
  loading_signals:      'Raccolta segnali (trend + Reddit)…',
  loading_passo0:       'Analisi competitor e pain points…',
  loading_insights:     'Analisi insight, trend e gap…',
  loading_strategy:     'Strategia di serie e ROI…',
  done:                 'Report completato',
  error:                'Errore',
}

const SERVER_STAGE_MAP: Record<string, Stage> = {
  passo0:   'loading_passo0',
  insights: 'loading_insights',
  strategy: 'loading_strategy',
}

const MARKETS: { value: Market; label: string }[] = [
  { value: 'US', label: 'US' },
  { value: 'UK', label: 'UK' },
  { value: 'DE', label: 'DE' },
  { value: 'FR', label: 'FR' },
  { value: 'IT', label: 'IT' },
  { value: 'ES', label: 'ES' },
]

async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`${url}: ${msg}`)
  }
  return res.json()
}

export default function HomePage() {
  const [keyword, setKeyword] = useState('')
  const [market, setMarket]   = useState<Market>('US')
  const [cpc, setCpc]         = useState('')
  const [stage, setStage]     = useState<Stage>('idle')
  const [report, setReport]   = useState<FullReport | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  // Credits state
  const [credits, setCredits] = useState<CreditsData | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(true)

  // User notes (Sessione 4)
  const [userNotes, setUserNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [showCpc, setShowCpc] = useState(false)

  // Fetch credits on mount
  useEffect(() => {
    fetch('/api/credits')
      .then(r => r.ok ? r.json() as Promise<CreditsData> : Promise.reject())
      .then(data => setCredits(data))
      .catch(() => setCredits(null))
      .finally(() => setCreditsLoading(false))
  }, [])

  // Validation phase state
  const [amazonDataState, setAmazonDataState] = useState<AmazonData | null>(null)
  const [selectedTargetAsin, setSelectedTargetAsin] = useState<string>('')
  const [customAsinInput, setCustomAsinInput]   = useState('')
  const [customAsinProduct, setCustomAsinProduct] = useState<FilteredBook | null>(null)
  const [customAsinError, setCustomAsinError]   = useState<string | null>(null)
  const [customAsinLoading, setCustomAsinLoading] = useState(false)

  // Background signals promise (started during phase 1, awaited in phase 2)
  const signalsRef = useRef<Promise<[unknown, unknown, unknown]> | null>(null)
  const kwRef      = useRef<string>('')
  const cpcRef     = useRef<number | undefined>(undefined)

  // ── Phase 1: fetch Amazon, start signals in background ───────────────────────
  const handlePhase1 = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyword.trim()) return

    const kw       = keyword.trim()
    const cpcValue = cpc.trim() ? parseFloat(cpc.trim().replace(',', '.')) : undefined

    setReport(null)
    setReportId(null)
    setError(null)
    setAmazonDataState(null)
    setSelectedTargetAsin('')
    setCustomAsinInput('')
    setCustomAsinProduct(null)
    setCustomAsinError(null)
    setStage('loading_amazon')

    try {
      const amazon = await postJSON('/api/amazon', { keyword: kw, market }) as AmazonData

      kwRef.current  = kw
      cpcRef.current = cpcValue

      // Fire-and-forget signals fetch — runs during validation pause
      signalsRef.current = Promise.all([
        fetch('/api/trends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw, market }),
        }).then(r => r.ok ? r.json() : { available: false, yoyGrowth: 0, relatedQueries: [], timelineData: [], keyword: kw }),
        fetch('/api/reddit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw }),
        }).then(r => r.ok ? r.json() : { posts: [], totalComments: 0, subredditsUsed: [], threadCount: 0, available: false, insufficientCorpus: true, keyword: kw }),
        fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw }),
        }).then(r => r.ok ? r.json() : { videos: [], totalComments: 0, available: false, insufficientCorpus: true, keyword: kw }),
      ]) as Promise<[unknown, unknown, unknown]>

      setAmazonDataState(amazon)
      setSelectedTargetAsin(amazon.competitorTarget.asin)
      setStage('awaiting_validation')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }, [keyword, market, cpc])

  // ── Fetch custom ASIN ─────────────────────────────────────────────────────────
  const handleFetchCustomAsin = useCallback(async () => {
    const asin = customAsinInput.trim().toUpperCase()
    if (asin.length !== 10) {
      setCustomAsinError('ASIN deve essere di 10 caratteri')
      return
    }
    setCustomAsinLoading(true)
    setCustomAsinError(null)
    setCustomAsinProduct(null)
    try {
      const res = await fetch('/api/amazon/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin, market }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Prodotto non trovato')
      const product = json as FilteredBook
      setCustomAsinProduct(product)
      setSelectedTargetAsin(asin)
    } catch (err) {
      setCustomAsinError(err instanceof Error ? err.message : 'Errore nel recupero del prodotto')
    } finally {
      setCustomAsinLoading(false)
    }
  }, [customAsinInput, market])

  // ── Phase 2: await signals, run AI pipeline ───────────────────────────────────
  const handlePhase2 = useCallback(async () => {
    if (!amazonDataState || !signalsRef.current) return

    const kw       = kwRef.current
    const cpcValue = cpcRef.current

    // Apply selected competitor target
    let finalAmazonData: AmazonData = { ...amazonDataState }
    if (selectedTargetAsin !== amazonDataState.competitorTarget.asin) {
      const newTarget =
        customAsinProduct?.asin === selectedTargetAsin
          ? customAsinProduct
          : amazonDataState.topBooks.find(b => b.asin === selectedTargetAsin)
      if (newTarget) finalAmazonData = { ...finalAmazonData, competitorTarget: newTarget }
    }

    setStage('loading_signals')

    try {
      const [trendsData, redditData, youtubeData] = await signalsRef.current

      setStage('loading_passo0')

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, market, amazonData: finalAmazonData, trendsData, redditData, youtubeData, cpc: cpcValue, userNotes: userNotes.trim() || undefined }),
      })
      if (!res.ok) throw new Error(`Analisi AI: ${await res.text()}`)
      if (!res.body) throw new Error('Stream non supportato dal browser')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as { type: string; stage?: string; report?: FullReport; message?: string }

          if (event.type === 'progress' && event.stage) {
            const next = SERVER_STAGE_MAP[event.stage]
            if (next) setStage(next)
          } else if (event.type === 'done' && event.report) {
            setReport(event.report)
            setReportId((event.report as { id?: string }).id ?? null)
            setStage('done')
          } else if (event.type === 'error') {
            throw new Error(event.message ?? 'Errore sconosciuto dal server')
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }, [amazonDataState, selectedTargetAsin, customAsinProduct, market, userNotes])

  const isLoading = !['idle', 'awaiting_validation', 'done', 'error'].includes(stage)
  const creditsBlocked = credits !== null && credits.available && credits.analysesMain < 1

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white">
      <header className="bg-white border-b border-zinc-200 no-print">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">
              BookInsight
              <span className="ml-2 text-sm font-normal text-zinc-400">v6.7</span>
            </h1>
            <p className="text-xs text-zinc-500">Analisi nicchie Amazon KDP con AI</p>
          </div>
          <a href="/history" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            Storico report
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="no-print">
          {/* ── Credits banner ────────────────────────────────────────────── */}
          {!creditsLoading && credits?.available && (
            <div className={`mb-4 rounded-xl border px-5 py-3 no-print ${
              credits.analysesMain === 0
                ? 'bg-red-50 border-red-200'
                : credits.analysesMain <= 3
                ? 'bg-amber-50 border-amber-200'
                : 'bg-zinc-50 border-zinc-200'
            }`}>
              <div className="flex items-center justify-between gap-4">
                {/* Left: label + big number */}
                <div className="flex items-baseline gap-2">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${
                    credits.analysesMain === 0 ? 'text-red-400' :
                    credits.analysesMain <= 3  ? 'text-amber-500' : 'text-zinc-400'
                  }`}>Analisi disponibili</span>
                  <span className={`text-2xl font-black tabular-nums leading-none ${
                    credits.analysesMain === 0 ? 'text-red-600' :
                    credits.analysesMain <= 3  ? 'text-amber-600' : 'text-zinc-800'
                  }`}>{credits.analysesMain}</span>
                  {credits.analysesMain === 0 && (
                    <span className="text-xs font-medium text-red-500 ml-1">
                      {credits.analysesAvailable === 0 ? '— SerpApi esaurito' : '— Apify insufficiente'}
                    </span>
                  )}
                  {credits.analysesMain > 0 && credits.analysesMain <= 3 && (
                    <span className="text-xs text-amber-500 ml-1">ultime rimaste</span>
                  )}
                </div>
                {/* Right: SerpApi + Apify detail */}
                <div className="text-right text-xs text-zinc-400 space-y-0.5 shrink-0">
                  <div>SerpApi <span className="font-medium text-zinc-600">{credits.analysesAvailable}</span></div>
                  {credits.apifyAvailable && (
                    <div>Apify <span className="font-medium text-zinc-600">${credits.apifyBalanceUsd.toFixed(2)}</span> · <span className="font-medium text-zinc-600">{credits.apifyAnalysesAvailable}</span></div>
                  )}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handlePhase1} className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 mb-8">
            <h2 className="text-lg font-semibold text-zinc-800 mb-4">Analizza una nicchia KDP</h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="es. stoicism for beginners"
                disabled={isLoading || stage === 'awaiting_validation'}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-zinc-50"
              />
              <select
                value={market}
                onChange={e => setMarket(e.target.value as Market)}
                disabled={isLoading || stage === 'awaiting_validation'}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 bg-white"
              >
                {MARKETS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isLoading || !keyword.trim() || stage === 'awaiting_validation' || creditsBlocked}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={creditsBlocked ? 'Crediti SerpApi esauriti' : undefined}
              >
                {isLoading ? 'Analisi…' : 'Analizza'}
              </button>
            </div>

            {/* CPC Amazon Ads — campo opzionale con box esplicativo collassabile */}
            <div className="mt-4 border-t border-zinc-100 pt-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-medium text-zinc-500 whitespace-nowrap">CPC Amazon Ads stimato (opzionale):</label>
                <input
                  type="text"
                  value={cpc}
                  onChange={e => setCpc(e.target.value)}
                  placeholder="es. 0.85"
                  disabled={isLoading || stage === 'awaiting_validation'}
                  className="w-28 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:bg-zinc-50"
                />
                <span className="text-xs text-zinc-400">$/€ per click · stima i click/mese acquistabili con il budget ads in §7</span>
                <button
                  type="button"
                  onClick={() => setShowCpc(v => !v)}
                  className="ml-auto flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors"
                >
                  <span className={`transition-transform inline-block ${showCpc ? 'rotate-90' : ''}`}>▶</span>
                  Come stimare il CPC
                </button>
              </div>
              {showCpc && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed space-y-2">
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <span className="shrink-0 font-bold text-amber-600">①</span>
                      <p>
                        <strong>Amazon Ads (gratuito, diretto):</strong> accedi ad{' '}
                        <em>Amazon Ads → Sponsored Products → crea campagna manuale</em>.
                        Aggiungi la keyword nella sezione <em>Targeting per keyword</em> e leggi il{' '}
                        <em>Bid suggerito</em> che appare accanto — non serve pubblicare la campagna.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="shrink-0 font-bold text-amber-600">②</span>
                      <p>
                        <strong>Helium10 Adtomic:</strong> nel modulo Adtomic cerca la keyword e leggi la colonna{' '}
                        <em>Suggested Bid</em>. Offre anche la fascia min/max (bid basso / bid alto) per calibrare meglio il budget.
                        Richiede piano Platinum o superiore.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="shrink-0 font-bold text-amber-600">③</span>
                      <p>
                        <strong>Publisher Rocket:</strong> nella scheda <em>AMS Keyword</em> inserisci la keyword
                        e ottieni direttamente il <em>Avg. CPC</em> stimato insieme al volume di ricerca Amazon.
                        È il metodo più rapido se hai già Publisher Rocket attivo.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* User notes — collapsible */}
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <button
                type="button"
                onClick={() => setShowNotes(v => !v)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <span className={`transition-transform ${showNotes ? 'rotate-90' : ''} inline-block`}>▶</span>
                Osservazioni personali sulla nicchia (opzionale)
              </button>
              {showNotes && (
                <div className="mt-2">
                  <textarea
                    value={userNotes}
                    onChange={e => setUserNotes(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder="Es. ho notato che i libri esistenti ignorano il target over 50 · il formato workbook sembra mancante · la keyword X sembra emergente…"
                    disabled={isLoading || stage === 'awaiting_validation'}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:bg-zinc-50 resize-y"
                  />
                  <p className="text-xs text-zinc-400 mt-1 text-right">{userNotes.length}/1000</p>
                  <p className="text-xs text-zinc-400 mt-0.5">I dati oggettivi (recensioni, Reddit, trends) hanno priorità. Le tue osservazioni vengono usate come segnale integrativo nella Gap Analysis.</p>
                </div>
              )}
            </div>

            {(isLoading || stage === 'awaiting_validation') && (
              <div className="mt-4">
                <PipelineProgress stage={stage} />
              </div>
            )}

            {stage === 'error' && error && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <strong>Errore:</strong> {error}
              </div>
            )}
          </form>

          {/* ── Validation panel ──────────────────────────────────────────────── */}
          {stage === 'awaiting_validation' && amazonDataState && (
            <ValidationPanel
              amazonData={amazonDataState}
              market={market}
              selectedTargetAsin={selectedTargetAsin}
              onSelectTarget={setSelectedTargetAsin}
              customAsinInput={customAsinInput}
              onCustomAsinChange={v => setCustomAsinInput(v)}
              onFetchCustomAsin={handleFetchCustomAsin}
              customAsinLoading={customAsinLoading}
              customAsinProduct={customAsinProduct}
              customAsinError={customAsinError}
              onProceed={handlePhase2}
            />
          )}
        </div>

        {report && <ReportView report={report} />}
        {stage === 'done' && reportId && (
          <div className="mt-4 text-center no-print">
            <a href={`/log/${reportId}`} className="text-sm text-zinc-400 hover:text-indigo-600 underline transition-colors">
              Vedi log dell&apos;analisi
            </a>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Validation Panel ─────────────────────────────────────────────────────────

function coverUrl(asin: string, imageUrl?: string) {
  return imageUrl || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX85_.jpg`
}

function ValidationPanel({
  amazonData, market, selectedTargetAsin, onSelectTarget,
  customAsinInput, onCustomAsinChange, onFetchCustomAsin,
  customAsinLoading, customAsinProduct, customAsinError, onProceed,
}: {
  amazonData: AmazonData
  market: string
  selectedTargetAsin: string
  onSelectTarget: (asin: string) => void
  customAsinInput: string
  onCustomAsinChange: (v: string) => void
  onFetchCustomAsin: () => void
  customAsinLoading: boolean
  customAsinProduct: FilteredBook | null
  customAsinError: string | null
  onProceed: () => void
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 mb-8">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-800">Verifica competitor target</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            L&apos;algoritmo ha suggerito un competitor di riferimento. Confermalo o scegli un altro — poi avvia l&apos;analisi.
          </p>
        </div>
        <button
          onClick={onProceed}
          className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 text-sm font-medium transition-colors"
        >
          Avvia analisi →
        </button>
      </div>

      {/* Book cards with radio */}
      <div className="space-y-2 mb-5">
        {amazonData.topBooks.map(b => {
          const isSelected = selectedTargetAsin === b.asin
          const isDefault  = b.asin === amazonData.competitorTarget.asin
          return (
            <label
              key={b.asin}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'}`}
            >
              <input
                type="radio"
                name="target"
                value={b.asin}
                checked={isSelected}
                onChange={() => onSelectTarget(b.asin)}
                className="shrink-0 accent-indigo-600"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverUrl(b.asin, b.imageUrl)}
                alt=""
                width={28}
                height={40}
                className="rounded shrink-0 object-cover bg-zinc-100 border border-zinc-200"
                onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-800 leading-snug line-clamp-1">{b.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  BSR {b.bsr.toLocaleString('it-IT')} · {b.reviewCount.toLocaleString('it-IT')} rec.
                  {' '}· ★{b.rating.toFixed(1)}
                  {b.selfPublished && <span className="ml-2 text-emerald-600 font-medium">SP</span>}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                {isDefault && !isSelected && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-medium">Suggerito</span>
                )}
                {isSelected && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-600 text-white font-semibold">Target</span>
                )}
              </div>
            </label>
          )
        })}
      </div>

      {/* Custom ASIN */}
      <div className="border-t border-zinc-100 pt-4">
        <p className="text-xs font-medium text-zinc-500 mb-2">
          Oppure inserisci un ASIN personalizzato da usare come competitor target:
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customAsinInput}
            onChange={e => onCustomAsinChange(e.target.value.toUpperCase())}
            placeholder="es. B08XXXXXXXXXX"
            maxLength={10}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
          />
          <button
            onClick={onFetchCustomAsin}
            disabled={customAsinLoading || customAsinInput.trim().length !== 10}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {customAsinLoading ? '…' : 'Cerca'}
          </button>
        </div>

        {customAsinError && (
          <p className="text-xs text-rose-600 mt-1.5">{customAsinError}</p>
        )}

        {customAsinProduct && (
          <label
            className={`flex items-center gap-3 p-3 mt-2 rounded-xl border cursor-pointer transition-colors ${selectedTargetAsin === customAsinProduct.asin ? 'border-indigo-300 bg-indigo-50' : 'border-zinc-200 hover:border-zinc-300'}`}
          >
            <input
              type="radio"
              name="target"
              value={customAsinProduct.asin}
              checked={selectedTargetAsin === customAsinProduct.asin}
              onChange={() => onSelectTarget(customAsinProduct.asin)}
              className="shrink-0 accent-indigo-600"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-800 leading-snug">{customAsinProduct.title}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {customAsinProduct.asin}
                {customAsinProduct.bsr > 0 && ` · BSR ${customAsinProduct.bsr.toLocaleString('it-IT')}`}
                {customAsinProduct.reviewCount > 0 && ` · ${customAsinProduct.reviewCount.toLocaleString('it-IT')} rec.`}
                {customAsinProduct.rating > 0 && ` · ★${customAsinProduct.rating.toFixed(1)}`}
              </p>
            </div>
            {selectedTargetAsin === customAsinProduct.asin && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-600 text-white font-semibold">Target</span>
            )}
          </label>
        )}
      </div>
    </div>
  )
}

// ─── Pipeline Progress ─────────────────────────────────────────────────────────

const STEPS: { key: Stage; label: string }[] = [
  { key: 'loading_amazon',      label: 'Amazon' },
  { key: 'awaiting_validation', label: 'Validazione' },
  { key: 'loading_signals',     label: 'Segnali' },
  { key: 'loading_passo0',      label: 'Competitor' },
  { key: 'loading_insights',    label: 'Insight & Gap' },
  { key: 'loading_strategy',    label: 'Strategia' },
]

function PipelineProgress({ stage }: { stage: Stage }) {
  const activeIdx = STEPS.findIndex(s => s.key === stage)

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((step, i) => {
          const isDone       = activeIdx > i
          const isActive     = activeIdx === i
          const isPending    = activeIdx < i
          const isValidation = step.key === 'awaiting_validation'

          return (
            <div key={step.key} className="flex items-center gap-1.5">
              <div className={[
                'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                isDone    ? 'bg-green-500 text-white' : '',
                isActive  ? `bg-indigo-600 text-white ${isValidation ? '' : 'animate-pulse'}` : '',
                isPending ? 'bg-zinc-200 text-zinc-400' : '',
              ].join(' ')}>
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`text-xs whitespace-nowrap ${isActive ? 'text-indigo-700 font-medium' : isDone ? 'text-green-600' : 'text-zinc-400'}`}>
                {step.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`w-6 h-px shrink-0 ${isDone ? 'bg-green-400' : 'bg-zinc-200'}`} />
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-zinc-400 italic">{STAGE_LABELS[stage]}</p>
    </div>
  )
}
