'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Market, TargetFinderResult, CreditsData } from '@/lib/types'
import { MARKET_BSR_MAX } from '@/lib/target'
import TargetSelector from '@/components/TargetSelector'

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

// ─── Schermata principale ────────────────────────────────────────────────────

type UiState = 'idle' | 'loading' | 'results' | 'error'

export default function TargetFinder() {
  const [keyword, setKeyword] = useState('')
  const [market, setMarket]   = useState<Market>('US')
  const [bsrMax, setBsrMax]   = useState<number>(MARKET_BSR_MAX['US'])
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

  const targetFinderBlocked = credits !== null && credits.available && credits.targetFinderAvailable < 1

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
        body: JSON.stringify({ keyword: keyword.trim(), market, bsrMax }),
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
            credits.targetFinderAvailable === 0
              ? 'bg-red-50 border-red-200'
              : credits.targetFinderAvailable <= 3
              ? 'bg-amber-50 border-amber-200'
              : 'bg-zinc-50 border-zinc-200'
          }`}>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                {/* Analisi complete */}
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
                {/* Scouting Target Finder */}
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
              onChange={e => {
                const m = e.target.value as Market
                setMarket(m)
                setBsrMax(MARKET_BSR_MAX[m])
              }}
              disabled={uiState === 'loading'}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 bg-white"
            >
              {MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-zinc-500 whitespace-nowrap">BSR max</span>
              <input
                type="number"
                min={1}
                value={bsrMax}
                onChange={e => setBsrMax(Number(e.target.value))}
                disabled={uiState === 'loading'}
                className="w-24 rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              disabled={uiState === 'loading' || !keyword.trim() || targetFinderBlocked}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uiState === 'loading' ? 'Analisi…' : 'Trova bersaglio'}
            </button>
          </div>
        </form>

        {/* ── Link analisi diretta ──────────────────────────────────────────── */}
        <div className="text-center">
          <a
            href={
              keyword.trim()
                ? `/analyze?keyword=${encodeURIComponent(keyword.trim())}&market=${market}&skipTarget=1`
                : `/analyze?skipTarget=1`
            }
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
          <TargetSelector
            result={result}
            initialBsrMax={bsrMax}
            keyword={keyword}
            market={market}
            onSelectTarget={(asin) => {
              window.location.href = `/analyze?keyword=${encodeURIComponent(keyword.trim())}&market=${market}&target=${asin}`
            }}
          />
        )}
      </main>
    </div>
  )
}
