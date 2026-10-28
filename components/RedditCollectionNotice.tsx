import type { RedditCollectionDiagnostics } from '../lib/types'

export default function RedditCollectionNotice({ diagnostics: d }: { diagnostics?: RedditCollectionDiagnostics }) {
  if (!d || (d.status === 'complete' && d.recoveredUrls.length === 0)) return null
  const success = d.selectedUrls.length - d.unavailableUrls.length - d.unattemptedUrls.length
  const searchErrors = d.queries.filter(q => q.status !== 'ok').length
  return <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" aria-label="Stato della raccolta Reddit">
    <p className="font-semibold">{d.status === 'complete' ? 'Raccolta Reddit completata con recupero' : d.status === 'partial' ? 'Raccolta Reddit parziale' : 'Raccolta Reddit non disponibile'}</p>
    <p className="mt-1">Dati recuperati da {success} delle {d.selectedUrls.length} discussioni richieste.</p>
    {d.recoveredUrls.length > 0 && <p>Discussioni recuperate al secondo tentativo: {d.recoveredUrls.length}.</p>}
    {d.unavailableUrls.length > 0 && <p>Discussioni rimaste senza dati: {d.unavailableUrls.length}.</p>}
    {d.unattemptedUrls.length > 0 && <p>Discussioni non avviate: {d.unattemptedUrls.length}.</p>}
    {d.budgetExhausted && <p>Tempo insufficiente per completare tutte le richieste.</p>}
    {searchErrors > 0 && <p>Ricerche non completate: {searchErrors}.</p>}
    {d.attempts.some(a => (a.schema?.unrecognizedItems ?? 0) > 0) && <p>Alcune risposte contenevano dati non riconosciuti.</p>}
    <p>La copertura dei commenti e la loro pertinenza sono valutate separatamente.</p>
  </div>
}
