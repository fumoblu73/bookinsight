import { AmazonData, TrendsData, RedditData, YouTubeData, PainPoint, AmazonReview, Market, SubNiche, TargetInterpretationSummary } from './types'
import { ProfitabilityBreakdown, RoiEstimate, DifficultyLevel, TrendSignal } from './scoring'

// ─── Helper ───────────────────────────────────────────────────────────────────

function booksTable(amazon: AmazonData): string {
  return amazon.topBooks
    .map((b, i) =>
      `${i + 1}. "${b.title}" (ASIN: ${b.asin}) — BSR: ${b.bsr.toLocaleString()}, ` +
      `Prezzo: ${b.currency}${b.price.toFixed(2)}, Recensioni: ${b.reviewCount}, ` +
      `Rating: ${b.rating}, Pagine: ${b.pages ?? 'N/D'}, ` +
      `Editore: ${b.publisher ?? 'N/D'}, Self-pub: ${b.selfPublished ? 'sì' : 'no'}`
    )
    .join('\n')
}

function painPointsList(painPoints: PainPoint[]): string {
  return painPoints
    .slice(0, 10)
    .map((p, i) =>
      `${i + 1}. [Score ${p.score}${p.criticalSignal ? ' ⚠CRITICO' : ''}] "${p.pain_point}" ` +
      `(F=${p.F} I=${p.I} S=${p.S}) — ${p.evidence}`
    )
    .join('\n')
}

// ─── PASSO 0 — Competitor target (Sonnet) ────────────────────────────────────
// §3: angolo posizionamento, target reader, USP del competitor selezionato

export function promptPasso0(amazon: AmazonData): string {
  const t = amazon.competitorTarget
  return `Sei un esperto di analisi KDP (Kindle Direct Publishing). Analizza il seguente libro competitor su Amazon ${amazon.market}.

LIBRO TARGET:
- Titolo: "${t.title}"
- ASIN: ${t.asin}
- BSR: ${t.bsr.toLocaleString()} (posizione in classifica)
- Prezzo: ${t.currency}${t.price.toFixed(2)}
- Recensioni: ${t.reviewCount} (rating ${t.rating}/5)
- Pagine: ${t.pages ?? 'N/D'}
- Editore: ${t.publisher ?? 'N/D'}${t.selfPublished ? ' [self-published]' : ''}

CONTESTO NICCHIA (top ${amazon.topBooks.length} libri per keyword "${amazon.keyword}"):
${booksTable(amazon)}

Rispondi SOLO con un oggetto JSON valido (nessun testo prima o dopo), con questa struttura esatta:
{
  "angolo": "stringa — l'angolo di posizionamento principale del libro (max 20 parole)",
  "target_reader": "stringa — chi è il lettore ideale di questo libro (max 20 parole)",
  "usp": "stringa — la promessa unica del libro vs altri nella nicchia (max 25 parole)",
  "punti_forza": ["stringa 1", "stringa 2", "stringa 3"],
  "punti_debolezza": ["stringa 1", "stringa 2"],
  "confidence": "ALTA | MEDIA | BASSA"
}`
}

// ─── Pain Points — estrazione Haiku da Reddit ─────────────────────────────────
// §5: Haiku legge il corpus Reddit e restituisce pain point grezzi F/I/S

const NON_ENGLISH_MARKETS = new Set<Market>(['DE', 'FR', 'IT', 'ES'])

