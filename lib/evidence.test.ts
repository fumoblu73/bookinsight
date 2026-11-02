import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEvidenceIndex, normalizeRedditAuthor, normalizeYouTubeAuthor, pseudonymizeAuthor, recordsByKey } from './evidence'
import { promptPainPointsReddit } from './prompts'
import type { RedditComment, RedditData, RedditPost, YouTubeData } from './types'

// Fixture sintetiche. I campi parentId/author del post/authorChannelId sono
// valorizzati a mano: il loro nome nei payload reali dipende dalla sonda.

const SALT = 'salt-for-tests-only-0123456789'

function comment(id: string, body: string, author: string, extra: Partial<RedditComment> = {}): RedditComment {
  return { id, body, author, score: 1, createdUtc: 1, month: '2026-10', ...extra }
}
function post(id: string, comments: RedditComment[], extra: Partial<RedditPost> = {}): RedditPost {
  return {
    id, title: `Title ${id}`, selftext: `Selftext of ${id}`, score: 1, subreddit: 'camping',
    createdUtc: 1, month: '2026-10', comments, link: `https://www.reddit.com/r/camping/comments/${id}/slug/`, ...extra,
  }
}
function reddit(posts: RedditPost[]): RedditData {
  return {
    keyword: 'k', posts, totalComments: posts.reduce((s, p) => s + p.comments.length, 0),
    subredditsUsed: ['camping'], threadCount: posts.length, available: true, insufficientCorpus: true,
  }
}
function youtube(videos: YouTubeData['videos'], insufficient = false): YouTubeData {
  return {
    keyword: 'k', videos, totalComments: videos.reduce((s, v) => s + v.comments.length, 0),
    available: true, insufficientCorpus: insufficient,
  }
}

test('indicizza solo i record trasmessi, con gli stessi limiti del prompt', () => {
  const long = 'x'.repeat(350)
  const many = Array.from({ length: 35 }, (_, i) => comment(`m${i}`, `comment number ${i} about meals`, `user${i}`))
  const data = reddit([
    post('aaa111', [comment('c1', long, 'alice'), comment('c2', '[deleted]', 'bob'), comment('c3', 'https://x.y', 'carl')],
      { author: 'op_one', selftext: 'y'.repeat(450) }),
    post('bbb222', many),
    post('ccc333', [comment('c4', '[removed]', 'dan')]), // nessun commento utilizzabile → thread escluso
  ])
  const index = buildEvidenceIndex({ reddit: data }, { authorSalt: SALT })
  const r = index.records

  assert.equal(r.filter(x => x.type === 'post').length, 2)
  assert.equal(r.filter(x => x.threadId === 'reddit:bbb222' && x.type === 'comment').length, 30, 'limite 30 commenti/thread')
  assert.ok(!r.some(x => x.threadId === 'reddit:ccc333'))
  assert.ok(!r.some(x => x.sourceItemId === 'c2' || x.sourceItemId === 'c3'), 'esclusi [deleted] e solo-link')

  const c1 = recordsByKey(index).get('reddit:comment:c1')!
  assert.equal(c1.text.length, 300)
  assert.equal(c1.truncated, true)
  const op = recordsByKey(index).get('reddit:post:aaa111')!
  assert.equal(op.text.length, 400)
  assert.equal(op.truncated, true)

  // Ogni testo non vuoto è letteralmente presente nel prompt di estrazione invariato.
  const prompt = promptPainPointsReddit('k', data)
  for (const rec of r) if (rec.text) assert.ok(prompt.includes(rec.text), `testo non trasmesso: ${rec.alias}`)
  // I titoli restano contesto: nessun record ne contiene il testo.
  assert.ok(!r.some(x => x.text.includes('Title ')))
})

test('alias brevi, univoci e sequenziali per piattaforma', () => {
  const index = buildEvidenceIndex({
    reddit: reddit([post('aaa111', [comment('c1', 'first comment here', 'a'), comment('c2', 'second comment here', 'b')])]),
    youtube: youtube([{ id: 'vid1', title: 'V', viewCount: 1, comments: [
      { id: 'Ugx1', text: 'youtube one text', likeCount: 3, publishedAt: '2026-01-01', authorChannelId: 'UCaaa' },
      { id: 'Ugx2', text: 'youtube two text', likeCount: 3, publishedAt: '2026-01-01' },
    ] }]),
  }, { authorSalt: SALT })
  assert.deepEqual(index.records.map(r => r.alias), ['R1', 'R2', 'R3', 'Y1', 'Y2'])
  assert.equal(new Set(index.records.map(r => r.recordKey)).size, 5)
})

