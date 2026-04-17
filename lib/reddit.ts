import { RedditData, RedditPost } from './types'

const MIN_RESULTS_FOR_ANALYSIS = 5

// Parole generiche da rimuovere per ottenere la variante corta
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

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchRedditData(keyword: string): Promise<RedditData> {
  const short = shortVariant(keyword)
  const queries = [keyword.toLowerCase()]
  if (short !== keyword.toLowerCase()) queries.push(short)

  // Ricerche in parallelo: keyword completa + variante corta
  const resultSets = await Promise.all(queries.map(q => searchRedditViaGoogle(q)))

  // Deduplicazione per URL
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

  // Ogni risultato Google diventa un post sintetico con il snippet come corpo
  // Il titolo + snippet = estratto della discussione Reddit indicizzata da Google
  const posts: RedditPost[] = allResults.map((r, i) => ({
    id: `g_${i}`,
    title: r.title ?? '',
    selftext: r.snippet ?? '',   // il corpus AI legge selftext
    score: 5,
    subreddit: r.link ? extractSubreddit(r.link) : 'reddit',
    createdUtc: Math.floor(Date.now() / 1000),
    month: new Date().toISOString().slice(0, 7),
    comments: [],                // snippet già in selftext, commenti non necessari
  }))

  const subredditsUsed = [...new Set(posts.map(p => p.subreddit))]

  return {
    keyword,
    posts,
    totalComments: posts.length,  // ogni snippet = 1 unità di corpus
    subredditsUsed,
    threadCount: posts.length,
    available: true,
    insufficientCorpus: posts.length < MIN_RESULTS_FOR_ANALYSIS,
  }
}
