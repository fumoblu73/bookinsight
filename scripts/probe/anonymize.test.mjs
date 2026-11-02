// Eseguire con: node --test scripts/probe/anonymize.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAnonymizer, idFormat } from './anonymize.mjs'

const SALT = 'test-salt-0123456789abcdef'

test('ID coerenti, prefissi e lunghezze conservati, relazione parentId preservata', () => {
  const { anonymize } = createAnonymizer(SALT)
  const out = anonymize([
    { kind: 'post', id: 'abc123', author: 'RealUser', title: 'My real title', body: 'secret story' },
    { kind: 'comment', id: 'k9x8y7', postId: 't3_abc123', parentId: 't3_abc123', author: 'Other', body: 'me too' },
    { kind: 'comment', id: 'z1z2z3', postId: 't3_abc123', parentId: 't1_k9x8y7', author: 'RealUser', body: '[deleted]' },
  ])
  assert.notEqual(out[0].id, 'abc123')
  assert.equal(out[0].id.length, 6)
  assert.equal(out[1].postId, `t3_${out[0].id}`)
  assert.equal(out[2].parentId, `t1_${out[1].id}`)
  assert.equal(out[0].author, out[2].author, 'stesso autore → stesso pseudonimo')
  assert.match(out[0].author, /^anon_user_\d+$/)
  assert.equal(out[2].body, '[deleted]')
  assert.equal(out[0].body, '«anon:text len=12»')
  assert.equal(out[0].title, '«anon:text len=13»')
  assert.equal(out[1].kind, 'comment')
})

test('YouTube: authorChannelId.value, canale UC, ID composti e URL di profilo', () => {
  const { anonymize } = createAnonymizer(SALT)
  const out = anonymize({
    snippet: {
      channelId: 'UCabcdefghijklmnopqrstuv',
      topLevelComment: {
        id: 'UgzAbC-dEf_123',
        snippet: {
          authorDisplayName: '@Somebody', authorChannelUrl: 'http://www.youtube.com/@Somebody',
          authorProfileImageUrl: 'https://yt3.ggpht.com/x', authorChannelId: { value: 'UCzzzzzzzzzzzzzzzzzzzzzz' },
          textOriginal: 'my words', publishedAt: '2026-01-02T03:04:05Z', likeCount: 3,
        },
      },
    },
    replies: { comments: [{ id: 'UgzAbC-dEf_123.8xYz', snippet: { parentId: 'UgzAbC-dEf_123' } }] },
  })
  const s = out.snippet.topLevelComment.snippet
  assert.match(out.snippet.channelId, /^UC.{22}$/)
  assert.notEqual(out.snippet.channelId, 'UCabcdefghijklmnopqrstuv')
  assert.match(s.authorChannelId.value, /^UC.{22}$/)
  assert.equal(s.authorChannelUrl, 'https://example.invalid/anon')
  assert.equal(s.authorProfileImageUrl, 'https://example.invalid/anon')
  assert.match(s.authorDisplayName, /^anon_user_/)
  assert.equal(s.publishedAt, '2026-01-02T03:04:05Z')
  assert.equal(s.likeCount, 3)
  assert.equal(out.replies.comments[0].snippet.parentId, out.snippet.topLevelComment.id)
  assert.ok(out.replies.comments[0].id.startsWith(`${out.snippet.topLevelComment.id}.`))
})

test('URL Reddit: subreddit tenuto, ID e utenti pseudonimizzati, query rimossa', () => {
  const { anonymize } = createAnonymizer(SALT)
  const out = anonymize({ url: 'https://www.reddit.com/r/camping/comments/abc123/my_slug/?utm=1', profile: 'https://www.reddit.com/user/RealUser/' })
  assert.match(out.url, /^https:\/\/www\.reddit\.com\/r\/camping\/comments\/[a-z0-9]{6}\/«?/)
  assert.ok(!out.url.includes('abc123') && !out.url.includes('utm') && !out.url.includes('my_slug'))
  assert.ok(!out.profile.includes('RealUser'))
})

test('Stringhe non classificate: nessun valore breve passa in chiaro', () => {
  const { anonymize } = createAnonymizer(SALT)
  const out = anonymize({ mysteryField: 'johnsmith', other: 'some long free text here', helpful_votes: 4, date: 'Reviewed in the United States on May 1, 2025' })
  assert.equal(out.mysteryField, '«anon:token len=9»')
  assert.equal(out.other, '«anon:text len=24»')
  assert.equal(out.helpful_votes, 4)
  assert.equal(out.date, 'Reviewed in the United States on May 1, 2025', 'date tenute: servono a verificare il formato')
})

test('Sali diversi producono pseudonimi diversi; sale obbligatorio', () => {
  const a = createAnonymizer(SALT).anonymize({ id: 'abc123' })
  const b = createAnonymizer('another-salt-0123456789').anonymize({ id: 'abc123' })
  assert.notEqual(a.id, b.id)
  assert.throws(() => createAnonymizer(''))
})

test('idFormat descrive senza esporre il valore', () => {
  assert.equal(idFormat('t1_abc'), 'prefix:t1_ len:6 charset:lower-alnum')
  assert.equal(idFormat(undefined), 'absent')
  assert.equal(idFormat('UgzAbC-d.x'), 'prefix:Ug len:10 charset:other dotted')
})
