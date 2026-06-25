'use client'

import { useState, useEffect } from 'react'
import type { Market, TargetFinderResult, TargetCandidate, TargetViability } from '@/lib/types'
import { PARITY_COMFORTABLE, PARITY_CHALLENGE } from '@/lib/target'
import { amazonProductUrl } from '@/lib/amazon'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coverUrl(asin: string, imageUrl?: string) {
  return imageUrl || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX85_.jpg`
}

function fmtRevenue(min: number, max: number, currency: string) {
  const sym = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'
  return `${sym}${Math.round(min).toLocaleString('it-IT')}–${Math.round(max).toLocaleString('it-IT')}/mese`
}

function fmtBsr(bsr: number): string {
  return bsr > 0 ? bsr.toLocaleString('it-IT') : 'n/d'
}

function parityLabel(months: number): { text: string; color: string } {
  if (months <= PARITY_COMFORTABLE) return { text: 'comodo',  color: 'bg-emerald-100 text-emerald-700' }
  if (months <= PARITY_CHALLENGE)   return { text: 'sfida',   color: 'bg-amber-100 text-amber-700' }
  return                                   { text: 'duro',    color: 'bg-rose-100 text-rose-700' }
}

function attackabilityBadge(a: TargetCandidate['attackability']) {
  if (a === 'ATTACCABILE')             return { text: 'Attaccabile',      color: 'bg-emerald-100 text-emerald-700' }
  if (a === 'ATTACCABILE_SE_PROMOSSO') return { text: 'Promosso',         color: 'bg-amber-100 text-amber-700' }
  return                                      { text: 'Non attaccabile',  color: 'bg-zinc-100 text-zinc-500' }
}

function quadrantLabel(q: TargetCandidate['quadrant']) {
  const map: Record<string, { text: string; color: string }> = {
    IDEALE:            { text: 'Ideale',          color: 'bg-indigo-100 text-indigo-700' },
    TROPPO_DURO:       { text: 'Troppo duro',     color: 'bg-rose-100 text-rose-700' },
    FACILE_BASSA_RESA: { text: 'Bassa resa',      color: 'bg-amber-100 text-amber-700' },
    ANOMALO:           { text: 'Anomalo',          color: 'bg-purple-100 text-purple-700' },
    NON_ATTACCABILE:   { text: 'Non attaccabile', color: 'bg-zinc-100 text-zinc-500' },
    DATI_INSUFFICIENTI:{ text: 'Dati incompleti', color: 'bg-zinc-100 text-zinc-400' },
  }
  return map[q] ?? { text: q, color: 'bg-zinc-100 text-zinc-500' }
}

function verdictBadge(v: TargetViability['verdict']) {
  const map: Record<string, { text: string; color: string }> = {
    BERSAGLIO_VALIDO:        { text: 'Bersaglio valido',    color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
    BATTIBILE_MA_SFIDA:      { text: 'Battibile (sfida)',   color: 'bg-amber-50 text-amber-700 border border-amber-200' },
    BATTIBILE_MA_BASSA_RESA: { text: 'Battibile (bassa resa)', color: 'bg-amber-50 text-amber-700 border border-amber-200' },
    NON_ATTACCABILE:         { text: 'Non attaccabile',     color: 'bg-rose-50 text-rose-700 border border-rose-200' },
    DA_VALUTARE:             { text: 'Da valutare',         color: 'bg-zinc-50 text-zinc-600 border border-zinc-200' },
  }
  return map[v] ?? { text: v, color: 'bg-zinc-50 text-zinc-600 border border-zinc-200' }
}

function gravitaColor(g: 'ALTA' | 'MEDIA' | 'BASSA') {
  if (g === 'ALTA')  return 'bg-rose-100 text-rose-700'
  if (g === 'MEDIA') return 'bg-amber-100 text-amber-700'
  return                    'bg-zinc-100 text-zinc-500'
}

function notAttackableReason(c: TargetCandidate): string {
  if (c.reviewCount > 150) return `${c.reviewCount} recensioni (>150)`
  if (c.attackability === 'NON_PROMOSSO') {
    const reasons: string[] = []
    if (!c.promotionFactors.lowReviewVelocity) reasons.push('muro alto')
    if (!c.promotionFactors.weakRating) reasons.push(`rating ${c.rating.toFixed(1)} > 4.3`)
    if (c.promotionFactors.ratingVeto) reasons.push(`veto rating ${c.rating.toFixed(1)} > 4.8`)
    return reasons.length > 0 ? reasons.join(' · ') : 'non promosso'
  }
  return 'non attaccabile'
}

function AmazonLink({ asin, market, className = '' }: { asin: string; market: Market; className?: string }) {
  return (
    <a
      href={amazonProductUrl(asin, market)}
      target="_blank"
      rel="noopener noreferrer"
      title="Apri su Amazon"
      onClick={e => e.stopPropagation()}
      className={`shrink-0 text-zinc-300 hover:text-zinc-600 transition-colors ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </a>
  )
}

