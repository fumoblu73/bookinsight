import { NextRequest, NextResponse } from 'next/server'
import { getReport, deleteReport } from '@/lib/upstash'

export const maxDuration = 10

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const report = await getReport(id)
    if (!report) {
      return NextResponse.json({ error: 'Report non trovato' }, { status: 404 })
    }
    return NextResponse.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteReport(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
