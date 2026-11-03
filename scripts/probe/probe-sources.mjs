#!/usr/bin/env node
// Sonda BookInsight 9.0.2 — NON usata in produzione, non importata dall'app.
//
// Scarica UN campione reale da Apify (fatihtahta~reddit-scraper-search-fast),
// YouTube Data API (commentThreads + videos) e SerpApi (amazon_product), poi salva:
//   lib/__fixtures__/probe-9.0.2/<fonte>.sample.json   fixture ANONIMIZZATE
//   lib/__fixtures__/probe-9.0.2/probe-report.json     solo struttura e conteggi, nessun valore
// Le credenziali si leggono SOLO da variabili d'ambiente e non vengono mai stampate
// né scritte su file. Il payload grezzo non viene salvato, salvo PROBE_SAVE_RAW=1
// (cartella .probe-raw/, esclusa da git: contiene dati personali, cancellarla dopo l'uso).
//
// Uso (dalla root del repository, istruzioni complete in scripts/probe/README.md):
//   APIFY_TOKEN=... YOUTUBE_API_KEY=... SERPAPI_KEY=... \
//   PROBE_REDDIT_URL='https://www.reddit.com/r/<sub>/comments/<id>/<slug>/' \
//   PROBE_YT_VIDEO_ID='<videoId>' PROBE_ASIN='<asin>' [PROBE_AMAZON_DOMAIN=amazon.com] \
//   node scripts/probe/probe-sources.mjs
// Ogni fonte è saltata se manca la sua credenziale o il suo input.

import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAnonymizer, describeShape, idFormat } from './anonymize.mjs'

const OUT_DIR = join(process.cwd(), 'lib', '__fixtures__', 'probe-9.0.2')
const RAW_DIR = join(process.cwd(), '.probe-raw')
const env = process.env

// Messaggi d'errore ripuliti da qualunque segreto presente nell'ambiente.
const SECRETS = [env.APIFY_TOKEN, env.YOUTUBE_API_KEY, env.SERPAPI_KEY].filter(Boolean)
function redact(text) {
  let out = String(text)
  for (const s of SECRETS) out = out.split(s).join('<redacted>')
  return out.replace(/(token|key|api_key)=[^&\s]+/gi, '$1=<redacted>')
}

async function getJson(url, init = {}, timeoutMs = 60_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${redact(body.slice(0, 300))}`)
  return JSON.parse(body)
}

function shapeTable(value) {
  return Object.fromEntries([...describeShape(value)].map(([p, e]) => [p, e.types]))
}
function countBy(values) {
  const out = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}
function keysOf(items) {
  return countBy(items.flatMap(i => (i && typeof i === 'object' ? Object.keys(i) : [])))
}

// ─── Reddit via Apify ───────────────────────────────────────────────────────

async function probeReddit() {
  if (!env.APIFY_TOKEN || !env.PROBE_REDDIT_URL) return { skipped: 'APIFY_TOKEN o PROBE_REDDIT_URL mancante' }
  if (!/^https:\/\/(www\.)?reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+\//i.test(env.PROBE_REDDIT_URL)) {
    throw new Error('PROBE_REDDIT_URL non nel formato https://www.reddit.com/r/<sub>/comments/<id>/<titolo>/ (i link di condivisione /s/ non vanno bene)')
  }
  // Stesso input usato da lib/reddit.ts. Token nell'header, non nell'URL.
  const items = await getJson(
    'https://api.apify.com/v2/acts/fatihtahta~reddit-scraper-search-fast/run-sync-get-dataset-items?timeout=45',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APIFY_TOKEN}` },
      body: JSON.stringify({ urls: [env.PROBE_REDDIT_URL], scrapeComments: true, maxComments: 40, includeNsfw: false }),
    },
    90_000,
  )
  if (!Array.isArray(items)) throw new Error('risposta Apify non è un array')
  const posts = items.filter(i => i.kind === 'post')
  const comments = items.filter(i => i.kind === 'comment')
  const parentKeys = [...new Set(items.flatMap(i => Object.keys(i)).filter(k => /parent/i.test(k)))]
  const authorKeys = [...new Set(items.flatMap(i => Object.keys(i)).filter(k => /author|user/i.test(k)))]
  const commentIds = new Set(comments.map(c => String(c.id ?? '').replace(/^t1_/, '')))
  const postIds = new Set(posts.map(p => String(p.id ?? '').replace(/^t3_/, '')))
  const parentResolution = {}
  for (const k of parentKeys) {
    parentResolution[k] = countBy(comments.map(c => {
      const v = c[k]
      if (typeof v !== 'string' || !v) return 'absent'
      const core = v.replace(/^t[13]_/, '')
      if (postIds.has(core)) return `points-to-post(${v.match(/^t\d_/)?.[0] ?? 'no-prefix'})`
      if (commentIds.has(core)) return `points-to-comment-in-sample(${v.match(/^t\d_/)?.[0] ?? 'no-prefix'})`
      return `points-outside-sample(${v.match(/^t\d_/)?.[0] ?? 'no-prefix'})`
    }))
  }
  const report = {
    itemCount: items.length,
    kinds: countBy(items.map(i => String(i.kind))),
    postKeys: keysOf(posts),
    commentKeys: keysOf(comments),
    parentLikeKeys: parentKeys,
    authorLikeKeys: authorKeys,
    parentResolution,
    postIdFormats: countBy(posts.map(p => idFormat(p.id))),
    commentIdFormats: countBy(comments.map(c => idFormat(c.id))),
    commentPostIdFormats: countBy(comments.map(c => idFormat(c.postId))),
    postAuthor: countBy(posts.map(p => authorClass(p.author))),
    commentAuthor: countBy(comments.map(c => authorClass(c.author))),
    commentCreatedFormat: countBy(comments.map(c => dateClass(c.created_utc))),
    shape: shapeTable(items),
  }
  const warning = items.length === 0
    ? 'dataset vuoto: link non nel formato /r/<sub>/comments/<id>/, thread rimosso/privato/NSFW o actor non concluso entro 45 s'
    : undefined
  return { raw: items, sample: items, report, warning }
}