export function promptPainPointsReddit(
  keyword: string,
  reddit: RedditData,
  youtube?: YouTubeData,
  market?: Market,
): string {
  const redditLanguageNote = market && NON_ENGLISH_MARKETS.has(market)
    ? `NOTA IMPORTANTE: il mercato selezionato è ${market} (non anglofono). Reddit è prevalentemente in inglese: il corpus potrebbe contenere discussioni in inglese sullo stesso argomento invece che in lingua locale. Questo è accettabile — i pain point universali emergono anche da comunità anglofone. Tuttavia, le recensioni Amazon in lingua locale sono la fonte primaria più affidabile per questo mercato. Dai priorità ai segnali dalle recensioni rispetto a quelli Reddit se ci sono discrepanze.\n\n`
    : ''

  const corpus = reddit.posts
    .slice(0, 15)
    .map(p => {
      const comments = p.comments
        .slice(0, 20)
        .map(c => `    [score ${c.score}] ${c.body.substring(0, 300)}`)
        .join('\n')
      return `POST (r/${p.subreddit}, score ${p.score}): "${p.title}"\n${p.selftext ? '  ' + p.selftext.substring(0, 400) + '\n' : ''}${comments}`
    })
    .join('\n\n---\n\n')

  const ytCorpus = youtube?.available && youtube.videos.length > 0
    ? youtube.videos.map(v => {
        const comments = v.comments
          .map(c => `  [${c.likeCount} likes] ${c.text.substring(0, 300)}`)
          .join('\n')
        return `VIDEO YouTube (${v.viewCount.toLocaleString()} views): "${v.title}"\n${comments}`
      }).join('\n\n---\n\n')
    : null

  const redditSection = reddit.available && !reddit.insufficientCorpus
    ? `CORPUS REDDIT (${reddit.totalComments} commenti totali da ${reddit.subredditsUsed.join(', ')}):\n${corpus}\n`
    : ''

  const ytSection = ytCorpus
    ? `CORPUS YOUTUBE (${youtube!.totalComments} commenti da ${youtube!.videos.length} video tutorial):
${ytCorpus}

NOTA: i commenti YouTube provengono da spettatori di video tutorial — tendono a esprimere bisogni pratici molto espliciti ("vorrei un libro che coprisse X"). Trattali come segnale di domanda latente, distinto ma complementare alle discussioni Reddit.
`
    : ''

  const fonteInstr = ytCorpus && reddit.available && !reddit.insufficientCorpus
    ? '- fonte: "reddit" se estratto da Reddit, "youtube" se estratto da YouTube'
    : ytCorpus
    ? '- fonte: sempre "youtube"'
    : '- fonte: sempre "reddit"'

  return `Sei un ricercatore di mercato specializzato in libri non-fiction. Analizza le discussioni sulla keyword "${keyword}" ed estrai i pain point reali degli utenti.

${redditLanguageNote}${redditSection}${ytSection}
REGOLA COMMENTI BREVI DI CONFERMA: Se un commento è una conferma breve del problema espresso nel post padre o nei commenti precedenti (es. "stesso problema", "anche io", "idem", "exactly", "same here", "this!", "+1", "agree") — NON assegnargli un pain point autonomo. Invece, incrementa di +1 il punteggio F del pain point del post padre o del commento descrittivo più recente sullo stesso problema. Haiku ha tutto il contesto necessario: conosce il titolo del post e i commenti precedenti. La stessa regola si applica al corpus YouTube.

CALIBRAZIONE F (Frequenza) — scala obbligatoria:
- F=1–2: menzione isolata in 1 solo thread/video, anche con più commenti di conferma
- F=3–4: presente in 2–3 thread distinti
- F=5–6: citato in 4–7 thread, tema ricorrente ma non dominante
- F=7–8: presente in 8+ thread o sub-tema dominante nel corpus
- F=9–10: il problema più citato, quasi ogni thread ne parla
REGOLA HARD: se num_fonti=1, F NON può superare 4.

CALIBRAZIONE I (Intensità emotiva) — scala obbligatoria:
- I=1–3: osservazione neutra, nessun disagio espresso
- I=4–6: frustrazione lieve, "sarebbe utile", "mi manca"
- I=7–8: frustrazione forte, "sono bloccato", "è impossibile", linguaggio emotivo diretto
- I=9–10: disagio acuto, impatto sulla vita/lavoro, parole come "desperate", "ruining", "failed"

ISTRUZIONI:
- Identifica 5-12 pain point distinti e concreti espressi dagli utenti
- Per ogni pain point assegna:
  - F (Frequenza): quante volte appare nel corpus, rispetta la calibrazione sopra
  - I (Intensità emotiva): quanto è forte il disagio espresso, rispetta la calibrazione sopra
  - S (Specificità/Solvibilità con un libro): quanto può essere risolto con contenuto scritto, scala 1-10
  - num_fonti: numero di thread/video DISTINTI in cui questo pain point appare (minimo 1)
- evidence: citazione breve o parafrase dal corpus (max 80 caratteri)
- ${fonteInstr}
- tipo: "gap_esecuzione" se è un problema pratico non risolto dai libri esistenti, "job_confermato" se è un bisogno già servito ma migliorabile

Rispondi SOLO con un array JSON valido (nessun testo prima o dopo):
[
  {
    "pain_point": "descrizione concisa del problema (max 15 parole)",
    "F": numero,
    "I": numero,
    "S": numero,
    "num_fonti": numero,
    "evidence": "citazione o parafrasi",
    "fonte": "reddit | youtube",
    "tipo": "gap_esecuzione | job_confermato",
    "linguaggio": "frase verbatim dell'utente se tipo=job_confermato, altrimenti null"
  }
]`
}

