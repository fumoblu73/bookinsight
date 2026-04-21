import { NextRequest, NextResponse } from 'next/server'
import { fetchYouTubeData } from '@/lib/youtube'

export const maxDuration = 15

export async function POST(req: NextRequest) {
  try {
    const { keyword } = await req.json() as { keyword: string }
    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
    }
    const data = await fetchYouTubeData(keyword.trim())
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({
      keyword: '', videos: [], totalComments: 0, available: false, insufficientCorpus: true, error: message,
    })
  }
}
