import { RedditData, RedditPost, RedditComment } from './types'

const MIN_RESULTS_FOR_ANALYSIS = 5
const MAX_POSTS = 15
const MAX_COMMENTS_PER_POST = 20

function extractPostId(link: string): string | null {
  const m = link.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)\//)
  return m ? m[1] : null
}

type ApifyItem = Record<string, unknown>

// ─── Componente 1: Traduzione AI della keyword ────────────────────────────────

async function translateKeywordForReddit(keyword: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log(`[reddit-translate] ANTHROPIC_API_KEY mancante, fallback a keyword originale`)
    return [keyword]
  }

  const prompt = `You are helping a market researcher find Reddit discussions about a topic. The user has a keyword they use on Amazon to find books, but Amazon book keywords (e.g. "iphone for seniors", "amish survival", "cricut for dummies") are rarely how people actually talk about the same topic on Reddit.

Your task: translate the Amazon keyword into 5 different Reddit-friendly search queries that real users would type. Cover different angles:
- Direct user language (someone with the problem): "my mom can't use her iphone"
- Caregiver language (someone helping): "teaching elderly parent smartphone"
- Frustration/help-seeking: "I can't figure out cricut design space"
- Specific scenario: "first iphone for grandfather"
- Related broader topic: "elderly parent technology help"

Rules:
- Each query: 3-6 words, natural English (no quotes, no operators)
- Queries must be substantially different from each other (different angles, not synonyms)
- Avoid the literal Amazon keyword as a query (already too narrow)
- Each query should be something a real Reddit user might write

Amazon keyword: "${keyword}"

Output ONLY a JSON array of 5 strings, nothing else. Example: ["query 1", "query 2", "query 3", "query 4", "query 5"]`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      console.log(`[reddit-translate] AI failed status:${res.status}, fallback a keyword originale`)
      return [keyword]
    }

    const data = await res.json() as { content: Array<{ text?: string }> }
    const text = data.content?.[0]?.text ?? ''

    const match = text.match(/\[[\s\S]*\]/)
    if (!match) {
      console.log(`[reddit-translate] AI output non parsabile, fallback`)
      return [keyword]
    }

    const queries = JSON.parse(match[0]) as string[]
    if (!Array.isArray(queries) || queries.length === 0) {
      return [keyword]
    }

    const cleaned = queries
      .filter(q => typeof q === 'string' && q.trim().length > 0)
      .map(q => q.trim().toLowerCase())
      .slice(0, 5)

    console.log(`[reddit-translate] keyword:"${keyword}" → queries:${JSON.stringify(cleaned)}`)
    return cleaned.length > 0 ? cleaned : [keyword]
  } catch (err) {
    console.log(`[reddit-translate] error: ${err}, fallback a keyword originale`)
    return [keyword]
  }
}

// ─── Componente 2: Ricerca SerpApi parallela sulle 5 query ───────────────────

interface GoogleResult {
  title?: string
  link?: string
  snippet?: string
}

async function serpApiFetch(params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) throw new Error('SERPAPI_KEY mancante')
  const qs = new URLSearchParams({ ...params, api_key: apiKey }).toString()
  const res = await fetch(`https://serpapi.com/search?${qs}`, {
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`SerpApi status ${res.status}`)
  return res.json()
}

async function searchRedditViaGoogle(query: string): Promise<GoogleResult[]> {
  try {
    const data = await serpApiFetch({
      engine: 'google',
      q: `site:reddit.com ${query}`,
      num: '15',
    })
    const results = (data as { organic_results?: GoogleResult[] }).organic_results ?? []
    return results.filter(r =>
      r.link?.includes('reddit.com/r/') && r.link.includes('/comments/')
    )
  } catch (err) {
    console.log(`[reddit-serpapi] failed query:"${query}" error:${err}`)
    return []
  }
}

interface RankedCandidate {
  url: string
  postId: string
  title: string
  snippet: string
  appearancesInQueries: number
  bestPosition: number
  totalScore: number
}

