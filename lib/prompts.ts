import { AmazonData, TrendsData, RedditData, YouTubeData, PainPoint, AmazonReview, Market, SubNiche, TargetInterpretationSummary, BookReviews, FilteredBook } from './types'
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
- Per ogni pain point estrai sia il CONTENUTO (cosa dicono) sia la FORMA LINGUISTICA (come lo dicono), perché il secondo è materiale prezioso per il copywriting del libro

CAMPI DI OUTPUT PER OGNI PAIN POINT:

1. CAMPI ANALITICI (esistenti):
   - pain_point: descrizione concisa del problema in italiano (max 15 parole)
   - F (Frequenza): rispetta la calibrazione sopra
   - I (Intensità emotiva): rispetta la calibrazione sopra
   - S (Specificità/Solvibilità con un libro): scala 1-10
   - num_fonti: numero di thread/video DISTINTI in cui appare (minimo 1)
   - ${fonteInstr}
   - tipo: "gap_esecuzione" o "job_confermato"

2. CAMPI VOICE-OF-CUSTOMER (NUOVI, OBBLIGATORI):

   - evidence_quotes: array di 2-4 CITAZIONI ESATTE (verbatim) dal corpus, in lingua originale
     • Devono essere copia letterale dal corpus, non parafrasi
     • Privilegia citazioni che esprimono il pain point in modo emotivo o specifico
     • Ognuna max 150 caratteri
     • Se trovi solo 1 citazione molto forte, va bene 1 invece di 2-4

   - voice_phrases: array di 2-5 FRASI BREVI pronte per essere usate nel copywriting del libro
     • Sono ESTRATTI CHIRURGICI dalle evidence_quotes, NON riformulazioni
     • Es: da "Design Space is SO BAD I want to throw it away" estrai "so bad", "throw it away"
     • Es: da "I have no idea how the heck to do this" estrai "no idea how the heck"
     • Frasi 2-6 parole, in lingua originale dal corpus
     • Devono essere usabili come hook/slogan/bullet/sottotitolo di libro
     • Privilegia frasi distintive, evocative, emotive — scarta frasi banali tipo "this is hard"

   - emotional_register: il tono emotivo prevalente, uno tra:
     • "frustrazione" — irritazione generale, problema noioso ricorrente
     • "rabbia" — ostilità diretta, parole forti, voglia di distruggere
     • "ansia" — paura, preoccupazione, scenari catastrofici
     • "rassegnazione" — accettazione amara, "è così e basta"
     • "desiderio" — espressione di un wishful, "I wish", "I want", "if only"
     • "confusione" — incapacità di capire, smarrimento, "I don't understand"
     • "orgoglio" — celebrazione di successo dopo difficoltà
     • "neutro" — osservazione fattuale senza carica emotiva

   - context: 1 riga (max 15 parole) che descrive CHI parla e IN CHE SITUAZIONE
     • Es: "principianti assoluti che vedono Excel per la prima volta"
     • Es: "caregivers che aiutano genitori anziani con smartphone"
     • Es: "hobbisti che hanno provato Cricut per un anno e sono frustrati"

   - evidence (campo legacy, mantenere per compatibilità): copia qui la PRIMA evidence_quote oppure una parafrasi breve (max 80 caratteri)

   - linguaggio (campo legacy esistente): frase verbatim se tipo=job_confermato, altrimenti null

