'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Market, TargetFinderResult, TargetCandidate, TargetViability, CreditsData } from '@/lib/types'
import { PARITY_COMFORTABLE, PARITY_CHALLENGE } from '@/lib/target'
import { amazonProductUrl } from '@/lib/amazon'

// ─── Costanti UI ─────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coverUrl(asin: string, imageUrl?: string) {
  return imageUrl || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX85_.jpg`
}

function fmtRevenue(min: number, max: number, currency: string) {
  const sym = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'
  return `${sym}${Math.round(min).toLocaleString('it-IT')}–${Math.round(max).toLocaleString('it-IT')}/mese`
}

function parityLabel(months: number): { text: string; color: string } {
  if (months <= PARITY_COMFORTABLE) return { text: 'comodo',  color: 'bg-emerald-100 text-emerald-700' }
  if (months <= PARITY_CHALLENGE)   return { text: 'sfida',   color: 'bg-amber-100 text-amber-700' }
  return                                   { text: 'duro',    color: 'bg-rose-100 text-rose-700' }
}

function attackabilityBadge(a: TargetCandidate['attackability']) {
  if (a === 'ATTACCABILE')             return { text: 'Attaccabile',      color: 'bg-emerald-100 text-emerald-700' }
  if (a === 'ATTACCABILE_SE_PROMOSSO') return { text: 'Promosso',         color: 'bg-amber-100 text-amber-700' }
  return                                      { text: 'Non attaccabile',  color: 'bg-zinc-100 text-zinc-500' }
}

function quadrantLabel(q: TargetCandidate['quadrant']) {
  const map: Record<string, { text: string; color: string }> = {
    IDEALE:            { text: 'Ideale',          color: 'bg-indigo-100 text-indigo-700' },
    TROPPO_DURO:       { text: 'Troppo duro',     color: 'bg-rose-100 text-rose-700' },
    FACILE_BASSA_RESA: { text: 'Bassa resa',      color: 'bg-amber-100 text-amber-700' },
    ANOMALO:           { text: 'Anomalo',          color: 'bg-purple-100 text-purple-700' },
    NON_ATTACCABILE:   { text: 'Non attaccabile', color: 'bg-zinc-100 text-zinc-500' },
    DATI_INSUFFICIENTI:{ text: 'Dati incompleti', color: 'bg-zinc-100 text-zinc-400' },
  }
  return map[q] ?? { text: q, color: 'bg-zinc-100 text-zinc-500' }
}

function verdictBadge(v: TargetViability['verdict']) {
  const map: Record<string, { text: string; color: string }> = {
    BERSAGLIO_VALIDO:        { text: 'Bersaglio valido',    color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
    BATTIBILE_MA_SFIDA:      { text: 'Battibile (sfida)',   color: 'bg-amber-50 text-amber-700 border border-amber-200' },
    BATTIBILE_MA_BASSA_RESA: { text: 'Battibile (bassa resa)', color: 'bg-amber-50 text-amber-700 border border-amber-200' },
    NON_ATTACCABILE:         { text: 'Non attaccabile',     color: 'bg-rose-50 text-rose-700 border border-rose-200' },
    DA_VALUTARE:             { text: 'Da valutare',         color: 'bg-zinc-50 text-zinc-600 border border-zinc-200' },
  }
  return map[v] ?? { text: v, color: 'bg-zinc-50 text-zinc-600 border border-zinc-200' }
}

function gravitaColor(g: 'ALTA' | 'MEDIA' | 'BASSA') {
  if (g === 'ALTA')  return 'bg-rose-100 text-rose-700'
  if (g === 'MEDIA') return 'bg-amber-100 text-amber-700'
  return                    'bg-zinc-100 text-zinc-500'
}

function notAttackableReason(c: TargetCandidate): string {
  if (c.reviewCount > 150) return `${c.reviewCount} recensioni (>150)`
  if (c.attackability === 'NON_PROMOSSO') {
    const reasons: string[] = []
    if (!c.promotionFactors.lowReviewVelocity) reasons.push('muro alto')
    if (!c.promotionFactors.weakRating) reasons.push(`rating ${c.rating.toFixed(1)} > 4.3`)
    if (c.promotionFactors.ratingVeto) reasons.push(`veto rating ${c.rating.toFixed(1)} > 4.8`)
    return reasons.length > 0 ? reasons.join(' · ') : 'non promosso'
  }
  return 'non attaccabile'
}

function analysisUrl(keyword: string, market: Market, asin: string) {
  return `/analyze?keyword=${encodeURIComponent(keyword)}&market=${market}&target=${asin}`
}

function AmazonLink({ asin, market, className = '' }: { asin: string; market: Market; className?: string }) {
  return (
    <a
      href={amazonProductUrl(asin, market)}
      target="_blank"
      rel="noopener noreferrer"
      title="Apri su Amazon"
      onClick={e => e.stopPropagation()}
      className={`shrink-0 text-zinc-300 hover:text-zinc-600 transition-colors ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </a>
  )
}

