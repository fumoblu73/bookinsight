import { YouTubeData, YouTubeVideo, YouTubeComment, Market } from './types'

const YT_API = 'https://www.googleapis.com/youtube/v3'

// ─── Parametri lingua/regione per YouTube Data API v3 ────────────────────────

const MARKET_YOUTUBE_PARAMS: Record<Market, { relevanceLanguage: string; regionCode: string }> = {
  US: { relevanceLanguage: 'en', regionCode: 'US' },
  UK: { relevanceLanguage: 'en', regionCode: 'GB' },
  DE: { relevanceLanguage: 'de', regionCode: 'DE' },
  FR: { relevanceLanguage: 'fr', regionCode: 'FR' },
  IT: { relevanceLanguage: 'it', regionCode: 'IT' },
  ES: { relevanceLanguage: 'es', regionCode: 'ES' },
}
const MIN_COMMENTS = 25
const MAX_VIDEOS = 8
const MAX_COMMENTS_PER_VIDEO = 100
const MAX_COMMENT_AGE_MONTHS = 24

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY non configurata')
  return key
}

function isRecentEnough(publishedAt: string): boolean {
  const published = new Date(publishedAt)
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - MAX_COMMENT_AGE_MONTHS)
  return published >= cutoff
}

function isValidComment(text: string, likeCount: number): boolean {
  if (text.length === 0) return false
  if (likeCount < 2) return false
  if (/https?:\/\//.test(text)) return false
  if (/^[\s\p{Emoji}\p{P}]+$/u.test(text)) return false
  return true
}

async function searchVideos(keyword: string, market: Market): Promise<string[]> {
  const { relevanceLanguage, regionCode } = MARKET_YOUTUBE_PARAMS[market]
  const query = encodeURIComponent(`${keyword} tutorial`)
  const url = `${YT_API}/search?part=id&type=video&q=${query}&maxResults=${MAX_VIDEOS}&order=viewCount&relevanceLanguage=${relevanceLanguage}&regionCode=${regionCode}&key=${getApiKey()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`YouTube search: ${res.status}`)
  const data = await res.json() as { items?: { id: { videoId: string } }[] }
  return (data.items ?? []).map(i => i.id.videoId)
}

async function fetchVideoDetails(videoId: string): Promise<{ title: string; viewCount: number }> {
  const url = `${YT_API}/videos?part=snippet,statistics&id=${videoId}&key=${getApiKey()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return { title: '', viewCount: 0 }
  const data = await res.json() as {
    items?: { snippet: { title: string }; statistics: { viewCount: string } }[]
  }
  const item = data.items?.[0]
  return {
    title: item?.snippet.title ?? '',
    viewCount: parseInt(item?.statistics.viewCount ?? '0', 10),
  }
}

async function fetchComments(videoId: string): Promise<YouTubeComment[]> {
  const url = `${YT_API}/commentThreads?part=snippet&videoId=${videoId}&maxResults=${MAX_COMMENTS_PER_VIDEO}&order=relevance&key=${getApiKey()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const data = await res.json() as {
    items?: {
      snippet: {
        topLevelComment: {
          id: string
          snippet: { textOriginal: string; likeCount: number; publishedAt: string }
        }
      }
    }[]
  }
  return (data.items ?? [])
    .map(i => ({
      id: i.snippet.topLevelComment.id,
      text: i.snippet.topLevelComment.snippet.textOriginal,
      likeCount: i.snippet.topLevelComment.snippet.likeCount,
      publishedAt: i.snippet.topLevelComment.snippet.publishedAt,
    }))
    .filter(c => isRecentEnough(c.publishedAt) && isValidComment(c.text, c.likeCount))
    .sort((a, b) => b.likeCount - a.likeCount)
}

export async function fetchYouTubeData(keyword: string, market: Market = 'US'): Promise<YouTubeData> {
  if (!process.env.YOUTUBE_API_KEY) {
    return { keyword, videos: [], totalComments: 0, available: false, insufficientCorpus: true }
  }

  try {
    const videoIds = await searchVideos(keyword, market)
    if (videoIds.length === 0) {
      return { keyword, videos: [], totalComments: 0, available: false, insufficientCorpus: true }
    }

    const videos: YouTubeVideo[] = await Promise.all(
      videoIds.map(async id => {
        const [details, comments] = await Promise.all([fetchVideoDetails(id), fetchComments(id)])
        return { id, title: details.title, viewCount: details.viewCount, comments }
      })
    )

    // Tronca a max 150 commenti totali, priorità ai video con più views
    const sorted = [...videos].sort((a, b) => b.viewCount - a.viewCount)
    let totalComments = 0
    const capped: YouTubeVideo[] = []
    for (const v of sorted) {
      const remaining = 400 - totalComments
      if (remaining <= 0) break
      const sliced = { ...v, comments: v.comments.slice(0, remaining) }
      capped.push(sliced)
      totalComments += sliced.comments.length
    }

    console.log(`[youtube] "${keyword}" → ${videoIds.length} video → ${totalComments} commenti filtrati`)

    return {
      keyword,
      videos: capped,
      totalComments,
      available: totalComments > 0,
      insufficientCorpus: totalComments < MIN_COMMENTS,
    }
  } catch (err) {
    console.error('[youtube] fetch failed:', err)
    return { keyword, videos: [], totalComments: 0, available: false, insufficientCorpus: true }
  }
}
