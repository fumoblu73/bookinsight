import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getReport } from '@/lib/upstash'
import type { LogEntry, AnalysisLog } from '@/lib/types'

function StatusIcon({ status }: { status: LogEntry['status'] }) {
  if (status === 'ok')    return <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold shrink-0">✓</span>
  if (status === 'warn')  return <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">⚠</span>
  return                         <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold shrink-0">✗</span>
}

function StatusBadge({ status }: { status: LogEntry['status'] }) {
  const cls = status === 'ok'
    ? 'bg-green-100 text-green-700'
    : status === 'warn'
    ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  const label = status === 'ok' ? 'OK' : status === 'warn' ? 'WARN' : 'ERROR'
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{label}</span>
}

function DetailValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400">[]</span>
    if (typeof value[0] === 'object' && value[0] !== null) {
      return (
        <div className="space-y-1 mt-1">
          {value.map((item, i) => (
            <div key={i} className="bg-zinc-50 rounded px-2 py-1 text-xs font-mono text-zinc-600">
              {JSON.stringify(item)}
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {value.map((item, i) => (
          <span key={i} className="bg-zinc-100 text-zinc-600 text-xs px-2 py-0.5 rounded font-mono">{String(item)}</span>
        ))}
      </div>
    )
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-indigo-700">{value}</span>
  }
  return <span className="font-mono text-zinc-700 break-all">{String(value ?? '')}</span>
}

function LogCard({ entry }: { entry: LogEntry }) {
  return (
    <div className={`bg-white rounded-xl border ${
      entry.status === 'ok' ? 'border-zinc-200' :
      entry.status === 'warn' ? 'border-amber-200' : 'border-red-200'
    } overflow-hidden`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${
        entry.status === 'ok' ? 'bg-zinc-50' :
        entry.status === 'warn' ? 'bg-amber-50' : 'bg-red-50'
      }`}>
        <StatusIcon status={entry.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-zinc-900 text-sm">{entry.label}</span>
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-sm text-zinc-600 mt-0.5">{entry.summary}</p>
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer px-4 py-2 text-xs text-zinc-400 hover:text-zinc-600 select-none list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          Dettagli
        </summary>
        <div className="px-4 pb-4 space-y-2 border-t border-zinc-100 pt-3">
          {Object.entries(entry.details).map(([key, val]) => (
            <div key={key}>
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{key}</span>
              <div className="mt-0.5 text-sm">
                <DetailValue value={val} />
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function durationLabel(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export default async function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let record
  try {
    record = await getReport(id)
  } catch {
    record = null
  }
  if (!record) notFound()

  const log = record.log as AnalysisLog | undefined

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-zinc-900 truncate">{record.keyword}</h1>
              <span className="text-xs font-medium text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded shrink-0">
                {record.market}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">Log analisi</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link href={`/report/${record.id}`} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
              ← Report
            </Link>
            <Link href="/history" className="text-sm text-zinc-500 hover:text-zinc-700">
              Storico
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {!log ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
            <p className="text-zinc-500 text-sm">Log non disponibile.</p>
            <p className="text-zinc-400 text-xs mt-1">
              Questa analisi è stata eseguita prima che il log fosse introdotto.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
              <div className="text-xs text-zinc-400 space-y-0.5">
                <p>Iniziata: {formatDateTime(log.startedAt)}</p>
                <p>Completata: {formatDateTime(log.completedAt)} · durata {durationLabel(log.startedAt, log.completedAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">{log.entries.length} step</span>
                {log.entries.some(e => e.status === 'error') && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">Errori presenti</span>
                )}
                {!log.entries.some(e => e.status === 'error') && log.entries.some(e => e.status === 'warn') && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">Warning presenti</span>
                )}
                {!log.entries.some(e => e.status !== 'ok') && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">Tutto OK</span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {log.entries.map((entry, i) => (
                <LogCard key={i} entry={entry} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
