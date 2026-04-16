import { notFound } from 'next/navigation'
import Link from 'next/link'
import ReportView from '@/components/ReportView'
import type { FullReport } from '@/components/ReportView'

interface Props {
  params: Promise<{ id: string }>
}

async function fetchReport(id: string): Promise<FullReport | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    const res = await fetch(`${base}/api/history/${id}`, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok) return null
    const record = await res.json()
    // The API returns the full ReportRecord; data field holds the FullReport
    return (record.data ?? record) as FullReport
  } catch {
    return null
  }
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params
  const report = await fetchReport(id)

  if (!report) notFound()

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200 no-print">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">BookInsight</h1>
            <p className="text-xs text-zinc-500 truncate max-w-xs">{report.keyword} · {report.market}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/history" className="text-sm text-zinc-500 hover:text-zinc-800">
              Storico
            </Link>
            <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
              Nuova analisi
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <ReportView report={report} />
      </main>
    </div>
  )
}
