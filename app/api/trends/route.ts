import { NextRequest, NextResponse } from 'next/server'
import { fetchTrendsData } from '@/lib/trends'

export const maxDuration = 10

export async function POST(req: NextRequest) {
  try {
    const { keyword } = await req.json() as { keyword: string }

    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
    }

    const data = await fetchTrendsData(keyword.trim())
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    // Trends è un errore degradante — restituisce fallback, non 500
    return NextResponse.json({
      keyword: '',
      timelineData: [],
      relatedQueries: [],
      yoyGrowth: 0,
      available: false,
      error: message,
    })
  }
}
