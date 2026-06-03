import { RedditData, RedditPost, RedditComment } from './types'

const MIN_RESULTS_FOR_ANALYSIS = 5
const MAX_POSTS = 15
const MAX_COMMENTS_PER_POST = 20
const COMMENT_AGE_MONTHS = 18

function extractPostId(link: string): string | null {
  const m = link.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)\//)
  return m ? m[1] : null
}

type ApifyItem = Record<string, unknown>

async function fetchRedditDataViaApifySearch(
  keyword: string,
  token: string,
): Promise<{ posts: RedditPost[]; success: boolean }> {

  async function tryFetch(attempt: 1 | 2): Promise<{ items: ApifyItem[]; success: boolean }> {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/run-sync-get-dataset-items?token=${token}&timeout=90`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searches: [keyword],
            searchPosts: true,
            searchComments: false,
            searchCommunities: false,
            searchUsers: false,
            searchMedia: false,
            sort: 'top',
            time: 'all',
            maxPostCount: MAX_POSTS,
            maxComments: MAX_COMMENTS_PER_POST,
            maxItems: MAX_POSTS * (MAX_COMMENTS_PER_POST + 5) + 10,
            includeNSFW: false,
            skipComments: false,
            scrollTimeout: 40,
            proxy: { useApifyProxy: true },
          }),
          signal: AbortSignal.timeout(120000),
        }
      )

      console.log(`[reddit-apify] attempt:${attempt} status:${res.status} keyword:"${keyword}"`)
      if (!res.ok) return { items: [], success: false }

      const items = await res.json() as ApifyItem[]
      console.log(`[reddit-apify] attempt:${attempt} items:${items.length}`)

      return { items, success: items.length > 0 }
    } catch (err) {
      console.log(`[reddit-apify] FAILED attempt:${attempt} keyword:"${keyword}" error:${err}`)
      return { items: [], success: false }
    }
  }

  let { items, success } = await tryFetch(1)

  if (!success) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    const second = await tryFetch(2)
    items = second.items
    success = second.success
  }

  if (!success || items.length === 0) {
    return { posts: [], success: false }
  }

  const postsRaw = items.filter(it => (it.dataType as string) === 'post')
  const commentsRaw = items.filter(it => (it.dataType as string) === 'comment')

  const now = Math.floor(Date.now() / 1000)
  const ageLimit = now - COMMENT_AGE_MONTHS * 30 * 24 * 3600

  // Raggruppa commenti per post (parentId è "t3_<postId>")
  const commentsByPostId = new Map<string, RedditComment[]>()
  for (const c of commentsRaw) {
    const parentIdRaw = c.parentId as string | undefined
    if (!parentIdRaw) continue
    const postId = parentIdRaw.replace(/^t3_/, '')
    const createdUtc = c.createdAt
      ? Math.floor(new Date(c.createdAt as string).getTime() / 1000)
      : 0
    if (createdUtc > 0 && createdUtc < ageLimit) continue

    if (!commentsByPostId.has(postId)) commentsByPostId.set(postId, [])
    const bucket = commentsByPostId.get(postId)!
    bucket.push({
      id: String(c.id ?? `c_${postId}_${bucket.length}`),
      body: (c.body as string) ?? '',
      score: (c.upVotes as number) ?? 0,
      author: (c.username as string) ?? '',
      createdUtc,
      month: new Date(createdUtc * 1000).toISOString().slice(0, 7),
    })
  }

  const sortedPosts = postsRaw
    .sort((a, b) => ((b.upVotes as number) ?? 0) - ((a.upVotes as number) ?? 0))
    .slice(0, MAX_POSTS)

  const posts: RedditPost[] = sortedPosts.map((p, i) => {
    const postUrl = (p.url as string) ?? ''
    const postId = (p.parsedId as string) ?? extractPostId(postUrl) ?? `g_${i}`
    const postComments = commentsByPostId.get(postId) ?? []
    const createdUtc = p.createdAt
      ? Math.floor(new Date(p.createdAt as string).getTime() / 1000)
      : Math.floor(Date.now() / 1000)

    return {
      id: postId,
      title: (p.title as string) ?? '',
      selftext: (p.body as string) ?? '',
      score: (p.upVotes as number) ?? 0,
      subreddit: ((p.parsedCommunityName as string) ?? (p.communityName as string) ?? 'reddit').replace(/^r\//, ''),
      createdUtc,
      month: new Date(createdUtc * 1000).toISOString().slice(0, 7),
      comments: postComments
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_COMMENTS_PER_POST),
      link: postUrl,
    }
  })

  return { posts, success: true }
}

export async function fetchRedditData(keyword: string): Promise<RedditData> {
  const apifyToken = process.env.APIFY_TOKEN

  if (!apifyToken) {
    console.log(`[reddit] APIFY_TOKEN mancante, skipping`)
    return {
      keyword, posts: [], totalComments: 0, subredditsUsed: [],
      threadCount: 0, available: false, insufficientCorpus: true,
    }
  }

  const { posts, success } = await fetchRedditDataViaApifySearch(keyword, apifyToken)

  if (!success || posts.length === 0) {
    console.log(`[reddit-summary] keyword:"${keyword}" status:NO_RESULTS`)
    return {
      keyword, posts: [], totalComments: 0, subredditsUsed: [],
      threadCount: 0, available: false, insufficientCorpus: true,
    }
  }

  const subredditsUsed = [...new Set(posts.map(p => p.subreddit))]
  const totalComments = posts.reduce((acc, p) => acc + p.comments.length, 0)
  const postsWithComments = posts.filter(p => p.comments.length > 0).length
  const postsEmpty = posts.length - postsWithComments

  console.log(
    `[reddit-summary] keyword:"${keyword}" ` +
    `posts:${posts.length} ` +
    `withComments:${postsWithComments} ` +
    `empty:${postsEmpty} ` +
    `totalComments:${totalComments} ` +
    `subreddits:${subredditsUsed.length} ` +
    `sortedByUpvotes:true`
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
