import { NextRequest, NextResponse } from 'next/server'
import { fetchAmazonData } from '@/lib/amazon'
import { Market } from '@/lib/types'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { keyword, market, targetAsin } = await req.json() as { keyword: string; market: Market; targetAsin?: string }

    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
    }
    if (!['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(market)) {
      return NextResponse.json({ error: 'mercato non valido' }, { status: 400 })
    }

    const data = await fetchAmazonData(keyword.trim(), market, targetAsin?.trim() || undefined)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
