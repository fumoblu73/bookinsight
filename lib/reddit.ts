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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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

// ─── Reddit OAuth API ─────────────────────────────────────────────────────────

async function getRedditAccessToken(): Promise<string | null> {
  const clientId     = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'BookInsight/1.0 by bookinsight-bot',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.log(`[reddit-auth] token fetch failed: ${res.status}`)
      return null
    }
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch (err) {
    console.log(`[reddit-auth] FAILED: ${err}`)
    return null
  }
}

interface RedditJsonPost {
  selftext?: string
  created_utc?: number
}

interface RedditJsonComment {
  kind: string
  data: {
    id?: string
    body?: string
    score?: number
    author?: string
    created_utc?: number
  }
}

async function fetchCommentsViaOAuth(
  link: string,
  accessToken: string,
): Promise<{ selftext: string; comments: RedditComment[]; createdUtc: number } | null> {
  const id = extractPostId(link)
  if (!id) {
    console.log(`[reddit-comments] SKIP no-id link:${link}`)
    return null
  }

  try {
    const res = await fetch(`https://oauth.reddit.com/comments/${id}.json?limit=5&depth=1`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'BookInsight/1.0 by bookinsight-bot',
      },
      signal: AbortSignal.timeout(5000),
    })
    console.log(`[reddit-comments] id:${id} status:${res.status}`)
    if (!res.ok) return null

    const data = await res.json() as [
      { data: { children: Array<{ data: RedditJsonPost }> } },
      { data: { children: RedditJsonComment[] } },
    ]
    console.log(`[reddit-comments] children:${data[1]?.data?.children?.length ?? 'undefined'}`)

    const postData  = data[0]?.data?.children?.[0]?.data
    const selftext  = (postData?.selftext ?? '').trim()
    const createdUtc = postData?.created_utc ?? Math.floor(Date.now() / 1000)

    const commentChildren = data[1]?.data?.children ?? []
    const comments: RedditComment[] = commentChildren
      .filter(c =>
        c.kind === 't1' &&
        c.data.body &&
        c.data.body !== '[deleted]' &&
        c.data.body !== '[removed]' &&
        c.data.body.length > 20
      )
      .slice(0, 5)
      .map(c => ({
        id: c.data.id ?? '',
        body: c.data.body ?? '',
        score: c.data.score ?? 0,
        author: c.data.author ?? '',
        createdUtc: c.data.created_utc ?? createdUtc,
        month: new Date((c.data.created_utc ?? createdUtc) * 1000).toISOString().slice(0, 7),
      }))

    return { selftext, comments, createdUtc }
  } catch (err) {
    console.log(`[reddit-comments] FAILED id:${id} error:${err}`)
    return null
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

  // Ottieni access token OAuth una volta sola per questa invocazione
  const accessToken = await getRedditAccessToken()
  if (!accessToken) {
    console.log('[reddit] OAuth token non disponibile — solo snippet Google (aggiungi REDDIT_CLIENT_ID e REDDIT_CLIENT_SECRET)')
  }

  // Fetch sequenziale con sleep(500)
  const posts: RedditPost[] = []
  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i]
    const base: RedditPost = {
      id: `g_${i}`,
      title: r.title ?? '',
      selftext: r.snippet ?? '',
      score: 5,
      subreddit: r.link ? extractSubreddit(r.link) : 'reddit',
      createdUtc: Math.floor(Date.now() / 1000),
      month: new Date().toISOString().slice(0, 7),
      comments: [],
      link: r.link ?? '',
    }

    if (r.link && accessToken) {
      const full = await fetchCommentsViaOAuth(r.link, accessToken)
      if (full) {
        posts.push({
          ...base,
          selftext: full.selftext || base.selftext,
          comments: full.comments,
          createdUtc: full.createdUtc,
          month: new Date(full.createdUtc * 1000).toISOString().slice(0, 7),
        })
      } else {
        posts.push(base)
      }
    } else {
      posts.push(base)
    }

    if (i < allResults.length - 1) await sleep(300)
  }

  const subredditsUsed = [...new Set(posts.map(p => p.subreddit))]
  const totalComments = posts.reduce((acc, p) => acc + p.comments.length, 0)

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
