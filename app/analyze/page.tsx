'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import ReportView from '@/components/ReportView'
import type { FullReport } from '@/components/ReportView'
import type { AmazonData, FilteredBook, Market, YouTubeData, CreditsData, PainPoint } from '@/lib/types'

// Ogni stage corrisponde a un evento reale emesso dal server o a una fetch completata
type Stage =
  | 'idle'
  | 'loading_amazon'               // fetch /api/amazon in corso
  | 'awaiting_validation'          // Amazon done, utente sceglie competitor target
  | 'loading_signals'              // attesa trends+reddit (già avviati in background)
  | 'loading_passo0'               // /api/analyze/pain-points in corso (passo0 + pain points)
  | 'awaiting_painpoint_selection' // pain points pronti, utente seleziona
  | 'loading_insights'             // /api/analyze/finalize in corso
  | 'loading_strategy'             // usato solo dal vecchio /api/analyze SSE (compatibilità)
  | 'done'
  | 'error'

const STAGE_LABELS: Record<Stage, string> = {
  idle:                         '',
  loading_amazon:               'Raccolta dati Amazon…',
  awaiting_validation:          'Scegli il competitor target',
  loading_signals:              'Raccolta segnali (trend + Reddit)…',
  loading_passo0:               'Estrazione pain points…',
  awaiting_painpoint_selection: 'Scegli i pain point da analizzare',
  loading_insights:             'Analisi insight, gap e strategia…',
  loading_strategy:             'Strategia di serie e ROI…',
  done:                         'Report completato',
  error:                        'Errore',
}

// Tipo per i dati di anteprima dopo la fase pain points
type PainPointsPreviewData = {
  scoring: { score: number; trendSignal: string; entryDifficulty: string }
  passo0: { angolo: string; target_reader: string }
  amazonSummary: { topBooks: FilteredBook[]; keyword: string }
  trendsSummary: { available: boolean; yoyGrowth: number; peakMonth: string | null }
  redditSummary: { available: boolean; postCount: number; commentCount: number }
}

const MARKETS: { value: Market; label: string }[] = [
  { value: 'US', label: 'US' },
  { value: 'UK', label: 'UK' },
  { value: 'DE', label: 'DE' },
  { value: 'FR', label: 'FR' },
  { value: 'IT', label: 'IT' },
  { value: 'ES', label: 'ES' },
]

const AMAZON_AUTOCOMPLETE_MID: Record<Market, string> = {
  US: 'ATVPDKIKX0DER',
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
}

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

