import { preparePainPointCorpus, REDDIT_CORPUS_LIMITS } from './reddit-corpus'
import type {
  RedditData, YouTubeData, SocialCommentProvenance, SocialCorpusManifest,
  SocialContext, SocialPlatform, SocialRecord,
} from './types'

// Stessa pulizia applicata dal wrapper AI, dopo il taglio dell'estratto.
export function transmittedText(text: string, limit: number): string {
  return text.slice(0, limit).replace(/\p{Surrogate}/gu, '')
}

function originalId(platform: SocialPlatform, value: string | undefined, kind: 'comment' | 'container'): string | undefined {
  const raw = value?.trim()
  const prefix = kind === 'comment' ? 't1_' : 't3_'
  // Il fullname Reddit dichiara anche il tipo: un post non identifica un commento.
  if (platform === 'reddit' && /^t\d_/.test(raw ?? '') && !raw?.startsWith(prefix)) return
  const id = platform === 'reddit' && raw?.startsWith(prefix) ? raw.slice(prefix.length) : raw
  return id && (platform === 'reddit' ? /^[a-z0-9]+$/i : /^[\w-]+$/).test(id)
    ? (platform === 'reddit' ? id.toLowerCase() : id) : undefined
}

function publishedDate(seconds: number): string | undefined {
  const date = new Date(seconds * 1000)
  return seconds > 0 && Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function redditUrl(value?: string): { url: string; threadId: string; commentId?: string } | undefined {
  if (!value || (!value.startsWith('/') && !/^https?:\/\//i.test(value))) return
  try {
    const url = new URL(value, 'https://www.reddit.com')
    if (url.hostname !== 'reddit.com' && !url.hostname.endsWith('.reddit.com')) return
    const match = url.pathname.match(/^\/r\/[^/]+\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?\/?$/i)
    if (!match) return
    url.hash = ''
    url.search = ''
    return { url: url.toString(), threadId: match[1].toLowerCase(), commentId: match[2]?.toLowerCase() }
  } catch { return }
}

function author(platform: SocialPlatform, provenance?: SocialCommentProvenance, username?: string) {
  const name = (username ?? provenance?.authorName ?? '').trim()
  const deleted = /^\[(deleted|removed)\]$/i.test(name)
  const unknown = !name || deleted || /^\[(anonymous|unknown)\]$/i.test(name)
  const accountId = provenance?.authorId?.trim()
  // L'ID account identifica l'autore anche se il display name è un placeholder.
  // YouTube: il solo display name, invece, non identifica un account.
  if (accountId) return {
    authorKey: `${platform}:account:${accountId}`,
    authorIdentityType: 'account_id' as const, authorStatus: 'identified' as const,
  }
  if (platform === 'reddit' && !unknown) return {
    authorKey: `reddit:username:${name.toLowerCase()}`,
    authorIdentityType: 'username' as const, authorStatus: 'identified' as const,
  }
  return { authorIdentityType: 'unknown' as const, authorStatus: deleted ? 'deleted' as const : 'unknown' as const }
}

function makeRecord(
  context: SocialContext, index: number, id: string, text: string,
  provenance?: SocialCommentProvenance, username?: string, publishedAt?: string,
): SocialRecord {
  const platform = context.platform
  const link = platform === 'reddit' ? redditUrl(provenance?.commentUrl) : undefined
  const sourceId = provenance
    ? provenance.idStatus === 'original' ? originalId(platform, provenance.originalId, 'comment') : undefined
    : originalId(platform, id, 'comment')
  const sourceCommentId = sourceId ?? (link && link.threadId === context.containerId ? link.commentId : undefined)
  const mismatch = (!!link && (link.threadId !== context.containerId ||
    (!!sourceId && !!link.commentId && link.commentId !== sourceId))) ||
    (!!provenance?.containerId && originalId(platform, provenance.containerId, 'container') !== context.containerId)
  const receivedUrl = link?.commentId && link.threadId === context.containerId && link.commentId === sourceCommentId
    ? link.url : undefined
  const reconstructedUrl = context.containerId && sourceCommentId
    ? platform === 'youtube'
      ? `https://www.youtube.com/watch?v=${context.containerId}&lc=${sourceCommentId}`
      : `https://www.reddit.com/comments/${context.containerId}/comment/${sourceCommentId}/`
    : undefined
  return {
    recordId: `${context.contextId}:comment:${index}`,
    platform, contextId: context.contextId, containerId: context.containerId,
    sourceCommentId,
    identityStatus: mismatch ? 'conflict' : sourceCommentId ? 'original'
      : provenance?.idStatus === 'synthetic' || /^c_/.test(id) ? 'synthetic' : 'missing',
    ...author(platform, provenance, username),
    parentId: provenance?.parentId,
    commentUrl: receivedUrl ?? reconstructedUrl,
    commentUrlOrigin: receivedUrl ? 'received' : reconstructedUrl ? 'reconstructed' : undefined,
    publishedAt,
    text,
    transmittedText: transmittedText(text, REDDIT_CORPUS_LIMITS.maxCommentChars),
    truncated: text.length > REDDIT_CORPUS_LIMITS.maxCommentChars,
    possibleCopy: false,
  }
}

/** Snapshot del solo corpus ammesso al prompt 9.0.1. Non modifica selezione,
 * ranking, filtri o testo del prompt originale. Il selftext è solo contesto.
 */
export function buildSocialManifest(reddit: RedditData, youtube?: YouTubeData): SocialCorpusManifest {
  const prepared = preparePainPointCorpus(reddit, youtube)
  const manifest: SocialCorpusManifest = { version: '9.0.2', contexts: [], records: [] }
  prepared.reddit.posts.forEach((post, i) => {
    const link = redditUrl(post.link)
    const containerId = link?.threadId ?? originalId('reddit', post.id, 'container')
    const context: SocialContext = {
      contextId: `reddit:post:${i}`, platform: 'reddit', containerId,
      title: transmittedText(post.title, post.title.length),
      transmittedText: transmittedText(post.selftext ?? '', REDDIT_CORPUS_LIMITS.maxSelftextChars),
      sourceUrl: link?.url ?? (containerId ? `https://www.reddit.com/comments/${containerId}/` : undefined),
      sourceUrlOrigin: link ? 'received' : containerId ? 'reconstructed' : undefined,
    }
    manifest.contexts.push(context)
    post.comments.forEach((c, j) => manifest.records.push(makeRecord(
      context, j, c.id, c.body, c.provenance, c.author,
      publishedDate(c.createdUtc),
    )))
  })
  prepared.youtube?.videos.forEach((video, i) => {
    const containerId = originalId('youtube', video.id, 'container')
    const context: SocialContext = {
      contextId: `youtube:video:${i}`, platform: 'youtube', containerId,
      title: transmittedText(video.title, video.title.length), transmittedText: '',
      sourceUrl: containerId ? `https://www.youtube.com/watch?v=${containerId}` : undefined,
      sourceUrlOrigin: containerId ? 'reconstructed' : undefined,
    }
    manifest.contexts.push(context)
    video.comments.forEach((c, j) => manifest.records.push(makeRecord(
      context, j, c.id, c.text, c.provenance, undefined, c.publishedAt,
    )))
  })

  // Ispeziona anche i duplicati che prepareRedditCorpus ha già rimosso.
  // Un conflitto non deve scomparire solo perché il prompt tiene la prima copia.
  const signatures = new Map<string, string>()
  const conflicts = new Set<string>()
  const inspect = (record: SocialRecord) => {
    if (!record.sourceCommentId) return
    const key = `${record.platform}:${record.sourceCommentId}`
    const signature = JSON.stringify([record.containerId, record.text, record.authorKey ?? record.authorStatus, record.parentId])
    const previous = signatures.get(key)
    if ((previous && previous !== signature) || record.identityStatus === 'conflict') conflicts.add(key)
    signatures.set(key, signature)
  }
  manifest.records.forEach(inspect)
  if (reddit.available) reddit.posts.forEach(post => {
    const containerId = redditUrl(post.link)?.threadId ?? originalId('reddit', post.id, 'container')
    const context: SocialContext = { contextId: 'audit', platform: 'reddit', containerId, title: '', transmittedText: '' }
    post.comments.forEach((c, i) => inspect(makeRecord(context, i, c.id, c.body, c.provenance, c.author)))
  })

  const seen = new Map<string, SocialRecord>()
  const texts = new Map<string, SocialRecord>()
  for (const record of manifest.records) {
    const key = record.sourceCommentId ? `${record.platform}:${record.sourceCommentId}` : undefined
    if (key && conflicts.has(key)) record.identityStatus = 'conflict'
    const previous = key ? seen.get(key) : undefined
    if (previous) record.duplicateOf = previous.recordId
    else if (key) seen.set(key, record)
    const textKey = JSON.stringify([record.platform, record.containerId ?? record.contextId, record.text.trim()])
    const sameText = texts.get(textKey)
    if (sameText && !record.duplicateOf) { record.possibleCopy = true; sameText.possibleCopy = true }
    else if (!sameText) texts.set(textKey, record)
  }
  for (const record of manifest.records) {
    if (record.platform !== 'reddit' || !record.parentId?.startsWith('t1_')) continue
    const parent = seen.get(`reddit:${originalId('reddit', record.parentId, 'comment')}`)
    if (parent && parent.contextId === record.contextId) record.parentRecordId = parent.recordId
  }
  return manifest
}
