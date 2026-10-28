import type { EvidenceReview } from './evidence-review'

export const SELECTION_BASIS = 'Le valutazioni successive che usano le testimonianze dei lettori si basano esclusivamente sui pain point e sulle testimonianze mantenuti nella selezione. Gli elementi esclusi e quelli non raggruppati non vengono usati come testimonianze nell’analisi.'
export const MARKET_BASIS = 'Dati di mercato, competitor e trend mantengono la loro base originale e affiancano la selezione nelle valutazioni strategiche.'
export const UNCHANGED_SCORES = 'F/I/S e punteggi dei pain point restano quelli calcolati prima della selezione. Profitability Score, ROI e valutazioni economiche si basano sui dati di mercato e sui parametri economici, senza ricalcolo dovuto alle esclusioni.'

/** Riepilogo delle scelte salvate, senza nuove inferenze o modifiche ai punteggi. */
export function summarizeReportSelection(review?: EvidenceReview) {
  if (!review?.selection) return null
  const catalog = new Map(review.records.map(r => [r.id, r]))
  const selectedPainIds = new Set(review.selection.selectedPainPointIds)
  const groupedIds = new Set(Object.values(review.groups).flat())
  const painPoints = review.painPoints.flatMap(p => {
    if (!p.id) return []
    const proposed = [...new Set(review.groups[p.id] ?? [])].filter(id => catalog.has(id))
    const selected = selectedPainIds.has(p.id)
    const kept = new Set(selected ? review.selection!.records[p.id] ?? [] : [])
    return [{ id: p.id, pain_point: p.pain_point, fonte: p.fonte, selected,
      selectedRecordIds: proposed.filter(id => kept.has(id)),
      excludedRecordIds: proposed.filter(id => !kept.has(id)) }]
  })
  const selectedIds = new Set(painPoints.flatMap(p => p.selectedRecordIds))
  const records = [...catalog.values()]
  const bySource = (['reddit', 'youtube', 'amazon'] as const).map(source => {
    const available = records.filter(r => r.source === source)
    const selected = available.filter(r => selectedIds.has(r.id)).length
    return { source, available: available.length, selected, unused: available.length - selected }
  })
  return {
    mode: review.version,
    statement: SELECTION_BASIS,
    marketBasis: MARKET_BASIS,
    unchangedScores: UNCHANGED_SCORES,
    painPoints,
    selectedPainPoints: painPoints.filter(p => p.selected).length,
    excludedPainPoints: painPoints.filter(p => !p.selected).length,
    testimonies: { available: records.length, selected: selectedIds.size, unused: records.length - selectedIds.size,
      ungrouped: records.filter(r => !groupedIds.has(r.id)).length, bySource },
  }
}
