// Eseguire con: node --test scripts/probe/compare-usefulness.test.mjs
// Garantisce che lo script di confronto usi lo stesso prompt dell'app.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function template(file) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = src.indexOf('`These are YouTube comments')
  const end = src.indexOf('${lines.join', start)
  assert.ok(start > 0 && end > start, `prompt non trovato in ${file}`)
  return src.slice(start, end)
}

test('prompt identico fra lib/youtube-usefulness.ts e lo script di confronto', () => {
  assert.equal(template('./compare-usefulness.mjs'), template('../../lib/youtube-usefulness.ts'))
})
