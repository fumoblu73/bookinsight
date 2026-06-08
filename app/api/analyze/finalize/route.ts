import { NextRequest, NextResponse } from 'next/server'
import { AnalysisLog } from '@/lib/types'
import { PainPointsIntermediate, runFinalizePhase } from '@/lib/analyze-phases'
import { cacheGet, cacheDel, saveReport, updateReport } from '@/lib/upstash'
import { isAnthropicBillingError } from '@/lib/ai'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  let body: {
    analysisId?: string
    selectedPainPointIds?: string[]
    cpc?: number
    userNotes?: string
    plannedPrice?: number
    plannedPages?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body JSON non valido' }, { status: 400 })
  }

  const { analysisId, selectedPainPointIds, cpc, userNotes, plannedPrice, plannedPages } = body

  if (!analysisId?.trim()) {
    return NextResponse.json({ error: 'analysisId richiesto' }, { status: 400 })
  }
  if (!Array.isArray(selectedPainPointIds)) {
    return NextResponse.json({ error: 'selectedPainPointIds deve essere un array' }, { status: 400 })
  }

  // ── Carica snapshot intermedio da Redis ────────────────────────────────────
  const intermediate = await cacheGet<PainPointsIntermediate>(`analysis:${analysisId}`)
  if (!intermediate) {
    return NextResponse.json(
      { error: 'Analisi scaduta o non trovata. Rilancia da /api/analyze/pain-points.' },
      { status: 410 },
    )
  }

  const startedAt = new Date().toISOString()

  try {
    // ── Crea record parziale su Redis per la History ───────────────────────
    const reportId = await saveReport({
      keyword: intermediate.keyword,
      market: intermediate.market,
      status: 'partial_gap',
    })

    // ── Fase AI: insights + gap + strategy + ROI ───────────────────────────
    const { report: reportData, finalizeLogs } = await runFinalizePhase(
      intermediate,
      selectedPainPointIds,
      { cpc, userNotes, plannedPrice, plannedPages },
    )

    const analysisLog: AnalysisLog = {
      entries: [...intermediate.logEntries, ...finalizeLogs],
      startedAt,
      completedAt: new Date().toISOString(),
    }

    const report = { id: reportId, ...reportData as Record<string, unknown> }

    // ── Salva report definitivo ────────────────────────────────────────────
    const roi = (reportData as Record<string, unknown>).roi as { scenarios: { netProfit12m: number }[] } | undefined
    const scoring = intermediate.scoring

    await updateReport(reportId, {
      status: 'complete',
      profitabilityScore: scoring.score,
      estimatedDailyRevenue: roi ? roi.scenarios[1].netProfit12m / 12 : undefined,
      competitionLevel: scoring.entryDifficulty,
      log: analysisLog,
      data: report,
    })

    // ── Elimina snapshot intermedio (libera spazio) ────────────────────────
    await cacheDel(`analysis:${analysisId}`)

    return NextResponse.json({ report })
  } catch (err) {
    if (isAnthropicBillingError(err)) {
      return NextResponse.json(
        { error: 'Crediti Anthropic esauriti. Ricarica su console.anthropic.com/settings/billing' },
        { status: 402 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
