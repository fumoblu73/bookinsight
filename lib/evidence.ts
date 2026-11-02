import { createHash } from 'node:crypto'
import { preparePainPointCorpus, REDDIT_CORPUS_LIMITS, redditThreadId } from './reddit-corpus'
import type {
  EvidenceAuthorKind, EvidenceRecord, EvidenceSource, RedditComment, RedditData, YouTubeData,
} from './types'

/** Limite del testo commento YouTube nel prompt di estrazione (lib/prompts.ts). */
export const YOUTUBE_COMMENT_CHARS = 300

export interface EvidenceSourceStats {
  records: number
  D: number            // authorKey distinti fra i record trasmessi (autori dei post inclusi)
  K: number            // thread/video con almeno un record trasmesso
  authorKnownRate: number | null // record con authorKey / record; null se nessun record
}

export interface EvidenceIndex {
  records: EvidenceRecord[]
  stats: Record<EvidenceSource, EvidenceSourceStats>
}

export interface BuildEvidenceIndexOptions {
  /** Sale casuale per analisi, NON da salvare: rende i pseudonimi non collegabili
   * fra analisi diverse. Obbligatorio. */
  authorSalt: string
}

// ─── Autori ─────────────────────────────────────────────────────────────────

const REDDIT_BOTS = new Set(['automoderator', 'remindmebot', 'sneakpeekbot', 'wikisummarizerbot', 'b0trank'])

/** Restituisce lo username Reddit normalizzato, oppure null per autori non
 * identificabili: vuoto, [deleted], [removed], bot noti o nomi con suffisso bot
 * esplicito (…Bot in CamelCase, …_bot, …-bot). Euristica conservativa: un nome
 * come "abbot" non è considerato bot. */
export function normalizeRedditAuthor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/^\/?u\//i, '')
  if (!trimmed || /^\[(deleted|removed)\]$/i.test(trimmed)) return null
  if (REDDIT_BOTS.has(trimmed.toLowerCase())) return null
  if (/[a-z0-9]Bot$/.test(trimmed) || /[_-]bot$/i.test(trimmed)) return null
  return trimmed.toLowerCase() // gli username Reddit non distinguono maiuscole
}

/** YouTube: solo l'ID del canale autore. Il display name non è mai usato. */
export function normalizeYouTubeAuthor(channelId: string | null | undefined): string | null {
  if (typeof channelId !== 'string') return null
  const trimmed = channelId.trim()
  return trimmed ? trimmed : null
}

export function pseudonymizeAuthor(kind: EvidenceAuthorKind, normalized: string | null, salt: string): string | null {
  if (normalized === null) return null
  const digest = createHash('sha256').update(`${salt}\u0000${kind}\u0000${normalized}`).digest('hex')
  return `${kind}:${digest.slice(0, 16)}`
}

// ─── ID ─────────────────────────────────────────────────────────────────────

/** ID sintetici generati dal collector (c_<postId>_<n>, g_<n>). Per i dati
 * precedenti alla 9.0.2, privi di idSource, si riconosce il formato. */
function isSyntheticCommentId(c: RedditComment): boolean {
  if (c.idSource) return c.idSource === 'synthetic'
  return !c.id || /^c_.+_\d+$/.test(c.id)
}
const redditCore = (id: string) => id.trim().replace(/^t[13]_/i, '').toLowerCase()

/** Risolve il genitore di un commento Reddit. Prefissi t1_ (commento) e t3_
 * (post) secondo la convenzione Reddit; senza prefisso si cerca prima fra i
 * commenti, poi il post dello stesso thread. Il formato reale del campo Apify è
 * da confermare con la sonda: senza parentId il risultato è null. */
function redditParentKey(parentId: string | undefined, threadId: string, commentKeyById: Map<string, string>): string | null {
  if (typeof parentId !== 'string' || !parentId.trim()) return null
  const raw = parentId.trim()
  const core = redditCore(raw)
  if (!core) return null
  if (/^t3_/i.test(raw)) return `reddit:post:${core}`
  if (/^t1_/i.test(raw)) return `reddit:comment:${core}`
  if (commentKeyById.has(core)) return commentKeyById.get(core)!
  if (core === threadId) return `reddit:post:${core}`
  return null
}

// ─── Indice ─────────────────────────────────────────────────────────────────

/** Costruisce l'indice dei SOLI record trasmessi al prompt di estrazione,
 * usando la stessa selezione (preparePainPointCorpus) e gli stessi troncamenti.
 * Funzione pura: nessun I/O; il sale è fornito dal chiamante. */
