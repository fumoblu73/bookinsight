import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runPainPointsReddit } from './ai'
import { preparePainPointCorpus, prepareRedditCorpus, redditCoverageNote } from './reddit-corpus'
import { promptGapAnalysis, promptKeyInsights, promptPainPointsReddit, promptBonusSuggestions, promptConceptDirections, promptThingsToAvoid, promptPivotSignals } from './prompts'
import { calcProfitabilityScore, calcRoiEstimate } from './scoring'
import type { AmazonData, FilteredBook, RedditComment, RedditData, RedditMeta, TrendsData, YouTubeData } from './types'

// Fixture sintetiche: riproducono i volumi del caso reale, non le testimonianze.
function redditFixture(counts: number[] = [], subreddits = ['camping']): RedditData {
  const posts = counts.map((count, i) => ({
    id: `post${i}`, title: `Meals discussion ${i}`, selftext: 'How can I rehydrate meals evenly?',
    score: 10, subreddit: subreddits[i % subreddits.length], createdUtc: 1, month: '2026-10',
    comments: Array.from({ length: count }, (_, j) => ({
      id: `comment${i}_${j}`, body: `I cannot rehydrate these meals evenly (thread ${i}, comment ${j}).`,
      score: 1, author: `reader${i}_${j}`, createdUtc: 1, month: '2026-10',
    })),
  }))
  return {
    keyword: 'just add water meals', posts,
    totalComments: counts.reduce((sum, n) => sum + n, 0),
    subredditsUsed: [...new Set(posts.map(p => p.subreddit))],
    threadCount: posts.length, available: posts.length > 0,
    insufficientCorpus: posts.length < 5, // comportamento dei dati precedenti
  }
}

function youtubeFixture(): YouTubeData {
  const counts = [4, 4, 3, 3, 3, 3, 3, 3]
  return {
    keyword: 'just add water meals', available: true, insufficientCorpus: false, totalComments: 26,
    videos: counts.map((n, i) => ({
      id: `video${i}`, title: `Meal tutorial ${i}`, viewCount: 100,
      comments: Array.from({ length: n }, (_, j) => ({
        id: `yt${i}_${j}`, text: 'The instructions leave my meals dry inside.', likeCount: 1, publishedAt: '2026-10-01',
      })),
    })),
  }
}

function rawPain(fonte?: 'reddit' | 'youtube') {
  return {
    pain_point: 'Difficoltà di reidratazione', F: 4, I: 7, num_fonti: 1,
    solvibilita: 'affrontabile', evidence: 'Meals are still dry.', fonte,
  }
}

test('corpus assente: nessuna chiamata AI', async () => {
  const reddit = redditFixture()
  assert.equal(prepareRedditCorpus().quality.usable, false)
  assert.equal(prepareRedditCorpus(reddit).quality.coverage, 'none')
  const result = await runPainPointsReddit(reddit.keyword, reddit, undefined, 'US', async () => {
    assert.fail('Non deve chiamare AI senza testimonianze')
  })
  assert.deepEqual(result, [])
})

test('fonte non disponibile esclusa anche con testi residui', () => {
  const reddit = { ...redditFixture([20, 20, 20]), available: false }
  assert.deepEqual(prepareRedditCorpus(reddit).posts, [])
  assert.equal(prepareRedditCorpus(reddit).quality.usable, false)
})

test('testo del post senza commenti non basta per il gate delle testimonianze', () => {
  assert.equal(prepareRedditCorpus(redditFixture([0, 0, 0, 0, 0])).quality.usable, false)
})

test('commenti vuoti, cancellati, bot, link ed emoji senza testo sono inutilizzabili', async () => {
  const reddit = redditFixture([8])
  const bodies = ['', '   ', '[removed]', ' [DELETED] ', 'Moderator rules', 'https://example.com', '!!!', '👍']
  reddit.posts[0].comments.forEach((c, i) => {
    c.body = bodies[i]
    if (i === 4) c.author = 'AutoModerator'
  })
  assert.deepEqual(prepareRedditCorpus(reddit).quality.limitations, ['no_usable_comments'])
  assert.equal(prepareRedditCorpus(reddit).quality.usable, false)
  assert.deepEqual(await runPainPointsReddit(reddit.keyword, reddit, undefined, 'US', async () => {
    assert.fail('Commenti inutilizzabili non devono arrivare ad AI')
  }), [])
})