test('YouTube escluso dal prompt → nessun record YouTube', () => {
  const index = buildEvidenceIndex({
    reddit: reddit([post('aaa111', [comment('c1', 'a reddit comment', 'a')])]),
    youtube: youtube([{ id: 'v', title: 'V', viewCount: 1, comments: [
      { id: 'Ugx1', text: 'text', likeCount: 3, publishedAt: '2026-01-01', authorChannelId: 'UCa' }] }], true),
  }, { authorSalt: SALT })
  assert.equal(index.records.filter(r => r.source === 'youtube').length, 0)
  assert.equal(index.stats.youtube.authorKnownRate, null)
})

test('normalizzazione autori: cancellati, bot e varianti dello stesso username', () => {
  for (const v of ['', '  ', '[deleted]', '[removed]', 'AutoModerator', 'RemindMeBot', 'SummaryHelperBot', 'helper_bot', 'some-bot', undefined, null]) {
    assert.equal(normalizeRedditAuthor(v as string), null, String(v))
  }
  assert.equal(normalizeRedditAuthor('abbot'), 'abbot', 'nessun falso positivo sul suffisso')
  assert.equal(normalizeRedditAuthor('u/Alice'), normalizeRedditAuthor(' alice '))
  assert.equal(normalizeYouTubeAuthor('  '), null)
  assert.equal(normalizeYouTubeAuthor(undefined), null)
})

test('pseudonimi: tipo di autore etichettato, sale per analisi, nessun valore grezzo', () => {
  const a = pseudonymizeAuthor('reddit_user', 'alice', SALT)!
  assert.match(a, /^reddit_user:[0-9a-f]{16}$/)
  assert.ok(!a.includes('alice'))
  assert.equal(a, pseudonymizeAuthor('reddit_user', 'alice', SALT))
  assert.notEqual(a, pseudonymizeAuthor('reddit_user', 'alice', 'another-salt-0123456789'))
  assert.notEqual(a, pseudonymizeAuthor('youtube_channel', 'alice', SALT))
  assert.throws(() => buildEvidenceIndex({ reddit: reddit([]) }, { authorSalt: '' }))
})

test('YouTube: autore solo da authorChannelId, mai dal display name', () => {
  const index = buildEvidenceIndex({
    reddit: reddit([]),
    youtube: youtube([{ id: 'v1', title: 'V', viewCount: 1, comments: [
      { id: 'Ugx1', text: 'with channel id', likeCount: 3, publishedAt: '2026-01-01', authorChannelId: 'UCabc' },
      // display name non presente nei tipi: un campo estraneo non deve essere usato
      { id: 'Ugx2', text: 'without channel id', likeCount: 3, publishedAt: '2026-01-01', ...{ authorDisplayName: '@Name' } },
    ] }]),
  }, { authorSalt: SALT })
  const [y1, y2] = index.records
  assert.match(y1.authorKey!, /^youtube_channel:/)
  assert.equal(y2.authorKey, null)
  assert.equal(y1.threadId, 'youtube:v1')
  assert.equal(y1.parentKey, null)
})

