import { NextRequest, NextResponse } from 'next/server'
import { Market, TargetFinderResult, RawBook } from '@/lib/types'
import { fetchTargetFinderCandidates, MARKET_CURRENCY } from '@/lib/amazon'
import { buildTargetFinderResult, RawCandidate } from '@/lib/target'
import { cacheGet, cacheSet } from '@/lib/upstash'

export const maxDuration = 60

const CACHE_TTL_SECONDS = 60 * 60 * 24  // 24h

function cacheKey(market: Market, keyword: string): string {
  // v3: aggiunge exclusionReason ai candidati DATI_INSUFFICIENTI
  return `target:v3:${market}:${keyword.toLowerCase().trim()}`
}

function rawBookToCandidate(book: RawBook, market: Market): RawCandidate {
  return {
    asin:          book.asin,
    title:         book.title,
    imageUrl:      book.imageUrl,
    price:         book.price,
    currency:      book.currency ?? MARKET_CURRENCY[market],
    reviewCount:   book.reviewCount,
    rating:        book.rating,
    bsr:           book.bsr,
    pages:         book.pages ?? 0,
    publishedDate: book.publishedDate,
    selfPublished: book.selfPublished,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { keyword, market } = await req.json() as { keyword?: string; market?: Market }

    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword richiesta' }, { status: 400 })
    }
    if (!['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(market ?? '')) {
      return NextResponse.json({ error: 'mercato non valido' }, { status: 400 })
    }

    const kw = keyword.trim()
    const key = cacheKey(market!, kw)

    // Cache hit → 0 crediti SerpApi
    const cached = await cacheGet<TargetFinderResult>(key)
    if (cached) {
      return NextResponse.json({ ...cached, cached: true })
    }

    // Fetch SERP + product details (nessun cap, prima pagina)
    let rawBooks: RawBook[]
    let unknownFormatCount = 0
    try {
      const fetched = await fetchTargetFinderCandidates(kw, market!)
      rawBooks = fetched.books
      unknownFormatCount = fetched.unknownFormatCount
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Nessun risultato')) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw err
    }

    if (rawBooks.length === 0) {
      return NextResponse.json(
        { error: `Keyword troppo specifica: nessun libro trovato per "${kw}" su ${market}` },
        { status: 400 },
      )
    }

    const rawCandidates: RawCandidate[] = rawBooks.map(b => rawBookToCandidate(b, market!))

    const result = buildTargetFinderResult(rawCandidates, kw, market!, new Date().toISOString(), unknownFormatCount)

    // Salva in cache 24h (fire-and-forget, non blocca risposta)
    cacheSet(key, result, CACHE_TTL_SECONDS).catch(() => {})

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
