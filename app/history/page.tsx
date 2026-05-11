import Link from 'next/link'
import { listReports } from '@/lib/upstash'
import type { ReportRecord } from '@/lib/types'
import HistoryTable from './HistoryTable'
import type { HistoryRow } from './HistoryTable'

function extractRow(r: ReportRecord): HistoryRow {
  const data = r.data as {
    scoringBreakdown?: { trendSignal?: string }
  } | null | undefined

  return {
    id: r.id,
    keyword: r.keyword,
    market: r.market,
    score: r.profitabilityScore,
    trendSignal: data?.scoringBreakdown?.trendSignal,
    difficulty: r.competitionLevel,
    monthlyRevenue: r.estimatedDailyRevenue,
    status: r.status,
    createdAt: r.createdAt,
  }
}

export default async function HistoryPage() {
  let reports: ReportRecord[] = []
  try {
    reports = await listReports(50)
  } catch {
    // Redis non disponibile: mostra lista vuota
  }

  const rows: HistoryRow[] = reports.map(extractRow)

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
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-zinc-900">Storico Report</h2>
        </div>
        <HistoryTable rows={rows} />
      </main>
    </div>
  )
}
