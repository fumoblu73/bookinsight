import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 5

const AUTOCOMPLETE_DOMAIN: Record<string, string> = {
  US: 'completion.amazon.com',
  UK: 'completion.amazon.co.uk',
  DE: 'completion.amazon.de',
  FR: 'completion.amazon.fr',
  IT: 'completion.amazon.it',
  ES: 'completion.amazon.es',
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mid    = searchParams.get('mid') ?? ''
  const prefix = searchParams.get('prefix') ?? ''
  const market = searchParams.get('market') ?? 'US'

  if (!mid || !prefix) {
    return NextResponse.json({ suggestions: [] })
  }

  const domain = AUTOCOMPLETE_DOMAIN[market] ?? 'completion.amazon.com'
  const url =
    `https://${domain}/api/2017/suggestions` +
    `?mid=${encodeURIComponent(mid)}&alias=aps&prefix=${encodeURIComponent(prefix)}&limit=11`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return NextResponse.json({ suggestions: [] })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ suggestions: [] })
  }
}
