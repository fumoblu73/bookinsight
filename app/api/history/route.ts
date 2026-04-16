import { NextResponse } from 'next/server'
import { listReports } from '@/lib/upstash'

export const maxDuration = 10

export async function GET() {
  try {
    const reports = await listReports(20)
    return NextResponse.json(reports)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
