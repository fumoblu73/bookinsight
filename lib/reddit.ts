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

// ─── SerpApi Reddit engine — commenti di un thread ────────────────────────────

interface SerpApiRedditComment {
  body?: string
  score?: number
  author?: string
  link?: string
}

async function fetchCommentsViaSerpApi(link: string): Promise<{ selftext: string; comments: RedditComment[] } | null> {
  const id = extractPostId(link)
  if (!id) {
    console.log(`[reddit-comments] SKIP no-id link:${link}`)
    return null
  }

  try {
    const data = await serpApiFetch({
      engine: 'reddit',
      type: 'comments',
      url: link,
    }) as {
      post_info?: { selftext?: string; title?: string }
      comments?: SerpApiRedditComment[]
      error?: string
    }

    if (data.error) {
      console.log(`[reddit-comments] id:${id} serpapi-error:${data.error}`)
      return null
    }

    const selftext = (data.post_info?.selftext ?? '').trim()
    const rawComments = data.comments ?? []

    console.log(`[reddit-comments] id:${id} selftext:${selftext.length} comments:${rawComments.length}`)

    const comments: RedditComment[] = rawComments
      .filter(c => c.body && c.body !== '[deleted]' && c.body !== '[removed]' && c.body.length > 20)
      .slice(0, 5)
      .map((c, i) => ({
        id: `c_${id}_${i}`,
        body: c.body ?? '',
        score: c.score ?? 0,
        author: c.author ?? '',
        createdUtc: Math.floor(Date.now() / 1000),
        month: new Date().toISOString().slice(0, 7),
      }))

    return { selftext, comments }
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

  // Fetch sequenziale con sleep(500) — SerpApi ha rate limit
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

    if (r.link) {
      const full = await fetchCommentsViaSerpApi(r.link)
      if (full) {
        posts.push({
          ...base,
          selftext: full.selftext || base.selftext,
          comments: full.comments,
        })
      } else {
        posts.push(base)
      }
    } else {
      posts.push(base)
    }

    if (i < allResults.length - 1) await sleep(500)
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