test('parentKey: t3_ → post, t1_ → commento, senza prefisso risolto nel thread, assente → null', () => {
  const index = buildEvidenceIndex({ reddit: reddit([post('aaa111', [
    comment('c1', 'top level complaint', 'a', { parentId: 't3_aaa111' }),
    comment('c2', 'same here for me', 'b', { parentId: 't1_c1' }),
    comment('c3', 'unprefixed reply text', 'c', { parentId: 'c1' }),
    comment('c4', 'unprefixed to post', 'd', { parentId: 'aaa111' }),
    comment('c5', 'parent outside sample', 'e', { parentId: 't1_zzz' }),
    comment('c6', 'legacy without parent', 'f'),
  ])]) }, { authorSalt: SALT })
  const k = recordsByKey(index)
  assert.equal(k.get('reddit:comment:c1')!.parentKey, 'reddit:post:aaa111')
  assert.equal(k.get('reddit:comment:c2')!.parentKey, 'reddit:comment:c1')
  assert.equal(k.get('reddit:comment:c3')!.parentKey, 'reddit:comment:c1')
  assert.equal(k.get('reddit:comment:c4')!.parentKey, 'reddit:post:aaa111')
  assert.equal(k.get('reddit:comment:c5')!.parentKey, 'reddit:comment:zzz', 'genitore non trasmesso: chiave conservata, validazione in frequency')
  assert.equal(k.has('reddit:comment:zzz'), false)
  assert.equal(k.get('reddit:comment:c6')!.parentKey, null)
})

test('ID sintetici: sourceItemId null, anche nei dati legacy senza idSource', () => {
  const index = buildEvidenceIndex({ reddit: reddit([
    post('aaa111', [
      comment('c_aaa111_0', 'legacy synthetic id', 'a'),
      comment('t1_realid', 'real prefixed id', 'b', { idSource: 'collector' }),
      comment('c_x_1', 'declared synthetic', 'c', { idSource: 'synthetic' }),
    ]),
    post('g_1', [comment('k1', 'thread without real id', 'd')], { link: undefined }),
  ]) }, { authorSalt: SALT })
  const byText = (t: string) => index.records.find(r => r.text === t)!
  assert.equal(byText('legacy synthetic id').sourceItemId, null)
  assert.match(byText('legacy synthetic id').recordKey, /^reddit:comment:~aaa111:0$/)
  assert.equal(byText('real prefixed id').sourceItemId, 'realid')
  assert.equal(byText('declared synthetic').sourceItemId, null)
  assert.equal(index.records.find(r => r.type === 'post' && r.threadId === 'reddit:g_1')!.sourceItemId, null)
})

test('statistiche per piattaforma: D con autori dei post, K, quota autori noti', () => {
  const index = buildEvidenceIndex({ reddit: reddit([
    post('aaa111', [comment('c1', 'text one here', 'alice'), comment('c2', 'text two here', 'Alice'), comment('c3', 'text three', '[deleted]')], { author: 'op' }),
    post('bbb222', [comment('c4', 'text four here', 'bob')]), // autore del post assente (pre-sonda)
  ]) }, { authorSalt: SALT })
  const s = index.stats.reddit
  assert.equal(s.records, 6)
  assert.equal(s.D, 3, 'op, alice (2 commenti), bob')
  assert.equal(s.K, 2)
  assert.equal(s.authorKnownRate, 4 / 6)
})

test('post con solo titolo: nessun record e autore escluso da D; canale del video mai in D', () => {
  const index = buildEvidenceIndex({
    reddit: reddit([post('aaa111', [comment('c1', 'reply to a title only post', 'alice', { parentId: 't3_aaa111' })],
      { author: 'op_title_only', selftext: '   ' })]),
    youtube: youtube([{ id: 'v1', title: 'V', viewCount: 1, channelId: 'UCcreator', comments: [
      { id: 'Ugx1', text: 'a viewer comment', likeCount: 3, publishedAt: '2026-01-01', authorChannelId: 'UCviewer' }] }]),
  }, { authorSalt: SALT })
  assert.equal(index.records.filter(r => r.type === 'post').length, 0)
  assert.equal(index.stats.reddit.D, 1)
  assert.equal(index.stats.reddit.K, 1)
  assert.equal(index.stats.youtube.D, 1)
  assert.equal(index.records[0].parentKey, 'reddit:post:aaa111', 'genitore non trasmesso')
})

test('deterministico a parità di sale e senza mutare i dati di ingresso', () => {
  const data = reddit([post('aaa111', [comment('c1', 'some text here', 'alice', { parentId: 't3_aaa111' })])])
  const before = JSON.stringify(data)
  const a = buildEvidenceIndex({ reddit: data }, { authorSalt: SALT })
  const b = buildEvidenceIndex({ reddit: data }, { authorSalt: SALT })
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(data), before)
  assert.ok(!JSON.stringify(a).includes('alice'), 'nessun autore in chiaro nell\'indice')
})
