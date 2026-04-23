import { RedditData, RedditPost, RedditComment } from './types'

const MIN_RESULTS_FOR_ANALYSIS = 5

const GENERIC_WORDS = new Set([
  'for', 'beginners', 'beginner', 'guide', 'book', 'complete', 'easy', 'simple',
  'how', 'to', 'the', 'a', 'an', 'and', 'or', 'with', 'your', 'my',
  'introduction', 'intro', 'basics', 'basic', 'advanced', 'ultimate', 'best',
  'step', 'steps', 'tips', 'tricks', 'secrets', 'made', 'fast', 'quick',
  'starter', 'dummies', 'everyone', 'anyone', 'all', 'top', 'great',
  'over', 'under', 'learn', 'learning', 'master', 'mastering',
])

function shortVariant(keyword: string): string {
  const words = keyword.toLowerCase().split(/\s+/)
  const core = words.filter(w => !GENERIC_WORDS.has(w))
  if (core.length === 0) return keyword.toLowerCase()
  return core.slice(0, 2).join(' ')
}

// ─── SerpApi fetch ────────────────────────────────────────────────────────────

async function serpApiFetch(params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) throw new Error('SERPAPI_KEY non configurata')
  const qs = new URLSearchParams({ ...params, api_key: apiKey }).toString()
  const res = await fetch(`https://serpapi.com/search?${qs}`)
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// ─── Google search su Reddit ──────────────────────────────────────────────────

interface GoogleResult {
  title?: string
  link?: string
  snippet?: string
}

async function searchRedditViaGoogle(query: string): Promise<GoogleResult[]> {
  try {
    const data = await serpApiFetch({
      engine: 'google',
      q: `site:reddit.com ${query}`,
      num: '10',
    }) as { organic_results?: GoogleResult[] }
    return (data.organic_results ?? [])
      .filter(r => r.link?.includes('reddit.com/r/') && r.link.includes('/comments/'))
  } catch (err) {
    console.error(`[reddit] Google search failed for "${query}":`, err)
    return []
  }
}

function extractSubreddit(link: string): string {
  const m = link.match(/reddit\.com\/r\/([^/]+)/)
  return m ? m[1] : 'reddit'
}

function extractPostId(link: string): string | null {
  const m = link.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)\//)
  return m ? m[1] : null
}

// ─── Apify Reddit scraper ─────────────────────────────────────────────────────

type ApifyItem = Record<string, unknown>

async function fetchCommentsViaApify(
  postUrl: string,
  token: string,
): Promise<RedditComment[]> {
  const postId = extractPostId(postUrl) ?? 'unknown'
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/run-sync-get-dataset-items?token=${token}&timeout=25`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: postUrl }],
          maxComments: 5,
          maxItems: 10,
        }),
        signal: AbortSignal.timeout(28000),
      }
    )

    console.log(`[reddit-comments] id:${postId} status:${res.status}`)
    if (!res.ok) return []

    const items = await res.json() as ApifyItem[]
    console.log(`[reddit-comments] id:${postId} items:${items.length}`)

    // Log struttura primo item per diagnostica (solo prima analisi)
    if (items.length > 0 && postId !== 'unknown') {
      console.log(`[reddit-comments] sample:${JSON.stringify(items[0]).slice(0, 150)}`)
    }

    const now = Math.floor(Date.now() / 1000)

    return items
      .filter(item => {
        const type = item.type as string | undefined
        const body = String(item.body ?? item.text ?? item.content ?? '')
        return type === 'comment' &&
          body.length > 20 &&
          body !== '[deleted]' &&
          body !== '[removed]'
      })
      .slice(0, 5)
      .map((item, i) => {
        const body   = String(item.body ?? item.text ?? item.content ?? '')
        const isoDate = item.createdAt as string | undefined
        const createdUtc = isoDate ? Math.floor(new Date(isoDate).getTime() / 1000) : now
        return {
          id:         String(item.id ?? `apify_${postId}_${i}`),
          body,
          score:      Number(item.score ?? 0),
          author:     String(item.author ?? ''),
          createdUtc,
          month:      new Date(createdUtc * 1000).toISOString().slice(0, 7),
        }
      })
  } catch (err) {
    console.log(`[reddit-comments] FAILED id:${postId} error:${err}`)
    return []
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchRedditData(keyword: string): Promise<RedditData> {
  const short = shortVariant(keyword)
  const queries = [keyword.toLowerCase()]
  if (short !== keyword.toLowerCase()) queries.push(short)

  const resultSets = await Promise.all(queries.map(q => searchRedditViaGoogle(q)))

  const seen = new Set<string>()
  const allResults: GoogleResult[] = []
  for (const results of resultSets) {
    for (const r of results) {
      if (r.link && !seen.has(r.link)) {
        seen.add(r.link)
        allResults.push(r)
      }
    }
  }

  console.log(`[reddit] "${keyword}" → queries: ${queries.join(', ')} → ${allResults.length} risultati Google`)

  if (allResults.length === 0) {
    return {
      keyword, posts: [], totalComments: 0, subredditsUsed: [],
      threadCount: 0, available: false, insufficientCorpus: true,
    }
  }

  const posts: RedditPost[] = allResults.map((r, i) => ({
    id: `g_${i}`,
    title: r.title ?? '',
    selftext: r.snippet ?? '',
    score: 5,
    subreddit: r.link ? extractSubreddit(r.link) : 'reddit',
    createdUtc: Math.floor(Date.now() / 1000),
    month: new Date().toISOString().slice(0, 7),
    comments: [],
    link: r.link ?? '',
  }))

  // Fetch commenti via Apify (parallelo, fallback silenzioso se token assente)
  const apifyToken = process.env.APIFY_TOKEN
  if (apifyToken) {
    await Promise.all(
      posts.map(async post => {
        if (!post.link) return
        post.comments = await fetchCommentsViaApify(post.link, apifyToken)
      })
    )
  } else {
    console.log('[reddit] APIFY_TOKEN non configurata — comments: []')
  }

  const subredditsUsed  = [...new Set(posts.map(p => p.subreddit))]
  const totalComments   = posts.reduce((acc, p) => acc + p.comments.length, 0)

  console.log(`[reddit] "${keyword}" → ${posts.length} post · ${totalComments} commenti caricati`)

  return {
    keyword,
    posts,
    totalComments,
    subredditsUsed,
    threadCount: posts.length,
    available: true,
    insufficientCorpus: posts.length < MIN_RESULTS_FOR_ANALYSIS,
  }
}