// ─── Schermata principale ────────────────────────────────────────────────────

type UiState = 'idle' | 'loading' | 'results' | 'error'

export default function TargetFinder() {
  const [keyword, setKeyword] = useState('')
  const [market, setMarket]   = useState<Market>('US')
  const [uiState, setUiState] = useState<UiState>('idle')
  const [result, setResult]   = useState<TargetFinderResult | null>(null)
  const [error, setError]     = useState<string | null>(null)

  // Credits
  const [credits, setCredits] = useState<CreditsData | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(true)

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/credits')
      .then(r => r.ok ? r.json() as Promise<CreditsData> : Promise.reject())
      .then(data => setCredits(data))
      .catch(() => setCredits(null))
      .finally(() => setCreditsLoading(false))
  }, [])

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

  useEffect(() => {
    const t = setTimeout(() => {
      if (keyword.trim().length >= 2) fetchSuggestions(keyword.trim(), market)
      else setSuggestions([])
    }, 300)
    return () => clearTimeout(t)
  }, [keyword, market, fetchSuggestions])

  useEffect(() => {
    setSuggestions([])
    setShowSuggestions(false)
  }, [market])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const creditsBlocked = credits !== null && credits.available && credits.analysesMain < 1

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!keyword.trim()) return
    setUiState('loading')
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), market }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore sconosciuto')
      setResult(json as TargetFinderResult)
      setUiState('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setUiState('error')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">
              BookInsight
              <span className="ml-2 text-sm font-normal text-zinc-400">Target Finder</span>
            </h1>
            <p className="text-xs text-zinc-500">Scegli il bersaglio giusto prima di analizzare</p>
          </div>
          <a href="/history" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            Storico report
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* ── Credits banner ────────────────────────────────────────────────── */}
        {!creditsLoading && credits?.available && (
          <div className={`rounded-xl border px-5 py-3 ${
            credits.analysesMain === 0
              ? 'bg-red-50 border-red-200'
              : credits.analysesMain <= 3
              ? 'bg-amber-50 border-amber-200'
              : 'bg-zinc-50 border-zinc-200'
          }`}>
            <div className="flex items-center justify-between gap-4">
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

        {/* ── Form ──────────────────────────────────────────────────────────── */}
        <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6">
          <h2 className="text-base font-semibold text-zinc-800 mb-1">Trova il bersaglio</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Inserisci la keyword della nicchia. Analizziamo i libri della prima pagina e ti suggeriamo i 3 bersagli più attaccabili.
          </p>
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
                disabled={uiState === 'loading'}
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
              disabled={uiState === 'loading'}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 bg-white"
            >
              {MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button
              type="submit"
              disabled={uiState === 'loading' || !keyword.trim() || creditsBlocked}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uiState === 'loading' ? 'Analisi…' : 'Trova bersaglio'}
            </button>
          </div>
        </form>

        {/* ── Link analisi diretta ──────────────────────────────────────────── */}
        <div className="text-center">
          <a
            href="/analyze"
            className="text-sm text-zinc-400 hover:text-indigo-600 transition-colors"
          >
            Analizza direttamente senza scegliere un bersaglio →
          </a>
        </div>

        {/* ── Loading ───────────────────────────────────────────────────────── */}
        {uiState === 'loading' && (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-10 text-center">
            <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium text-zinc-700">Analizzo i libri della prima pagina…</p>
            <p className="text-xs text-zinc-400 mt-1">Può richiedere 15–25 secondi (product detail in parallelo)</p>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {uiState === 'error' && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
            <strong>Errore:</strong> {error}
          </div>
        )}

        {/* ── Risultati ─────────────────────────────────────────────────────── */}
        {uiState === 'results' && result && (
          <ResultsView result={result} />
        )}
      </main>
    </div>
  )
}

// ─── Risultati ────────────────────────────────────────────────────────────────

function ResultsView({ result }: { result: TargetFinderResult }) {
  const { keyword, market, candidates, suggested, nicheReviewVelocity, warning, unknownFormatCount } = result

  const attackable    = candidates.filter(c => c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO')
  const nonAttackable = candidates.filter(c => c.attackability === 'NON_ATTACCABILE' || c.attackability === 'NON_PROMOSSO')

  const byQuadrant = (q: TargetCandidate['quadrant']) =>
    attackable.filter(c => c.quadrant === q)

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-zinc-700">
          "{keyword}" · {market}
        </span>
        <span className="text-xs text-zinc-400">
          Velocità nicchia ~{nicheReviewVelocity.toFixed(1)} rec/mese ·{' '}
          {candidates.length} libri analizzati
        </span>
        {warning && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
            ⚠ {warning}
          </span>
        )}
        {unknownFormatCount != null && unknownFormatCount > 0 && (
          <span className="text-xs text-zinc-500 bg-zinc-100 border border-zinc-200 rounded-full px-2.5 py-0.5">
            {unknownFormatCount} {unknownFormatCount === 1 ? 'libro escluso' : 'libri esclusi'} per formato non identificabile (possibili hardcover o dati incompleti)
          </span>
        )}
      </div>

      {/* ── 1. Bersagli suggeriti ────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-zinc-800 mb-3">Bersagli suggeriti</h2>
        {suggested.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-700">
            Nessun bersaglio suggerito. Prova una keyword diversa o analizza manualmente un ASIN.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suggested.map((c, i) => (
              <SuggestedCard key={c.asin} candidate={c} rank={i + 1} keyword={keyword} market={market} />
            ))}
          </div>
        )}
      </section>

      {/* ── 2. Vista quadranti ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-zinc-800 mb-1">Tutti i candidati — quadranti</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Asse orizzontale: ricavo mensile stimato · Asse verticale: facilità di attacco
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-2xl overflow-hidden border border-zinc-200">
          <QuadrantCell
            label="IDEALE" labelColor="text-indigo-700"
            description="Alta resa · Poco difeso"
            candidates={byQuadrant('IDEALE')}
            keyword={keyword} market={market}
            borderClass="border-b border-r border-zinc-200"
          />
          <QuadrantCell
            label="TROPPO DURO" labelColor="text-rose-700"
            description="Alta resa · Ben difeso"
            candidates={byQuadrant('TROPPO_DURO')}
            keyword={keyword} market={market}
            borderClass="border-b border-zinc-200"
          />
          <QuadrantCell
            label="BASSA RESA" labelColor="text-amber-700"
            description="Bassa resa · Poco difeso"
            candidates={byQuadrant('FACILE_BASSA_RESA')}
            keyword={keyword} market={market}
            borderClass="border-r border-zinc-200"
          />
          <QuadrantCell
            label="ANOMALO" labelColor="text-purple-700"
            description="Bassa resa · Ben difeso"
            candidates={byQuadrant('ANOMALO')}
            keyword={keyword} market={market}
            borderClass=""
          />
        </div>
        {attackable.filter(c => c.quadrant === 'DATI_INSUFFICIENTI').length > 0 && (
          <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-xs font-medium text-zinc-500 mb-1.5">Dati incompleti (esclusi dalle mediane)</p>
            <div className="flex flex-wrap gap-2">
              {attackable.filter(c => c.quadrant === 'DATI_INSUFFICIENTI').map(c => (
                <CandidateChip key={c.asin} candidate={c} keyword={keyword} market={market} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 3. ASIN manuale ─────────────────────────────────────────────── */}
      <ManualAsinSection keyword={keyword} market={market} />

      {/* ── 4. Non attaccabili ──────────────────────────────────────────── */}
      {nonAttackable.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-zinc-800 mb-3">Non attaccabili</h2>
          <div className="rounded-2xl border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {nonAttackable.map(c => (
              <div key={c.asin} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-zinc-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverUrl(c.asin, c.imageUrl)}
                  alt=""
                  width={24}
                  height={34}
                  className="rounded shrink-0 object-cover bg-zinc-100 border border-zinc-200 opacity-40"
                  onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-600 line-clamp-1">{c.title}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {c.reviewCount} rec. · ★{c.rating.toFixed(1)} · {notAttackableReason(c)}
                  </p>
                </div>
                <AmazonLink asin={c.asin} market={market} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Card bersaglio suggerito ─────────────────────────────────────────────────

type ViabilityUiState = 'idle' | 'loading' | 'done' | 'error'

function SuggestedCard({ candidate: c, rank, keyword, market }: {
  candidate: TargetCandidate
  rank: number
  keyword: string
  market: Market
}) {
  const att    = attackabilityBadge(c.attackability)
  const parity = parityLabel(c.monthsToParity)
  const quad   = quadrantLabel(c.quadrant)

  const [viState, setViState]   = useState<ViabilityUiState>('idle')
  const [viability, setViability] = useState<TargetViability | null>(null)
  const [viError, setViError]   = useState<string | null>(null)
  const [userRV, setUserRV]     = useState(3)
  const [arcR, setArcR]         = useState(0)
  const [showPanel, setShowPanel] = useState(false)

  async function fetchViability(rv: number, arc: number) {
    setViState('loading')
    setViError(null)
    try {
      const res = await fetch('/api/target/viability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: c.asin, market, keyword, userReviewVelocity: rv, arcReviews: arc }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore sconosciuto')
      setViability(json as TargetViability)
      setViState('done')
      setShowPanel(true)
    } catch (err) {
      setViError(err instanceof Error ? err.message : String(err))
      setViState('error')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
          {rank}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverUrl(c.asin, c.imageUrl)}
          alt=""
          width={36}
          height={52}
          className="rounded shrink-0 object-cover bg-zinc-100 border border-zinc-200"
          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800 line-clamp-2 leading-snug">{c.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[11px] font-mono text-zinc-400">{c.asin}</p>
            <AmazonLink asin={c.asin} market={market} />
          </div>
        </div>
      </div>

      {/* Metriche */}
      <div className="text-sm text-zinc-700 font-medium">
        Vende ~{fmtRevenue(c.estMonthlyRevenueMin, c.estMonthlyRevenueMax, c.currency)}
      </div>
      <div className="text-xs text-zinc-500">
        {c.reviewCount} rec. · ★{c.rating.toFixed(1)}
        {c.bsr > 0 && ` · BSR ${c.bsr.toLocaleString('it-IT')}`}
      </div>

      {/* Badge */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${att.color}`}>
          {att.text}
        </span>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${parity.color}`}
          title={`Mesi per pareggiare il muro: ${c.monthsToParity.toFixed(1)}`}
        >
          {parity.text} (~{Math.round(c.monthsToParity)} mesi)
        </span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${quad.color}`}>
          {quad.text}
        </span>
      </div>

      {/* CTA row */}
      <div className="flex gap-2 mt-auto">
        <a
          href={analysisUrl(keyword, market, c.asin)}
          className="flex-1 block text-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 transition-colors"
        >
          Scegli come bersaglio →
        </a>
        <button
          onClick={() => {
            if (showPanel && viState === 'done') {
              setShowPanel(false)
            } else {
              fetchViability(userRV, arcR)
            }
          }}
          disabled={viState === 'loading'}
          className="rounded-lg border border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50 text-zinc-600 hover:text-indigo-700 text-sm px-3 py-2 transition-colors disabled:opacity-50 shrink-0"
          title="Analisi approfondita: debolezze, mesi al sorpasso, proiezioni"
        >
          {viState === 'loading' ? '…' : showPanel ? '▲' : '↗'}
        </button>
      </div>

      {/* Viability panel (inline) */}
      {showPanel && viState === 'done' && viability && (
        <ViabilityDisplay
          viability={viability}
          userRV={userRV}
          arcR={arcR}
          onRecalc={(rv, arc) => { setUserRV(rv); setArcR(arc); fetchViability(rv, arc) }}
          recalcLoading={false}
        />
      )}
      {viState === 'error' && viError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {viError}
        </p>
      )}
    </div>
  )
}

// ─── Pannello viability ───────────────────────────────────────────────────────

function ViabilityDisplay({
  viability: v,
  userRV,
  arcR,
  onRecalc,
  recalcLoading,
}: {
  viability: TargetViability
  userRV: number
  arcR: number
  onRecalc: (rv: number, arc: number) => void
  recalcLoading: boolean
}) {
  const badge   = verdictBadge(v.verdict)
  const movingStr = v.monthsToParityMoving >= 999 ? '∞' : `${v.monthsToParityMoving.toFixed(1)}`

  const [localRV, setLocalRV]   = useState(userRV)
  const [localArc, setLocalArc] = useState(arcR)

  return (
    <div className="border-t border-zinc-100 pt-3 space-y-3">
      {/* Verdict */}
      <div className={`text-xs font-medium px-3 py-2 rounded-lg ${badge.color}`}>
        <span className="font-bold">{badge.text}</span>
        <span className="ml-1.5 opacity-80">— {v.verdictReason}</span>
      </div>

      {/* Parity metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Metric label="Rec. al traguardo" value={`${v.reviewsToParity}`} />
        <Metric label="Mesi (statico)" value={`${v.monthsToParityStatic.toFixed(1)}`} />
        <Metric label="Mesi (competitor avanza)" value={movingStr} />
        {v.recentReviewVelocity !== null && (
          <Metric
            label="Velocità recente"
            value={`${v.recentReviewVelocity.toFixed(1)} rec/mese`}
            highlight={v.isAccelerating ? 'amber' : undefined}
          />
        )}
      </div>

      {/* Warnings */}
      {v.isAccelerating && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ Il competitor sta accelerando — considera che il muro crescerà
        </div>
      )}
      {v.freshnessAdvantage && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          ✓ Libro datato ({Math.round(v.ageMonths ?? 0)} mesi) — puoi posizionarti come "aggiornato"
        </div>
      )}

      {/* Weaknesses */}
      {v.weaknesses.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-zinc-500 mb-1.5 uppercase tracking-wide">
            Difetti exploitabili ({v.weaknesses.length})
          </p>
          <div className="space-y-1.5">
            {v.weaknesses.map((w, i) => (
              <div key={i} className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${gravitaColor(w.gravita)}`}>
                    {w.gravita}
                  </span>
                  <span className="text-zinc-700 font-medium">{w.difetto}</span>
                  <span className="ml-auto text-zinc-400">×{w.frequenza}</span>
                </div>
                <p className="text-zinc-400 italic mt-0.5">"{w.evidence}"</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {v.weaknesses.length === 0 && (
        <p className="text-xs text-zinc-400 italic">
          Nessuna debolezza chiara emergente dalle recensioni disponibili.
        </p>
      )}

      {/* Assumptions / Ricalcola */}
      <div className="border border-zinc-200 rounded-lg px-3 py-2.5 space-y-2">
        <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Ipotesi</p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span>Rec/mese tue</span>
            <input
              type="number"
              min={1}
              max={50}
              value={localRV}
              onChange={e => setLocalRV(Number(e.target.value))}
              className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span>ARC rec.</span>
            <input
              type="number"
              min={0}
              max={200}
              value={localArc}
              onChange={e => setLocalArc(Number(e.target.value))}
              className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <button
            onClick={() => onRecalc(localRV, localArc)}
            disabled={recalcLoading}
            className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
          >
            {recalcLoading ? 'Ricalcolo…' : 'Ricalcola'}
          </button>
        </div>
        <p className="text-[10px] text-zinc-400">
          Ipotesi attuali: {v.assumptions.userReviewVelocity} rec/mese · ARC {v.assumptions.arcReviews}
        </p>
      </div>
    </div>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: 'amber' }) {
  const valueColor = highlight === 'amber' ? 'text-amber-700' : 'text-zinc-800'
  return (
    <div>
      <span className="text-zinc-400">{label}: </span>
      <span className={`font-semibold ${valueColor}`}>{value}</span>
    </div>
  )
}

// ─── Sezione ASIN manuale ─────────────────────────────────────────────────────

function ManualAsinSection({ keyword, market }: { keyword: string; market: Market }) {
  const [asin, setAsin]         = useState('')
  const [userRV, setUserRV]     = useState(3)
  const [arcR, setArcR]         = useState(0)
  const [viState, setViState]   = useState<ViabilityUiState>('idle')
  const [viability, setViability] = useState<TargetViability | null>(null)
  const [viError, setViError]   = useState<string | null>(null)

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    const cleanAsin = asin.trim().toUpperCase()
    if (!cleanAsin) return
    setViState('loading')
    setViError(null)
    setViability(null)
    try {
      const res = await fetch('/api/target/viability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: cleanAsin, market, keyword, userReviewVelocity: userRV, arcReviews: arcR }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore sconosciuto')
      setViability(json as TargetViability)
      setViState('done')
    } catch (err) {
      setViError(err instanceof Error ? err.message : String(err))
      setViState('error')
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-zinc-800 mb-1">Analizza un ASIN specifico</h2>
      <p className="text-xs text-zinc-400 mb-3">
        Incolla l'ASIN di un competitor dalla SERP per l'analisi viability completa con debolezze.
      </p>
      <form onSubmit={handleAnalyze} className="bg-white rounded-2xl border border-zinc-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={asin}
            onChange={e => setAsin(e.target.value)}
            placeholder="es. B0XXXXXX"
            disabled={viState === 'loading'}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-zinc-50"
          />
          <div className="flex gap-2 items-center text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              Rec/mese
              <input
                type="number" min={1} max={50} value={userRV}
                onChange={e => setUserRV(Number(e.target.value))}
                disabled={viState === 'loading'}
                className="ml-1 w-14 rounded border border-zinc-300 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1">
              ARC
              <input
                type="number" min={0} max={200} value={arcR}
                onChange={e => setArcR(Number(e.target.value))}
                disabled={viState === 'loading'}
                className="ml-1 w-14 rounded border border-zinc-300 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={viState === 'loading' || !asin.trim()}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {viState === 'loading' ? 'Analisi…' : 'Analizza'}
          </button>
        </div>
        {viState === 'loading' && (
          <p className="text-xs text-zinc-400">
            Recupero recensioni e analizzo con AI… (20–45 secondi per ASIN nuovo, molto meno se già in cache)
          </p>
        )}
        {viState === 'error' && viError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {viError}
          </div>
        )}
        {viState === 'done' && viability && asin.trim() && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="font-mono">{asin.trim().toUpperCase()}</span>
            <AmazonLink asin={asin.trim().toUpperCase()} market={market} />
          </div>
        )}
        {viState === 'done' && viability && (
          <ViabilityDisplay
            viability={viability}
            userRV={userRV}
            arcR={arcR}
            onRecalc={(rv, arc) => {
              setUserRV(rv)
              setArcR(arc)
              setViState('loading')
              fetch('/api/target/viability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asin: asin.trim().toUpperCase(), market, keyword, userReviewVelocity: rv, arcReviews: arc }),
              })
                .then(r => r.json())
                .then(json => { setViability(json); setViState('done') })
                .catch(err => { setViError(String(err)); setViState('error') })
            }}
            recalcLoading={false}
          />
        )}
      </form>
    </section>
  )
}

