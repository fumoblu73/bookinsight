# BookInsight 9.0.1 — utilizzabilità e copertura Reddit

## Regole

`RedditData.available` descrive la disponibilità della fonte. Il nuovo campo
opzionale `corpusQuality` distingue l'utilizzabilità dalla copertura:

| Campo | Regola |
| --- | --- |
| `usable` | Fonte disponibile e almeno **1 commento utilizzabile in 1 thread**. Consente l'analisi qualitativa anche di un campione piccolo. |
| `coverage: none` | Nessun commento utilizzabile: Reddit escluso dall'AI. |
| `coverage: limited` | Corpus utilizzabile, ma almeno uno dei minimi di copertura manca. L'AI riceve i testi e un avviso esplicito. |
| `coverage: diversified` | Nel prompt, almeno **20 commenti utilizzabili, 5 thread distinti con commenti utilizzabili e 2 subreddit noti distinti**, insieme. |

Le soglie sono operative, non validate statisticamente: 20 commenti forniscono
un minimo di materiale; 5 thread mantengono la precedente soglia come indicatore
di copertura; 2 subreddit segnalano che il campione supera una sola comunità.
Nessuna combinazione garantisce rappresentatività dell'intero mercato.
`limitations` indica i minimi mancanti (`few_comments`, `few_threads`,
`few_subreddits`) oppure `no_usable_comments`.

Si escludono commenti vuoti, `[removed]`/`[deleted]`, AutoModerator e testi
composti solo da link, punteggiatura o emoji. Il filtro del collector sui
messaggi fissati dei moderatori resta attivo. Le conferme brevi leggibili
rimangono nel contesto: l'AI deve associarle al problema descritto nel thread,
senza inventare un problema autonomo. Pertinenza semantica e qualità della
testimonianza restano da valutare nell'analisi AI, non si deducono dal conteggio.
Un post con solo titolo/selftext e senza commenti utilizzabili non supera il gate.

La valutazione deduplica ID di thread e commenti e distingue:

- `collectedCommentCount`: commenti presenti nel payload ricevuto dal collector,
  prima del filtro locale. Non è il totale grezzo degli item Apify pagati.
- `usableCommentCount` / `usableThreadCount`: commenti e thread distinti
  utilizzabili, prima dei limiti di selezione del prompt.
- `transmittedCommentCount` / `transmittedThreadCount`: commenti e thread
  effettivamente inseriti nel prompt, dopo i limiti di **15 thread** e
  **30 commenti per thread**. La copertura viene calcolata su questa selezione.
- `subredditCount`: subreddit distinti nei thread effettivamente trasmessi.

Il collector chiede ad Apify fino a 40 commenti per URL; il suo filtro, il ranking
e il limite di 30 commenti per post precedono già il payload RedditData. Il
prompt applica di nuovo il limite per gestire in sicurezza anche payload legacy
o forniti direttamente. Non è possibile ricostruire dagli aggregati salvati i
commenti scartati prima del payload.

Il limite di testo rimane 300 caratteri per commento e 400 per selftext. Non ci
sono ulteriori tagli al prompt in `callSonnet`: viene soltanto ripulito da
surrogate Unicode isolate. `max_tokens: 8192` riguarda l'output, non tronca i
commenti in ingresso. I nomi subreddit sono normalizzati; il fallback `reddit`
dello scraper non conta come comunità nota.

## Compatibilità e attribuzione

- `insufficientCorpus` resta come avviso legacy (`coverage !== 'diversified'`),
  ma non esclude più Reddit dall'analisi.
- I nuovi campi sono opzionali. Dati e snapshot intermedi precedenti sono
  rivalutati dai testi, senza affidarsi al vecchio flag o ai contatori salvati.
  I report archiviati si aprono senza migrazione né riscrittura: la UI gestisce
  l'assenza dei nuovi campi e conserva l'avviso legacy quando disponibile.
- Log, snapshot intermedio, `redditMeta`, riepilogo API e `voice_data.reddit`
  conservano la nuova valutazione per le nuove esecuzioni.
- I prompt di estrazione, Key Insights e Gap Analysis esplicitano che le frequenze
  riguardano il campione osservato e non la prevalenza nell'intero mercato.
  I nuovi pain point Reddit mantengono `redditCorpusQuality` opzionale: l'avviso
  segue il campione anche nei prompt bonus, concept, things-to-avoid e pivot.
  Un singolo commento è segnalato esplicitamente come testimonianza qualitativa
  isolata, non prova di frequenza elevata o domanda consolidata.
- Ogni pain point mantiene la piattaforma dichiarata; una fonte esclusa non
  viene rietichettata come l'altra. Un output AI senza `fonte` viene accettato
  solo se esiste una sola piattaforma utilizzabile. Output ambigui vengono scartati.
  Se un problema emerge su entrambe le piattaforme, il prompt richiede evidenze
  separate con citazioni e `num_fonti` della rispettiva piattaforma.
  Nel report le evidenze sociali mostrano esplicitamente la fonte Reddit/YouTube;
  l'assenza del campo nei report precedenti non causa errori.
  Evidenze Reddit con `num_fonti` non intero, inferiore a 1 o superiore ai thread
  inclusi vengono scartate prima dello scoring: questa validazione evita che il
  modello inventi thread per un segnale isolato, senza introdurre nuovi cap F/I.
