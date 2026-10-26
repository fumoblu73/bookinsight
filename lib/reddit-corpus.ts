import type { RedditComment, RedditCorpusQuality, RedditData, RedditPost, YouTubeData } from './types'

/** Soglie operative, non garanzie di rappresentatività statistica del mercato.
 * Un solo commento leggibile è un segnale qualitativo utilizzabile. I tre minimi
 * di copertura devono invece essere soddisfatti insieme; non escludono dall'AI.
 * I limiti di invio coincidono con quelli della raccolta Reddit.
 */
export const REDDIT_CORPUS_LIMITS = {
  maxPosts: 15,
  maxCommentsPerPost: 30,
  maxCommentChars: 300,
  maxSelftextChars: 400,
  diversifiedComments: 20,
  diversifiedThreads: 5,
  diversifiedSubreddits: 2,
} as const

function usableComment(comment: RedditComment): boolean {
  const body = typeof comment.body === 'string'
    ? comment.body.slice(0, REDDIT_CORPUS_LIMITS.maxCommentChars).trim() : ''
  return body.length > 0 &&
    !/^\[(removed|deleted)\]$/i.test(body) &&
    comment.author?.trim().toLowerCase() !== 'automoderator' &&
    /[\p{L}\p{N}]/u.test(body.replace(/https?:\/\/\S+/gi, ''))
}

/** Ricalcola sempre dai testi effettivamente inviabili, anche per dati legacy.
 * Non si fida dei contatori salvati o del vecchio insufficientCorpus. Elimina
 * duplicati e commenti tecnicamente inutilizzabili senza mutare i dati originali.
 * La pertinenza semantica e il valore delle conferme brevi restano compiti AI.
 */
export function prepareRedditCorpus(
  reddit?: Pick<RedditData, 'available' | 'posts'>,
): { posts: RedditPost[]; quality: RedditCorpusQuality } {
  const collectedCommentCount = (reddit?.posts ?? []).reduce((sum, p) => sum + p.comments.length, 0)
  const threads = new Map<string, RedditPost>()
  const seenComments = new Set<string>()

  for (const post of reddit?.available ? reddit.posts : []) {
    const urlId = post.link?.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i)?.[1]
    const threadId = (urlId || post.id?.replace(/^t3_/, '') ||
      `${post.subreddit}:${post.title}`).toLowerCase()
    let thread = threads.get(threadId)
    if (!thread) {
      thread = { ...post, comments: [] }
      threads.set(threadId, thread)
    }
    for (const comment of post.comments) {
      if (!usableComment(comment)) continue
      const commentId = comment.id?.replace(/^t1_/, '') || `${threadId}:${comment.author}:${comment.body.trim()}`
      if (seenComments.has(commentId)) continue
      seenComments.add(commentId)
      thread.comments.push(comment)
    }
  }

  const usablePosts = [...threads.values()].filter(p => p.comments.length > 0)
  const usableCommentCount = usablePosts.reduce((sum, p) => sum + p.comments.length, 0)
  const posts = usablePosts
    .slice(0, REDDIT_CORPUS_LIMITS.maxPosts)
    .map(p => ({ ...p, comments: p.comments.slice(0, REDDIT_CORPUS_LIMITS.maxCommentsPerPost) }))
  const transmittedCommentCount = posts.reduce((sum, p) => sum + p.comments.length, 0)
  const subreddits = new Set(posts.map(p => p.subreddit.trim().replace(/^r\//i, '').toLowerCase())
    .filter(s => s && s !== 'reddit')) // 'reddit' è il fallback dello scraper, non un subreddit noto
  const usable = transmittedCommentCount > 0
  const limitations: RedditCorpusQuality['limitations'] = []
  if (!usable) {
    limitations.push('no_usable_comments')
  } else {
    if (transmittedCommentCount < REDDIT_CORPUS_LIMITS.diversifiedComments) limitations.push('few_comments')
    if (posts.length < REDDIT_CORPUS_LIMITS.diversifiedThreads) limitations.push('few_threads')
    if (subreddits.size < REDDIT_CORPUS_LIMITS.diversifiedSubreddits) limitations.push('few_subreddits')
  }

  return {
    posts,
    quality: {
      usable,
      coverage: !usable ? 'none' : limitations.length > 0 ? 'limited' : 'diversified',
      collectedCommentCount,
      usableCommentCount,
      usableThreadCount: usablePosts.length,
      transmittedCommentCount,
      transmittedThreadCount: posts.length,
      subredditCount: subreddits.size,
      limitations,
    },
  }
}

/** Mantiene le soglie YouTube esistenti e allinea prompt e attribuzione: una
 * fonte esclusa dall'estrazione non può comparire nel prompt come evidenza.
 */
export function preparePainPointCorpus(reddit: RedditData, youtube?: YouTubeData) {
  return {
    reddit: prepareRedditCorpus(reddit),
    youtube: youtube?.available && !youtube.insufficientCorpus &&
      youtube.videos.some(v => v.comments.some(c => c.text.trim().length > 0))
      ? youtube : undefined,
  }
}

export function redditCoverageNote(quality: RedditCorpusQuality): string {
  if (!quality.usable) return 'Reddit escluso: nessun commento utilizzabile.'
  // Fallback per eventuali snapshot creati prima dei contatori di trasmissione.
  const comments = quality.transmittedCommentCount ?? quality.usableCommentCount
  const threads = quality.transmittedThreadCount ?? quality.usableThreadCount
  return `Copertura Reddit ${quality.coverage === 'limited' ? 'limitata' : 'diversificata'}: ` +
    `${quality.collectedCommentCount === undefined ? '' : `${quality.collectedCommentCount} commenti raccolti nel payload, `}` +
    `${quality.usableCommentCount} commenti utilizzabili; ${comments} commenti inclusi nel prompt da ${threads} thread distinti, ${quality.subredditCount} subreddit. ` +
    (comments === 1 ? 'Segnale qualitativo isolato: un solo commento non dimostra frequenza elevata né domanda consolidata. ' : '') +
    'Le frequenze descrivono solo il campione osservato, non la prevalenza nell’intero mercato. ' +
    'Anche un campione diversificato non garantisce rappresentatività statistica.'
}
