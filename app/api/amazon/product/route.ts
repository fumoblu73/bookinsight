import { NextRequest, NextResponse } from 'next/server'
import { fetchSingleProduct } from '@/lib/amazon'
import { Market } from '@/lib/types'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { asin, market } = await req.json() as { asin: string; market: Market }

    if (!asin?.trim() || asin.trim().length !== 10) {
      return NextResponse.json({ error: 'ASIN non valido (deve essere 10 caratteri)' }, { status: 400 })
    }
    if (!['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(market)) {
      return NextResponse.json({ error: 'Mercato non valido' }, { status: 400 })
    }

    const product = await fetchSingleProduct(asin.trim().toUpperCase(), market)
    if (!product) {
      return NextResponse.json({ error: 'Prodotto non trovato o non è un libro' }, { status: 404 })
    }
    return NextResponse.json(product)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
