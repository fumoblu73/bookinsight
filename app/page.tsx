'use client'

import { useState, useCallback } from 'react'
import ReportView from '@/components/ReportView'
import type { FullReport } from '@/components/ReportView'

type Market = 'US' | 'UK' | 'DE' | 'IT' | 'ES'

// Ogni stage corrisponde a un evento reale emesso dal server o a una fetch completata
type Stage =
  | 'idle'
  | 'loading_amazon'    // fetch /api/amazon in corso
  | 'loading_signals'   // fetch /api/trends + /api/reddit in corso
  | 'loading_passo0'    // server: passo0 + pain points (stream event: passo0)
  | 'loading_insights'  // server: insights + trend + gap (stream event: insights)
  | 'loading_strategy'  // server: strategy + ROI (stream event: strategy)
  | 'done'
  | 'error'

const STAGE_LABELS: Record<Stage, string> = {
  idle:              '',
  loading_amazon:    'Raccolta dati Amazon…',
  loading_signals:   'Raccolta segnali (trend + Reddit)…',
  loading_passo0:    'Analisi competitor e pain points…',
  loading_insights:  'Analisi insight, trend e gap…',
  loading_strategy:  'Strategia di serie e ROI…',
  done:  'Report completato',
  error: 'Errore',
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
  const [market, setMarket] = useState<Market>('US')
  const [stage, setStage] = useState<Stage>('idle')
  const [report, setReport] = useState<FullReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyword.trim()) return

    const kw = keyword.trim()
    setReport(null)
    setError(null)
    setStage('loading_amazon')

    try {
      // ── Amazon ────────────────────────────────────────────────────────────
      const amazonData = await postJSON('/api/amazon', { keyword: kw, market })

      // ── Segnali: Trends + Reddit in parallelo ─────────────────────────────
      setStage('loading_signals')
      const [trendsData, redditData] = await Promise.all([
        fetch('/api/trends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw, market }),
        }).then(r => r.ok ? r.json() : { available: false, yoyGrowth: 0, relatedQueries: [] }),
        fetch('/api/reddit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: kw }),
        }).then(r => r.ok ? r.json() : { posts: [] }),
      ])

      // ── AI pipeline (streaming) ───────────────────────────────────────────
      // Il server emette un evento JSON per ogni step completato:
      //   {type:'progress', stage:'passo0'}   → passo0+painPoints done
      //   {type:'progress', stage:'insights'} → insights+gap done
      //   {type:'progress', stage:'strategy'} → strategy in corso
      //   {type:'done', report:{...}}          → report completo
      setStage('loading_passo0')

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, market, amazonData, trendsData, redditData }),
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
  }, [keyword, market])

  const isLoading = stage !== 'idle' && stage !== 'done' && stage !== 'error'

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200 no-print">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">BookInsight</h1>
            <p className="text-xs text-zinc-500">Analisi nicchie Amazon KDP con AI</p>
          </div>
          <a href="/history" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            Storico report
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
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

            {isLoading && (
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
        </div>

        {report && <ReportView report={report} />}
      </main>
    </div>
  )
}

// ─── Pipeline Progress ─────────────────────────────────────────────────────────

const STEPS: { key: Stage; label: string }[] = [
  { key: 'loading_amazon',   label: 'Amazon' },
  { key: 'loading_signals',  label: 'Segnali' },
  { key: 'loading_passo0',   label: 'Competitor' },
  { key: 'loading_insights', label: 'Insight & Gap' },
  { key: 'loading_strategy', label: 'Strategia' },
]

function PipelineProgress({ stage }: { stage: Stage }) {
  const activeIdx = STEPS.findIndex(s => s.key === stage)

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((step, i) => {
          const isDone    = activeIdx > i
          const isActive  = activeIdx === i
          const isPending = activeIdx < i

          return (
            <div key={step.key} className="flex items-center gap-1.5">
              <div className={[
                'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                isDone    ? 'bg-green-500 text-white' : '',
                isActive  ? 'bg-indigo-600 text-white animate-pulse' : '',
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
