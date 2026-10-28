import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import RedditCollectionNotice from './RedditCollectionNotice'
import { newRedditDiagnostics } from '../lib/reddit-collection'

test('legacy e raccolte complete senza problemi restano leggibili senza avvisi aggiuntivi', () => {
  assert.equal(renderToStaticMarkup(<RedditCollectionNotice />), '')
  const d = newRedditDiagnostics(); d.status = 'complete'
  assert.equal(renderToStaticMarkup(<RedditCollectionNotice diagnostics={d} />), '')
})

test('raccolta parziale: recuperi, URL mancanti e ricerche fallite restano distinti dalla pertinenza', () => {
  const d = newRedditDiagnostics(); Object.assign(d, { status: 'partial', selectedUrls: ['one', 'two', 'three'], recoveredUrls: ['one'], unavailableUrls: ['two'], unattemptedUrls: ['three'], budgetExhausted: true })
  d.queries = [{ query: 'topic', kind: 'original', status: 'provider_error', organicResults: 0, redditLinks: 0, recognizedThreads: 0 }]
  const html = renderToStaticMarkup(<RedditCollectionNotice diagnostics={d} />)
  assert.match(html, /Raccolta Reddit parziale/)
  assert.match(html, /Dati recuperati da 1 delle 3/)
  assert.match(html, /secondo tentativo: 1/)
  assert.match(html, /rimaste senza dati: 1/)
  assert.match(html, /non avviate: 1/)
  assert.match(html, /Ricerche non completate: 1/)
  assert.match(html, /pertinenza sono valutate separatamente/)
})
