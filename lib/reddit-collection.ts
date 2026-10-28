import type { RedditCollectionDiagnostics, RedditFetchOutcome, RedditRawSchema } from './types'

export type ApifyItem = Record<string, unknown>
export type RedditFetchResult = { items: ApifyItem[]; outcome: RedditFetchOutcome; httpStatus?: number; runId?: string; datasetId?: string; retryAfterMs?: number; schema?: RedditRawSchema }

export function planRedditQueries(keyword: string, expansions: string[]): string[] {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  return [...new Set([keyword, ...expansions].filter(s => typeof s === 'string').map(clean).filter(Boolean))].slice(0, 5)
}

export function redditThreadId(link: string): string | null {
  try {
    const url = new URL(link)
    if (!['http:', 'https:'].includes(url.protocol) || (url.hostname !== 'reddit.com' && !url.hostname.endsWith('.reddit.com'))) return null
    return url.pathname.match(/^\/r\/[^/]+\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1].toLowerCase() ?? null
  } catch { return null }
}

const object = (v: unknown): v is ApifyItem => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Solo nomi di campi e quantità, senza testi, credenziali o valori degli autori. */
export function profileRedditItems(items: unknown[]): RedditRawSchema {
  const posts = items.filter((v): v is ApifyItem => object(v) && v.kind === 'post')
  const comments = items.filter((v): v is ApifyItem => object(v) && v.kind === 'comment')
  const fields = (rows: ApifyItem[]) => [...new Set(rows.flatMap(r => Object.keys(r)))].sort().slice(0, 80)
  const names = ['id', 'postId', 'author', 'author_id', 'authorId', 'author_fullname', 'authorFullname', 'parent_id', 'parentId', 'url', 'permalink']
  return {
    itemCount: items.length, posts: posts.length, comments: comments.length,
    unrecognizedItems: items.length - posts.length - comments.length,
    postFields: fields(posts), commentFields: fields(comments),
    commentFieldPresence: Object.fromEntries(names.map(key => [key, comments.filter(r => r[key] !== null && r[key] !== undefined && r[key] !== '').length])),
    authorObjectFields: fields(comments.flatMap(r => object(r.author) ? [r.author] : [])),
  }
}

export function originalRedditAccount(item: ApifyItem): string | undefined {
  for (const key of ['author_fullname', 'authorFullname', 'author_id', 'authorId']) {
    const value = item[key]
    if (typeof value === 'string' && /^t2_[a-z0-9]+$/i.test(value.trim())) return value.trim().toLowerCase()
  }
}

export function newRedditDiagnostics(): RedditCollectionDiagnostics {
  return { version: '9.0.2', status: 'not_run', queries: [], candidateUrls: 0, selectedUrls: [], attempts: [], recoveredUrls: [], unavailableUrls: [], unattemptedUrls: [], skippedRetries: [], budgetExhausted: false }
}

/** Coda generale: prima tutti gli URL iniziali, poi un recupero per esito
 * transitorio. Cinque richieste al massimo; l'ordine dei risultati resta quello
 * dei candidati, indipendentemente dai tempi di risposta dei singoli URL. */
export async function collectRedditPosts(
  urls: string[], fetchPost: (url: string, signal: AbortSignal) => Promise<RedditFetchResult>, fetchStart: number,
  options: { now?: () => number; concurrency?: number; budgetMs?: number; requestTimeoutMs?: number; retryDelayMs?: number } = {},
) {
  const now = options.now ?? Date.now, deadline = fetchStart + (options.budgetMs ?? 90_000)
  const uniqueUrls = [...new Set(urls)], diagnostics = newRedditDiagnostics()
  diagnostics.selectedUrls = uniqueUrls
  const jobs = uniqueUrls.map(url => ({ url, attempt: 1 as 1 | 2 }))
  const collected = new Map<string, RedditFetchResult>(), attempted = new Set<string>()
  let cursor = 0, providerRejected = false
  const retryable = (r: RedditFetchResult) => r.outcome === 'empty_dataset' || r.outcome === 'timeout' || r.outcome === 'network_error' ||
    (r.outcome === 'http_error' && (r.httpStatus === 429 || (r.httpStatus ?? 0) >= 500))
  async function execute(url: string): Promise<RedditFetchResult> {
    const controller = new AbortController()
    let onAbort: () => void = () => {}
    const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 50_000)
    try {
      return await Promise.race([fetchPost(url, controller.signal), new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('request_timeout'))
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })])
    } catch {
      return { items: [], outcome: controller.signal.aborted ? 'timeout' : 'network_error' }
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort) }
  }
  const worker = async () => {
    while (cursor < jobs.length && !providerRejected) {
      const job = jobs[cursor++]
      if (job.attempt === 2) {
        const delay = Math.max(options.retryDelayMs ?? 3000, collected.get(job.url)?.retryAfterMs ?? 0)
        if (now() + delay >= deadline) { diagnostics.budgetExhausted = true; diagnostics.skippedRetries.push(job.url); continue }
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      }
      if (providerRejected) break
      if (now() >= deadline) {
        diagnostics.budgetExhausted = true
        if (job.attempt === 2) diagnostics.skippedRetries.push(job.url)
        continue
      }
      attempted.add(job.url)
      const started = now(), result = await execute(job.url)
      const { items, ...metadata } = result
      diagnostics.attempts.push({ url: job.url, attempt: job.attempt, durationMs: now() - started, ...metadata })
      collected.set(job.url, result)
      if (result.outcome === 'http_error' && [401, 402, 403, 404].includes(result.httpStatus ?? 0)) providerRejected = true
      if (job.attempt === 1 && retryable(result) && !providerRejected) jobs.push({ url: job.url, attempt: 2 })
      // Il payload grezzo non viene registrato nei diagnostici.
      void items
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(5, options.concurrency ?? 5)) }, worker))
  diagnostics.recoveredUrls = uniqueUrls.filter(url => collected.get(url)?.outcome === 'success' && diagnostics.attempts.some(a => a.url === url && a.attempt === 2))
  diagnostics.unattemptedUrls = uniqueUrls.filter(url => !attempted.has(url))
  diagnostics.unavailableUrls = uniqueUrls.filter(url => attempted.has(url) && collected.get(url)?.outcome !== 'success')
  if (providerRejected) diagnostics.stopReason = 'provider_rejected'
  const successCount = uniqueUrls.filter(url => collected.get(url)?.outcome === 'success').length
  const schemaWarnings = diagnostics.attempts.some(a => a.outcome === 'success' && (a.schema?.unrecognizedItems ?? 0) > 0)
  diagnostics.status = !attempted.size ? 'not_run' : !successCount ? 'failed' :
    diagnostics.unavailableUrls.length || diagnostics.unattemptedUrls.length || schemaWarnings ? 'partial' : 'complete'
  return {
    allItems: uniqueUrls.flatMap(url => collected.get(url)?.outcome === 'success' ? collected.get(url)!.items : []),
    successCount, failureCount: diagnostics.unavailableUrls.length, diagnostics,
  }
}