export default function AnalyzePage() {
  const [keyword, setKeyword]             = useState('')
  const [market, setMarket]               = useState<Market>('US')
  const [cpc, setCpc]                     = useState('')
  const [stage, setStage]                 = useState<Stage>('idle')
  const [targetAsinFromUrl, setTargetAsinFromUrl] = useState<string | null>(null)
  const [skipTargetSelection, setSkipTargetSelection] = useState(false)
  const [report, setReport]   = useState<FullReport | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  // Credits state
  const [credits, setCredits] = useState<CreditsData | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(true)

  // User notes
  const [userNotes, setUserNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [showCpc, setShowCpc] = useState(false)
  const [plannedPrice, setPlannedPrice] = useState('')
  const [plannedPages, setPlannedPages] = useState('')
  const [showPlannedParams, setShowPlannedParams] = useState(false)

  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const autoStartedRef = useRef(false)

  // Pain point selection state (Step 2 — curated mode)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [painPointsToReview, setPainPointsToReview] = useState<PainPoint[]>([])
  const [selectedPainPointIds, setSelectedPainPointIds] = useState<Set<string>>(new Set())
  const [previewData, setPreviewData] = useState<PainPointsPreviewData | null>(null)

  // Leggi URL params da Target Finder (?keyword=&market=&target=&skipTarget=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const kw   = params.get('keyword')
    const mkt  = params.get('market') as Market | null
    const tgt  = params.get('target')
    const skip = params.get('skipTarget') === '1'
    if (kw) setKeyword(kw)
    if (mkt && ['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(mkt)) setMarket(mkt)
    if (tgt) setTargetAsinFromUrl(tgt.toUpperCase())
    if (skip || tgt) setSkipTargetSelection(true)
  }, [])

  // Fetch credits on mount
  useEffect(() => {
    fetch('/api/credits')
      .then(r => r.ok ? r.json() as Promise<CreditsData> : Promise.reject())
      .then(data => setCredits(data))
      .catch(() => setCredits(null))
      .finally(() => setCreditsLoading(false))
  }, [])

  // Autocomplete: fetch suggestions via proxy
  const fetchSuggestions = useCallback(async (value: string, mkt: Market) => {
    if (value.length < 2) { setSuggestions([]); return }
    const mid = AMAZON_AUTOCOMPLETE_MID[mkt]
    setLoadingSuggestions(true)
    try {
      const res = await fetch(`/api/autocomplete?mid=${mid}&prefix=${encodeURIComponent(value)}&market=${mkt}`)
      if (!res.ok) throw new Error()
      const data = await res.json() as { suggestions?: Array<{ value: string }> }
      setSuggestions(data.suggestions?.map(s => s.value) ?? [])
      setShowSuggestions(true)
    } catch {
      setSuggestions([])
    } finally {
      setLoadingSuggestions(false)
    }
  }, [])

  // Debounce 300ms sul typing della keyword
  useEffect(() => {
    const t = setTimeout(() => {
      if (keyword.trim().length >= 2) fetchSuggestions(keyword.trim(), market)
      else setSuggestions([])
    }, 300)
    return () => clearTimeout(t)
  }, [keyword, market, fetchSuggestions])

  // Reset dropdown al cambio mercato
  useEffect(() => {
    setSuggestions([])
    setShowSuggestions(false)
  }, [market])

  // Chiudi dropdown al click fuori
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
  const kwRef           = useRef<string>('')
  const cpcRef          = useRef<number | undefined>(undefined)
  const plannedPriceRef = useRef<number | undefined>(undefined)
  const plannedPagesRef = useRef<number | undefined>(undefined)

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
    setAnalysisId(null)
    setPainPointsToReview([])
    setSelectedPainPointIds(new Set())
    setPreviewData(null)
    setStage('loading_amazon')

    try {
      const amazon = await postJSON('/api/amazon', { keyword: kw, market, targetAsin: targetAsinFromUrl || undefined }) as AmazonData

      kwRef.current           = kw
      cpcRef.current          = cpcValue
      plannedPriceRef.current = plannedPrice.trim() ? parseFloat(plannedPrice.trim().replace(',', '.')) : undefined
      plannedPagesRef.current = plannedPages.trim() ? parseInt(plannedPages.trim(), 10) : undefined

      // Fire-and-forget signals fetch — runs during validation pause
      signalsRef.current = Promise.all([
        fetch('/api/trends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw, market }),
        }).then(r => r.ok ? r.json() : { available: false, yoyGrowth: 0, relatedQueries: [], timelineData: [], keyword: kw, peakMonth: null }),
        fetch('/api/reddit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw }),
        }).then(r => r.ok ? r.json() : { posts: [], totalComments: 0, subredditsUsed: [], threadCount: 0, available: false, insufficientCorpus: true, keyword: kw }),
        fetch('/api/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw, market }),
        }).then(r => r.ok ? r.json() : { videos: [], totalComments: 0, available: false, insufficientCorpus: true, keyword: kw }),
      ]) as Promise<[unknown, unknown, unknown]>

      setAmazonDataState(amazon)
      setSelectedTargetAsin(amazon.competitorTarget.asin)

      // Se l'ASIN da Target Finder non è in topBooks, precompila il campo custom ASIN
      if (targetAsinFromUrl && !amazon.topBooks.some(b => b.asin === targetAsinFromUrl)) {
        setCustomAsinInput(targetAsinFromUrl)
      }

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

  // ── Phase 2: await signals, call /api/analyze/pain-points ────────────────────
  const handlePhase2 = useCallback(async () => {
    if (!amazonDataState || !signalsRef.current) return

    const kw = kwRef.current

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

      const res = await fetch('/api/analyze/pain-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: kw,
          market,
          amazonData: finalAmazonData,
          trendsData,
          redditData,
          youtubeData,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }))
        const errMsg = (errData as { error?: string }).error ?? res.statusText
        if (res.status === 402) {
          setError('BILLING_ANTHROPIC')
          setStage('error')
          return
        }
        throw new Error(errMsg)
      }

      const data = await res.json() as {
        analysisId: string
        painPoints: PainPoint[]
        painPointsAmazon: PainPoint[]
        scoring: { score: number; trendSignal: string; entryDifficulty: string }
        passo0: { angolo: string; target_reader: string }
        amazonSummary: { topBooks: FilteredBook[]; keyword: string }
        trendsSummary: { available: boolean; yoyGrowth: number; peakMonth: string | null }
        redditSummary: { available: boolean; postCount: number; commentCount: number }
      }

      const allPainPoints = [...data.painPoints, ...(data.painPointsAmazon ?? [])]
      setAnalysisId(data.analysisId)
      setPainPointsToReview(allPainPoints)
      setSelectedPainPointIds(new Set(allPainPoints.filter(p => p.id).map(p => p.id!)))
      setPreviewData({
        scoring: data.scoring,
        passo0: data.passo0,
        amazonSummary: data.amazonSummary,
        trendsSummary: data.trendsSummary,
        redditSummary: data.redditSummary,
      })
      setStage('awaiting_painpoint_selection')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }, [amazonDataState, selectedTargetAsin, customAsinProduct, market])

  // Auto-start Phase 2 quando l'utente ha già espresso intent skipTarget
  useEffect(() => {
    if (
      stage === 'awaiting_validation' &&
      skipTargetSelection &&
      amazonDataState &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true
      handlePhase2()
    }
  }, [stage, skipTargetSelection, amazonDataState, handlePhase2])

  // ── Phase 3: call /api/analyze/finalize with selected pain points ─────────────
  const handlePhase3 = useCallback(async () => {
    if (selectedPainPointIds.size === 0 || !analysisId) return
    setStage('loading_insights')
    setError(null)
    try {
      const res = await fetch('/api/analyze/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId,
          selectedPainPointIds: Array.from(selectedPainPointIds),
          cpc: cpcRef.current,
          userNotes: userNotes.trim() || undefined,
          plannedPrice: plannedPriceRef.current,
          plannedPages: plannedPagesRef.current,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }))
        const errMsg = (errData as { error?: string }).error ?? res.statusText
        if (res.status === 402) {
          setError('BILLING_ANTHROPIC')
          setStage('error')
          return
        }
        if (res.status === 410) {
          setError('Analisi scaduta (30 min superati). Riavvia dalla ricerca.')
          setStage('error')
          return
        }
        throw new Error(errMsg)
      }
      const data = await res.json() as { report: FullReport }
      setReport(data.report)
      setReportId((data.report as unknown as { id?: string }).id ?? null)
      setStage('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }, [analysisId, selectedPainPointIds, userNotes])

  const isLoading = !['idle', 'awaiting_validation', 'awaiting_painpoint_selection', 'done', 'error'].includes(stage)
  const isFormLocked = isLoading || stage === 'awaiting_painpoint_selection'
  const analyzeBlocked = credits !== null && credits.available && credits.analyzesAvailable < 1

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white">
      <header className="bg-white border-b border-zinc-200 no-print">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">
              BookInsight
              <span className="ml-2 text-sm font-normal text-zinc-400">v6.8</span>
            </h1>
            <p className="text-xs text-zinc-500">Analisi nicchie Amazon KDP con AI</p>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
              Trova il bersaglio
            </a>
            <a href="/history" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
              Storico report
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="no-print">
          {/* ── Credits banner ────────────────────────────────────────────── */}
          {!creditsLoading && credits?.available && (
            <div className={`mb-4 rounded-xl border px-5 py-3 no-print ${
              credits.analyzesAvailable === 0
                ? 'bg-red-50 border-red-200'
                : credits.analyzesAvailable <= 3
                ? 'bg-amber-50 border-amber-200'
                : 'bg-zinc-50 border-zinc-200'
            }`}>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${
                      credits.analyzesAvailable === 0 ? 'text-red-400' :
                      credits.analyzesAvailable <= 3  ? 'text-amber-500' : 'text-zinc-400'
                    }`}>Analisi disponibili</span>
                    <span className={`text-xl font-black tabular-nums leading-none ${
                      credits.analyzesAvailable === 0 ? 'text-red-600' :
                      credits.analyzesAvailable <= 3  ? 'text-amber-600' : 'text-zinc-800'
                    }`}>{credits.analyzesAvailable}</span>
                    {credits.analyzesAvailable === 0 && (
                      <span className="text-xs font-medium text-red-500 ml-1">— SerpApi esaurito</span>
                    )}
                    {credits.analyzesAvailable > 0 && credits.analyzesAvailable <= 3 && (
                      <span className="text-xs text-amber-500 ml-1">ultime rimaste</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${
                      credits.targetFinderAvailable === 0 ? 'text-red-400' :
                      credits.targetFinderAvailable <= 3  ? 'text-amber-500' : 'text-zinc-400'
                    }`}>Scouting disponibili</span>
                    <span className={`text-xl font-black tabular-nums leading-none ${
                      credits.targetFinderAvailable === 0 ? 'text-red-600' :
                      credits.targetFinderAvailable <= 3  ? 'text-amber-600' : 'text-zinc-800'
                    }`}>{credits.targetFinderAvailable}</span>
                    {credits.targetFinderAvailable === 0 && (
                      <span className="text-xs font-medium text-red-500 ml-1">
                        {credits.apifyAvailable && credits.apifyBalanceUsd < 0.10 ? '— Apify insufficiente' : '— SerpApi esaurito'}
                      </span>
                    )}
                    {credits.targetFinderAvailable > 0 && credits.targetFinderAvailable <= 3 && (
                      <span className="text-xs text-amber-500 ml-1">ultime rimaste</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-zinc-400 space-y-0.5 shrink-0">
                  <div>
                    <a href="https://serpapi.com/manage-api-key" target="_blank" rel="noreferrer"
                      className="inline-flex items-center justify-end gap-1 text-zinc-400 hover:text-indigo-500 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                      SerpApi — <span className="font-medium text-zinc-600">{credits.total_searches_left.toLocaleString('it-IT')} ricerche rimanenti</span>
                    </a>
                  </div>
                  {credits.apifyAvailable && (
                    <div>
                      <a href="https://console.apify.com/billing" target="_blank" rel="noreferrer"
                        className="inline-flex items-center justify-end gap-1 text-zinc-400 hover:text-indigo-500 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                        Apify — <span className="font-medium text-zinc-600">${credits.apifyBalanceUsd.toFixed(2)} credito rimanente</span>
                      </a>
                    </div>
                  )}
                  <div>
                    <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer"
                      className="inline-flex items-center justify-end gap-1 text-zinc-400 hover:text-indigo-500 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                      Anthropic — <span className="font-medium text-zinc-600">verifica crediti</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handlePhase1} className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 mb-8">
            <h2 className="text-lg font-semibold text-zinc-800 mb-4">Analizza una nicchia KDP</h2>
            {targetAsinFromUrl && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-700">
                <span className="font-semibold">Bersaglio da Target Finder:</span>
                <span className="font-mono">{targetAsinFromUrl}</span>
                <button
                  type="button"
                  onClick={() => setTargetAsinFromUrl(null)}
                  className="ml-auto text-indigo-400 hover:text-indigo-700 transition-colors"
                  title="Rimuovi bersaglio pre-selezionato"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1" ref={suggestionsRef}>
                <input
                  type="text"
                  value={keyword}
                  onChange={e => {
                    setKeyword(e.target.value)
                    if (e.target.value.length < 2) setShowSuggestions(false)
                  }}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                  onKeyDown={e => { if (e.key === 'Escape') setShowSuggestions(false) }}
                  placeholder="es. stoicism for beginners"
                  disabled={isFormLocked || stage === 'awaiting_validation'}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-zinc-50"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white rounded-xl border border-zinc-200 shadow-lg overflow-hidden">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setKeyword(s)
                          setShowSuggestions(false)
                          setSuggestions([])
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors flex items-center gap-2"
                      >
                        <span className="text-zinc-300 text-xs">⌕</span>
                        {s}
                      </button>
                    ))}
                    <div className="px-4 py-1.5 text-xs text-zinc-300 border-t border-zinc-100 flex items-center gap-1">
                      <span>Suggerimenti Amazon {market}</span>
                      {loadingSuggestions && <span className="animate-pulse">…</span>}
                    </div>
                  </div>
                )}
              </div>
              <select
                value={market}
                onChange={e => setMarket(e.target.value as Market)}
                disabled={isFormLocked || stage === 'awaiting_validation'}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 bg-white"
              >
                {MARKETS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isFormLocked || !keyword.trim() || stage === 'awaiting_validation' || analyzeBlocked}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={
                  credits?.analyzesAvailable === 0 ? 'Crediti SerpApi insufficienti — ricarica su serpapi.com' :
                  undefined
                }
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
                  disabled={isFormLocked || stage === 'awaiting_validation'}
                  className="w-28 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:bg-zinc-50"
                />
                <span className="text-xs text-zinc-400">$/€ per click · usato per stimare il costo ads nel modello ROI §7</span>
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

            {/* Parametri libro pianificato — collassabile, opzionale */}
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <button
                type="button"
                onClick={() => setShowPlannedParams(v => !v)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <span className={`transition-transform ${showPlannedParams ? 'rotate-90' : ''} inline-block`}>▶</span>
                Parametri del libro pianificato (opzionale — usati nel calcolo ROI §7)
              </button>
              {showPlannedParams && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Prezzo di vendita pianificato</label>
                    <input
                      type="text"
                      value={plannedPrice}
                      onChange={e => setPlannedPrice(e.target.value)}
                      placeholder={`es. 14.99`}
                      disabled={isFormLocked || stage === 'awaiting_validation'}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:bg-zinc-50"
                    />
                    <p className="text-xs text-zinc-400">Se assente: usato il prezzo del bersaglio</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Pagine pianificate</label>
                    <input
                      type="text"
                      value={plannedPages}
                      onChange={e => setPlannedPages(e.target.value)}
                      placeholder="es. 180"
                      disabled={isFormLocked || stage === 'awaiting_validation'}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:bg-zinc-50"
                    />
                    <p className="text-xs text-zinc-400">Influisce sulla royalty (costo di stampa KDP). Se assente: usate le pagine del bersaglio</p>
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
                    disabled={isFormLocked || stage === 'awaiting_validation'}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:bg-zinc-50 resize-y"
                  />
                  <p className="text-xs text-zinc-400 mt-1 text-right">{userNotes.length}/1000</p>
                  <p className="text-xs text-zinc-400 mt-0.5">I dati oggettivi (recensioni, Reddit, trends) hanno priorità. Le tue osservazioni vengono usate come segnale integrativo nella Gap Analysis.</p>
                </div>
              )}
            </div>

            {(isLoading || stage === 'awaiting_validation' || stage === 'awaiting_painpoint_selection') && (
              <div className="mt-4">
                <PipelineProgress stage={stage} />
              </div>
            )}

            {stage === 'error' && error && (
              error === 'BILLING_ANTHROPIC' ? (
                <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm">
                  <p className="font-semibold text-red-700">Crediti Anthropic esauriti</p>
                  <a
                    href="https://console.anthropic.com/settings/billing"
                    target="_blank"
                    rel="noreferrer"
                    className="text-red-600 underline underline-offset-2 text-xs"
                  >
                    Ricarica crediti Anthropic →
                  </a>
                </div>
              ) : (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  <strong>Errore:</strong> {error}
                </div>
              )
            )}
          </form>

          {/* ── Validation panel (target selection) — solo se non skipTargetSelection ── */}
          {stage === 'awaiting_validation' && amazonDataState && !skipTargetSelection && (
            <ValidationPanel
              amazonData={amazonDataState}
              market={market}
              selectedTargetAsin={selectedTargetAsin}
              onSelectTarget={setSelectedTargetAsin}
              suggestedTargetAsin={targetAsinFromUrl ?? undefined}
              customAsinInput={customAsinInput}
              onCustomAsinChange={v => setCustomAsinInput(v)}
              onFetchCustomAsin={handleFetchCustomAsin}
              customAsinLoading={customAsinLoading}
              customAsinProduct={customAsinProduct}
              customAsinError={customAsinError}
              onProceed={handlePhase2}
            />
          )}

          {/* ── Skip target recap card — visibile quando arriva da /target o con skipTarget=1 ── */}
          {(stage === 'awaiting_validation' || stage === 'loading_signals' || stage === 'loading_passo0') && amazonDataState && skipTargetSelection && (
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 mb-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-zinc-800">Riepilogo analisi</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Parametri confermati — procedi con l&apos;analisi</p>
                  <div className="mt-3 space-y-1.5 text-sm text-zinc-700">
                    <div>
                      <span className="text-xs text-zinc-400 mr-1.5">Keyword:</span>
                      <span className="font-medium">{kwRef.current || keyword}</span>
                    </div>
                    <div>
                      <span className="text-xs text-zinc-400 mr-1.5">Mercato:</span>
                      <span className="font-medium">{market}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-zinc-400 mr-1.5">Target:</span>
                      {targetAsinFromUrl ? (
                        <span className="font-mono text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded">
                          {targetAsinFromUrl}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-500 italic">Selezionato automaticamente da BookInsight</span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handlePhase2}
                  className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 text-sm font-medium transition-colors"
                >
                  Avvia analisi →
                </button>
              </div>
            </div>
          )}

          {/* ── Pain point selection panel ──────────────────────────────────────── */}
          {stage === 'awaiting_painpoint_selection' && painPointsToReview.length > 0 && previewData && (
            <PainPointSelectionPanel
              painPoints={painPointsToReview}
              selectedIds={selectedPainPointIds}
              onToggle={(id) => setSelectedPainPointIds(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })}
              onSelectAll={() => setSelectedPainPointIds(
                new Set(painPointsToReview.filter(p => p.id).map(p => p.id!))
              )}
              onDeselectAll={() => setSelectedPainPointIds(new Set())}
              onContinue={handlePhase3}
              previewData={previewData}
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

// ─── Badge helpers ────────────────────────────────────────────────────────────

function fonteBadgeClass(fonte: string): string {
  if (fonte === 'reddit')               return 'bg-orange-100 text-orange-700 border-orange-200'
  if (fonte === 'youtube')              return 'bg-red-100 text-red-700 border-red-200'
  if (fonte === 'recensione_negativa')  return 'bg-rose-100 text-rose-700 border-rose-200'
  if (fonte === 'recensione_positiva')  return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  return 'bg-zinc-100 text-zinc-600 border-zinc-200'
}

function registerBadgeClass(reg: string): string {
  if (reg === 'frustrazione' || reg === 'rabbia') return 'bg-red-50 text-red-600 border-red-200'
  if (reg === 'ansia')     return 'bg-amber-50 text-amber-700 border-amber-200'
  if (reg === 'desiderio') return 'bg-purple-50 text-purple-700 border-purple-200'
  if (reg === 'confusione') return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  if (reg === 'orgoglio')  return 'bg-green-50 text-green-700 border-green-200'
  return 'bg-zinc-50 text-zinc-500 border-zinc-200'
}

// ─── Pain Point Card ──────────────────────────────────────────────────────────

function PainPointCard({ pp, isSelected, onToggle }: {
  pp: PainPoint
  isSelected: boolean
  onToggle: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasId = !!pp.id
  const hasEvidence = (pp.evidence_quotes && pp.evidence_quotes.length > 0) ||
                      (pp.voice_phrases && pp.voice_phrases.length > 0)

  return (
    <div className={`border rounded-xl p-4 mb-3 transition-colors ${
      isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-zinc-200 bg-white'
    }`}>
      <div className="flex gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          disabled={!hasId}
          className="mt-0.5 shrink-0 w-4 h-4 rounded accent-indigo-600 cursor-pointer disabled:cursor-default"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-zinc-800 leading-snug flex-1">{pp.pain_point}</p>
            <span className="shrink-0 text-xs font-bold text-indigo-700 bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-full">
              {pp.score.toFixed(1)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-zinc-100 text-zinc-600 border-zinc-200 font-mono">F:{pp.F}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-zinc-100 text-zinc-600 border-zinc-200 font-mono">I:{pp.I}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-zinc-100 text-zinc-600 border-zinc-200 font-mono">S:{pp.S}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${fonteBadgeClass(pp.fonte)}`}>
              {pp.fonte.replace(/_/g, ' ')}
            </span>
            {pp.emotional_register && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${registerBadgeClass(pp.emotional_register)}`}>
                {pp.emotional_register}
              </span>
            )}
            {pp.criticalSignal && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-200 font-semibold">
                ⚡ critico
              </span>
            )}
          </div>
          {hasEvidence ? (
            <>
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {expanded ? '▲ Nascondi evidence' : '▼ Mostra evidence'}
              </button>
              {expanded && (
                <div className="mt-2 space-y-2">
                  {pp.evidence_quotes && pp.evidence_quotes.length > 0 && (
                    <ul className="space-y-1">
                      {pp.evidence_quotes.slice(0, 4).map((q, i) => (
                        <li key={i} className="text-xs text-zinc-600 italic border-l-2 border-indigo-200 pl-2">
                          &quot;{q.length > 200 ? q.slice(0, 200) + '…' : q}&quot;
                        </li>
                      ))}
                    </ul>
                  )}
                  {pp.voice_phrases && pp.voice_phrases.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pp.voice_phrases.slice(0, 5).map((phrase, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {phrase}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-400 italic line-clamp-2">{pp.evidence?.slice(0, 120) ?? ''}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pain Point Selection Panel ───────────────────────────────────────────────

function PainPointSelectionPanel({
  painPoints, selectedIds, onToggle, onSelectAll, onDeselectAll, onContinue, previewData,
}: {
  painPoints: PainPoint[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onContinue: () => void
  previewData: PainPointsPreviewData
}) {
  const selectableTotal = painPoints.filter(p => p.id).length
  const selectedCount   = selectedIds.size

  return (
    <div className="mb-8 space-y-4">
      {/* Anteprima analisi */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-4">
        <h3 className="text-sm font-semibold text-zinc-700 mb-3">Anteprima analisi</h3>
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="text-2xl font-black text-indigo-700 tabular-nums">{previewData.scoring.score}</div>
            <div className="text-xs text-zinc-400">Profitability /100</div>
          </div>
          <div>
            <div className="text-lg font-bold text-zinc-700">{previewData.scoring.trendSignal}</div>
            <div className="text-xs text-zinc-400">Trend segnale</div>
          </div>
          <div>
            <div className="text-lg font-bold text-zinc-700">{previewData.scoring.entryDifficulty}</div>
            <div className="text-xs text-zinc-400">Difficoltà entrata</div>
          </div>
          {previewData.redditSummary.available && (
            <div>
              <div className="text-lg font-bold text-zinc-700">{previewData.redditSummary.postCount} post</div>
              <div className="text-xs text-zinc-400">{previewData.redditSummary.commentCount} commenti Reddit</div>
            </div>
          )}
        </div>
        {previewData.passo0?.angolo && (
          <div className="mt-3 text-xs text-zinc-500 border-t border-zinc-100 pt-3">
            <span className="font-medium text-zinc-600">Angolo competitor:</span>{' '}
            {previewData.passo0.angolo}
          </div>
        )}
      </div>

      {/* Selezione pain points */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h3 className="text-base font-semibold text-zinc-800">Seleziona i pain point da analizzare</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Scarta quelli irrilevanti per il tuo mercato. Quelli rimanenti guideranno Insights, Gap Analysis e Strategia.
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full whitespace-nowrap">
            {selectedCount}/{selectableTotal}
          </span>
        </div>

        <div className="mt-4">
          {painPoints.map(pp => (
            <PainPointCard
              key={pp.id ?? pp.pain_point}
              pp={pp}
              isSelected={pp.id ? selectedIds.has(pp.id) : true}
              onToggle={() => pp.id && onToggle(pp.id)}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-zinc-100">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-sm text-zinc-600 hover:text-zinc-800 border border-zinc-300 rounded-lg px-4 py-2 transition-colors"
          >
            Seleziona tutti
          </button>
          <button
            type="button"
            onClick={onDeselectAll}
            className="text-sm text-zinc-600 hover:text-zinc-800 border border-zinc-300 rounded-lg px-4 py-2 transition-colors"
          >
            Deseleziona tutti
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={selectedCount === 0}
            className="ml-auto rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Continua con {selectedCount} pain point →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Validation Panel ─────────────────────────────────────────────────────────

function coverUrl(asin: string, imageUrl?: string) {
  return imageUrl || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX85_.jpg`
}

function ValidationPanel({
  amazonData, market, selectedTargetAsin, onSelectTarget,
  suggestedTargetAsin,
  customAsinInput, onCustomAsinChange, onFetchCustomAsin,
  customAsinLoading, customAsinProduct, customAsinError, onProceed,
}: {
  amazonData: AmazonData
  market: string
  selectedTargetAsin: string
  onSelectTarget: (asin: string) => void
  suggestedTargetAsin?: string
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
          const isSelected    = selectedTargetAsin === b.asin
          const isDefault     = b.asin === amazonData.competitorTarget.asin
          const isFromFinder  = suggestedTargetAsin === b.asin
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
                {isFromFinder && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-semibold border border-indigo-200">Target Finder</span>
                )}
                {isDefault && !isSelected && !isFromFinder && (
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
          {suggestedTargetAsin && !amazonData.topBooks.some(b => b.asin === suggestedTargetAsin)
            ? <>Bersaglio da Target Finder (<span className="font-mono">{suggestedTargetAsin}</span>) non trovato nella SERP — cercalo come ASIN personalizzato:</>
            : 'Oppure inserisci un ASIN personalizzato da usare come competitor target:'}
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
  { key: 'loading_amazon',               label: 'Amazon' },
  { key: 'awaiting_validation',          label: 'Target' },
  { key: 'loading_signals',              label: 'Segnali' },
  { key: 'loading_passo0',               label: 'Pain Points' },
  { key: 'awaiting_painpoint_selection', label: 'Selezione' },
  { key: 'loading_insights',             label: 'Analisi' },
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
          const isPause      = step.key === 'awaiting_validation' || step.key === 'awaiting_painpoint_selection'

          return (
            <div key={step.key} className="flex items-center gap-1.5">
              <div className={[
                'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                isDone    ? 'bg-green-500 text-white' : '',
                isActive  ? `bg-indigo-600 text-white ${isPause ? '' : 'animate-pulse'}` : '',
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
