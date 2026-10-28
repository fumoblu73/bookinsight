import type { AmazonReviewCollection } from '../lib/types'

export default function AmazonReviewNotice({ collection }: { collection?: AmazonReviewCollection }) {
  if (!collection) return null
  return <p className={`mb-3 rounded-lg border p-3 text-xs ${collection.status === 'complete' ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
    <strong>Recensioni Amazon: {collection.reviewCount} testi raccolti da {collection.booksWithReviews}/{collection.requestedBooks} libri.</strong>{' '}
    {collection.status === 'unavailable' ? 'Nessun testo di recensione disponibile: Amazon non contribuisce alle testimonianze di questa analisi.'
      : collection.status === 'partial' ? 'Campione parziale: alcuni libri non hanno restituito testi di recensione.' : 'Campione disponibile per la selezione manuale.'}
    {' '}Il numero totale di recensioni dei libri è un dato di mercato distinto dai testi effettivamente raccolti.
  </p>
}