async function searchRedditMulti(queries: string[]): Promise<RankedCandidate[]> {
  const resultsByQuery = await Promise.all(
    queries.map(q => searchRedditViaGoogle(q))
  )

  const candidateMap = new Map<string, RankedCandidate>()

  resultsByQuery.forEach((results) => {
    results.forEach((r, posIdx) => {
      if (!r.link) return
      const postId = extractPostId(r.link)
      if (!postId) return

      const existing = candidateMap.get(postId)
      if (existing) {
        existing.appearancesInQueries++
        existing.bestPosition = Math.min(existing.bestPosition, posIdx + 1)
      } else {
        candidateMap.set(postId, {
          url: r.link,
          postId,
          title: r.title ?? '',
          snippet: r.snippet ?? '',
          appearancesInQueries: 1,
          bestPosition: posIdx + 1,
          totalScore: 0,
        })
      }
    })
  })

  const candidates = Array.from(candidateMap.values())
  candidates.forEach(c => {
    const appearancesScore = (c.appearancesInQueries / queries.length) * 60
    const positionScore = ((16 - c.bestPosition) / 15) * 40
    c.totalScore = appearancesScore + positionScore
  })

  candidates.sort((a, b) => b.totalScore - a.totalScore)

  console.log(
    `[reddit-aggregate] queries:${queries.length} uniqueUrls:${candidates.length} ` +
    `topScore:${candidates[0]?.totalScore.toFixed(1) ?? 'N/A'}`
  )

  return candidates
}

// ─── Componente 3: Scrape Apify — URL singola batched ────────────────────────

