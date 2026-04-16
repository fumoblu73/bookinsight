import { notFound } from 'next/navigation'
import Link from 'next/link'
import ReportView from '@/components/ReportView'
import type { FullReport } from '@/components/ReportView'
import { getReport } from '@/lib/upstash'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params

  let report: FullReport | null = null
  try {
    const record = await getReport(id)
    if (record?.data) report = record.data as FullReport
  } catch {
    // Redis non disponibile
  }

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
