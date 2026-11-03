#!/usr/bin/env node
// Confronto fra modelli per il filtro di utilità dei commenti YouTube. NON usato in produzione.
//
// Legge i commenti YouTube da un report BookInsight esportato (voice_data.youtube),
// li fa giudicare a ciascun modello con lo stesso prompt e lo stesso schema JSON di
// lib/youtube-usefulness.ts, e confronta i risultati.
//
// Uso (dalla root del repository, dopo `npm ci`):
//   ANTHROPIC_API_KEY=... node scripts/probe/compare-usefulness.mjs <report.json>
// Opzionale: COMPARE_MODELS=claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5 (ripetibili)
//
// Output:
//   terminale: conteggi, accordo fra modelli, tempi, token e costo stimato (nessun testo)
//   .probe-raw/compare-usefulness.md: i commenti su cui i modelli non sono d'accordo
//   (cartella esclusa da git: contiene testi di commenti pubblici; cancellarla dopo l'uso)

import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_TEXT_CHARS = 300
// Prezzi per milione di token (input, output), da documentazione Anthropic al 2026-10.
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.10, 0.50],
}

// Deve restare identico a buildUsefulnessPrompt in lib/youtube-usefulness.ts
// (verificato da scripts/probe/compare-usefulness.test.mjs).
export function buildUsefulnessPrompt(keyword, comments) {
  const lines = comments.map((c, i) => `c${i + 1}: ${c.text.substring(0, MAX_TEXT_CHARS).replace(/\s+/g, ' ').trim()}`)
  return `These are YouTube comments under videos about "${keyword}". They will be used as voice-of-customer evidence for a non-fiction book on this topic.

Mark a comment as useful when it carries content about the topic: a problem or difficulty, a need or request, a question, a concrete personal experience, an objection or disagreement, an opinion about a method, ingredient, product or approach, or a practical tip.

Mark it as not useful when it is only generic praise or thanks, a greeting, chatter about the creator or the channel, a joke or reaction without content, off-topic, spam or self-promotion, or a reply that only addresses another user without adding content.

When unsure, keep the comment.

Return the ids of the useful comments.

${lines.join('\n')}`
}

async function classify(client, model, keyword, comments) {
  const started = Date.now()
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { useful_ids: { type: 'array', items: { type: 'string' } } },
          required: ['useful_ids'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: buildUsefulnessPrompt(keyword, comments) }],
  })
  const ms = Date.now() - started
  if (response.stop_reason !== 'end_turn') throw new Error(`stop_reason ${response.stop_reason}`)
  const block = response.content.find(b => b.type === 'text')
  const ids = JSON.parse(block.text).useful_ids
  const keep = new Set()
  for (const alias of ids) {
    const m = typeof alias === 'string' ? alias.trim().match(/^c(\d+)$/) : null
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= comments.length) keep.add(Number(m[1]) - 1)
  }
  const [pin, pout] = PRICES[model] ?? [NaN, NaN]
  const cost = (response.usage.input_tokens * pin + response.usage.output_tokens * pout) / 1e6
  return { keep, ms, usage: response.usage, cost }
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('indicare il percorso del report JSON esportato')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY mancante')
  const report = JSON.parse(readFileSync(file, 'utf8'))
  const keyword = report?.meta?.topic ?? ''
  const comments = (report?.voice_data?.youtube?.videos ?? []).flatMap(v => (v.comments ?? []).map(c => ({ text: String(c.text ?? '') })))
  if (comments.length === 0) throw new Error('nessun commento YouTube nel report')
  const models = (process.env.COMPARE_MODELS ?? Object.keys(PRICES).join(',')).split(',').map(s => s.trim()).filter(Boolean)
  const client = new Anthropic({ timeout: 120_000, maxRetries: 1 })

  console.log(`[compare] keyword:"${keyword}" commenti:${comments.length} modelli:${models.join(', ')}`)
  // Lo stesso modello può comparire due volte (es. COMPARE_MODELS=claude-opus-5-5,claude-opus-5-5):
  // l'accordo di un modello con se stesso misura la variabilità di base.
  const results = {}
  const seen = {}
  for (const model of models) {
    seen[model] = (seen[model] ?? 0) + 1
    const label = seen[model] > 1 ? `${model}#${seen[model]}` : model
    try {
      results[label] = await classify(client, model, keyword, comments)
      const r = results[label]
      console.log(`[compare] ${label}: utili ${r.keep.size}/${comments.length} · ${(r.ms / 1000).toFixed(1)} s · ` +
        `token in ${r.usage.input_tokens} out ${r.usage.output_tokens} · costo stimato $${r.cost.toFixed(4)}`)
    } catch (err) {
      console.log(`[compare] ${label}: FALLITO ${err?.message ?? err}`)
    }
  }

  const ok = Object.keys(results)
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const a = results[ok[i]].keep, b = results[ok[j]].keep
      let agree = 0, onlyA = 0, onlyB = 0
      for (let k = 0; k < comments.length; k++) {
        const x = a.has(k), y = b.has(k)
        if (x === y) agree++
        else if (x) onlyA++
        else onlyB++
      }
      console.log(`[compare] accordo ${ok[i]} vs ${ok[j]}: ${(100 * agree / comments.length).toFixed(1)}% ` +
        `(solo ${ok[i]}: ${onlyA}, solo ${ok[j]}: ${onlyB})`)
    }
  }

  const disagreements = comments.map((c, k) => ({ k, c, votes: ok.map(m => results[m].keep.has(k)) }))
    .filter(d => d.votes.some(v => v) && d.votes.some(v => !v))
  const dir = join(process.cwd(), '.probe-raw')
  mkdirSync(dir, { recursive: true })
  const md = [
    `# Disaccordi fra modelli (${disagreements.length} commenti su ${comments.length})`, '',
    `Colonne: ${ok.join(' | ')} (✓ = utile)`, '',
    ...disagreements.map(d => `- ${d.votes.map(v => (v ? '✓' : '✗')).join(' ')} — ${d.c.text.substring(0, 300).replace(/\s+/g, ' ')}`),
  ].join('\n')
  writeFileSync(join(dir, 'compare-usefulness.md'), md + '\n')
  console.log(`[compare] disaccordi: ${disagreements.length} → .probe-raw/compare-usefulness.md`)
}

main().catch(err => {
  console.error(`[compare] errore: ${err?.message ?? err}`)
  process.exit(1)
})
