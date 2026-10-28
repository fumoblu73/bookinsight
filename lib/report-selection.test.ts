import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EvidenceRecord, EvidenceReview } from './evidence-review'
import { summarizeReportSelection } from './report-selection'

const record = (id: string, source: EvidenceRecord['source']): EvidenceRecord => ({
  id, source, text: id, excerpt: id, title: id, identityStatus: 'original',
})
const review: EvidenceReview = {
  version: 'manual-selection-v1',
  painPoints: [
    { id: 'first', pain_point: 'Primo problema', fonte: 'reddit' },
    { id: 'second', pain_point: 'Secondo problema', fonte: 'reddit' },
    { id: 'discarded', pain_point: 'Problema scartato', fonte: 'recensione_negativa' },
  ],
  records: [record('shared', 'reddit'), record('other', 'reddit'), record('amazon', 'amazon'), record('ungrouped', 'youtube')],
  groups: { first: ['shared', 'other'], second: ['shared'], discarded: ['amazon'] },
  processing: { status: 'complete', requested: 4, processedRecordIds: ['shared', 'other', 'amazon', 'ungrouped'] },
  selection: { selectedPainPointIds: ['first', 'second'], records: { first: ['other'], second: ['shared'] }, savedAt: '2026-10-28T18:00:00Z' },
}

test('il riepilogo distingue esclusioni per gruppo, esclusioni globali e testi non raggruppati', () => {
  const result = summarizeReportSelection(review)!
  assert.equal(result.selectedPainPoints, 2)
  assert.equal(result.excludedPainPoints, 1)
  assert.deepEqual(result.painPoints[0].excludedRecordIds, ['shared'])
  assert.deepEqual(result.painPoints[1].selectedRecordIds, ['shared'])
  assert.deepEqual(result.painPoints[2], { id: 'discarded', pain_point: 'Problema scartato', fonte: 'recensione_negativa', selected: false, selectedRecordIds: [], excludedRecordIds: ['amazon'] })
  assert.deepEqual(result.testimonies, { available: 4, selected: 2, unused: 2, ungrouped: 1, bySource: [
    { source: 'reddit', available: 2, selected: 2, unused: 0 },
    { source: 'youtube', available: 1, selected: 0, unused: 1 },
    { source: 'amazon', available: 1, selected: 0, unused: 1 },
  ] })
})

test('una testimonianza mantenuta per più gruppi conta una sola volta nel totale', () => {
  const result = summarizeReportSelection({ ...review, selection: { ...review.selection!, records: { first: ['shared'], second: ['shared'] } } })!
  assert.equal(result.testimonies.selected, 1)
  assert.equal(result.painPoints.filter(p => p.selected).reduce((n, p) => n + p.selectedRecordIds.length, 0), 2)
})

test('report senza selezione salvata non dichiarano una revisione manuale', () => {
  assert.equal(summarizeReportSelection(), null)
  assert.equal(summarizeReportSelection({ ...review, selection: undefined }), null)
})
