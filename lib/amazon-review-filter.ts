import type { AmazonReview, BookReviews } from './types'

/** Campione delle testimonianze: il rating medio dei libri resta un dato di mercato. */
export function isPainReview(review: Pick<AmazonReview, 'rating'>): boolean {
  return Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 3
}

export function painReviews(groups: BookReviews[] = []): BookReviews[] {
  return groups.map(g => ({ ...g, reviews: g.reviews.filter(isPainReview) })).filter(g => g.reviews.length > 0)
}
