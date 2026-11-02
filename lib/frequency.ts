import type { EvidenceIndex } from './evidence'
import type { EvidenceRecord, EvidenceRef, EvidenceRelation, EvidenceSource, FrequencyShadow } from './types'

// Frequenza verificabile 9.0.2, modello B candidato (algorithmVersion b-0.1).
// SHADOW: non sostituisce PainPoint.F, non entra in score, ordinamento, soglia 3,0,
// Profitability Score, ROI o verdetto. Funzioni pure, nessun I/O.
//
// Decisioni metodologiche (concordate con l'utente):
// - U: authorKey distinti dei record problem/request (conferme e obiezioni escluse, D4).
// - T: thread distinti di TUTTI i record di M, contestazioni incluse: una
//   discussione in cui il problema è contestato è comunque una discussione sul problema.
// - Conferma valida solo se il genitore è trasmesso (nell'indice, stessa piattaforma)
//   e associato allo stesso pain point con relazione diversa da context
//   (un'altra conferma vale solo se a sua volta valida).
// - D, K e authorKnownRate: sull'intera piattaforma (record trasmessi), dall'indice.

export const FREQUENCY_ALGORITHM_VERSION = 'b-0.1' as const
export const FREQUENCY_LIMITS = { minD: 50, minK: 3, minAuthorKnownRate: 0.9, capSingleThread: 4 } as const

const RELATIONS: readonly EvidenceRelation[] = ['problem', 'request', 'objection', 'contextual_confirmation', 'context']
const CORE: ReadonlySet<EvidenceRelation> = new Set(['problem', 'request'])

/** F_base dalla percentuale di autori: soglie del modello B. */
export function frequencyBase(pct: number): number {
  const bounds = [1, 2, 4, 6, 9, 13, 18, 25, 35]
  const i = bounds.findIndex(b => pct < b)
  return i === -1 ? 10 : i + 1
}

/** F candidato senza cap: min(10, round(F_base + (T-1)/(K-1))). */
export function candidateF(U: number, T: number, D: number, K: number): number {
  const spread = K > 1 ? (T - 1) / (K - 1) : 0
  return Math.min(10, Math.round(frequencyBase((100 * U) / D) + spread))
}

export function computeFrequencyShadow(params: {
  source: EvidenceSource
  refs: EvidenceRef[]
  index: EvidenceIndex
  F_legacy: number
}): FrequencyShadow {
  const { source, refs, index, F_legacy } = params
  const limitations: string[] = []
  const records = new Map<string, EvidenceRecord>()
  for (const r of index.records) if (r.source === source) records.set(r.recordKey, r)

  // Riferimenti validi: record trasmesso della stessa piattaforma e relazione nota.
  const relations = new Map<string, Set<EvidenceRelation>>()
  let invalid = 0
  for (const ref of refs ?? []) {
    if (!ref || !records.has(ref.recordKey) || !RELATIONS.includes(ref.relation)) { invalid++; continue }
    if (!relations.has(ref.recordKey)) relations.set(ref.recordKey, new Set())
    relations.get(ref.recordKey)!.add(ref.relation)
  }
  if (invalid > 0) limitations.push(`invalid_refs:${invalid}`)

  const memo = new Map<string, boolean>()
  const confirmationValid = (key: string, visiting: Set<string>): boolean => {
    if (memo.has(key)) return memo.get(key)!
    if (visiting.has(key)) return false // ciclo
    visiting.add(key)
    const parentKey = records.get(key)?.parentKey
    const parentRel = parentKey ? relations.get(parentKey) : undefined
    let ok = false
    if (parentKey && records.has(parentKey) && parentRel) {
      ok = [...parentRel].some(rel => rel === 'problem' || rel === 'request' || rel === 'objection') ||
        (parentRel.has('contextual_confirmation') && confirmationValid(parentKey, visiting))
    }
    visiting.delete(key)
    memo.set(key, ok)
    return ok
  }

  const core: EvidenceRecord[] = []
  const confirmations: EvidenceRecord[] = []
  const counted: EvidenceRecord[] = [] // M
  let rejectedConfirmations = 0
  for (const [key, rels] of relations) {
    const rec = records.get(key)!
    const isCore = [...rels].some(r => CORE.has(r))
    let validConf = false
    if (rels.has('contextual_confirmation')) {
      validConf = confirmationValid(key, new Set())
      if (!validConf) rejectedConfirmations++
    }
    if (isCore) core.push(rec)
    if (validConf) confirmations.push(rec)
    if (isCore || validConf || rels.has('objection')) counted.push(rec)
  }
  if (rejectedConfirmations > 0) limitations.push(`unverified_confirmations:${rejectedConfirmations}`)

  const authors = (list: EvidenceRecord[]) => new Set(list.map(r => r.authorKey).filter((a): a is string => a !== null))
  const U = authors(core).size
  const U_withConfirmations = authors([...core, ...confirmations]).size
  const T = new Set(counted.map(r => r.threadId)).size
  const M = counted.length
  const M_anon = counted.filter(r => r.authorKey === null).length
  const { D, K, authorKnownRate } = index.stats[source]

  if (U === 0) limitations.push('no_known_authors')
  if (D < FREQUENCY_LIMITS.minD) limitations.push('D_below_50')
  if (K < FREQUENCY_LIMITS.minK) limitations.push('K_below_3')
  if (authorKnownRate === null || authorKnownRate < FREQUENCY_LIMITS.minAuthorKnownRate) {
    limitations.push('author_known_rate_below_0.9')
  }
  const calculable = U > 0 && D >= FREQUENCY_LIMITS.minD && K >= FREQUENCY_LIMITS.minK &&
    authorKnownRate !== null && authorKnownRate >= FREQUENCY_LIMITS.minAuthorKnownRate

  const F_candidate = calculable ? candidateF(U, T, D, K) : null
  const F_candidate_capped = F_candidate === null ? null
    : T === 1 ? Math.min(F_candidate, FREQUENCY_LIMITS.capSingleThread) : F_candidate

  return {
    algorithmVersion: FREQUENCY_ALGORITHM_VERSION,
    status: calculable ? 'ok' : 'not_calculable',
    U, U_withConfirmations, T, M, M_anon, D, K, authorKnownRate,
    F_legacy, F_candidate, F_candidate_capped, calculable, limitations,
  }
}

/** Passata di attribuzione fallita (errore, timeout, JSON troncato): il report prosegue. */
export function failedFrequencyShadow(F_legacy: number, reason: string): FrequencyShadow {
  return {
    algorithmVersion: FREQUENCY_ALGORITHM_VERSION, status: 'failed',
    U: null, U_withConfirmations: null, T: null, M: 0, M_anon: 0, D: null, K: null, authorKnownRate: null,
    F_legacy, F_candidate: null, F_candidate_capped: null, calculable: false, limitations: [`attribution_failed:${reason}`],
  }
}