function authorClass(v) {
  if (v === undefined) return 'absent'
  if (v === null) return 'null'
  if (typeof v !== 'string') return `non-string:${typeof v}`
  if (v === '') return 'empty'
  if (v === '[deleted]' || v === '[removed]') return v
  if (v === 'AutoModerator') return 'AutoModerator'
  if (/bot$/i.test(v)) return 'name-ends-with-bot'
  return 'present'
}
function dateClass(v) {
  if (v === undefined || v === null || v === '') return 'absent'
  if (typeof v === 'number') return v > 1e12 ? 'epoch-ms' : 'epoch-s'
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? 'iso-datetime' : /^\d+$/.test(v) ? 'numeric-string' : 'other-string'
  return typeof v
}

// ─── YouTube Data API ───────────────────────────────────────────────────────

async function probeYouTube() {
  if (!env.YOUTUBE_API_KEY || !env.PROBE_YT_VIDEO_ID) return { skipped: 'YOUTUBE_API_KEY o PROBE_YT_VIDEO_ID mancante' }
  const base = 'https://www.googleapis.com/youtube/v3'
  const vid = encodeURIComponent(env.PROBE_YT_VIDEO_ID)
  const key = encodeURIComponent(env.YOUTUBE_API_KEY)
  // part=snippet come in produzione + replies per osservare parentId delle risposte (non usate in 9.0.2).
  const threads = await getJson(`${base}/commentThreads?part=snippet,replies&videoId=${vid}&maxResults=20&order=relevance&key=${key}`)
  const videos = await getJson(`${base}/videos?part=snippet,statistics&id=${vid}&key=${key}`)
  const items = threads.items ?? []
  const top = items.map(i => i.snippet?.topLevelComment)
  const videoChannelId = videos.items?.[0]?.snippet?.channelId
  const replies = items.flatMap(i => i.replies?.comments ?? [])
  const report = {
    threadCount: items.length,
    threadSnippetKeys: keysOf(items.map(i => i.snippet)),
    topLevelCommentKeys: keysOf(top),
    topLevelSnippetKeys: keysOf(top.map(t => t?.snippet)),
    authorChannelIdShape: countBy(top.map(t => {
      const a = t?.snippet?.authorChannelId
      if (a === undefined) return 'absent'
      if (a && typeof a === 'object') return `object{${Object.keys(a).join(',')}} value:${idFormat(a.value)}`
      return `string ${idFormat(a)}`
    })),
    threadSnippetChannelIdVsVideoChannel: countBy(items.map(i => {
      const c = i.snippet?.channelId
      if (c === undefined) return 'absent'
      if (!videoChannelId) return 'video-channel-unknown'
      return c === videoChannelId ? 'equals-video-channelId' : 'differs-from-video-channelId'
    })),
    topLevelSnippetChannelIdVsVideoChannel: countBy(top.map(t => {
      const c = t?.snippet?.channelId
      if (c === undefined) return 'absent'
      return c === videoChannelId ? 'equals-video-channelId' : 'differs-from-video-channelId'
    })),
    commentsByVideoOwner: top.filter(t => videoChannelId && t?.snippet?.authorChannelId?.value === videoChannelId).length,
    textOriginalPresence: countBy(top.map(t => typeof t?.snippet?.textOriginal === 'string' ? 'string' : 'absent')),
    textOriginalEqualsTextDisplay: countBy(top.map(t => String(t?.snippet?.textOriginal === t?.snippet?.textDisplay))),
    topLevelIdFormats: countBy(top.map(t => idFormat(t?.id))),
    replyCount: replies.length,
    replyParentIdResolution: countBy(replies.map(r => {
      const p = r.snippet?.parentId
      if (!p) return 'absent'
      return top.some(t => t?.id === p) ? 'equals-topLevelComment.id' : 'other'
    })),
    replyIdFormats: countBy(replies.map(r => idFormat(r.id))),
    videoSnippetKeys: keysOf((videos.items ?? []).map(v => v.snippet)),
    videoChannelIdFormat: idFormat(videoChannelId),
    shapeThreads: shapeTable(threads),
  }
  const raw = { commentThreads: threads, videos }
  // Il campione tiene il payload intero: description/title/thumbnails vengono anonimizzati.
  return { raw, sample: raw, report }
}