Rispondi SOLO con un array JSON valido (nessun testo prima o dopo):
[
  {
    "pain_point": "descrizione concisa del problema in italiano (max 15 parole)",
    "F": numero,
    "I": numero,
    "S": numero,
    "num_fonti": numero,
    "evidence": "prima evidence_quote o parafrasi (max 80 char)",
    "evidence_quotes": ["citazione 1 verbatim", "citazione 2 verbatim", "citazione 3 verbatim"],
    "voice_phrases": ["frase breve 1", "frase breve 2", "frase breve 3"],
    "emotional_register": "frustrazione | rabbia | ansia | rassegnazione | desiderio | confusione | orgoglio | neutro",
    "context": "chi parla e in che situazione",
    "fonte": "reddit | youtube",
    "tipo": "gap_esecuzione | job_confermato",
    "linguaggio": "frase verbatim se tipo=job_confermato, altrimenti null"
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

// ─── Pain Points da Recensioni Amazon (Haiku) ─────────────────────────────────

export function promptPainPointsAmazonReviews(
  keyword: string,
  topBookReviews: BookReviews[],
  market: Market,
): string | null {
  const perBook: Array<{ asin: string; bookTitle: string; entries: Array<{ label: string; text: string }> }> = []

  for (const br of topBookReviews) {
    const negEntries = br.reviews
      .filter(r => r.rating <= 3)
      .slice(0, 5)
      .map(r => ({ label: `[NEG ${r.rating}★]`, text: `"${r.title}" — ${r.body.slice(0, 500)}` }))

    const mixedEntries = br.reviews
      .filter(r => r.rating === 4)
      .slice(0, 2)
      .map(r => ({ label: `[MIXED 4★]`, text: `"${r.title}" — ${r.body.slice(0, 500)}` }))

    const bookEntries = [...negEntries, ...mixedEntries]
    if (bookEntries.length > 0) {
      perBook.push({ asin: br.asin, bookTitle: br.bookTitle, entries: bookEntries })
    }
  }

  const totalReviews = perBook.reduce((acc, b) => acc + b.entries.length, 0)
  if (totalReviews < 3) return null

  const corpus = perBook
    .map(b => {
      const reviewsText = b.entries
        .map(e => `  ${e.label} ${e.text}`)
        .join('\n')
      return `Libro: "${b.bookTitle}" (ASIN: ${b.asin})\n${reviewsText}`
    })
    .join('\n\n---\n\n')

  return `Sei un esperto di analisi editoriale KDP con specializzazione nell'interpretazione delle recensioni Amazon.

CORPUS RECENSIONI COMPETITOR (keyword: "${keyword}", mercato: ${market}):

${corpus}

CALIBRAZIONE F (Frequenza) — scala obbligatoria 1-10:
- F=1-2: il problema appare in 1 sola recensione di 1 solo libro
- F=3-4: il problema appare in 2-3 recensioni dello stesso libro, OPPURE in 1 sola recensione ma in 2 libri distinti
- F=5-6: il problema appare in 3+ libri distinti (pattern cross-competitor consolidato)
- F=7-8: il problema appare in 4+ libri distinti o è citato ripetutamente nella maggior parte dei libri analizzati
- F=9-10: il problema appare in QUASI TUTTI i libri del corpus (pattern sistemico della nicchia)
REGOLA HARD: se il problema viene da un solo libro (num_fonti=1), F NON può superare 4.

CALIBRAZIONE I (Intensità emotiva) — scala obbligatoria 1-10:
Usa COME PROXY PRIMARIO il rating della recensione, modulato dal tono testuale:
- I=1-3: recensione 4★ ("mixed"), feedback costruttivo neutro ("would be nice if", "could be better")
- I=4-6: recensione 3★, frustrazione lieve ("annoying", "frustrating", "wish it had")
- I=7-8: recensione 1-2★, frustrazione esplicita ("waste", "useless", "terrible", linguaggio diretto e negativo)
- I=9-10: recensione 1★ con linguaggio estremo ("worst book ever", "scam", "ruined", "throw it away")

CALIBRAZIONE S (Specificità/Solvibilità con un libro) — scala obbligatoria 1-10:
Quanto è risolvibile il problema con una scelta editoriale concreta nel nuovo libro?
- S=1-3: difficile da risolvere senza riscrivere completamente il libro o cambiare genere
- S=4-6: risolvibile con modifiche moderate (riorganizzazione capitoli, aggiunta esempi, sezioni didattiche extra)
- S=7-8: facilmente risolvibile con una scelta editoriale precisa (large print, layout a pagina singola, QR code per video, lay-flat binding, illustrazioni a piena pagina, indice analitico, glossario, ecc.)
- S=9-10: risolvibile banalmente con un singolo accorgimento (es. aumento font, formato fisico diverso)

REGOLA HARD: F, I, S sono SEMPRE numeri interi tra 1 e 10. NON usare mai 0 o valori fuori scala. NON usare i valori "1, 1, 1" come default: ogni pain point deve avere valori giustificati dalle calibrazioni sopra.

ISTRUZIONI:
Estrai pain point appartenenti a queste tre categorie (TUTTE valide):

1. CONTENUTO E STRUTTURA — mancanza di esempi pratici, template assenti, teoria senza applicazione, capitoli mancanti, progressione confusa, sezioni superficiali su temi cruciali, ecc.

2. USABILITA E FRUIZIONE — leggibilità (testo troppo piccolo, font difficile), layout (pagine non apribili a 180 gradi, illustrazioni piccole o poco chiare, schema visivo confuso), navigazione (indice mancante, riferimenti incrociati assenti, difficoltà a trovare informazioni durante la pratica/lettura), formato fisico (rilegatura che si chiude, dimensioni inadatte all'uso pratico). Questi NON sono preferenze soggettive: sono problemi concreti che un editore può risolvere con scelte editoriali specifiche (large print, layout a pagina singola, lay-flat binding, illustrazioni a tutta pagina, QR code per video, ecc.).

3. PRESENTAZIONE DIDATTICA — istruzioni poco chiare, mancanza di esempi visivi, assenza di varianti per livelli diversi, modifiche/adattamenti non spiegati, sequenze/progressioni non guidate.

IGNORA invece queste categorie (NON validi come pain point):
- Problemi logistici: spedizione, packaging, qualità stampa fisica del singolo esemplare ricevuto
- Confronti tra edizioni: Kindle vs cartaceo, hardcover vs paperback
- Opinioni puramente soggettive sullo STILE dell'autore: "tono noioso", "stile pesante", "non mi piace il modo di scrivere"
- Lamentele sul prezzo o sulla lunghezza generica del libro

REGOLA DI PRIORITA:
- Dai peso maggiore ai problemi che compaiono in più libri distinti (cross-competitor pattern)
- Max 8 pain points

REGOLE DI FORMATTAZIONE OUTPUT:

a) Campo "pain_point": stringa asciutta, max 15 parole, in italiano. Nessuna ripetizione di parole accidentale (NO "Layout layout: foto..." → SÌ "Layout: foto e istruzioni su pagine diverse"). Nessun prefisso ridondante (NO "Problema: ..." → SÌ scrivi direttamente il problema). Frase nominale o frase breve.

b) Campo "evidence": parafrasi in italiano che riassume cosa dicono le recensioni di supporto. Qui PUOI riformulare con parole tue.

c) Campo "evidence_quotes": citazioni LETTERALI dal testo originale delle recensioni. NON parafrasare. NON tradurre. NON riassumere. Copia esattamente le parole come appaiono nella recensione, anche se in inglese. Max 200 caratteri ciascuna.

   ESEMPIO CORRETTO (verbatim dal testo):
   ✓ "pages don't lie flat while practicing"
   ✓ "the words are so small I can barely read them"
   ✓ "photos and descriptions are on different pages"

   ESEMPIO SBAGLIATO (parafrasi/descrizione di terza persona):
   ✗ "Multiple reviewers explicitly request lay-flat binding"
   ✗ "Reader complaint about small font size making book difficult to read"
   ✗ "Reviewer suggests improvement for layout by placing photo and instructions on facing pages"

   Se non trovi una citazione letterale nel testo originale che supporta il pain point, ometti il campo evidence_quotes o lascia un array vuoto. NON inventare citazioni e NON descriverle: meglio nessuna citazione che una parafrasi.

d) Campo "voice_phrases": frasi brevi (2-6 parole) estratte letteralmente dal testo delle recensioni, che rappresentano il modo concreto in cui i lettori esprimono il problema. Stesse regole verbatim di evidence_quotes: copia letterale, nessuna parafrasi.

Nel template sotto i campi numerici sono descritti tra <>: nel TUO output JSON devi restituire NUMERI INTERI per F, I, S, num_fonti — non stringhe.

Rispondi SOLO con un array JSON valido (nessun testo prima o dopo):
[
  {
    "pain_point": "descrizione sintetica del problema (max 15 parole)",
    "F": "<intero 1-10, rispetta la calibrazione F sopra>",
    "I": "<intero 1-10, rispetta la calibrazione I sopra>",
    "S": "<intero 1-10, rispetta la calibrazione S sopra>",
    "num_fonti": "<numero di libri distinti in cui il problema appare, minimo 1>",
    "evidence": "parafrasi sintetica in italiano (max 200 chars) che riassume cosa dicono le recensioni",
    "fonte": "recensione_negativa | recensione_positiva (in base al rating prevalente delle recensioni di supporto)",
    "evidence_quotes": ["VERBATIM dal testo originale, no parafrasi, max 200 chars", "..."],
    "voice_phrases": ["VERBATIM 2-6 parole dal testo originale, no parafrasi", "..."],
    "emotional_register": "frustrazione | rabbia | ansia | rassegnazione | desiderio | confusione | orgoglio | neutro",
    "tipo": "gap_esecuzione | job_confermato"
  }
]`
}

// ─── Concept Directions (Sonnet) ─────────────────────────────────────────────

export function promptConceptDirections(
  keyword: string,
  market: Market,
  painPoints: PainPoint[],
  topBookReviews: BookReviews[],
  gapAnalysis?: unknown,
): string {
  // Blocco pain points con evidence e voice
  const ppBlock = painPoints.map(pp => {
    const lines: string[] = [
      `[${pp.id}] ${pp.pain_point} (score ${pp.score}, fonte: ${pp.fonte})`,
    ]
    if (pp.evidence_quotes?.length) {
      pp.evidence_quotes.slice(0, 2).forEach(q => lines.push(`  citazione: "${q}"`))
    }
    if (pp.voice_phrases?.length) {
      pp.voice_phrases.slice(0, 3).forEach(p => lines.push(`  voce lettore: "${p}"`))
    }
    return lines.join('\n')
  }).join('\n\n')

  // Blocco recensioni negative top competitor (max 3 per libro, body ≤400 chars)
  const reviewLines: string[] = []
  for (const br of topBookReviews) {
    const negReviews = br.reviews
      .filter(r => r.rating <= 3)
      .slice(0, 3)
    if (negReviews.length > 0) {
      reviewLines.push(`Libro: "${br.bookTitle}"`)
      negReviews.forEach(r => {
        reviewLines.push(`  [${r.rating}★] "${r.title}" — ${r.body.slice(0, 400)}`)
      })
    }
  }
  const reviewBlock = reviewLines.length > 0
    ? reviewLines.join('\n')
    : '(nessuna recensione negativa disponibile)'

  // Blocco gap analysis compatto (passo1, passo2, passo4)
  let gapBlock = '(gap analysis non disponibile)'
  if (gapAnalysis && typeof gapAnalysis === 'object') {
    const ga = gapAnalysis as Record<string, unknown>
    const compact = {
      problemi_non_risolti: ga['passo1_problemi_non_risolti'],
      angoli_mancanti: ga['passo2_angoli_mancanti'],
      target_non_servito: ga['passo4_target_non_servito'],
    }
    gapBlock = JSON.stringify(compact, null, 2).slice(0, 1500)
  }

  return `Sei un esperto di strategia editoriale KDP specializzato nel posizionamento di nuovi titoli in nicchie già competitive.

KEYWORD: "${keyword}" (mercato: ${market})

ISTRUZIONI LINGUA E TERMINOLOGIA:

Il report è letto da un autore-decisore di lingua ITALIANA che valuta se entrare nella nicchia. Per questo motivo i campi analitici del report devono essere in italiano, mentre il titolo del libro proposto resta nella lingua del mercato perché si rivolge ai lettori finali.

REGOLE PER CAMPO:

- "titolo_concetto" → lingua del mercato (${market}): è il titolo del libro che andrebbe pubblicato per i lettori target. Per US/UK: inglese. Per IT: italiano. Per DE/FR/ES: rispettiva lingua locale.

- "sotto_segmento" → SEMPRE ITALIANO. Descrizione del target reader rivolta all'autore-decisore.

- "angolo" → SEMPRE ITALIANO. Spiegazione strategica del concept.

- "why_could_work" → SEMPRE ITALIANO. Analisi del potenziale di successo.

- "main_risk" → SEMPRE ITALIANO. Analisi del rischio principale.

- "differenziatori_chiave" → SEMPRE ITALIANO (ogni elemento).

- "evidenza_motivo" → SEMPRE ITALIANO. Giustificazione del punteggio di evidenza.

CONVENZIONE PER TERMINI TECNICI DEL MERCATO:

Quando nella spiegazione italiana incontri un termine tecnico, di formato editoriale, o un'espressione idiomatica specifica del mercato che merita di essere richiamata letteralmente (perché è il termine effettivo che useresti nel libro/in copertina/nelle ricerche Amazon), traducilo in italiano e aggiungi il termine originale tra parentesi.

ESEMPI CORRETTI:
✓ "Calcolatore stampabile della quantità di legna (printable firewood quantity calculator), primo nella nicchia"
✓ "Modulo compilabile incorporato (fill-in workbook embedded), trasformandolo in un riferimento riutilizzabile"
✓ "Sessioni di pratica da 30 minuti (30-minute practice sessions) progettate per evitare la perfection-burnout"
✓ "Posizionamento anti-stanchezza (anti-burnout positioning)"

ESEMPI SBAGLIATI:
✗ "Printable firewood quantity calculator stampabile" (mix confusionario di lingue)
✗ "Una guida workbook a fill-in" (mix non strutturato)
✗ "Un fill-in workbook compilabile" (ridondanza, scegli una via)

ECCEZIONI (NON tradurre):
- Acronimi consolidati: USDA, FDA, EPA, USP — restano in originale senza parentesi
- Nomi propri di organizzazioni, prodotti, autori — restano in originale
- Termini tecnici già consolidati anche in italiano: "homesteading", "prepper", "off-grid" — restano in inglese senza parentesi
- Nomi geografici: "Bay Area", "Midwest" — restano in originale

NON tradurre forzatamente quando la traduzione italiana risulta artificiale o pedante.

═══ PAIN POINT DEI LETTORI ═══
${ppBlock}

═══ RECENSIONI NEGATIVE COMPETITOR ═══
${reviewBlock}

═══ GAP ANALYSIS ═══
${gapBlock}

═══ ISTRUZIONI ═══
Genera esattamente 3 concept di libro ALTERNATIVI per la nicchia "${keyword}" sul mercato ${market}.
Questi NON sono volumi della stessa serie: sono 3 libri indipendenti con angoli distinti.

Ogni concept deve avere un sotto-segmento target DISTINTO dagli altri due (no overlap > 50% di pubblico target).

- Concept 1: il più allineato ai pain point top (sotto-segmento principale della nicchia)
- Concept 2: alternativa che attacca un pain meno ovvio o un segmento adiacente
- Concept 3: esplorazione laterale (audience diversa, formato diverso, o approccio inversamente posizionato)

Regole:
- Ogni concept deve referenziare pain point concreti via pain_points_origine (usa gli ID esatti mostrati sopra, es. "pp_abc12345" o "pp_amz_abc12345")
- difficolta_esecuzione riflette: skill autoriali richieste, ricerca necessaria, costi di produzione, capacità di differenziarsi visivamente
- evidenza_score (1-10): (a) quanti pain top sono coperti, (b) chiarezza del segnale dai dati, (c) probabilità realistica di emergere dato il top 5 attuale
- Usa i voice_phrases dei lettori dove possibile per i titoli dei concept

Rispondi SOLO con un array JSON di esattamente 3 elementi, niente prosa, niente markdown:
[
  {
    "titolo_concetto": "titolo conciso (max 12 parole, lingua del mercato)",
    "sotto_segmento": "descrizione del pubblico target (max 25 parole, specifica)",
    "pain_points_origine": ["pp_xxxxxxxx", "..."],
    "angolo": "cosa rende unico questo concept (2-3 frasi, max 400 chars)",
    "why_could_work": "meccanica del successo (2-3 frasi, max 400 chars)",
    "main_risk": "rischio principale (1-2 frasi, max 300 chars)",
    "differenziatori_chiave": ["differenziatore 1", "differenziatore 2", "differenziatore 3"],
    "difficolta_esecuzione": "BASSA | MEDIA | ALTA",
    "evidenza_score": 7,
    "evidenza_motivo": "perché questo score (max 20 parole)"
  }
]`
}

// ─── Bonus Suggestions (Sonnet) ───────────────────────────────────────────────

export function promptBonusSuggestions(
  keyword: string,
  market: Market,
  painPoints: PainPoint[],
  topBookReviews: BookReviews[],
  gapAnalysis?: unknown,
): string {
  // Blocco pain points
  const ppBlock = painPoints.map(pp => {
    const lines: string[] = [
      `[${pp.id}] ${pp.pain_point} (F:${pp.F} I:${pp.I} S:${pp.S}, fonte:${pp.fonte})`,
    ]
    if (pp.evidence_quotes?.length) {
      pp.evidence_quotes.slice(0, 2).forEach(q => lines.push(`  citazione: "${q}"`))
    }
    if (pp.voice_phrases?.length) {
      pp.voice_phrases.slice(0, 3).forEach(p => lines.push(`  voce lettore: "${p}"`))
    }
    return lines.join('\n')
  }).join('\n\n')

  // Blocco recensioni negative Amazon
  const reviewLines: string[] = []
  for (const br of topBookReviews) {
    const negReviews = br.reviews
      .filter(r => r.rating <= 3)
      .slice(0, 4)
    if (negReviews.length > 0) {
      reviewLines.push(`Libro: "${br.bookTitle}"`)
      negReviews.forEach(r => {
        reviewLines.push(`  [${r.rating}★] "${r.title}" — ${r.body.slice(0, 500)}`)
      })
    }
  }
  const reviewBlock = reviewLines.length > 0
    ? reviewLines.join('\n')
    : '(nessuna recensione negativa disponibile)'

  // Blocco gap analysis
  const gapBlock = gapAnalysis
    ? JSON.stringify(gapAnalysis, null, 2).slice(0, 2000)
    : '(gap analysis non disponibile)'

  return `Sei un esperto di editoria KDP specializzato nel design di bonus e materiali supplementari per libri self-published.

KEYWORD: "${keyword}" (mercato: ${market})

═══ PAIN POINT DEI LETTORI ═══
${ppBlock}

═══ RECENSIONI NEGATIVE COMPETITOR ═══
${reviewBlock}

═══ GAP ANALYSIS ═══
${gapBlock}

═══ ISTRUZIONI ═══
Genera da 1 a 5 bonus tangibili (non concettuali) per il libro che affrontino uno o più pain point specifici tra quelli forniti sopra.

Regole:
- Ogni bonus deve referenziare i pain point di origine via pain_points_origine (array di ID esatti come mostrati sopra, es. "pp_abc12345")
- Preferisci bonus a basso costo produttivo (workbook PDF, checklist, template, planner) rispetto a bonus costosi (video corsi, community) — includi i costosi solo se il segnale è molto forte
- Usa il voice_phrases dei lettori per i titoli dei bonus dove possibile
- efficacia_score (1-10): considera (a) esplicitezza del segnale nei dati, (b) numero pain point risolti, (c) facilità di percezione del valore per il lettore
- Adatta esempi al pubblico del mercato ${market}

Rispondi SOLO con un array JSON valido, nessun testo prima o dopo:
[
  {
    "titolo": "titolo conciso (max 12 parole)",
    "tipo": "workbook|checklist|cheat_sheet|template|mini_corso_video|community|quiz|audio_companion|risorse_esterne|planner",
    "pain_points_origine": ["pp_xxxxxxxx"],
    "segnale_fonte": "recensione|reddit|youtube|gap_analysis|misto",
    "evidence_quote": "citazione esemplificativa max 200 chars (ometti se non disponibile)",
    "razionale": "perché questo bonus risolve i pain point (2-3 frasi, max 400 chars)",
    "come_realizzarlo": "formato, lunghezza, strumenti (2-3 frasi, max 400 chars)",
    "come_presentarlo": "dove inserirlo: back matter, lead magnet, bonus page, copertina (max 400 chars)",
    "efficacia_score": 7,
    "efficacia_motivo": "perché questo score (max 20 parole)"
  }
]`
}

// ─── Things to Avoid (Sonnet) ─────────────────────────────────────────────────

export function promptThingsToAvoid(
  keyword: string,
  market: Market,
  painPoints: PainPoint[],
  topBooks: FilteredBook[],
  topBookReviews: BookReviews[],
  gapAnalysis?: unknown,
): string {
  // Blocco top 5 strutturato + statistiche aggregate
  const prices = topBooks.map(b => b.price).filter(p => p > 0)
  const avgPrice = prices.length > 0 ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : 'N/D'
  const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : 'N/D'
  const maxPrice = prices.length > 0 ? Math.max(...prices).toFixed(2) : 'N/D'
  const ratings = topBooks.map(b => b.rating).filter(r => r > 0)
  const ratingRange = ratings.length > 0
    ? `${Math.min(...ratings).toFixed(1)}–${Math.max(...ratings).toFixed(1)}`
    : 'N/D'
  const bsrRange = topBooks.filter(b => b.bsr > 0).map(b => b.bsr)
  const bsrRangeStr = bsrRange.length > 0
    ? `${Math.min(...bsrRange).toLocaleString()}–${Math.max(...bsrRange).toLocaleString()}`
    : 'N/D'

  const booksBlock = topBooks
    .map((b, i) =>
      `${i + 1}. "${b.title}" — ${b.currency}${b.price.toFixed(2)}, BSR ${b.bsr.toLocaleString()}, ` +
      `${b.reviewCount} rec, ${b.rating}★, ${b.pages ?? '?'} pag, ${b.selfPublished ? 'self-pub' : 'publisher'}`
    )
    .join('\n')

  // Blocco recensioni negative (≤3★, max 3 per libro, 400 chars)
  const reviewLines: string[] = []
  for (const br of topBookReviews) {
    const neg = br.reviews.filter(r => r.rating <= 3).slice(0, 3)
    if (neg.length > 0) {
      reviewLines.push(`Libro: "${br.bookTitle}"`)
      neg.forEach(r => reviewLines.push(`  [${r.rating}★] "${r.title}" — ${r.body.slice(0, 400)}`))
    }
  }
  const reviewBlock = reviewLines.length > 0
    ? reviewLines.join('\n')
    : '(nessuna recensione negativa disponibile)'

  // Blocco pain points top (max 8, con evidence_quotes)
  const topPainPoints = [...painPoints]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8)

  const ppBlock = topPainPoints.map(pp => {
    const lines: string[] = [
      `[${pp.id}] score ${pp.score} — "${pp.pain_point}" (fonte: ${pp.fonte})`,
    ]
    if (pp.evidence_quotes?.length) {
      pp.evidence_quotes.slice(0, 2).forEach(q => lines.push(`  citazione: "${q}"`))
    }
    return lines.join('\n')
  }).join('\n\n')

  // Blocco gap analysis narrativo
  let gapBlock = '(gap analysis non disponibile)'
  if (gapAnalysis && typeof gapAnalysis === 'object') {
    const ga = gapAnalysis as Record<string, unknown>
    const compact = {
      problemi_non_risolti: ga['passo1_problemi_non_risolti'],
      angoli_mancanti: ga['passo2_angoli_mancanti'],
      target_non_servito: ga['passo4_target_non_servito'],
    }
    gapBlock = JSON.stringify(compact, null, 2).slice(0, 1500)
  }

  return `Sei un esperto di strategia editoriale KDP che identifica gli errori più comuni che un nuovo entrante commette in questa nicchia.

KEYWORD: "${keyword}" (mercato: ${market})

═══ TOP ${topBooks.length} COMPETITOR ═══
${booksBlock}

Statistiche aggregate: prezzo medio ${market === 'IT' ? '€' : '$'}${avgPrice} (range ${minPrice}–${maxPrice}) · BSR range ${bsrRangeStr} · rating range ${ratingRange}★

═══ RECENSIONI NEGATIVE ═══
${reviewBlock}

═══ PAIN POINTS TOP (ordinati per score) ═══
${ppBlock}

═══ GAP ANALYSIS ═══
${gapBlock}

═══ ISTRUZIONI ═══
Genera ESATTAMENTE 3 anti-pattern specifici e ancorati ai dati di questa nicchia.
Ordina per severità decrescente: critica → alta → media.
I 3 anti-pattern devono avere categorie DISTINTE (no doppioni di categoria).
Almeno 1 deve avere severità "critica" se i dati lo supportano.

LINGUA: SEMPRE ITALIANO per tutti i campi.

REGOLA D'ORO: ogni "evidence" deve citare un dato specifico verificabile dal report. NIENTE frasi vaghe.

ESEMPI di evidence VALIDA:
✓ "Il top 4 ha prezzo medio $27.79, range $17.99-$37.97. Sotto $19.99 ti collochi nella fascia low-quality."
✓ "3 recensioni negative su 5 libri citano 'pictures don't match instructions' o 'no diagrams' (pattern cross-competitor)."
✓ "Il pain point score 7.6 'mancanza esempi pratici' è confermato da 2 thread Reddit e 4 recensioni negative."
✓ "I top 4 competitor hanno tutti illustrazioni vettoriali in copertina; foto realistiche perdono leggibilità a thumbnail 100×150."

ESEMPI di evidence INVALIDA:
✗ "La nicchia è competitiva."
✗ "I lettori si aspettano qualità."
✗ "È importante differenziarsi."

CATEGORIE ammesse (usa esattamente questi valori):
- pricing: errori di prezzo
- positioning: errori di posizionamento (es. troppo generico, sovrapposizione con dominator)
- cover_design: errori di copertina (es. mismatch genere, illeggibile a thumbnail)
- content: errori di contenuto (es. troppo teorico, mancano esempi)
- format: errori di formato (es. layout non funzionale)
- marketing: errori di marketing (es. ARC team insufficiente, ads troppo presto)
- differentiation: mancata differenziazione (es. clone degli omnibus, no USP chiaro)
- review_velocity: errori di review velocity (es. lanciare senza ARC)

SEVERITÀ (usa esattamente questi valori):
- critica: errore che da solo uccide il lancio
- alta: errore che riduce significativamente la conversione
- media: errore evitabile ma non fatale

CONVENZIONE TERMINI: traduci in italiano, aggiungi termine originale tra parentesi se aggiunge precisione editoriale.
ECCEZIONI (non tradurre): USDA, FDA e altri acronimi consolidati; nomi propri; termini già usati in italiano (prepper, homesteading, off-grid).

Rispondi SOLO con un array JSON di 3 elementi, ordinato per severità decrescente, niente prosa, niente markdown:
[
  {
    "titolo": "Etichetta breve dell'anti-pattern (max 8 parole, italiano)",
    "descrizione": "2-3 frasi italiane che spiegano cosa evitare e perché (max 500 chars)",
    "categoria": "pricing | positioning | cover_design | content | format | marketing | differentiation | review_velocity",
    "evidence": "1-2 frasi italiane con dato specifico verificabile dal report (max 400 chars). Cita numeri concreti.",
    "severita": "critica | alta | media"
  }
]`
}