// ─── Key Insights (Sonnet) ────────────────────────────────────────────────────
// §1: 6 insight con dati numerici, basati su tutti i dati raccolti

export function promptKeyInsights(
  amazon: AmazonData,
  trends: TrendsData,
  reddit: RedditData,
  scoring: ProfitabilityBreakdown,
  painPoints: PainPoint[],
  overrideSubNiches?: SubNiche[],
): string {
  const topPains = painPoints.slice(0, 5).map(p => `"${p.pain_point}" (score ${p.score})`).join(', ')
  const trendSummary = trends.available
    ? `YoY ${trends.yoyGrowth > 0 ? '+' : ''}${trends.yoyGrowth}%, trend: ${scoring.trendSignal}`
    : 'dati trend non disponibili'
  const subNichesSource = overrideSubNiches ?? amazon.subNiches
  const subNicheSummary = subNichesSource.length > 0
    ? subNichesSource.map(s => `"${s.keyword}" (BSR ${s.bsr.toLocaleString()}, ${s.vulnerable ? 'vulnerabile' : 'competitiva'})`).join(', ')
    : 'nessuna sub-nicchia identificata'

  return `Sei un analista KDP esperto. Genera 6 Key Insights per la nicchia "${amazon.keyword}" sul mercato ${amazon.market}.

DATI DISPONIBILI:
- Profitability Score: ${scoring.score}/100
- BSR medio top ${amazon.topBooks.length}: ${scoring.avgBsr.toLocaleString()}
- Prezzo medio: ${amazon.topBooks[0]?.currency ?? '$'}${scoring.avgPrice.toFixed(2)} (${scoring.minPrice.toFixed(2)}–${scoring.maxPrice.toFixed(2)}) · Pagine medie: ${scoring.avgPages} (${scoring.minPages}–${scoring.maxPages})
- Entry Difficulty: ${scoring.entryDifficulty}
- Trend: ${trendSummary}
- Reddit: ${reddit.available ? `${reddit.totalComments} commenti` : 'non disponibile'}
- Top pain point: ${topPains || 'non estratti'}
- Sub-nicchie: ${subNicheSummary}
- Competitor target: "${amazon.competitorTarget.title}" (BSR ${amazon.competitorTarget.bsr.toLocaleString()}, ${amazon.competitorTarget.reviewCount} rec.)
- Top 5 libri: BSR da ${amazon.topBooks[0]?.bsr.toLocaleString()} a ${amazon.topBooks[amazon.topBooks.length - 1]?.bsr.toLocaleString()}

REGOLE:
- Ogni insight DEVE contenere almeno un dato numerico specifico
- Varia il tipo: opportunità, rischio, dato di mercato, osservazione competitor, trend, suggerimento
- Linguaggio diretto, niente frasi generiche
- Max 2 righe per insight

Rispondi SOLO con un array JSON valido:
[
  { "insight": "testo insight con dati", "tipo": "opportunita | rischio | mercato | competitor | trend | suggerimento" },
  ...6 elementi totali
]`
}

// ─── Trend Forecast (Sonnet) ──────────────────────────────────────────────────
// §4B: classificazione vincolata + narrativa trend

export function promptTrendForecast(
  keyword: string,
  trends: TrendsData,
  trendSignal: TrendSignal,
): string {
  const timeline = trends.timelineData
    .slice(-12)
    .map(d => `${d.date}: ${d.value}`)
    .join(', ')

  const related = trends.relatedQueries
    .slice(0, 5)
    .map(q => `"${q.query}" (${q.value}, YoY ${q.growthYoY > 0 ? '+' : ''}${q.growthYoY}%${q.isEmerging ? ' 🌱' : ''})`)
    .join(', ')

  return `Sei un analista di mercato KDP. Analizza i dati di Google Trends per "${keyword}".

DATI TREND (ultimi 12 mesi, scala 0-100):
${timeline}

QUERY CORRELATE: ${related || 'nessuna'}
CLASSIFICAZIONE ALGORITMICA: ${trendSignal}

Rispondi SOLO con un oggetto JSON valido:
{
  "classificazione": "${trendSignal === 'N/A' ? 'CRESCITA | STABILE | DECLINO' : trendSignal}",
  "narrativa": "2-3 frasi che spiegano il trend con riferimento ai dati numerici",
  "stagionalita": "descrizione eventuale stagionalità o null",
  "query_emergenti": ["query1", "query2"] oppure []
}`
}

