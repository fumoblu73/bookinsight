import Link from 'next/link'

interface ReportSummary {
  id: string
  keyword: string
  market: string
  createdAt: string
  status: string
  profitabilityScore?: number
}

async function fetchHistory(): Promise<ReportSummary[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    const res = await fetch(`${base}/api/history`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'complete':        return { label: 'Completo',  cls: 'bg-green-100 text-green-700' }
    case 'partial_gap':     return { label: 'Parziale',  cls: 'bg-yellow-100 text-yellow-700' }
    case 'partial_trends':  return { label: 'Parziale',  cls: 'bg-yellow-100 text-yellow-700' }
    case 'partial_reddit':  return { label: 'Parziale',  cls: 'bg-yellow-100 text-yellow-700' }
    case 'failed':          return { label: 'Fallito',   cls: 'bg-red-100 text-red-700' }
    default:                return { label: status,      cls: 'bg-zinc-100 text-zinc-600' }
  }
}

function scoreColor(score?: number) {
  if (score === undefined) return 'text-zinc-400'
  if (score >= 70) return 'text-green-600 font-bold'
  if (score >= 45) return 'text-yellow-600 font-bold'
  return 'text-red-600 font-bold'
}

export default async function HistoryPage() {
  const reports = await fetchHistory()

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">BookInsight</h1>
            <p className="text-xs text-zinc-500">Storico analisi</p>
          </div>
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            Nuova analisi
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-zinc-900 mb-6">Storico Report</h2>

        {reports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center">
            <p className="text-zinc-500 mb-4">Nessun report ancora generato.</p>
            <Link href="/" className="inline-block rounded-lg bg-indigo-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-indigo-700 transition-colors">
              Inizia la prima analisi
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map(r => {
              const badge = statusBadge(r.status)
              const date  = new Date(r.createdAt).toLocaleString('it-IT', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })
              return (
                <Link
                  key={r.id}
                  href={`/report/${r.id}`}
                  className="block bg-white rounded-xl border border-zinc-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-zinc-900 truncate">{r.keyword}</span>
                        <span className="text-xs font-medium text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">
                          {r.market}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">{date}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {r.profitabilityScore !== undefined && (
                        <div className="text-right">
                          <p className={`text-lg ${scoreColor(r.profitabilityScore)}`}>
                            {r.profitabilityScore}
                            <span className="text-xs font-normal text-zinc-400">/100</span>
                          </p>
                          <p className="text-xs text-zinc-400">Score</p>
                        </div>
                      )}
                      <svg className="w-5 h-5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
