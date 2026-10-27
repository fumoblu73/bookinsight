import type { AttributionBatch } from './social-attribution'
import type { SocialDiagnostic } from './types'
import { resolveSocialQuote } from './social-quotes'

const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined

/** Valida una decisione intera prima di conservarla. I record validi non vengono riesaminati. */
export function inspectSocialDecisions(batch: AttributionBatch, output: unknown) {
  const raw = object(output)?.decisions
  const issues: { recordId: string; reason: SocialDiagnostic['reason'] }[] = []
  const decisions: { recordId: string; matches: Record<string, unknown>[] }[] = []
  const adjustments: string[] = []
  if (!Array.isArray(raw)) return { decisions, adjustments, issues: batch.records.map(r => ({ recordId: r.recordId, reason: 'missing_decisions' as const })) }
  const allowed = new Set(batch.records.map(r => r.recordId))
  // Non conserva ID estranei restituiti dal modello nel report o nei log.
  if (raw.some(v => !allowed.has(String(object(v)?.recordId)))) issues.push(...batch.records.map(r => ({ recordId: r.recordId, reason: 'unexpected_record' as const })))
  for (const record of batch.records) {
    const matches = raw.filter(v => object(v)?.recordId === record.recordId)
    let reason: SocialDiagnostic['reason'] | undefined
    if (!matches.length) reason = 'missing_record'
    else if (matches.length !== 1) reason = 'duplicate_record'
    const decision = object(matches[0]), values = decision?.matches
    const cleanMatches: Record<string, unknown>[] = []
    let adjusted = false
    if (!reason && !Array.isArray(values)) reason = 'invalid_matches'
    if (!reason) for (const value of values as unknown[]) {
      const m = object(value)
      const resolved = resolveSocialQuote(record.transmittedText, m?.quote)
      if (!m || !batch.painPoints.some(p => p.id === m.painPointId)) reason = 'unknown_pain'
      else if (!['direct', 'confirmation', 'ambiguous'].includes(String(m.supportType))) reason = 'invalid_support'
      else if (!resolved) reason = 'invalid_quote'
      else if (!Array.isArray(m.contextRecordIds) || !m.contextRecordIds.every(id => typeof id === 'string' && (id === batch.context.contextId || batch.contextRecords.some(r => r.recordId === id)))) reason = 'invalid_context'
      if (reason) break
      cleanMatches.push({ ...m, quote: resolved!.quote })
      adjusted ||= resolved!.adjusted
    }
    if (reason) issues.push({ recordId: record.recordId, reason })
    else {
      decisions.push({ recordId: record.recordId, matches: cleanMatches })
      if (adjusted) adjustments.push(record.recordId)
    }
  }
  return { decisions, issues, adjustments }
}