// ─── Gap Analysis 5 passi (Sonnet) ────────────────────────────────────────────
// §5: il cuore del report — 5 passi + Gap Inventory Table

function reviewsBlock(amazon: AmazonData): string {
  if (!amazon.topBookReviews?.length) return 'Non disponibili.'
  return amazon.topBookReviews.map(br => {
    const pos = br.reviews.filter((r: AmazonReview) => r.rating >= 4).slice(0, 2)
    const neg = br.reviews.filter((r: AmazonReview) => r.rating <= 3).slice(0, 3)
    const fmt = (r: AmazonReview) => `[${r.rating}★] "${r.title}" — ${r.body.slice(0, 200)}`
    return `"${br.bookTitle.slice(0, 60)}" (${br.reviews.length} recensioni analizzate):
  POSITIVE: ${pos.length ? pos.map(fmt).join(' | ') : 'nessuna'}
  NEGATIVE: ${neg.length ? neg.map(fmt).join(' | ') : 'nessuna'}`
  }).join('\n\n')
}

export function promptGapAnalysis(
  amazon: AmazonData,
  painPoints: PainPoint[],
  reddit: RedditData,
  userNotes?: string,
  youtube?: YouTubeData,
): string {
  const topPains = painPointsList(painPoints)
  const books = booksTable(amazon)

  const ytBlock = youtube?.available && youtube.totalComments > 0
    ? `\nYOUTUBE (${youtube.videos.length} video · ${youtube.totalComments} commenti): sì`
    : '\nYOUTUBE: non disponibile'

  const userNotesBlock = userNotes?.trim()
    ? `\nOSSERVAZIONI DELL'UTENTE (segnale integrativo):\n${userNotes.trim()}\nREGOLA: I dati numerici (recensioni Amazon, Reddit, trends) hanno priorità assoluta sulle osservazioni dell'utente. Usa le osservazioni come segnale aggiuntivo, non come dato primario. Per ogni gap nella gap_inventory_table indica in nota_utente se l'osservazione dell'utente conferma, contraddice o è irrilevante rispetto al gap (max 15 parole, oppure null).\n`
    : ''

  return `Sei un esperto di strategia editoriale KDP. Esegui una Gap Analysis completa per la nicchia "${amazon.keyword}" (mercato ${amazon.market}).

TOP ${amazon.topBooks.length} COMPETITOR:
${books}

RECENSIONI AMAZON TOP COMPETITOR (testo reale):
${reviewsBlock(amazon)}

TOP PAIN POINT (da Reddit/YouTube/discussioni online):
${topPains || 'Nessun pain point estratto — basati su competitor e recensioni.'}

REDDIT/DISCUSSIONI ONLINE: ${reddit.available ? `sì (${reddit.threadCount} thread da ${reddit.subredditsUsed.join(', ')})` : 'non disponibile'}${ytBlock}${userNotesBlock}

ISTRUZIONI:
- Usa le recensioni positive per capire cosa apprezzano i lettori (aspetti da eguagliare o superare)
- Usa le recensioni negative per identificare lacune reali (gap da colmare con il nuovo libro)
- Integra i pain point Reddit come conferma o segnale aggiuntivo

Esegui i 5 passi e rispondi SOLO con un oggetto JSON valido:
{
  "passo1_problemi_non_risolti": {
    "descrizione": "Quali problemi i lettori hanno ancora dopo aver letto i libri esistenti?",
    "items": ["problema 1", "problema 2", "problema 3"]
  },
  "passo2_angoli_mancanti": {
    "descrizione": "Quali angoli/approcci NON sono coperti dai competitor?",
    "items": ["angolo 1", "angolo 2", "angolo 3"]
  },
  "passo3_formato_gap": {
    "descrizione": "Il formato dei libri esistenti è ottimale? Cosa manca?",
    "items": ["gap formato 1", "gap formato 2"]
  },
  "passo4_target_non_servito": {
    "descrizione": "Quale segmento di lettori è ignorato dai competitor?",
    "segmento": "descrizione segmento specifico",
    "dimensione": "stima relativa: piccolo | medio | grande"
  },
  "passo5_tesi_libro": {
    "titolo_proposto": "Titolo che include obbligatoriamente la keyword \\"${amazon.keyword}\\" come hook di curiosità. Max 60 caratteri.",
    "sottotitolo": "Sottotitolo che segue questa struttura in sequenza: 1) ripete la keyword principale per SEO Amazon 2) promette un outcome chiaro e desiderabile (before/after del lettore) 3) identifica il target specifico con identity language (es. 'for busy moms', 'even if you have no experience') 4) opzionale: aggiunge urgenza o quantificatore (solo se onesto e supportabile). Titolo + sottotitolo devono essere max 196 caratteri totali.",
    "hook": "Una frase che cattura l'attenzione del target (max 20 parole)",
    "differenziatori": ["diff 1", "diff 2", "diff 3"],
    "seo_note": "Verifica: il titolo contiene la keyword principale? Il totale titolo+sottotitolo è sotto 196 caratteri? Nessuno dei seguenti termini è presente: 'bestselling', '#1', 'free', nomi di altri autori o titoli, marchi registrati, solo punteggiatura, HTML tags."
  },
  "gap_inventory_table": [
    {
      "gap": "nome gap",
      "tipo": "contenuto | formato | target | angolo",
      "priorita": "ALTA | MEDIA | BASSA",
      "opportunita": "come sfruttarlo (max 15 parole)",
      "nota_utente": "conferma/contraddice/null — solo se osservazioni utente presenti"
    }
  ]
}`
}

