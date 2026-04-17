import { RedditData, RedditPost, RedditComment } from './types'

const USER_AGENT = 'BookInsight/1.0'
const MIN_COMMENT_SCORE = 2
const MAX_POSTS_PER_SUBREDDIT = 10
const TARGET_MIN_COMMENTS = 20
const TARGET_MAX_COMMENTS = 150
const MONTHS_BACK = 24
const MIN_SUBREDDIT_SUBSCRIBERS = 1000

// Parole generiche da rimuovere per ottenere il nucleo tematico della keyword
const GENERIC_WORDS = new Set([
  'for', 'beginners', 'beginner', 'guide', 'book', 'complete', 'easy', 'simple',
  'how', 'to', 'the', 'a', 'an', 'and', 'or', 'with', 'your', 'my',
  'introduction', 'intro', 'basics', 'basic', 'advanced', 'ultimate', 'best',
  'step', 'steps', 'tips', 'tricks', 'secrets', 'made', 'fast', 'quick',
  'starter', 'dummies', 'everyone', 'anyone', 'all', 'top', 'great',
  'over', 'under', 'learn', 'learning', 'master', 'mastering',
])

/**
 * Costruisce varianti di ricerca broad da una keyword KDP.
 * Es. "stock option for beginners" → ["stock option for beginners", "stock option"]
 * Es. "keto diet for women over 50" → ["keto diet for women over 50", "keto diet women", "keto diet"]
 */
function buildSearchVariants(keyword: string): string[] {
  const words = keyword.toLowerCase().split(/\s+/)
  const coreWords = words.filter(w => !GENERIC_WORDS.has(w))

  const variants: string[] = []

  // 1. Keyword completa (sempre presente)
  variants.push(keyword.toLowerCase())

  // 2. Solo le parole core (es. "stock option" da "stock option for beginners")
  const corePhrase = coreWords.join(' ')
  if (corePhrase && corePhrase !== keyword.toLowerCase()) {
    variants.push(corePhrase)
  }

  // 3. Prime 2 parole core (se ci sono almeno 2 core words e differisce dai precedenti)
  if (coreWords.length > 1) {
    variants.push(coreWords.slice(0, 2).join(' '))
  }

  // Deduplica e limita a 3
  return [...new Set(variants)].slice(0, 3)
}

// ─── Fetch con retry ──────────────────────────────────────────────────────────

async function redditFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status} ${url}`)
  return res.json()
}

// ─── Ricerca subreddit rilevanti ──────────────────────────────────────────────

async function findRelevantSubreddits(keyword: string): Promise<string[]> {
  // Usa l'ultimo variant (il più generico) per trovare subreddit tematici
  const variants = buildSearchVariants(keyword)
  const searchQuery = variants[variants.length - 1]
  const url = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(searchQuery)}&limit=10`
  try {
    const data = await redditFetch(url) as {
      data: { children: Array<{ data: { display_name: string; subscribers: number; last_created_utc?: number } }> }
    }
    return data.data.children
      .filter(s => s.data.subscribers >= MIN_SUBREDDIT_SUBSCRIBERS)
      .map(s => s.data.display_name)
      .slice(0, 5)
  } catch {
    return []
  }
}

// ─── Ricerca post per keyword in un subreddit ─────────────────────────────────

async function fetchPostsFromSubreddit(
  subreddit: string,
  keyword: string,
  cutoffUtc: number
): Promise<RedditPost[]> {
  const variants = buildSearchVariants(keyword)

  const posts: RedditPost[] = []
  const seenIds = new Set<string>()

  for (const query of variants) {
    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=top&t=year&limit=${MAX_POSTS_PER_SUBREDDIT}&restrict_sr=1`
    try {
      const data = await redditFetch(url) as {
        data: { children: Array<{ data: Record<string, unknown> }> }
      }

      for (const child of data.data.children) {
        const p = child.data
        const createdUtc = Number(p.created_utc ?? 0)
        if (createdUtc < cutoffUtc) continue
        if (seenIds.has(String(p.id))) continue
        seenIds.add(String(p.id))

        posts.push({
          id:         String(p.id ?? ''),
          title:      String(p.title ?? ''),
          selftext:   String(p.selftext ?? ''),
          score:      Number(p.score ?? 0),
          subreddit,
          createdUtc,
          month:      utcToMonth(createdUtc),
          comments:   [],
        })
      }
    } catch {
      // Subreddit non disponibile, continua
    }
  }

  return posts
}

// ─── Fetch commenti di un post ────────────────────────────────────────────────

async function fetchComments(postId: string, subreddit: string): Promise<RedditComment[]> {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=50&sort=top`
  try {
    const data = await redditFetch(url) as Array<{ data: { children: Array<{ data: Record<string, unknown> }> } }>
    if (!Array.isArray(data) || data.length < 2) return []

    const comments: RedditComment[] = []
    for (const child of data[1].data.children) {
      const c = child.data
      const score = Number(c.score ?? 0)
      if (score < MIN_COMMENT_SCORE) continue
      const body = String(c.body ?? '')
      if (!body || body === '[deleted]' || body === '[removed]') continue

      comments.push({
        id:         String(c.id ?? ''),
        body,
        score,
        author:     String(c.author ?? ''),
        createdUtc: Number(c.created_utc ?? 0),
        month:      utcToMonth(Number(c.created_utc ?? 0)),
      })
    }
    return comments
  } catch {
    return []
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function utcToMonth(utc: number): string {
  const d = new Date(utc * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchRedditData(keyword: string): Promise<RedditData> {
  const cutoffUtc = Math.floor(Date.now() / 1000) - MONTHS_BACK * 30 * 24 * 60 * 60

  // 1. Trova subreddit rilevanti
  const subreddits = await findRelevantSubreddits(keyword)

  // Fallback: cerca globalmente se nessun subreddit trovato
  const searchTargets = subreddits.length > 0
    ? subreddits
    : ['all']

  const allPosts: RedditPost[] = []

  // 2. Fetch post da ogni subreddit
  for (const subreddit of searchTargets) {
    const posts = await fetchPostsFromSubreddit(subreddit, keyword, cutoffUtc)
    allPosts.push(...posts)
    if (allPosts.length >= 20) break
  }

  // 3. Fallback r/all se subreddit specifici trovati ma 0 post (topic generico o storico)
  if (allPosts.length === 0 && searchTargets[0] !== 'all') {
    const fallbackPosts = await fetchPostsFromSubreddit('all', keyword, cutoffUtc)
    allPosts.push(...fallbackPosts)
  }

  // 3. Fetch commenti per i post più rilevanti
  let totalComments = 0
  for (const post of allPosts) {
    if (totalComments >= TARGET_MAX_COMMENTS) break
    const comments = await fetchComments(post.id, post.subreddit)
    post.comments = comments
    totalComments += comments.length
  }

  const subredditsUsed = [...new Set(allPosts.map(p => p.subreddit))]

  return {
    keyword,
    posts: allPosts,
    totalComments,
    subredditsUsed,
    threadCount: allPosts.length,
    available: allPosts.length > 0,
    insufficientCorpus: totalComments < TARGET_MIN_COMMENTS,
  }
}