// ─── Ricalcolo lato client con BSR max custom ────────────────────────────────

function clientMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function recalcTargetResult(base: TargetFinderResult, newBsrMax: number): TargetFinderResult {
  const candidates = base.candidates.map(c => ({
    ...c,
    outOfBsrRange: c.bsr > 0 ? c.bsr > newBsrMax : false,
  }))

  const attackableValid = candidates.filter(c =>
    (c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO') &&
    c.dataComplete && !c.outOfBsrRange,
  )

  const revMids = attackableValid.map(c => (c.estMonthlyRevenueMin + c.estMonthlyRevenueMax) / 2)
  const minRev  = revMids.length > 0 ? Math.min(...revMids) : 0
  const maxRev  = revMids.length > 0 ? Math.max(...revMids) : 0
  const medianRevenue = clientMedian(revMids)
  const medianDefense = clientMedian(attackableValid.map(c => c.defenseScore))

  const updated = candidates.map(c => {
    const revMid = (c.estMonthlyRevenueMin + c.estMonthlyRevenueMax) / 2
    const isAttackableValid =
      (c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO') &&
      c.dataComplete && !c.outOfBsrRange

    const sellsScore = (isAttackableValid && maxRev > minRev)
      ? Math.round((revMid - minRev) / (maxRev - minRev) * 100) : 0
    const attractiveness = (sellsScore / 100) * (1 - c.defenseScore / 100)

    let quadrant: TargetCandidate['quadrant']
    if (c.attackability === 'NON_ATTACCABILE' || c.attackability === 'NON_PROMOSSO') {
      quadrant = 'NON_ATTACCABILE'
    } else if (!c.dataComplete || c.outOfBsrRange) {
      quadrant = 'DATI_INSUFFICIENTI'
    } else if (revMid >= medianRevenue && c.defenseScore < medianDefense) {
      quadrant = 'IDEALE'
    } else if (revMid >= medianRevenue && c.defenseScore >= medianDefense) {
      quadrant = 'TROPPO_DURO'
    } else if (revMid < medianRevenue && c.defenseScore < medianDefense) {
      quadrant = 'FACILE_BASSA_RESA'
    } else {
      quadrant = 'ANOMALO'
    }

    let exclusionReason: string | undefined
    if (quadrant === 'DATI_INSUFFICIENTI') {
      const reasons: string[] = []
      if (c.bsr === 0)         reasons.push('BSR non disponibile')
      if (c.outOfBsrRange)     reasons.push('BSR fuori soglia di mercato')
      if (c.ageMonths === null) reasons.push('Età sconosciuta')
      exclusionReason = reasons.join(' · ') || undefined
    }

    return { ...c, sellsScore, attractiveness, quadrant, exclusionReason }
  })

  let suggested = updated
    .filter(c => c.quadrant === 'IDEALE')
    .sort((a, b) => b.attractiveness - a.attractiveness)
    .slice(0, 3)

  if (suggested.length < 3) {
    const fallbacks = updated
      .filter(c => c.quadrant === 'FACILE_BASSA_RESA')
      .sort((a, b) => b.attractiveness - a.attractiveness)
      .slice(0, 3 - suggested.length)
    suggested = [...suggested, ...fallbacks]
  }

  const sortedCandidates = [...updated].sort((a, b) => {
    const aAtt = a.attackability === 'ATTACCABILE' || a.attackability === 'ATTACCABILE_SE_PROMOSSO'
    const bAtt = b.attackability === 'ATTACCABILE' || b.attackability === 'ATTACCABILE_SE_PROMOSSO'
    if (aAtt && !bAtt) return -1
    if (!aAtt && bAtt) return 1
    return b.attractiveness - a.attractiveness
  })

  return { ...base, candidates: sortedCandidates, suggested, medians: { revenue: medianRevenue, defense: medianDefense } }
}

// ─── TargetSelector ───────────────────────────────────────────────────────────

export default function TargetSelector({
  result,
  initialBsrMax,
  keyword,
  market,
  onSelectTarget,
}: {
  result: TargetFinderResult
  initialBsrMax: number
  keyword: string
  market: Market
  onSelectTarget: (asin: string) => void
}) {
  const [displayResult, setDisplayResult] = useState<TargetFinderResult>(result)
  const [localBsrMax, setLocalBsrMax]     = useState<number>(initialBsrMax)
  const [recalcInput, setRecalcInput]     = useState<number>(initialBsrMax)

  // reset when a new result arrives (new search)
  useEffect(() => {
    setDisplayResult(result)
    setLocalBsrMax(initialBsrMax)
    setRecalcInput(initialBsrMax)
  }, [result, initialBsrMax])

  const { candidates, suggested, nicheReviewVelocity, warning, unknownFormatCount } =
    displayResult

  const [interpretation, setInterpretation] = useState<string | null>(null)
  const [interpretationLoading, setInterpretationLoading] = useState(true)
  const [interpretationError, setInterpretationError] = useState<string | null>(null)

  useEffect(() => {
    setInterpretationLoading(true)
    setInterpretationError(null)
    setInterpretation(null)

    const att = result.candidates.filter(c => c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO')
    const nonAtt = result.candidates.filter(c => c.attackability === 'NON_ATTACCABILE' || c.attackability === 'NON_PROMOSSO')
    const excluded = att.filter(c => c.quadrant === 'DATI_INSUFFICIENTI')

    const summary = {
      totalCandidates: result.candidates.length,
      attackableCount: att.length,
      suggestedCount: result.suggested.length,
      quadrantCounts: {
        IDEALE:            att.filter(c => c.quadrant === 'IDEALE').length,
        TROPPO_DURO:       att.filter(c => c.quadrant === 'TROPPO_DURO').length,
        FACILE_BASSA_RESA: att.filter(c => c.quadrant === 'FACILE_BASSA_RESA').length,
        ANOMALO:           att.filter(c => c.quadrant === 'ANOMALO').length,
      },
      nonAttackableCount: nonAtt.length,
      nonAttackableReasons: {
        over150Reviews: nonAtt.filter(c => c.reviewCount > 150).length,
        nonPromosso:    nonAtt.filter(c => c.attackability === 'NON_PROMOSSO').length,
      },
      excludedFromQuadrantsCount: excluded.length,
      excludedReasons: {
        bsrZero:      excluded.filter(c => c.bsr === 0).length,
        outOfBsrRange: excluded.filter(c => c.outOfBsrRange).length,
        ageUnknown:   excluded.filter(c => c.ageMonths === null).length,
      },
      unknownFormatCount: result.unknownFormatCount ?? 0,
      nicheReviewVelocity: result.nicheReviewVelocity,
      warnings: result.warning ? result.warning.split(' | ') : [],
    }

    let cancelled = false

    fetch('/api/target/interpretation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: result.keyword, market: result.market, resultSummary: summary }),
    })
      .then(r => r.json())
      .then((json: { interpretation?: string; error?: string }) => {
        if (cancelled) return
        if (json.error) throw new Error(json.error)
        setInterpretation(json.interpretation ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setInterpretationError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (!cancelled) setInterpretationLoading(false) })

    return () => { cancelled = true }
  }, [result])

  const attackable    = candidates.filter(c => c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO')
  const nonAttackable = candidates.filter(c => c.attackability === 'NON_ATTACCABILE' || c.attackability === 'NON_PROMOSSO')

  const byQuadrant = (q: TargetCandidate['quadrant']) =>
    attackable.filter(c => c.quadrant === q)

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-zinc-700">
          &quot;{keyword}&quot; · {market}
        </span>
        <span className="text-xs text-zinc-400">
          Velocità nicchia ~{nicheReviewVelocity.toFixed(1)} rec/mese ·{' '}
          {candidates.length} libri analizzati
        </span>
        {warning && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
            ⚠ {warning}
          </span>
        )}
        {unknownFormatCount != null && unknownFormatCount > 0 && (
          <span className="text-xs text-zinc-500 bg-zinc-100 border border-zinc-200 rounded-full px-2.5 py-0.5">
            {unknownFormatCount} {unknownFormatCount === 1 ? 'libro escluso' : 'libri esclusi'} per formato non identificabile (possibili hardcover o dati incompleti)
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-zinc-400 whitespace-nowrap">BSR max</span>
          <input
            type="number"
            min={1}
            value={recalcInput}
            onChange={e => setRecalcInput(Number(e.target.value))}
            className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={() => {
              const updated = recalcTargetResult(result, recalcInput)
              setDisplayResult(updated)
              setLocalBsrMax(recalcInput)
            }}
            disabled={recalcInput === localBsrMax}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-zinc-300 disabled:cursor-default transition-colors whitespace-nowrap"
          >
            Ricalcola
          </button>
        </div>
      </div>

      {/* ── Interpretazione AI ──────────────────────────────────────────── */}
      <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">📊</span>
          <h2 className="text-sm font-semibold text-amber-900">Lettura del risultato</h2>
          {interpretationLoading && (
            <span className="ml-auto text-[11px] text-amber-400 animate-pulse">Analisi in corso…</span>
          )}
        </div>
        {interpretationLoading && (
          <div className="space-y-2">
            <div className="h-3.5 bg-amber-100 rounded animate-pulse w-full" />
            <div className="h-3.5 bg-amber-100 rounded animate-pulse w-11/12" />
            <div className="h-3.5 bg-amber-100 rounded animate-pulse w-full" />
            <div className="h-3.5 bg-amber-100 rounded animate-pulse w-4/5" />
            <div className="h-3.5 bg-amber-100 rounded animate-pulse w-full" />
            <div className="h-3.5 bg-amber-100 rounded animate-pulse w-3/4" />
          </div>
        )}
        {interpretationError && !interpretationLoading && (
          <p className="text-xs text-rose-600">Impossibile generare l&apos;interpretazione: {interpretationError}</p>
        )}
        {interpretation && !interpretationLoading && (
          <p className="text-sm text-amber-950 leading-relaxed whitespace-pre-line">{interpretation}</p>
        )}
      </section>

      {/* ── 1. Bersagli suggeriti ────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-zinc-800 mb-3">Bersagli suggeriti</h2>
        {suggested.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-700">
            Nessun bersaglio suggerito. Prova una keyword diversa o analizza manualmente un ASIN.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suggested.map((c, i) => (
              <SuggestedCard key={c.asin} candidate={c} rank={i + 1} keyword={keyword} market={market} onSelectTarget={onSelectTarget} />
            ))}
          </div>
        )}
      </section>

      {/* ── 2. Vista quadranti ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-zinc-800 mb-1">Tutti i candidati — quadranti</h2>
        <p className="text-xs text-zinc-400 mb-3">
          Asse orizzontale: ricavo mensile stimato · Asse verticale: facilità di attacco
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-2xl overflow-hidden border border-zinc-200">
          <QuadrantCell
            label="IDEALE" labelColor="text-indigo-700"
            description="Alta resa · Poco difeso"
            candidates={byQuadrant('IDEALE')}
            keyword={keyword} market={market}
            onSelectTarget={onSelectTarget}
            borderClass="border-b border-r border-zinc-200"
          />
          <QuadrantCell
            label="TROPPO DURO" labelColor="text-rose-700"
            description="Alta resa · Ben difeso"
            candidates={byQuadrant('TROPPO_DURO')}
            keyword={keyword} market={market}
            onSelectTarget={onSelectTarget}
            borderClass="border-b border-zinc-200"
          />
          <QuadrantCell
            label="BASSA RESA" labelColor="text-amber-700"
            description="Bassa resa · Poco difeso"
            candidates={byQuadrant('FACILE_BASSA_RESA')}
            keyword={keyword} market={market}
            onSelectTarget={onSelectTarget}
            borderClass="border-r border-zinc-200"
          />
          <QuadrantCell
            label="ANOMALO" labelColor="text-purple-700"
            description="Bassa resa · Ben difeso"
            candidates={byQuadrant('ANOMALO')}
            keyword={keyword} market={market}
            onSelectTarget={onSelectTarget}
            borderClass=""
          />
        </div>
        {attackable.filter(c => c.quadrant === 'DATI_INSUFFICIENTI').length > 0 && (
          <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-xs font-medium text-zinc-500 mb-1.5">Esclusi dai quadranti</p>
            <div className="flex flex-wrap gap-2">
              {attackable.filter(c => c.quadrant === 'DATI_INSUFFICIENTI').map(c => (
                <CandidateChip key={c.asin} candidate={c} keyword={keyword} market={market} onSelectTarget={onSelectTarget} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 3. ASIN manuale ─────────────────────────────────────────────── */}
      <ManualAsinSection keyword={keyword} market={market} />

      {/* ── 4. Non attaccabili ──────────────────────────────────────────── */}
      {nonAttackable.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-zinc-800 mb-3">Non attaccabili</h2>
          <div className="rounded-2xl border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {nonAttackable.map(c => (
              <div key={c.asin} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-zinc-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverUrl(c.asin, c.imageUrl)}
                  alt=""
                  width={24}
                  height={34}
                  className="rounded shrink-0 object-cover bg-zinc-100 border border-zinc-200 opacity-40"
                  onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-600 line-clamp-1">{c.title}</p>
                  <p className="text-sm text-zinc-700 font-medium mt-0.5">
                    {c.estMonthlyRevenueMin === 0 && c.estMonthlyRevenueMax === 0
                      ? 'Stima non disponibile'
                      : `Vende ~${fmtRevenue(c.estMonthlyRevenueMin, c.estMonthlyRevenueMax, c.currency)}`}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    BSR: {fmtBsr(c.bsr)} · {c.reviewCount} rec. · ★{c.rating.toFixed(1)} · {notAttackableReason(c)}
                  </p>
                </div>
                <AmazonLink asin={c.asin} market={market} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Card bersaglio suggerito ─────────────────────────────────────────────────

type ViabilityUiState = 'idle' | 'loading' | 'done' | 'error'

function SuggestedCard({ candidate: c, rank, keyword, market, onSelectTarget }: {
  candidate: TargetCandidate
  rank: number
  keyword: string
  market: Market
  onSelectTarget: (asin: string) => void
}) {
  const att    = attackabilityBadge(c.attackability)
  const parity = parityLabel(c.monthsToParity)
  const quad   = quadrantLabel(c.quadrant)

  const [viState, setViState]   = useState<ViabilityUiState>('idle')
  const [viability, setViability] = useState<TargetViability | null>(null)
  const [viError, setViError]   = useState<string | null>(null)
  const [userRV, setUserRV]     = useState(3)
  const [arcR, setArcR]         = useState(0)
  const [showPanel, setShowPanel] = useState(false)

  async function fetchViability(rv: number, arc: number) {
    setViState('loading')
    setViError(null)
    try {
      const res = await fetch('/api/target/viability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: c.asin, market, keyword, userReviewVelocity: rv, arcReviews: arc }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore sconosciuto')
      setViability(json as TargetViability)
      setViState('done')
      setShowPanel(true)
    } catch (err) {
      setViError(err instanceof Error ? err.message : String(err))
      setViState('error')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
          {rank}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverUrl(c.asin, c.imageUrl)}
          alt=""
          width={36}
          height={52}
          className="rounded shrink-0 object-cover bg-zinc-100 border border-zinc-200"
          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800 line-clamp-2 leading-snug">{c.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[11px] font-mono text-zinc-400">{c.asin}</p>
            <AmazonLink asin={c.asin} market={market} />
          </div>
        </div>
      </div>

      {/* Metriche */}
      <div className="text-sm text-zinc-700 font-medium">
        Vende ~{fmtRevenue(c.estMonthlyRevenueMin, c.estMonthlyRevenueMax, c.currency)}
      </div>
      <div className="text-xs text-zinc-500">
        BSR: {fmtBsr(c.bsr)} · {c.reviewCount} rec. · ★{c.rating.toFixed(1)}
      </div>

      {/* Badge */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${att.color}`}>
          {att.text}
        </span>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${parity.color}`}
          title={`Mesi per pareggiare il muro: ${c.monthsToParity.toFixed(1)}`}
        >
          {parity.text} (~{Math.round(c.monthsToParity)} mesi)
        </span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${quad.color}`}>
          {quad.text}
        </span>
      </div>

      {/* CTA row */}
      <div className="flex gap-2 mt-auto">
        <button
          type="button"
          onClick={() => onSelectTarget(c.asin)}
          className="flex-1 block text-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 transition-colors"
        >
          Scegli come bersaglio →
        </button>
        <button
          onClick={() => {
            if (showPanel && viState === 'done') {
              setShowPanel(false)
            } else {
              fetchViability(userRV, arcR)
            }
          }}
          disabled={viState === 'loading'}
          className="rounded-lg border border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50 text-zinc-600 hover:text-indigo-700 text-sm px-3 py-2 transition-colors disabled:opacity-50 shrink-0"
          title="Analisi approfondita: debolezze, mesi al sorpasso, proiezioni"
        >
          {viState === 'loading' ? '…' : showPanel ? '▲' : '↗'}
        </button>
      </div>

      {/* Viability panel (inline) */}
      {showPanel && viState === 'done' && viability && (
        <ViabilityDisplay
          viability={viability}
          userRV={userRV}
          arcR={arcR}
          onRecalc={(rv, arc) => { setUserRV(rv); setArcR(arc); fetchViability(rv, arc) }}
          recalcLoading={false}
        />
      )}
      {viState === 'error' && viError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {viError}
        </p>
      )}
    </div>
  )
}

// ─── Pannello viability ───────────────────────────────────────────────────────

function ViabilityDisplay({
  viability: v,
  userRV,
  arcR,
  onRecalc,
  recalcLoading,
}: {
  viability: TargetViability
  userRV: number
  arcR: number
  onRecalc: (rv: number, arc: number) => void
  recalcLoading: boolean
}) {
  const badge   = verdictBadge(v.verdict)
  const movingStr = v.monthsToParityMoving >= 999 ? '∞' : `${v.monthsToParityMoving.toFixed(1)}`

  const [localRV, setLocalRV]   = useState(userRV)
  const [localArc, setLocalArc] = useState(arcR)

  return (
    <div className="border-t border-zinc-100 pt-3 space-y-3">
      {/* Verdict */}
      <div className={`text-xs font-medium px-3 py-2 rounded-lg ${badge.color}`}>
        <span className="font-bold">{badge.text}</span>
        <span className="ml-1.5 opacity-80">— {v.verdictReason}</span>
      </div>

      {/* Parity metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Metric label="Rec. al traguardo" value={`${v.reviewsToParity}`} />
        <Metric label="Mesi (statico)" value={`${v.monthsToParityStatic.toFixed(1)}`} />
        <Metric label="Mesi (competitor avanza)" value={movingStr} />
        {v.recentReviewVelocity !== null && (
          <Metric
            label="Velocità recente"
            value={`${v.recentReviewVelocity.toFixed(1)} rec/mese`}
            highlight={v.isAccelerating ? 'amber' : undefined}
          />
        )}
      </div>

      {/* Warnings */}
      {v.isAccelerating && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ Il competitor sta accelerando — considera che il muro crescerà
        </div>
      )}
      {v.freshnessAdvantage && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          ✓ Libro datato ({Math.round(v.ageMonths ?? 0)} mesi) — puoi posizionarti come &quot;aggiornato&quot;
        </div>
      )}

      {/* Weaknesses */}
      {v.weaknesses.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-zinc-500 mb-1.5 uppercase tracking-wide">
            Difetti exploitabili ({v.weaknesses.length})
          </p>
          <div className="space-y-1.5">
            {v.weaknesses.map((w, i) => (
              <div key={i} className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${gravitaColor(w.gravita)}`}>
                    {w.gravita}
                  </span>
                  <span className="text-zinc-700 font-medium">{w.difetto}</span>
                  <span className="ml-auto text-zinc-400">×{w.frequenza}</span>
                </div>
                <p className="text-zinc-400 italic mt-0.5">&quot;{w.evidence}&quot;</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {v.weaknesses.length === 0 && (
        <p className="text-xs text-zinc-400 italic">
          Nessuna debolezza chiara emergente dalle recensioni disponibili.
        </p>
      )}

      {/* Assumptions / Ricalcola */}
      <div className="border border-zinc-200 rounded-lg px-3 py-2.5 space-y-2">
        <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Ipotesi</p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span>Rec/mese tue</span>
            <input
              type="number"
              min={1}
              max={50}
              value={localRV}
              onChange={e => setLocalRV(Number(e.target.value))}
              className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span>ARC rec.</span>
            <input
              type="number"
              min={0}
              max={200}
              value={localArc}
              onChange={e => setLocalArc(Number(e.target.value))}
              className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <button
            onClick={() => onRecalc(localRV, localArc)}
            disabled={recalcLoading}
            className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
          >
            {recalcLoading ? 'Ricalcolo…' : 'Ricalcola'}
          </button>
        </div>
        <p className="text-[10px] text-zinc-400">
          Ipotesi attuali: {v.assumptions.userReviewVelocity} rec/mese · ARC {v.assumptions.arcReviews}
        </p>
      </div>
    </div>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: 'amber' }) {
  const valueColor = highlight === 'amber' ? 'text-amber-700' : 'text-zinc-800'
  return (
    <div>
      <span className="text-zinc-400">{label}: </span>
      <span className={`font-semibold ${valueColor}`}>{value}</span>
    </div>
  )
}

// ─── Sezione ASIN manuale ─────────────────────────────────────────────────────

function ManualAsinSection({ keyword, market }: { keyword: string; market: Market }) {
  const [asin, setAsin]         = useState('')
  const [userRV, setUserRV]     = useState(3)
  const [arcR, setArcR]         = useState(0)
  const [viState, setViState]   = useState<ViabilityUiState>('idle')
  const [viability, setViability] = useState<TargetViability | null>(null)
  const [viError, setViError]   = useState<string | null>(null)

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    const cleanAsin = asin.trim().toUpperCase()
    if (!cleanAsin) return
    setViState('loading')
    setViError(null)
    setViability(null)
    try {
      const res = await fetch('/api/target/viability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: cleanAsin, market, keyword, userReviewVelocity: userRV, arcReviews: arcR }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore sconosciuto')
      setViability(json as TargetViability)
      setViState('done')
    } catch (err) {
      setViError(err instanceof Error ? err.message : String(err))
      setViState('error')
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-zinc-800 mb-1">Analizza un ASIN specifico</h2>
      <p className="text-xs text-zinc-400 mb-3">
        Incolla l&apos;ASIN di un competitor dalla SERP per l&apos;analisi fattibilità completa con debolezze.
      </p>
      <form onSubmit={handleAnalyze} className="bg-white rounded-2xl border border-zinc-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={asin}
            onChange={e => setAsin(e.target.value)}
            placeholder="es. B0XXXXXX"
            disabled={viState === 'loading'}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-zinc-50"
          />
          <div className="flex gap-2 items-center text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              Rec/mese
              <input
                type="number" min={1} max={50} value={userRV}
                onChange={e => setUserRV(Number(e.target.value))}
                disabled={viState === 'loading'}
                className="ml-1 w-14 rounded border border-zinc-300 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1">
              ARC
              <input
                type="number" min={0} max={200} value={arcR}
                onChange={e => setArcR(Number(e.target.value))}
                disabled={viState === 'loading'}
                className="ml-1 w-14 rounded border border-zinc-300 px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={viState === 'loading' || !asin.trim()}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {viState === 'loading' ? 'Analisi…' : 'Analizza'}
          </button>
        </div>
        {viState === 'loading' && (
          <p className="text-xs text-zinc-400">
            Recupero recensioni e analizzo con AI… (20–45 secondi per ASIN nuovo, molto meno se già in cache)
          </p>
        )}
        {viState === 'error' && viError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {viError}
          </div>
        )}
        {viState === 'done' && viability && asin.trim() && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="font-mono">{asin.trim().toUpperCase()}</span>
            <AmazonLink asin={asin.trim().toUpperCase()} market={market} />
          </div>
        )}
        {viState === 'done' && viability && (
          <ViabilityDisplay
            viability={viability}
            userRV={userRV}
            arcR={arcR}
            onRecalc={(rv, arc) => {
              setUserRV(rv)
              setArcR(arc)
              setViState('loading')
              fetch('/api/target/viability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asin: asin.trim().toUpperCase(), market, keyword, userReviewVelocity: rv, arcReviews: arc }),
              })
                .then(r => r.json())
                .then(json => { setViability(json); setViState('done') })
                .catch(err => { setViError(String(err)); setViState('error') })
            }}
            recalcLoading={false}
          />
        )}
      </form>
    </section>
  )
}

// ─── Cella quadrante ──────────────────────────────────────────────────────────

function QuadrantCell({ label, labelColor, description, candidates, keyword, market, onSelectTarget, borderClass }: {
  label: string
  labelColor: string
  description: string
  candidates: TargetCandidate[]
  keyword: string
  market: Market
  onSelectTarget: (asin: string) => void
  borderClass: string
}) {
  return (
    <div className={`bg-white p-4 min-h-[140px] ${borderClass}`}>
      <div className="mb-2">
        <span className={`text-xs font-bold ${labelColor}`}>{label}</span>
        <span className="text-[11px] text-zinc-400 ml-1.5">{description}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="text-[11px] text-zinc-300 italic">Nessun libro</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {candidates.map(c => (
            <CandidateChip key={c.asin} candidate={c} keyword={keyword} market={market} onSelectTarget={onSelectTarget} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Chip candidato (per vista quadranti) ─────────────────────────────────────

function CandidateChip({ candidate: c, keyword: _keyword, market, onSelectTarget }: {
  candidate: TargetCandidate
  keyword: string
  market: Market
  onSelectTarget: (asin: string) => void
}) {
  return (
    <div className="flex items-center bg-zinc-50 hover:bg-indigo-50 border border-zinc-200 hover:border-indigo-300 rounded-lg transition-colors group">
      <button
        type="button"
        onClick={() => onSelectTarget(c.asin)}
        title={`${c.title}\nBSR: ${fmtBsr(c.bsr)} · ${c.reviewCount} rec · ★${c.rating.toFixed(1)} · ${Math.round(c.monthsToParity)} mesi parità`}
        className="flex items-center gap-1.5 px-2 py-1 min-w-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverUrl(c.asin, c.imageUrl)}
          alt=""
          width={18}
          height={26}
          className="rounded object-cover bg-zinc-100 border border-zinc-200 shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
        />
        <div className="min-w-0">
          <span className="text-[11px] text-zinc-600 max-w-[100px] truncate block leading-tight">{c.title}</span>
          <span className="text-[10px] text-zinc-500 font-medium block">
            {c.estMonthlyRevenueMin === 0 && c.estMonthlyRevenueMax === 0
              ? 'Stima n/d'
              : `~${fmtRevenue(c.estMonthlyRevenueMin, c.estMonthlyRevenueMax, c.currency)}`}
          </span>
          <span className="text-[10px] text-zinc-400 block">BSR: {fmtBsr(c.bsr)} · {c.reviewCount} rec.</span>
          {c.exclusionReason && (
            <span className="text-[10px] text-zinc-400 italic block">{c.exclusionReason}</span>
          )}
        </div>
      </button>
      <AmazonLink asin={c.asin} market={market} className="pr-1.5 opacity-0 group-hover:opacity-100" />
    </div>
  )
}