// ─── Series Strategy (Sonnet) ─────────────────────────────────────────────────
// §6: verdetto INVEST/PARTIAL/PASS + strategia serie

export function promptSeriesStrategy(
  amazon: AmazonData,
  gapTesi: { titolo_proposto: string; sottotitolo: string; differenziatori: string[] },
  scoring: ProfitabilityBreakdown,
  roi: RoiEstimate,
): string {
  return `Sei un editore KDP strategico. Valuta la fattibilità di una serie di libri per la nicchia "${amazon.keyword}" (${amazon.market}).

LIBRO ÂNCORA (proposto dalla Gap Analysis):
- Titolo: "${gapTesi.titolo_proposto}"
- Sottotitolo: "${gapTesi.sottotitolo}"
- Differenziatori: ${gapTesi.differenziatori.join('; ')}

DATI DI MERCATO:
- Profitability Score: ${scoring.score}/100
- Entry Difficulty: ${scoring.entryDifficulty}
- Trend: ${scoring.trendSignal}
- Prezzo medio: $${scoring.avgPrice.toFixed(2)} (${scoring.minPrice.toFixed(2)}–${scoring.maxPrice.toFixed(2)}) · Pagine medie: ${scoring.avgPages} (${scoring.minPages}–${scoring.maxPages})
- Vendite stimate/giorno (bersaglio): ${roi.targetDailySalesMin}-${roi.targetDailySalesMax}
- Break-even (scenario base): ${roi.scenarios[1].breakEvenMonths} mesi (${roi.bepSignal})
- ROI netto 12m: $${roi.scenarios[0].netProfit12m.toFixed(0)}-$${roi.scenarios[2].netProfit12m.toFixed(0)} (pessimistico–ottimistico)
- Sub-nicchie disponibili: ${amazon.subNiches.map(s => `"${s.keyword}"`).join(', ') || 'nessuna'}

Rispondi SOLO con un oggetto JSON valido:
{
  "verdetto": "INVEST | PARTIAL | PASS",
  "motivazione_verdetto": "2-3 frasi che giustificano il verdetto con dati numerici",
  "libro_1": {
    "titolo": "${gapTesi.titolo_proposto}",
    "focus": "focus principale del primo volume",
    "pagine_target": numero,
    "tempo_scrittura_settimane": numero
  },
  "libro_2": {
    "titolo": "titolo proposto per il secondo volume",
    "focus": "angolo complementare o approfondimento",
    "timing": "mesi dopo il lancio del libro 1"
  },
  "libro_3": {
    "titolo": "titolo proposto per il terzo volume (opzionale)",
    "focus": "nicchia adiacente o spin-off",
    "condizione": "quando considerarlo (es. se libro 1 supera X vendite/mese)"
  },
  "strategia_lancio": "descrizione tattica lancio libro 1 (pricing, ARC, ads) in 3-5 punti",
  "rischi_principali": ["rischio 1", "rischio 2"]
}`
}

