import { NextRequest, NextResponse } from 'next/server'
import { fetchRedditData } from '@/lib/reddit'

export const maxDuration = 10

export async function POST(req: NextRequest) {
  try {
    const { keyword } = await req.json() as { keyword: string }

    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
    }

    const data = await fetchRedditData(keyword.trim())
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({
      keyword: '',
      posts: [],
      totalComments: 0,
      subredditsUsed: [],
      threadCount: 0,
      available: false,
      insufficientCorpus: true,
      error: message,
    })
  }
}