export function buildEvidenceIndex(
  input: { reddit: RedditData; youtube?: YouTubeData },
  options: BuildEvidenceIndexOptions,
): EvidenceIndex {
  if (!options.authorSalt) throw new Error('buildEvidenceIndex: authorSalt obbligatorio')
  const salt = options.authorSalt
  const prepared = preparePainPointCorpus(input.reddit, input.youtube)
  const records: EvidenceRecord[] = []
  const seen = new Set<string>()
  const counters = { R: 0, Y: 0 }
  const push = (r: Omit<EvidenceRecord, 'alias'>, prefix: 'R' | 'Y') => {
    if (seen.has(r.recordKey)) return
    seen.add(r.recordKey)
    records.push({ ...r, alias: `${prefix}${++counters[prefix]}` })
  }

  if (prepared.reddit.quality.usable) {
    for (const post of prepared.reddit.posts) {
      const tid = redditThreadId(post)
      const threadId = `reddit:${tid}`
      const postKey = `reddit:post:${tid}`
      const selftext = post.selftext ?? ''
      push({
        recordKey: postKey, source: 'reddit', type: 'post',
        // Thread reale solo se l'ID è base36 Reddit (da URL o collector); g_<n> e
        // il fallback subreddit:titolo non sono riconducibili al post originale.
        sourceItemId: /^[a-z0-9]+$/.test(tid) ? tid : null,
        threadId,
        authorKey: pseudonymizeAuthor('reddit_user', normalizeRedditAuthor(post.author), salt),
        parentKey: null,
        text: selftext.substring(0, REDDIT_CORPUS_LIMITS.maxSelftextChars),
        truncated: selftext.length > REDDIT_CORPUS_LIMITS.maxSelftextChars,
      }, 'R')

      const commentKeyById = new Map<string, string>()
      const keys = post.comments.map((c, i) => {
        const synthetic = isSyntheticCommentId(c)
        const key = synthetic ? `reddit:comment:~${tid}:${i}` : `reddit:comment:${redditCore(c.id)}`
        if (!synthetic) commentKeyById.set(redditCore(c.id), key)
        return { key, synthetic }
      })
      post.comments.forEach((c, i) => {
        const body = c.body ?? ''
        push({
          recordKey: keys[i].key, source: 'reddit', type: 'comment',
          sourceItemId: keys[i].synthetic ? null : redditCore(c.id),
          threadId,
          authorKey: pseudonymizeAuthor('reddit_user', normalizeRedditAuthor(c.author), salt),
          parentKey: redditParentKey(c.parentId, tid, commentKeyById),
          text: body.substring(0, REDDIT_CORPUS_LIMITS.maxCommentChars),
          truncated: body.length > REDDIT_CORPUS_LIMITS.maxCommentChars,
        }, 'R')
      })
    }
  }

  for (const video of prepared.youtube?.videos ?? []) {
    video.comments.forEach((c, i) => {
      const text = c.text ?? ''
      const hasId = typeof c.id === 'string' && c.id.trim().length > 0
      push({
        recordKey: hasId ? `youtube:comment:${c.id.trim()}` : `youtube:comment:~${video.id}:${i}`,
        source: 'youtube', type: 'comment',
        sourceItemId: hasId ? c.id.trim() : null,
        threadId: `youtube:${video.id}`,
        authorKey: pseudonymizeAuthor('youtube_channel', normalizeYouTubeAuthor(c.authorChannelId), salt),
        parentKey: null, // risposte YouTube rinviate: solo commenti di primo livello
        text: text.substring(0, YOUTUBE_COMMENT_CHARS),
        truncated: text.length > YOUTUBE_COMMENT_CHARS,
      }, 'Y')
    })
  }

  return { records, stats: { reddit: statsFor(records, 'reddit'), youtube: statsFor(records, 'youtube') } }
}

function statsFor(records: EvidenceRecord[], source: EvidenceSource): EvidenceSourceStats {
  const own = records.filter(r => r.source === source)
  const known = own.filter(r => r.authorKey !== null)
  return {
    records: own.length,
    D: new Set(known.map(r => r.authorKey)).size,
    K: new Set(own.map(r => r.threadId)).size,
    authorKnownRate: own.length > 0 ? known.length / own.length : null,
  }
}

export function recordsByKey(index: EvidenceIndex): Map<string, EvidenceRecord> {
  return new Map(index.records.map(r => [r.recordKey, r]))
}
