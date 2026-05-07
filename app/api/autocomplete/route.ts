import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 5

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mid    = searchParams.get('mid') ?? ''
  const prefix = searchParams.get('prefix') ?? ''

  if (!mid || !prefix) {
    return NextResponse.json({ suggestions: [] })
  }

  const url =
    `https://completion.amazon.com/api/2017/suggestions` +
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