// ─── Investment ROI narrativa (Haiku) ─────────────────────────────────────────
// §7: 4 blocchi narrativi su dati deterministici già calcolati

export function promptRoiNarrative(
  keyword: string,
  market: string,
  roi: RoiEstimate,
  scoring: ProfitabilityBreakdown,
): string {
  const base = roi.scenarios[1]
  const pess = roi.scenarios[0]
  const ott  = roi.scenarios[2]
  return `Sei un consulente finanziario KDP. Scrivi una narrativa di investimento per la nicchia "${keyword}" (${market}).

DATI CALCOLATI (NON modificare i numeri):
- Bersaglio: ${roi.targetDailySalesMin}-${roi.targetDailySalesMax} vendite/giorno
- Royalty libro pianificato: ${roi.newBookRoyalty.toFixed(2)} per copia
- Budget di produzione: ${roi.params.budgetProduzione} (scrittura ${roi.params.costoScrittura} + copertina ${roi.params.costoCopertina} + recensioni lancio ${roi.params.costoPerRecensione}×${roi.params.arcReviews})
- Ramp-up: ${roi.rampMonths} mesi
- Costo per vendita pubblicitaria: ${roi.costPerAdSale.toFixed(2)} (CPC ${roi.params.cpc} / tasso conversione ${roi.params.conversionRate})
- Ads sostenibili: ${roi.adSaleIsProfitable ? 'sì (costo ads < royalty)' : 'no al lancio (costo ads > royalty — normale, compra ranking)'}
- Scenario pessimistico: netto 12m ${pess.netProfit12m.toFixed(0)}, break-even ${pess.breakEvenMonths === 999 ? 'mai entro 12m' : `mese ${pess.breakEvenMonths}`}
- Scenario base: netto 12m ${base.netProfit12m.toFixed(0)}, break-even ${base.breakEvenMonths === 999 ? 'mai entro 12m' : `mese ${base.breakEvenMonths}`}
- Scenario ottimistico: netto 12m ${ott.netProfit12m.toFixed(0)}, break-even ${ott.breakEvenMonths === 999 ? 'mai entro 12m' : `mese ${ott.breakEvenMonths}`}
- Verdetto: ${roi.investVerdict} · Profitability Score: ${scoring.score}/100

Rispondi SOLO con un oggetto JSON valido con 4 blocchi narrativi:
{
  "blocco_scenario": "Descrivi la forbice pessimistico-base-ottimistico con i numeri forniti; spiega cosa determina ciascuno scenario (3-4 righe)",
  "blocco_budget": "Spiega la composizione del budget di produzione (scrittura + copertina + recensioni lancio). Spiega perché il costo ads al lancio può essere in perdita e che cosa compra (ranking e recensioni, non profitto immediato). (2-3 righe)",
  "blocco_timeline": "Timeline mese per mese fino al break-even nello scenario base, con le milestone concrete legate al ramp (${roi.rampMonths} mesi). (3-4 righe)",
  "blocco_verdetto": "Verdetto finale con raccomandazione d'azione specifica basata su ${roi.investVerdict}, tono diretto. (2-3 righe)"
}`
}

// ─── Target Interpretation (Sonnet — prosa) ──────────────────────────────────

