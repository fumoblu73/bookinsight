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
  // Selezione per pertinenza, non per visualizzazioni: su keyword generiche come
  // "game design" l'ordinamento per viewCount restituisce intrattenimento di massa
  // (tutorial Minecraft, video da decine di milioni di visualizzazioni) invece di
  // discussione tematica. L'ordinamento per visualizzazioni resta applicato
  // localmente più sotto per dare priorità ai video più visti dentro l'insieme
  // già selezionato per pertinenza.
  const url = `${YT_API}/search?part=id&type=video&q=${query}&maxResults=${MAX_VIDEOS}&order=relevance&relevanceLanguage=${relevanceLanguage}&regionCode=${regionCode}&key=${getApiKey()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`YouTube search: ${res.status}`)
  const data = await res.json() as { items?: { id: { videoId: string } }[] }
  return (data.items ?? []).map(i => i.id.videoId)
}

async function fetchVideoDetails(videoId: string): Promise<{ title: string; viewCount: number; channelId?: string }> {
  const url = `${YT_API}/videos?part=snippet,statistics&id=${videoId}&key=${getApiKey()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return { title: '', viewCount: 0 }
  const data = await res.json() as {
    items?: { snippet: { title: string; channelId?: string }; statistics: { viewCount: string } }[]
  }
  const item = data.items?.[0]
  return {
    title: item?.snippet.title ?? '',
    viewCount: parseInt(item?.statistics.viewCount ?? '0', 10),
    // Canale del video (confermato dalla sonda 9.0.2): non è l'autore dei commenti.
    channelId: typeof item?.snippet.channelId === 'string' && item.snippet.channelId ? item.snippet.channelId : undefined,
  }
}

/** D6 (9.0.2): gli identificativi dei canali servono solo durante la fase pain-points
 * (pseudonimizzati nell'indice evidenze) e non vanno conservati negli snapshot:
 * la retention YouTube resta quella precedente alla 9.0.2. Non muta l'input. */
export function stripYouTubeIdentifiers(youtube: YouTubeData | undefined): YouTubeData | undefined {
  if (!youtube) return youtube
  return {
    ...youtube,
    videos: youtube.videos.map(v => {
      const video: YouTubeVideo = { ...v, comments: v.comments.map(c => {
        const comment: YouTubeComment = { ...c }
        delete comment.authorChannelId
        return comment
      }) }
      delete video.channelId
      return video
    }),
  }
}

function authorChannelIdOf(raw: { value?: string } | undefined): { authorChannelId?: string } {
  const value = raw?.value
  return typeof value === 'string' && value.trim() ? { authorChannelId: value.trim() } : {}
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
          snippet: {
            textOriginal: string; likeCount: number; publishedAt: string
            authorChannelId?: { value?: string }
          }
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
      // Autore: solo snippet.topLevelComment.snippet.authorChannelId.value. La sonda 9.0.2
      // conferma che snippet.channelId è il canale del VIDEO, mai usarlo come autore;
      // il display name non viene letto.
      ...(authorChannelIdOf(i.snippet.topLevelComment.snippet.authorChannelId)),
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
        return {
          id, title: details.title, viewCount: details.viewCount, comments,
          ...(details.channelId ? { channelId: details.channelId } : {}),
        }
      })
    )

    // Tronca a max 400 commenti totali, priorità ai video con più views
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

    const videosWithComments = capped.filter(v => v.comments.length > 0).length
    console.log(`[youtube] "${keyword}" → ${videoIds.length} video → ${totalComments} commenti filtrati → ${videosWithComments}/${MAX_VIDEOS} video con commenti`)

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
