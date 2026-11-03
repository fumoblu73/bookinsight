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
const MAX_COMMENT_AGE_MONTHS = 36 // era 24: allargato su richiesta per avere più commenti

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

// Filtri tecnici: testo vuoto, link (spesso spam o autopromozione), solo emoji o
// punteggiatura. Il minimo di 2 "mi piace" è stato rimosso: tagliava la maggior parte
// dei commenti; la qualità è ora valutata da isUsefulComment.
export function isValidComment(text: string): boolean {
  if (text.trim().length === 0) return false
  if (/https?:\/\/|www\./i.test(text)) return false
  if (/^[\s\p{Emoji}\p{P}\p{S}]+$/u.test(text)) return false
  return true
}

// Formule a basso contenuto informativo quando costituiscono tutto il commento.
const LOW_VALUE = [
  /^(thank(s| you)( (so|very) much)?|thx|ty)\b/i,
  /^(great|nice|awesome|amazing|excellent|cool|wow|perfect|love (this|it|you|your)|best)( (video|tutorial|content|job|one|work|channel))?\b/i,
  /^(good|great) (video|job|tutorial|content|work)\b/i,
  /^(first|lol|haha+|lmao|same|this|me too|agreed?|yes|no|ok(ay)?)\b/i,
  /^(grazie|bravo|bravissim[oa]|ottimo|bellissimo|danke|super|merci|génial|gracias|genial)\b/i,
]
const SELF_PROMO = /(check out my|subscribe to (my|me)|my channel|follow me|sub4sub|iscriviti al mio)/i

/**
 * Utilità del commento come testimonianza di un lettore (euristica deterministica,
 * nessuna chiamata AI). Scarta: testi molto brevi (< 4 parole o < 20 caratteri),
 * solo timestamp, autopromozione, e complimenti/ringraziamenti generici brevi senza
 * contenuto (nessuna domanda né riferimento a difficoltà, bisogni o dettagli).
 * Un commento che inizia con "thanks" ma descrive un problema resta valido.
 */
export function isUsefulComment(text: string): boolean {
  const t = text.trim()
  const words = t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w))
  if (t.length < 20 || words.length < 4) return false
  if (SELF_PROMO.test(t)) return false
  // Solo confine iniziale: le radici (struggl, confus, need…) coprono anche le forme flesse.
  const substantive = /\?|\b(how|why|what|when|where|which|can't|cannot|couldn't|don't|didn't|doesn't|won't|struggl|problem|issue|hard|difficult|confus|wish|need|want|would love|help|tried|wrong|fail|mistake|instead|but|however|too|not)/i.test(t) ||
    /(^|\s)(come|perché|non|ma|però)(?=\s|$|[.,!?])|problem|difficil|vorrei|serv[eo]|aiut/i.test(t)
  if (!substantive && t.length < 80 && LOW_VALUE.some(re => re.test(t))) return false
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

type RawYtComment = {
  id: string
  snippet: {
    textOriginal: string; likeCount: number; publishedAt: string
    parentId?: string
    authorChannelId?: { value?: string }
  }
}

function toComment(raw: RawYtComment, parentId?: string): YouTubeComment {
  return {
    id: raw.id,
    text: raw.snippet.textOriginal,
    likeCount: raw.snippet.likeCount,
    publishedAt: raw.snippet.publishedAt,
    // Autore: solo snippet.authorChannelId.value. La sonda 9.0.2 conferma che
    // snippet.channelId è il canale del VIDEO: mai usarlo come autore; il display
    // name non viene letto.
    ...(authorChannelIdOf(raw.snippet.authorChannelId)),
    ...(parentId ? { parentId } : {}),
  }
}

function keepComment(c: YouTubeComment): boolean {
  return typeof c.text === 'string' && isRecentEnough(c.publishedAt) && isValidComment(c.text) && isUsefulComment(c.text)
}

/** Commenti principali + risposte restituite insieme (part=replies: YouTube ne include
 * solo una parte per thread). Ordine: thread per "mi piace" del commento principale,
 * ogni risposta subito dopo il suo commento, così il contesto resta leggibile.
 * Una risposta utile resta anche se il commento principale è stato scartato. */
export async function fetchComments(videoId: string): Promise<YouTubeComment[]> {
  const url = `${YT_API}/commentThreads?part=snippet,replies&videoId=${videoId}&maxResults=${MAX_COMMENTS_PER_VIDEO}&order=relevance&key=${getApiKey()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const data = await res.json() as {
    items?: { snippet: { topLevelComment: RawYtComment }; replies?: { comments?: RawYtComment[] } }[]
  }
  const threads = (data.items ?? [])
    .filter(i => i?.snippet?.topLevelComment?.snippet)
    .map(i => {
      const top = toComment(i.snippet.topLevelComment)
      const replies = (i.replies?.comments ?? [])
        .filter(r => r?.snippet)
        .map(r => toComment(r, r.snippet.parentId || top.id))
        .filter(keepComment)
        .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
      return { top, keepTop: keepComment(top), replies }
    })
    .sort((a, b) => b.top.likeCount - a.top.likeCount)
  return threads.flatMap(t => [...(t.keepTop ? [t.top] : []), ...t.replies])
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