- La soglia YouTube esistente rimane invariata. Prompt, gate AI e normalizzazione
  usano la stessa ammissione: YouTube disponibile, non insufficiente e con testi.

Non cambiano la formula `0,67F + 0,33I`, il cap F su fonte singola, la
classificazione S, il Profitability Score, ROI, verdetto o algoritmo U/T/M.

## Caso segnalato: "just add water meals"

| | Prima | Dopo |
| --- | --- | --- |
| Reddit: 3 thread, 64 commenti utilizzabili | `insufficientCorpus=true`, testi esclusi | `usable=true`, `coverage=limited`, 64 commenti inviati |
| Avviso | Flag usato come blocco | Copertura limitata esplicita nei prompt e nel report |
| YouTube: 8 video, 26 commenti | Unica fonte sociale ammessa | Entrambe le piattaforme ammesse, evidenze attribuite separatamente |

La fixture del caso segnalato distribuisce i commenti in **22/21/21**: **64
raccolti nel payload, 64 utilizzabili e 64 trasmessi**, verificati contando le
righe effettive del prompt passato all'estrattore. I 26 commenti YouTube sono
aggiuntivi. Il solo totale di 64 non garantisce lo stesso risultato con qualsiasi
distribuzione: con **40/12/12** nel payload, 64 sono utilizzabili ma solo **54**
sono inseriti nel prompt (30 + 12 + 12). Anche questo caso è coperto da test.

Il test riproduce questi volumi con testi sintetici e un estrattore iniettato.
Verifica l'ammissione e l'attribuzione, non il contenuto del report reale né
quanti pain point un modello live estrarrebbe. I report archiviati non vengono
rianalizzati automaticamente.

## Test locali senza servizi esterni

Il repository non ha uno script npm `test`; si usa il runner nativo Node e il
compilatore TypeScript già installati. Dalla root del checkout:

```bash
./node_modules/.bin/tsc --project tsconfig.tests.json --outDir /workspace/work/bookinsight-9.0.1/review-tests
mkdir -p /workspace/work/bookinsight-9.0.1/review-tests/node_modules/@
ln -sfn ../../lib /workspace/work/bookinsight-9.0.1/review-tests/node_modules/@/lib
NODE_PATH="$PWD/node_modules" node /workspace/work/bookinsight-9.0.1/review-tests/lib/reddit.test.js
NODE_PATH="$PWD/node_modules" node /workspace/work/bookinsight-9.0.1/review-tests/components/ReportView.test.js
node /workspace/work/bookinsight-9.0.1/review-tests/lib/target.test.js
node /workspace/work/bookinsight-9.0.1/review-tests/lib/scoring.test.js
./node_modules/.bin/tsc --noEmit --incremental false
npm run lint
```

I test non leggono credenziali né chiamano API. Non richiedono dipendenze nuove.
Il link simbolico nel solo output dei test risolve l'alias Next `@/lib` nel
runner CommonJS; non cambia sorgenti né configurazione di produzione.
Baseline prima delle modifiche: TypeScript OK, target 21/21, scoring 24/24;
lint già non superato con 5 errori e 13 avvisi (ReportView, TargetSelector,
trends e avvisi in altri file). Le anomalie preesistenti non rientrano in questa
modifica.

## Esito della verifica locale

- Nuovi test Reddit: **34/34**, inclusi volumi del caso segnalato, confini delle
  soglie, commenti inutilizzabili, duplicati, attribuzione e dati legacy.
- Rendering completo del report: **3/3**, inclusi report senza `corpusQuality`,
  conservazione di fonti/evidenze, assenza di fonte e avviso del commento singolo.
- Target: **21/21**; scoring/verdetto/ROI: **24/24**.
- TypeScript dell'intero progetto: **nessun errore**.
- Lint completo: **5 errori e 13 avvisi preesistenti**, come prima della modifica.
  Errori: 2 `react/no-unescaped-entities` in ReportView, 2
  `react-hooks/set-state-in-effect` in TargetSelector, 1 `prefer-const` in trends.
  Un confronto per regola, severità e messaggio fra i sorgenti di `bookinsight-9`
  e i file modificati conferma **zero nuove segnalazioni**; i nuovi file TS
  non hanno segnalazioni.
- `git diff --check`: superato. Moduli di scoring, Amazon, YouTube, target,
  dipendenze e configurazione Next invariati.

Limiti residui: soglie euristiche, testi troncati ai limiti descritti e verifica
semantica affidata all'AI. Non è stata eseguita una nuova analisi live della
keyword né verificata la persistenza su Redis; nessun servizio esterno,
credenziale o variabile di produzione è stato modificato.