// ─── Cella quadrante ──────────────────────────────────────────────────────────

function QuadrantCell({ label, labelColor, description, candidates, keyword, market, borderClass }: {
  label: string
  labelColor: string
  description: string
  candidates: TargetCandidate[]
  keyword: string
  market: Market
  borderClass: string
}) {
  return (
    <div className={`bg-white p-4 min-h-[140px] ${borderClass}`}>
      <div className="mb-2">
        <span className={`text-xs font-bold ${labelColor}`}>{label}</span>
        <span className="text-[11px] text-zinc-400 ml-1.5">{description}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="text-[11px] text-zinc-300 italic">Nessun libro</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map(c => (
            <CandidateChip key={c.asin} candidate={c} keyword={keyword} market={market} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Chip candidato (per vista quadranti) ─────────────────────────────────────

function CandidateChip({ candidate: c, keyword, market }: {
  candidate: TargetCandidate
  keyword: string
  market: Market
}) {
  return (
    <div className="flex items-center bg-zinc-50 hover:bg-indigo-50 border border-zinc-200 hover:border-indigo-300 rounded-lg transition-colors group">
      <a
        href={analysisUrl(keyword, market, c.asin)}
        title={`${c.title}\n${c.reviewCount} rec · ★${c.rating.toFixed(1)} · ${Math.round(c.monthsToParity)} mesi parità`}
        className="flex items-center gap-1.5 px-2 py-1 min-w-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverUrl(c.asin, c.imageUrl)}
          alt=""
          width={18}
          height={26}
          className="rounded object-cover bg-zinc-100 border border-zinc-200 shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
        />
        <span className="text-[11px] text-zinc-600 max-w-[100px] truncate">{c.title}</span>
      </a>
      <AmazonLink asin={c.asin} market={market} className="pr-1.5 opacity-0 group-hover:opacity-100" />
    </div>
  )
}