async function fetchSinglePostViaApify(
  url: string,
  token: string,
): Promise<{ items: ApifyItem[]; success: boolean }> {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/fatihtahta~reddit-scraper-search-fast/run-sync-get-dataset-items?token=${token}&timeout=30`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [url],
          scrapeComments: true,
          maxComments: MAX_COMMENTS_PER_POST,
          includeNsfw: false,
        }),
        signal: AbortSignal.timeout(35000),
      }
    )

    if (!res.ok) {
      console.log(`[reddit-apify] singleUrl status:${res.status} url:${url.substring(0, 80)}`)
      return { items: [], success: false }
    }

    const items = await res.json() as ApifyItem[]
    return { items, success: items.length > 0 }
  } catch (err) {
    console.log(`[reddit-apify] singleUrl FAILED url:${url.substring(0, 80)} error:${err}`)
    return { items: [], success: false }
  }
}

async function fetchPostsViaApifyBatched(
  urls: string[],
  token: string,
): Promise<{ allItems: ApifyItem[]; successCount: number; failureCount: number }> {
  const BATCH_SIZE = 3
  const allItems: ApifyItem[] = []
  let successCount = 0
  let failureCount = 0

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(url => fetchSinglePostViaApify(url, token))
    )

    for (const result of batchResults) {
      if (result.success) {
        allItems.push(...result.items)
        successCount++
      } else {
        failureCount++
      }
    }

    console.log(
      `[reddit-apify] batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(urls.length / BATCH_SIZE)} ` +
      `done, totalSuccess:${successCount} totalFailure:${failureCount}`
    )
  }

  return { allItems, successCount, failureCount }
}

// ─── Componente 4: fetchRedditData (flusso ibrido) ───────────────────────────

export async function fetchRedditData(keyword: string): Promise<RedditData> {
  const apifyToken = process.env.APIFY_TOKEN

  if (!apifyToken) {
    console.log(`[reddit] APIFY_TOKEN mancante`)
    return {
      keyword, posts: [], totalComments: 0, subredditsUsed: [],
      threadCount: 0, available: false, insufficientCorpus: true,
    }
  }

  // STEP 1: Traduzione AI
  const queries = await translateKeywordForReddit(keyword)

  // STEP 2: SerpApi multi-query
  const candidates = await searchRedditMulti(queries)

  if (candidates.length === 0) {
    console.log(`[reddit-summary] keyword:"${keyword}" status:NO_GOOGLE_RESULTS`)
    return {
      keyword, posts: [], totalComments: 0, subredditsUsed: [],
      threadCount: 0, available: false, insufficientCorpus: true,
    }
  }

  // STEP 3: Top 15 candidati per Apify (15 URL ÷ 3 paralleli = 5 batch × ~15s ≈ 75s)
  const APIFY_FETCH_COUNT = 15
  const topCandidates = candidates.slice(0, APIFY_FETCH_COUNT)
  const urlsToFetch = topCandidates.map(c => c.url)

  // STEP 4: Apify scrape batched (3 URL paralleli alla volta)
  const { allItems, successCount, failureCount } = await fetchPostsViaApifyBatched(urlsToFetch, apifyToken)

  if (allItems.length === 0) {
    console.log(`[reddit-summary] keyword:"${keyword}" status:APIFY_ALL_FAILED successCount:0 failureCount:${failureCount}`)
    return {
      keyword, posts: [], totalComments: 0, subredditsUsed: [],
      threadCount: 0, available: false, insufficientCorpus: true,
    }
  }

  // STEP 5: Mapping Apify items → RedditPost
  const postsRaw = allItems.filter(it => (it.kind as string) === 'post')
  const commentsRaw = allItems.filter(it => (it.kind as string) === 'comment')

  // Raggruppa commenti per postId estratto dall'URL del commento
  const commentsByPostId = new Map<string, RedditComment[]>()
  for (const c of commentsRaw) {
    const postId = (c.postId as string) ?? ''
    if (!postId) continue

    const createdAt = c.created_utc
      ? Math.floor(new Date(c.created_utc as string).getTime() / 1000)
      : 0
    if (!commentsByPostId.has(postId)) commentsByPostId.set(postId, [])
    const bucket = commentsByPostId.get(postId)!
    bucket.push({
      id: String(c.id ?? `c_${postId}_${bucket.length}`),
      body: (c.body as string) ?? '',
      score: (c.score as number) ?? 0,
      author: (c.author as string) ?? '',
      createdUtc: createdAt,
      month: createdAt > 0
        ? new Date(createdAt * 1000).toISOString().slice(0, 7)
        : new Date().toISOString().slice(0, 7),
    })
  }

  // STEP 6: Re-ranking finale con upVotes reali integrati
  const maxUpVotes = Math.max(1, ...postsRaw.map(p => (p.score as number) ?? 0))

  const enrichedPosts = postsRaw.map(p => {
    const postUrl = (p.url as string) ?? ''
    const postId = (p.id as string) ?? extractPostId(postUrl) ?? ''
    const candidate = topCandidates.find(c => c.postId === postId)
    const upVotes = (p.score as number) ?? 0

    const appearancesScore = candidate
      ? (candidate.appearancesInQueries / queries.length) * 30
      : 0
    const positionScore = candidate
      ? ((16 - candidate.bestPosition) / 15) * 20
      : 0
    const upVotesScore = (upVotes / maxUpVotes) * 50
    const finalScore = appearancesScore + positionScore + upVotesScore

    return { rawPost: p, postId, upVotes, finalScore }
  })

  enrichedPosts.sort((a, b) => b.finalScore - a.finalScore)
  const selected = enrichedPosts.slice(0, MAX_POSTS)

  const posts: RedditPost[] = selected.map((e, i) => {
    const p = e.rawPost
    const postUrl = (p.url as string) ?? ''
    const createdUtc = p.created_utc
      ? Math.floor(new Date(p.created_utc as string).getTime() / 1000)
      : Math.floor(Date.now() / 1000)
    const postComments = (commentsByPostId.get(e.postId) ?? [])
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_COMMENTS_PER_POST)

    return {
      id: e.postId || `g_${i}`,
      title: (p.title as string) ?? '',
      selftext: (p.body as string) ?? '',
      score: e.upVotes,
      subreddit: (p.subreddit as string) ?? 'reddit',
      createdUtc,
      month: new Date(createdUtc * 1000).toISOString().slice(0, 7),
      comments: postComments,
      link: postUrl,
    }
  })

  const subredditsUsed = [...new Set(posts.map(p => p.subreddit))]
  const totalComments = posts.reduce((acc, p) => acc + p.comments.length, 0)
  const postsWithComments = posts.filter(p => p.comments.length > 0).length

  console.log(
    `[reddit-summary] keyword:"${keyword}" ` +
    `translatedQueries:${queries.length} ` +
    `googleCandidates:${candidates.length} ` +
    `apifyAttempted:${urlsToFetch.length} ` +
    `apifySuccess:${successCount} ` +
    `apifyFailure:${failureCount} ` +
    `apifyReturnedPosts:${postsRaw.length} ` +
    `finalPosts:${posts.length} ` +
    `withComments:${postsWithComments} ` +
    `totalComments:${totalComments} ` +
    `subreddits:${subredditsUsed.length} ` +
    `commentsScrapedTotal:${commentsRaw.length} ` +
    `commentsKept:${totalComments} ` +
    `flow:hybrid_v5_fatihtahta`
  )

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