// ─── SerpApi amazon_product ─────────────────────────────────────────────────

async function probeAmazon() {
  if (!env.SERPAPI_KEY || !env.PROBE_ASIN) return { skipped: 'SERPAPI_KEY o PROBE_ASIN mancante' }
  const qs = new URLSearchParams({
    engine: 'amazon_product', asin: env.PROBE_ASIN,
    amazon_domain: env.PROBE_AMAZON_DOMAIN || 'amazon.com', api_key: env.SERPAPI_KEY,
  })
  const data = await getJson(`https://serpapi.com/search?${qs}`)
  const ri = data.reviews_information ?? {}
  const reviewLists = Object.entries(ri).filter(([, v]) => Array.isArray(v))
  const allReviews = reviewLists.flatMap(([, v]) => v)
  const report = {
    topLevelKeys: Object.keys(data),
    reviewsInformationKeys: Object.keys(ri),
    reviewListSizes: Object.fromEntries(reviewLists.map(([k, v]) => [k, v.length])),
    reviewKeys: keysOf(allReviews),
    helpfulFields: {
      helpful_votes: allReviews.filter(r => r && 'helpful_votes' in r).length,
      helpful_count: allReviews.filter(r => r && 'helpful_count' in r).length,
      otherHelpfulLike: [...new Set(allReviews.flatMap(r => Object.keys(r ?? {})).filter(k => /helpful/i.test(k) && !['helpful_votes', 'helpful_count'].includes(k)))],
      valueTypes: countBy(allReviews.flatMap(r => ['helpful_votes', 'helpful_count'].filter(k => r && k in r).map(k => `${k}:${typeof r[k]}`))),
    },
    authorPresence: countBy(allReviews.map(r => r?.author === undefined ? (r?.profile ? 'profile-object' : 'absent') : typeof r.author)),
    datePresence: countBy(allReviews.map(r => r?.date === undefined ? 'absent' : typeof r.date)),
    idPresence: countBy(allReviews.map(r => r?.id === undefined ? 'absent' : idFormat(r.id))),
    shapeReviewsInformation: shapeTable(ri),
  }
  // Nella fixture solo reviews_information: il resto del prodotto non serve a 9.0.2.
  const warning = allReviews.length === 0
    ? `nessuna lista di recensioni singole in reviews_information (chiavi presenti: ${Object.keys(ri).join(', ') || 'nessuna'})`
    : undefined
  return { raw: data, sample: { reviews_information: ri }, report, warning }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const salt = randomBytes(32).toString('hex') // non salvato: pseudonimi non reversibili fra esecuzioni
  const anon = createAnonymizer(salt)
  mkdirSync(OUT_DIR, { recursive: true })
  const summary = { probeVersion: '9.0.2-probe-1', generatedAt: new Date().toISOString(), sources: {} }

  for (const [name, fn] of [['apify-reddit', probeReddit], ['youtube', probeYouTube], ['serpapi-amazon_product', probeAmazon]]) {
    try {
      const res = await fn()
      if (res.skipped) {
        summary.sources[name] = { status: 'skipped', reason: res.skipped }
        console.log(`[probe] ${name}: saltata (${res.skipped})`)
        continue
      }
      if (env.PROBE_SAVE_RAW === '1') {
        mkdirSync(RAW_DIR, { recursive: true })
        writeFileSync(join(RAW_DIR, `${name}.raw.json`), JSON.stringify(res.raw, null, 2))
      }
      writeFileSync(join(OUT_DIR, `${name}.sample.json`), JSON.stringify(anon.anonymize(res.sample), null, 2) + '\n')
      summary.sources[name] = res.warning ? { status: 'empty', warning: res.warning, ...res.report } : { status: 'ok', ...res.report }
      console.log(res.warning ? `[probe] ${name}: VUOTA (${res.warning})` : `[probe] ${name}: ok`)
    } catch (err) {
      summary.sources[name] = { status: 'failed', error: redact(err?.message ?? err) }
      console.log(`[probe] ${name}: FALLITA ${redact(err?.message ?? err)}`)
    }
  }
  summary.anonymizer = anon.stats()
  writeFileSync(join(OUT_DIR, 'probe-report.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(`[probe] report: ${join('lib', '__fixtures__', 'probe-9.0.2', 'probe-report.json')}`)
  console.log('[probe] Controllare manualmente le fixture prima del commit (nessun nome, testo o URL personale).')
}

main().catch(err => {
  console.error(`[probe] errore: ${redact(err?.message ?? err)}`)
  process.exit(1)
})
