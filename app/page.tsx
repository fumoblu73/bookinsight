'use client'

import { useState, useCallback } from 'react'
import ReportView from '@/components/ReportView'
import type { FullReport } from '@/components/ReportView'

type Market = 'US' | 'UK' | 'DE' | 'IT' | 'ES'

type Stage =
  | 'idle'
  | 'loading_amazon'
  | 'loading_signals'
  | 'loading_ai'
  | 'done'
  | 'error'

const STAGE_LABELS: Record<Stage, string> = {
  idle: '',
  loading_amazon: 'Raccolta dati Amazon…',
  loading_signals: 'Raccolta segnali (trend + Reddit)…',
  loading_ai: 'Analisi AI in corso… (45–60 s)',
  done: 'Report completato',
  error: 'Errore',
}

const MARKETS: { value: Market; label: string }[] = [
  { value: 'US', label: 'US' },
  { value: 'UK', label: 'UK' },
  { value: 'DE', label: 'DE' },
  { value: 'IT', label: 'IT' },
  { value: 'ES', label: 'ES' },
]

export default function HomePage() {
  const [keyword, setKeyword] = useState('')
  const [market, setMarket] = useState<Market>('US')
  const [stage, setStage] = useState<Stage>('idle')
  const [report, setReport] = useState<FullReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyword.trim()) return

    setReport(null)
    setError(null)
    setStage('loading_amazon')

    try {
      // Step 1a: Amazon data
      const amazonRes = await fetch('/api/amazon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), market }),
      })
      if (!amazonRes.ok) {
        const msg = await amazonRes.text()
        throw new Error(`Amazon API: ${msg}`)
      }
      const amazonData = await amazonRes.json()

      // Step 1b: Trends + Reddit in parallelo
      setStage('loading_signals')
      const [trendsRes, redditRes] = await Promise.all([
        fetch('/api/trends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: keyword.trim(), market }),
        }),
        fetch('/api/reddit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: keyword.trim() }),
        }),
      ])

      const trendsData = trendsRes.ok
        ? await trendsRes.json()
        : { available: false, yoyGrowth: 0, relatedQueries: [] }
      const redditData = redditRes.ok
        ? await redditRes.json()
        : { posts: [] }

      // Step 2: AI analysis
      setStage('loading_ai')
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), market, amazonData, trendsData, redditData }),
      })
      if (!analyzeRes.ok) {
        const msg = await analyzeRes.text()
        throw new Error(`Analisi AI: ${msg}`)
      }
      const result: FullReport = await analyzeRes.json()
      setReport(result)
      setStage('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }, [keyword, market])

  const isLoading = stage === 'loading_amazon' || stage === 'loading_signals' || stage === 'loading_ai'

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 no-print">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">BookInsight</h1>
            <p className="text-xs text-zinc-500">Analisi nicchie Amazon KDP con AI</p>
          </div>
          <a
            href="/history"
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Storico report
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Search form */}
        <div className="no-print">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 mb-8">
            <h2 className="text-lg font-semibold text-zinc-800 mb-4">Analizza una nicchia KDP</h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="es. stoicism for beginners"
                disabled={isLoading}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-zinc-50"
              />
              <select
                value={market}
                onChange={e => setMarket(e.target.value as Market)}
                disabled={isLoading}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 bg-white"
              >
                {MARKETS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isLoading || !keyword.trim()}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Analisi…' : 'Analizza'}
              </button>
            </div>

            {/* Pipeline progress */}
            {isLoading && (
              <div className="mt-4">
                <PipelineProgress stage={stage} />
              </div>
            )}

            {/* Error inline */}
            {stage === 'error' && error && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <strong>Errore:</strong> {error}
              </div>
            )}
          </form>
        </div>

        {/* Report */}
        {report && <ReportView report={report} />}
      </main>
    </div>
  )
}

// ─── Pipeline Progress ─────────────────────────────────────────────────────────

const STEPS: { key: Stage; label: string }[] = [
  { key: 'loading_amazon',  label: 'Dati Amazon' },
  { key: 'loading_signals', label: 'Segnali' },
  { key: 'loading_ai',      label: 'Analisi AI' },
]

function PipelineProgress({ stage }: { stage: Stage }) {
  const activeIdx = STEPS.findIndex(s => s.key === stage)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, i) => {
        const isDone    = activeIdx > i
        const isActive  = activeIdx === i
        const isPending = activeIdx < i

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div className={[
              'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
              isDone    ? 'bg-green-500 text-white' : '',
              isActive  ? 'bg-indigo-600 text-white animate-pulse' : '',
              isPending ? 'bg-zinc-200 text-zinc-400' : '',
            ].join(' ')}>
              {isDone ? '✓' : i + 1}
            </div>
            <span className={`text-xs ${isActive ? 'text-indigo-700 font-medium' : isDone ? 'text-green-600' : 'text-zinc-400'}`}>
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${isDone ? 'bg-green-400' : 'bg-zinc-200'}`} />
            )}
          </div>
        )
      })}
      <span className="ml-2 text-xs text-zinc-500 italic">{STAGE_LABELS[stage]}</span>
    </div>
  )
}
