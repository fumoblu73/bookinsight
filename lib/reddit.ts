import { RedditData, RedditPost, RedditComment } from './types'

const USER_AGENT = 'BookInsight/1.0'
const MIN_COMMENT_SCORE = 5
const MAX_POSTS_PER_SUBREDDIT = 10
const TARGET_MIN_COMMENTS = 20
const TARGET_MAX_COMMENTS = 150
const MONTHS_BACK = 12
const MIN_SUBREDDIT_SUBSCRIBERS = 1000

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
  const url = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(keyword)}&limit=10`
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
  const variants = [
    keyword,
    ...keyword.split(' ').map(w => w),
  ].slice(0, 3)

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