export function promptTargetInterpretation(
  keyword: string,
  market: string,
  s: TargetInterpretationSummary,
): string {
  const warningsBlock = s.warnings.length > 0
    ? `- Avvisi del sistema: ${s.warnings.join('; ')}\n`
    : ''

  const excludedBlock = s.excludedFromQuadrantsCount > 0
    ? `- Esclusi dai quadranti (dati insufficienti): ${s.excludedFromQuadrantsCount}
  · BSR mancante: ${s.excludedReasons.bsrZero}
  · BSR fuori soglia di mercato: ${s.excludedReasons.outOfBsrRange}
  · Età sconosciuta (data pubblicazione assente): ${s.excludedReasons.ageUnknown}\n`
    : `- Esclusi dai quadranti (dati insufficienti): 0\n`

  return `Sei un analista KDP. Scrivi una lettura ragionata della seguente analisi Target Finder.

KEYWORD: "${keyword}"
MERCATO: ${market}

DATI:
- Candidati totali analizzati: ${s.totalCandidates}
- Attaccabili (≤100 rec, o 101-150 con fattori promozione): ${s.attackableCount}
- Bersagli suggeriti: ${s.suggestedCount}
- Quadranti degli attaccabili:
  · IDEALE (alta resa, poco difeso): ${s.quadrantCounts.IDEALE}
  · TROPPO DURO (alta resa, ben difeso): ${s.quadrantCounts.TROPPO_DURO}
  · BASSA RESA (bassa resa, poco difeso): ${s.quadrantCounts.FACILE_BASSA_RESA}
  · ANOMALO (bassa resa, ben difeso): ${s.quadrantCounts.ANOMALO}
- Non attaccabili: ${s.nonAttackableCount}
  · Muro recensioni >150: ${s.nonAttackableReasons.over150Reviews}
  · Non promossi (101-150 rec, mancano fattori promozione): ${s.nonAttackableReasons.nonPromosso}
${excludedBlock}- Libri scartati per formato non identificabile (possibili hardcover): ${s.unknownFormatCount}
- Velocità nicchia stimata: ~${s.nicheReviewVelocity.toFixed(1)} recensioni/mese
${warningsBlock}
ISTRUZIONI:
Scrivi una lettura ragionata in prosa italiana, tra 200 e 400 parole. NON usare JSON. NON usare elenchi puntati. Scrivi paragrafi di prosa fluida. Tono: consulente diretto, niente retorica, niente "forse" o "potrebbe essere" — di' le cose chiaramente.

La lettura deve coprire questi punti nell'ordine indicato:

1. STATO DELLA NICCHIA: Una frase netta che sintetizza lo stato (es. "nicchia satura", "nicchia salutare con opportunità concrete", "nicchia debole o keyword da rivedere").

2. COSA DICONO I NUMERI: Interpreta i dati — non limitarti a ripeterli. Se molti non-attaccabili sono per >150 recensioni, di' "muro consolidato di bestseller". Se i suggeriti vengono da BASSA RESA (perché IDEALE = 0), avverti che sono ripieghi. Se ci sono molti esclusi per BSR fuori soglia, commenta il profilo di mercato.

3. RACCOMANDAZIONE: Sii propositivo e concreto.
   - Se la nicchia è difficile o deludente: suggerisci 2-3 keyword alternative più strette, o un cambio di angolo tematico specifico (es. sub-nicchie, target reader più preciso, formato diverso).
   - Se la nicchia è promettente: indica chiaramente su quali suggeriti puntare e perché (in base alla distribuzione nei quadranti).

REGOLE ASSOLUTE:
- Commenta SOLO i dati ricevuti. Zero invenzioni.
- NON usare JSON, bullet point, o markdown formattato. Solo prosa.
- Tra 200 e 400 parole.`
}

// ─── Target Weaknesses (Haiku) ────────────────────────────────────────────────
// Milestone 5: analisi difetti exploitabili da recensioni Amazon del competitor

export function promptTargetWeaknesses(
  bookTitle: string,
  reviews: AmazonReview[],
): string {
  const reviewList = reviews
    .slice(0, 15)
    .map((r, i) => `[${i + 1}] Rating:${r.rating}/5 — "${r.title}"\n${r.body}`)
    .join('\n\n')

  return `Analizza le recensioni del libro "${bookTitle}" su Amazon per identificare difetti exploitabili da un competitor KDP.

RECENSIONI (${reviews.length} totali, prime ${Math.min(15, reviews.length)} mostrate):
${reviewList}

Identifica i difetti concreti del libro che un competitor può sfruttare scrivendo un libro migliore. Considera: contenuto incompleto o superficiale, struttura confusa, esempi poveri, promesse non mantenute, formato scadente, errori fattuali.

NON includere difetti generici (es. "prezzo alto") o recensioni di servizio (spedizione, packaging). Solo difetti del contenuto/formato del libro stesso.

Restituisci un array JSON (vuoto [] se non emergono difetti chiari da almeno 2 recensioni):
[
  {
    "difetto": "descrizione concisa del difetto (max 12 parole)",
    "gravita": "ALTA | MEDIA | BASSA",
    "frequenza": numero intero 1-10 che stima quante recensioni menzionano il problema,
    "evidence": "citazione breve da una recensione (max 15 parole)"
  }
]

Max 5 difetti. Ordina per gravità decrescente. JSON puro senza markdown.`
}