test('un commento utilizzabile in un thread: ammesso con tre avvisi di copertura', async () => {
  const reddit = redditFixture([1])
  const { quality } = prepareRedditCorpus(reddit)
  assert.equal(quality.usable, true)
  assert.equal(quality.coverage, 'limited')
  assert.deepEqual(quality.limitations, ['few_comments', 'few_threads', 'few_subreddits'])
  let calls = 0
  const result = await runPainPointsReddit(reddit.keyword, reddit, undefined, 'US', async prompt => {
    calls++
    assert.match(prompt, /Copertura Reddit limitata/)
    return [{ ...rawPain('reddit'), num_fonti: 1 }]
  })
  assert.equal(calls, 1)
  assert.equal(result[0].fonte, 'reddit')
})

test('le conferme brevi restano contestualizzabili nel thread', () => {
  const reddit = redditFixture([2])
  reddit.posts[0].comments[1].body = 'same here'
  const prompt = promptPainPointsReddit(reddit.keyword, reddit)
  assert.equal(prepareRedditCorpus(reddit).quality.usableCommentCount, 2)
  assert.match(prompt, /same here/)
  assert.match(prompt, /NON assegnargli un pain point autonomo/)
})

test('3 thread e 64 commenti: corpus Reddit ammesso integralmente con avviso', async () => {
  const reddit = redditFixture([22, 21, 21])
  const { quality } = prepareRedditCorpus(reddit)
  assert.equal(reddit.insufficientCorpus, true) // gate legacy ora ignorato
  assert.equal(quality.usable, true)
  assert.equal(quality.coverage, 'limited')
  assert.equal(quality.usableCommentCount, 64)
  assert.equal(quality.collectedCommentCount, 64)
  assert.equal(quality.transmittedCommentCount, 64)
  assert.equal(quality.usableThreadCount, 3)
  assert.ok(quality.limitations.includes('few_threads'))
  assert.ok(!quality.limitations.includes('few_comments'))
  const result = await runPainPointsReddit(reddit.keyword, reddit, youtubeFixture(), 'US', async prompt => {
    assert.match(prompt, /64 commenti utilizzabili; 64 commenti inclusi nel prompt da 3 thread distinti/)
    assert.equal((prompt.match(/^    \[score 1\]/gm) ?? []).length, 64)
    assert.match(prompt, /CORPUS REDDIT/)
    assert.match(prompt, /CORPUS YOUTUBE \(26 commenti da 8 video/)
    for (const post of reddit.posts) {
      for (const comment of post.comments) assert.ok(prompt.includes(comment.body))
    }
    assert.match(prompt, /non la prevalenza nell’intero mercato/)
    assert.match(prompt, /Non estrapolare percentuali o domanda di mercato/)
    return [rawPain('reddit'), { ...rawPain('youtube'), pain_point: 'Istruzioni incomplete' }]
  })
  assert.deepEqual(result.map(p => p.fonte).sort(), ['reddit', 'youtube'])
})

test('copertura diversificata: almeno 20 commenti, 5 thread e 2 subreddit', () => {
  const { quality } = prepareRedditCorpus(redditFixture([4, 4, 4, 4, 4], ['camping', 'backpacking']))
  assert.equal(quality.coverage, 'diversified')
  assert.deepEqual(quality.limitations, [])
  assert.equal(quality.subredditCount, 2)
  assert.match(redditCoverageNote(quality), /non garantisce rappresentatività statistica/)
})

test('19 commenti in 5 thread e 2 subreddit: avviso sulla quantità', () => {
  const { quality } = prepareRedditCorpus(redditFixture([4, 4, 4, 4, 3], ['camping', 'backpacking']))
  assert.equal(quality.usable, true)
  assert.deepEqual(quality.limitations, ['few_comments'])
})

test('20 commenti in 4 thread e 2 subreddit: avviso sui thread', () => {
  const { quality } = prepareRedditCorpus(redditFixture([5, 5, 5, 5], ['camping', 'backpacking']))
  assert.deepEqual(quality.limitations, ['few_threads'])
})

test('molti commenti in un solo subreddit: avviso sulla diversificazione', () => {
  const { quality } = prepareRedditCorpus(redditFixture([10, 10, 10, 10, 10]))
  assert.equal(quality.usable, true)
  assert.equal(quality.coverage, 'limited')
  assert.deepEqual(quality.limitations, ['few_subreddits'])
})

test('thread senza commenti utilizzabili non migliorano la copertura', () => {
  const { quality } = prepareRedditCorpus(redditFixture([20, 0, 0, 0, 0], ['camping', 'backpacking']))
  assert.equal(quality.usableThreadCount, 1)
  assert.equal(quality.subredditCount, 1)
  assert.equal(quality.coverage, 'limited')
})

test('nomi subreddit normalizzati; fallback reddit non conta come diversità', () => {
  const { quality } = prepareRedditCorpus(redditFixture([4, 4, 4, 4, 4], ['Camping', 'r/camping', 'reddit']))
  assert.equal(quality.subredditCount, 1)
  assert.deepEqual(quality.limitations, ['few_subreddits'])
})

test('thread e commenti duplicati non gonfiano il campione', () => {
  const reddit = redditFixture([10])
  reddit.posts.push({ ...reddit.posts[0], id: 't3_post0' })
  reddit.posts[0].comments.push({ ...reddit.posts[0].comments[0], id: 't1_comment0_0' })
  const { quality } = prepareRedditCorpus(reddit)
  assert.equal(quality.usableThreadCount, 1)
  assert.equal(quality.usableCommentCount, 10)
})

test('commenti distinti con lo stesso testo contano come conferme distinte', () => {
  const reddit = redditFixture([2])
  reddit.posts[0].comments[1].body = reddit.posts[0].comments[0].body
  assert.equal(prepareRedditCorpus(reddit).quality.usableCommentCount, 2)
})

test('limiti di invio applicati dopo il filtro; contatori riferiti al prompt', () => {
  const reddit = redditFixture(Array.from({ length: 16 }, () => 35))
  reddit.posts[0].comments[0].body = '[removed]'
  const { posts, quality } = prepareRedditCorpus(reddit)
  assert.equal(posts.length, 15)
  assert.equal(posts[0].comments.length, 30)
  assert.equal(quality.collectedCommentCount, 560)
  assert.equal(quality.usableCommentCount, 559)
  assert.equal(quality.usableThreadCount, 16)
  assert.equal(quality.transmittedCommentCount, 450)
  assert.equal(quality.transmittedThreadCount, 15)
  assert.equal(posts[0].comments[0].id, 'comment0_1')
})

test('compatibilità legacy: calcola dai testi senza fidarsi dei vecchi contatori', () => {
  const reddit = { ...redditFixture([22, 21, 21]), threadCount: 0, totalComments: 0 }
  const before = JSON.stringify(reddit)
  const { quality } = prepareRedditCorpus(reddit)
  assert.equal(quality.usableCommentCount, 64)
  assert.equal(quality.usableThreadCount, 3)
  assert.equal(JSON.stringify(reddit), before) // nessuna migrazione o mutazione implicita
  assert.equal(reddit.corpusQuality, undefined)
})

test('metadata nuovi obsoleti non ammettono un corpus vuoto', () => {
  const reddit = redditFixture([0, 0, 0, 0, 0])
  reddit.insufficientCorpus = false
  reddit.corpusQuality = prepareRedditCorpus(redditFixture([22, 21, 21])).quality
  assert.equal(prepareRedditCorpus(reddit).quality.usable, false)
})

test('metadata report: round trip JSON e assenza dei nuovi campi nei report legacy', () => {
  const reddit = redditFixture([22, 21, 21])
  const legacy: RedditMeta = {
    available: reddit.available, insufficientCorpus: true,
    threadCount: reddit.threadCount, subredditsUsed: reddit.subredditsUsed,
  }
  assert.equal(legacy.corpusQuality?.usable, undefined)
  const current: RedditMeta = { ...legacy, corpusQuality: prepareRedditCorpus(reddit).quality }
  const saved: RedditMeta = JSON.parse(JSON.stringify(current))
  assert.deepEqual(saved.corpusQuality, current.corpusQuality)
  assert.equal(saved.insufficientCorpus, true)
  assert.equal(saved.corpusQuality?.usable, true)
})

test('fonte Reddit esclusa: non rietichettare le sue evidenze come YouTube', async () => {
  const result = await runPainPointsReddit('test', redditFixture(), youtubeFixture(), 'US', async prompt => {
    assert.ok(!prompt.includes('CORPUS REDDIT:'))
    assert.match(prompt, /fonte: sempre "youtube"/)
    return [rawPain('reddit'), rawPain('youtube')]
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].fonte, 'youtube')
})

test('fonte YouTube esclusa: non rietichettare le sue evidenze come Reddit', async () => {
  const youtube = { ...youtubeFixture(), insufficientCorpus: true }
  const result = await runPainPointsReddit('test', redditFixture([2]), youtube, 'US', async prompt => {
    assert.ok(!prompt.includes('CORPUS YOUTUBE ('))
    assert.match(prompt, /fonte: sempre "reddit"/)
    return [rawPain('youtube'), rawPain('reddit')]
  })
  assert.deepEqual(result.map(p => p.fonte), ['reddit'])
})

test('output AI legacy senza fonte: fallback solo quando la piattaforma è univoca', async () => {
  const redditOnly = await runPainPointsReddit('test', redditFixture([2]), undefined, 'US', async () => [rawPain()])
  const youtubeOnly = await runPainPointsReddit('test', redditFixture(), youtubeFixture(), 'US', async () => [rawPain()])
  const both = await runPainPointsReddit('test', redditFixture([2]), youtubeFixture(), 'US', async () => [rawPain()])
  assert.equal(redditOnly[0].fonte, 'reddit')
  assert.equal(youtubeOnly[0].fonte, 'youtube')
  assert.deepEqual(both, [])
})

test('YouTube senza commenti non permette di chiamare AI o attribuire evidenze', () => {
  const youtube = youtubeFixture()
  youtube.videos.forEach(v => { v.comments = [] })
  assert.equal(preparePainPointCorpus(redditFixture(), youtube).youtube, undefined)
})

test('formula, cap F e classificazione di solvibilità restano invariati', async () => {
  const result = await runPainPointsReddit('test', redditFixture([2]), undefined, 'US', async () => [{
    ...rawPain('reddit'), F: 10, I: 9, num_fonti: 1,
    solvibilita: 'vincolo_formato', requisito_forma: 'Protocollo pratico di reidratazione',
  }])
  assert.equal(result[0].F, 4)
  assert.equal(result[0].score, Math.round((0.67 * 4 + 0.33 * 9) * 10) / 10)
  assert.equal(result[0].criticalSignal, true)
  assert.equal(result[0].solvibilita, 'vincolo_formato')
  assert.equal(result[0].requisito_forma, 'Protocollo pratico di reidratazione')
})

test('prompt successivi conservano fonte e avviso di copertura', async () => {
  const reddit = redditFixture([22, 21, 21])
  const pains = await runPainPointsReddit('test', reddit, undefined, 'US', async () => [rawPain('reddit')])
  const book: FilteredBook = {
    asin: 'TEST000001', title: 'Meal guide', bsr: 1000, bsrTimestamp: '2026-10-01',
    price: 15, currency: '$', reviewCount: 50, rating: 4, pages: 100,
    selfPublished: true, sponsored: false, royalty: 5,
    estimatedDailySalesMin: 1, estimatedDailySalesMax: 2, pagesEstimated: false,
  }
  const amazon: AmazonData = {
    keyword: reddit.keyword, market: 'US', topBooks: [book], rawTop15: [book], subNiches: [],
    competitorTarget: book, scrapedAt: '2026-10-01',
    ads_intelligence: {
      available: false, recommendedMonthlyAdBudget: 0, competitorMonthlyRevenueAvg: 0,
      competitorMonthlyRevenueRange: { min: 0, max: 0 }, competitorCount: 0, weakSampleWarning: true, currency: '$',
    },
  }
  const trends: TrendsData = { keyword: reddit.keyword, available: false, timelineData: [], relatedQueries: [], yoyGrowth: 0, peakMonth: null }
  const scoring = calcProfitabilityScore(amazon.topBooks, trends, 'basso', 'US')
  for (const prompt of [
    promptKeyInsights(amazon, trends, reddit, scoring, pains),
    promptGapAnalysis(amazon, pains, reddit),
    promptBonusSuggestions(reddit.keyword, 'US', pains, []),
    promptConceptDirections(reddit.keyword, 'US', pains, []),
    promptThingsToAvoid(reddit.keyword, 'US', pains, amazon.topBooks, []),
    promptPivotSignals(reddit.keyword, 'US', amazon.topBooks, calcRoiEstimate(book, 'US'), pains, {}),
  ]) {
    assert.match(prompt, /Copertura Reddit limitata/)
    assert.match(prompt, /non la prevalenza nell’intero mercato/)
    assert.match(prompt, /fonte[=:] ?reddit/)
  }
})

test('commenti validi dopo quelli rimossi sono disponibili anche nei dati legacy', () => {
  const reddit = redditFixture([1])
  const valid = reddit.posts[0].comments[0]
  const removed: RedditComment = { ...valid, id: 'removed', body: '[deleted]' }
  reddit.posts[0].comments = [removed, valid]
  assert.deepEqual(prepareRedditCorpus(reddit).posts[0].comments, [valid])
  assert.ok(!promptPainPointsReddit('test', reddit).includes('[deleted]'))
})

test('un testo utilizzabile solo oltre il limite di invio non qualifica il corpus', () => {
  const reddit = redditFixture([1])
  reddit.posts[0].comments[0].body = ' '.repeat(300) + 'A real experience beyond the excerpt.'
  assert.equal(prepareRedditCorpus(reddit).quality.usable, false)
})

test('identità URL del thread prevale su ID differenti restituiti dallo scraper', () => {
  const reddit = redditFixture([4, 4])
  reddit.posts.forEach(p => { p.link = 'https://www.reddit.com/r/camping/comments/abc123/meal/' })
  const { quality } = prepareRedditCorpus(reddit)
  assert.equal(quality.usableThreadCount, 1)
  assert.equal(quality.usableCommentCount, 8)
})

test('64 commenti distribuiti 40/12/12: 64 utilizzabili ma 54 realmente nel prompt', async () => {
  const reddit = redditFixture([40, 12, 12])
  const { quality } = prepareRedditCorpus(reddit)
  assert.equal(quality.collectedCommentCount, 64)
  assert.equal(quality.usableCommentCount, 64)
  assert.equal(quality.transmittedCommentCount, 54)
  await runPainPointsReddit('test', reddit, undefined, 'US', async prompt => {
    assert.equal((prompt.match(/^    \[score 1\]/gm) ?? []).length, 54)
    assert.match(prompt, /64 commenti utilizzabili; 54 commenti inclusi nel prompt/)
    assert.ok(prompt.includes(reddit.posts[0].comments[29].body))
    assert.ok(!prompt.includes(reddit.posts[0].comments[30].body))
    return []
  })
})

test('troncamento del testo: ogni commento trasmesso ha al massimo 300 caratteri', async () => {
  const reddit = redditFixture([1])
  const prefix = 'A'.repeat(300)
  reddit.posts[0].comments[0].body = prefix + 'OMITTED_COMMENT_TAIL'
  reddit.posts[0].selftext = 'B'.repeat(400) + 'OMITTED_POST_TAIL'
  await runPainPointsReddit('test', reddit, undefined, 'US', async prompt => {
    assert.ok(prompt.includes(`[score 1] ${prefix}\n`))
    assert.ok(!prompt.includes('OMITTED_COMMENT_TAIL'))
    assert.ok(!prompt.includes('OMITTED_POST_TAIL'))
    return []
  })
})

test('un commento: avviso isolato, analisi ammessa e cap F esistente conservato', async () => {
  const reddit = redditFixture([1])
  const result = await runPainPointsReddit('test', reddit, undefined, 'US', async prompt => {
    assert.match(prompt, /un solo commento non dimostra frequenza elevata né domanda consolidata/)
    assert.match(prompt, /num_fonti non può superare 1/)
    return [{ ...rawPain('reddit'), F: 10, I: 9, num_fonti: 1 }]
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].F, 4) // cap preesistente, nessuna nuova formula
  assert.equal(result[0].I, 9)
  assert.equal(result[0].redditCorpusQuality?.transmittedCommentCount, 1)
  assert.match(promptBonusSuggestions('test', 'US', result, []), /Segnale qualitativo isolato/)
  assert.match(promptConceptDirections('test', 'US', result, []), /non dimostra frequenza elevata né domanda consolidata/)
})

test('un commento: rifiuta evidenze che dichiarano thread impossibili prima dello scoring', async () => {
  for (const num_fonti of [0, 2, 99, 1.5, NaN, Infinity]) {
    const result = await runPainPointsReddit('test', redditFixture([1]), undefined, 'US', async () => [{
      ...rawPain('reddit'), F: 10, I: 9, num_fonti,
    }])
    assert.deepEqual(result, [])
  }
})

test('snapshot senza contatori nuovi: avvisi di copertura ancora leggibili', () => {
  const quality = prepareRedditCorpus(redditFixture([1])).quality
  delete quality.collectedCommentCount
  delete quality.transmittedCommentCount
  delete quality.transmittedThreadCount
  assert.match(redditCoverageNote(quality), /1 commenti inclusi nel prompt da 1 thread/)
  assert.match(redditCoverageNote(quality), /Segnale qualitativo isolato/)
})

test('pain point salvati senza metadati nuovi conservano fonte e contesto nei prompt successivi', () => {
  const pain = {
    ...rawPain('reddit'), fonte: 'reddit' as const, solvibilita: 'affrontabile' as const,
    score: 5, id: 'legacy_reddit',
  }
  const before = JSON.stringify(pain)
  const prompt = promptBonusSuggestions('test', 'US', [pain], [])
  assert.match(prompt, /fonte:reddit/)
  assert.match(prompt, /copertura non specificata nei dati salvati/)
  assert.equal(JSON.stringify(pain), before)
})
