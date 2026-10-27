# BookInsight 9.0.2 — provenienza delle testimonianze e U/T/M

Base: `ec1563730ba8ff4b40a00665270140feff144fa5`, merge della PR #1 su
`bookinsight-9`. Il rilascio di prova usa il branch dedicato
`codex/bookinsight-9.0.2` e un deployment Vercel Preview. Non prevede merge
in `master` o `bookinsight-9`, né promozioni in produzione.

## Perimetro

U conta gli autori identificabili distinti, T i thread Reddit/video YouTube
distinti e M i commenti pertinenti distinti. Sono conteggi descrittivi del
campione trasmesso all'estrazione sociale. Non stimano prevalenza o domanda di
mercato e non combinano piattaforme o pain point distinti.

F/I/S, cap, formule, soglie, ordinamento, ROI e Profitability Score rimangono
invariati. I nuovi dati non sono trasmessi ai prompt strategici esistenti.
Non viene introdotta alcuna ponderazione o formula combinata U/T/M.

## Pipeline

1. I collector conservano metadati aggiuntivi opzionali in `provenance`.
   Reddit conserva ID originale/sintetico, contenitore, eventuale padre e URL
   del commento; l'autore resta lo username. YouTube conserva anche
   `authorChannelId.value` e il nome visualizzato, quando presenti. Il nome
   YouTube non viene usato per identificare un utente.
2. `buildSocialManifest` usa gli stessi gate e la stessa selezione di
   `preparePainPointCorpus`. Registra testi conservati, estratti trasmessi,
   troncamento, contesti e identità. Il taglio è 300 caratteri per commento,
   400 per selftext; viene riprodotta la pulizia delle surrogate del wrapper.
   Titolo e selftext sono solo contesto e non incrementano M.
3. Lo snapshot intermedio conserva il manifest insieme ai dati originali.
4. In finalizzazione un passaggio separato Haiku propone associazioni ai soli
   pain point sociali selezionati. Un secondo revisore, con istruzioni indipendenti,
   verifica il sostegno al problema per ciascuna associazione candidata.
   Entrambi operano in parallelo alla finalizzazione, senza cambiare le chiamate
   AI o i payload strategici esistenti.
5. Il codice valida riferimenti, citazioni ed esiti del revisore, calcola U/T/M e salva il risultato
   in `report.socialEvidence`. Nessun numero dichiarato dall'AI diventa un
   conteggio. `voice_data` conserva anche gli ID e metadati dei collector.
6. Il report espone conteggi, completezza e testimonianze consultabili;
   l'export JSON include `social_evidence`, oltre a `voice_data`.

L'attribuzione avviene in finalizzazione: non introduce latenza aggiuntiva
nella selezione iniziale dei pain point. I conteggi sono disponibili nel report.

## Regole di identità e deduplica

- La chiave del commento è piattaforma + ID originale. Per Reddit un permalink
  coerente può recuperare un ID assente. Gli ID interni/sintetici non dimostrano
  l'identità di un commento originale.
- I fullname Reddit devono essere coerenti con il tipo: `t1_` identifica un
  commento, `t3_` un post. Un prefisso del tipo sbagliato non viene promosso
  a identità originale valida dalla normalizzazione.
- Il thread Reddit è identificato prima dall'URL, poi dall'ID originale;
  il video dal suo ID. I fallback basati su indici/titoli non sono identità
  originali. Gli URL ricostruiti sono distinti da quelli ricevuti.
- Le copie tecniche con lo stesso ID contano una sola volta. Le copie con
  metadati incompatibili sono marcate in conflitto, anche se il preparatore
  Reddit ha già tenuto soltanto la prima copia nel prompt.
- Testi uguali con ID differenti restano commenti distinti. Nel medesimo
  contenitore sono segnalati come possibili copie; il testo uguale non basta
  per eliminarli automaticamente.
- Un record con identità del commento/contenitore incerta rimane consultabile
  ma è separato dai conteggi confermati. I valori sono quindi conteggi
  confermati, non stime del numero di record incerti.
- Username Reddit normalizzati per maiuscole/minuscole; ID canale YouTube
  mantenuti come identità della piattaforma. Non vengono collegate identità
  tra piattaforme e non si afferma di misurare persone fisiche distinte.
- Autori vuoti, `[deleted]` o placeholder riconoscibili non ricevono identità
  inventate. I loro commenti possono incrementare T e M; la copertura di U è
  incompleta e il numero di menzioni con autore sconosciuto viene mostrato.
  Un ID account disponibile ha precedenza sul nome visualizzato: su YouTube
  un nome impostato a `[deleted]` non annulla l'ID canale restituito dall'API.
- Più commenti pertinenti dello stesso autore incrementano M, U una sola volta.
  Più commenti nello stesso thread/video incrementano T una sola volta.
- Più citazioni dello stesso commento contano una sola menzione per pain point.
  Lo stesso commento può sostenere pain point distinti, con associazioni separate.

La deduplica aggiuntiva serve ai conteggi e non sposta i tagli del collector:
ranking, limiti e corpus della 9.0.1 restano invariati.

## Contratto di attribuzione

Il modello riceve descrizioni e ID dei pain point, estratti dei commenti e
contesto dello stesso thread/video. Non riceve le chiavi degli autori, F/I/S
o score. Ogni batch richiede una decisione esplicita per ogni record esaminato,
anche senza associazioni:

```json
{
  "decisions": [{
    "recordId": "reddit:post:0:comment:0",
    "matches": [{
      "painPointId": "pp_esistente",
      "supportType": "direct",
      "quote": "Estratto letterale del commento",
      "contextRecordIds": []
    }]
  }]
}
```

Si validano ID richiesti, piattaforma, citazione nell'estratto effettivamente
trasmesso (con equivalenza Unicode NFC) e riferimenti al contesto. Un'assenza
di decisione, un output malformato o una decisione duplicata non equivalgono a
un commento esaminato senza menzioni. Una citazione dalla coda non trasmessa
è rifiutata anche se esiste nel testo completo conservato.

Le conferme brevi devono avere tipo `confirmation` e indicare il commento
padre effettivo, a sua volta associato allo stesso problema, oppure il post
padre dichiarato da un `parentId` di tipo `t3_`. Una catena di conferme deve
terminare in testimonianza diretta o contesto del post. I cicli non si validano
da soli. Parentela assente, contesto inventato o non pertinente producono una
conferma ambigua, esclusa dai conteggi. Non si deduce parentela dal ranking.
Un controllo conservativo intercetta anche alcune conferme brevi comuni
erroneamente dichiarate autonome; non sostituisce l'analisi semantica.

Il revisore riceve problema, testo del singolo commento, citazione proposta e
tipo di sostegno. Per `direct` non riceve titolo, post o commenti altrui;
per `confirmation` riceve soltanto il padre esplicito disponibile nel manifest.
Non riceve identità degli autori o score. Restituisce `supported`, `unsupported`
o `unclear` con una motivazione strutturata. Un'approvazione richiede anche una
citazione letterale del problema, verificata nel testo del commento o nel padre.
Prezzi neutrali, consigli senza problemi espressi e smentite non sostengono il
problema. Il revisore non applica soglie di prezzo o di convenienza.

Il protocollo `problem-support-v2` separa `problemExpressed` e
`referentIdentified` (yes/no/unclear). Per approvare un'associazione entrambi
devono essere yes. Una lamentela con oggetto non identificabile è
`unclear/ambiguous_referent`, distinta da `unsupported/topic_only`; quest'ultimo
richiede che il problema non sia espresso. Il parser rifiuta risposte incoerenti
con questi requisiti. I campi delle versioni precedenti restano leggibili.

Solo le proposte approvate possono diventare associazioni. Il rifiuto motivato
è una decisione negativa valida; una verifica mancante, malformata, duplicata o
incerta lascia il record non verificato per quel pain point. Non lo trasforma
in un'assenza confermata. Il report conserva `verification.decisions` e, per ogni
pain point, `reviewedRecordIds`, così una regressione non può scambiare un caso
mai esaminato per un'esclusione corretta. Le conferme approvate devono comunque
superare il controllo deterministico della parentela e della catena di sostegno.

`uncertainRecordIds` conserva i casi semanticamente incerti, anche quando
l'estrattore li dichiara ambiguous. `unresolvedRecordIds` conserva invece i casi
senza una valutazione valida. Entrambi sono separati dai record con decisione
positiva o negativa valida. Gli incerti non incrementano U/T/M e impediscono di
dichiarare la copertura completa. Se tutti i record sono incerti, U/T/M restano
null e lo stato è partial; una conferma ambigua non diventa uno zero completo.
La vista rende consultabili gli estratti incerti e dichiara i record irrisolti.

## Completezza e limiti operativi

- Budget complessivo condiviso di 45 secondi, massimo tre richieste concorrenti,
  batch di attribuzione da 15 commenti dello stesso contenitore e verifiche da
  massimo otto associazioni candidate. Le due fasi condividono gli stessi worker.
  Il secondo passaggio introduce chiamate e costo AI aggiuntivi; non estende il
  budget temporale e può ridurre la copertura completata nei campioni più grandi.
  La coda alterna piattaforme e contenitori prima di elaborarne i gruppi successivi,
  evitando che il prefisso Reddit occupi tutto il tempo disponibile.
- Ogni richiesta ha timeout di 12 secondi, nessun retry SDK e massimo 8192
  token di output. Risposte interrotte/troncate sono trattate come fallimenti.
- Un solo recupero applicativo dei record mancanti o strutturalmente invalidi
  è ammesso entro gli stessi 45 secondi. I recuperi entrano in fondo alla coda,
  dopo il primo tentativo degli altri contenitori; le decisioni già valide
  vengono conservate. Anche la verifica può recuperare una sola volta le coppie
  mancanti, preservando i giudizi validi, inclusi unclear. Le incertezze
  semantiche non vengono riprovate per ottenere un'approvazione.
- Batch completati, omessi e falliti sono distinguibili. I conteggi di una
  lavorazione parziale sono accompagnati da stato e numero di commenti esaminati.
  `processing` conserva record avviati, record mai avviati, esaurimento del budget
  e fallimenti distinti fra attribuzione e verifica. Una fonte mai avviata resta
  `not_run`; una fonte avviata senza decisioni valide è `failed`. In entrambi i
  casi i conteggi non disponibili restano null.
  `processing.diagnostics` distingue lista di decisioni assente, record omessi,
  duplicati, matches non validi, riferimenti/citazioni invalidi e verifiche
  mancanti o malformate. Conserva ID interni richiesti, fase e numero del
  tentativo, senza output grezzi del modello. `processing.records` registra
  l'esito strutturale finale e gli eventuali due tentativi per ciascun record;
  non costituisce da solo approvazione semantica.
  I fallimenti registrano nei log contesto interno, dimensione del gruppo,
  classe dell'errore e stato HTTP se disponibile, senza testo o messaggi grezzi
  del provider.
- Senza alcuna decisione valida U/T/M sono `null`, non zero. Zero indica assenza
  di supporti confermati nella parte elaborata; lo stato chiarisce se completa.
- La completezza è distinta per indicatore. Autori sconosciuti limitano U;
  identità incerte limitano anche T/M. Conferme ambigue ed esclusioni vengono
  dichiarate. Lo stato `complete` indica completamento del protocollo, non
  completezza delle identità né certezza della pertinenza semantica.
- Un guasto dell'attribuzione non impedisce il completamento del report o
  cambia i pain point e gli scoring precedenti.
- Nessuna migrazione dei report archiviati: U/T/M non disponibili quando
  mancano i nuovi dati. Gli snapshot intermedi legacy non vengono rianalizzati
  implicitamente. TTL snapshot di 30 minuti e report di 90 giorni invariati.
  I report con conteggi precedenti al revisore mantengono i valori salvati e
  mostrano che precedono la nuova verifica di pertinenza.

La validazione certifica coerenza dei riferimenti, presenza delle citazioni e
completamento del protocollo di verifica. La pertinenza resta una valutazione AI:
il secondo revisore riduce gli errori osservati, senza garantire assenza di errori.
Il prompt richiede che il commento documenti il problema specifico: la sola
coincidenza di argomento, target o situazione non basta. Consigli e abitudini
devono indicare anche il problema affrontato; emozioni o inesperienza non
vengono dedotte dal contesto. Le citazioni vanno copiate come estratti contigui,
senza traduzioni, correzioni o ricostruzioni di testo troncato.
Per le testimonianze dirette il sostegno deve essere nel singolo commento:
titolo e testimonianze altrui non possono attribuirgli un problema implicito.
Esempi contrastivi distinguono abitudini e consigli da problemi espliciti,
includendo quelli già alleviati o risolti.
Le `evidence_quotes` legacy dell'estrazione non vengono riscritte o certificate:
le nuove associazioni validate sono conservate separatamente.

La raccolta YouTube resta limitata ai commenti principali, senza paginazione
o risposte. Soglia di 25 commenti filtrati, filtri, ranking e tetto di 400
restano quelli eseguiti dalla 9.0.1. I commenti scartati dal collector o dal
prompt non entrano nei nuovi conteggi.

I campi Apify `parent_id`/`parentId`, `url`/`permalink` sono preservati se
presenti e verificati nella fase di attribuzione. La loro effettiva presenza
dipende dal payload dell'actor: i test usano risposte simulate, non una nuova
raccolta live. In assenza di parentela le conferme non sono contate automaticamente.

## Verifiche locali

Le fixture coprono: dimensioni U/T/M indipendenti, autori cancellati e sconosciuti,
duplicati, identità sintetiche e conflittuali, permalink, tagli del prompt,
Unicode, citazioni inventate, più citazioni/problemi per commento, conferme
esplicite e ambigue, cicli, batch mancanti, timeout e guasti, piattaforme separate,
collector simulati, finalizzazione curated, persistenza/export JSON e rendering
legacy. Le nuove regressioni coprono il rifiuto semantico, le verifiche mancanti,
la distribuzione di 850 record fra le fonti e i gruppi mai avviati per budget.
La finalizzazione con e senza attribuzione viene confrontata per
numeri, pain point e prompt Gap Analysis realmente generato.

Esecuzione senza credenziali o servizi esterni:

```bash
./node_modules/.bin/tsc -p tsconfig.tests.json --outDir /workspace/work/tests-9.0.2
mkdir -p /workspace/work/tests-9.0.2/node_modules/@
ln -sfn ../../lib /workspace/work/tests-9.0.2/node_modules/@/lib
NODE_PATH="$PWD/node_modules" node --test /workspace/work/tests-9.0.2/lib/*.test.js /workspace/work/tests-9.0.2/components/*.test.js
./node_modules/.bin/tsc --noEmit --incremental false
npm run lint
git diff --check
```

Limiti delle verifiche locali: persistenza e API sono simulate, senza analisi
AI live o scritture su Redis reale. La build e questi test non sostituiscono
il collaudo dell'anteprima con le integrazioni configurate.

Il collaudo live del 27 ottobre ha trovato un falso positivo semantico:
una descrizione di porzioni da parte di un escursionista solo era associata
all'ansia da primo viaggio. Il caso positivo con ansia esplicita e quello
negativo con sole porzioni sono registrati in
`scripts/fixtures/social-relevance-9.0.2.json`. Per valutare un nuovo risultato
sullo stesso corpus, senza simulare l'AI:

```bash
node scripts/check-social-relevance.mjs /percorso/report-o-export.json
```

Se una nuova estrazione parafrasa il nome del problema, verificare che sia
equivalente e passare il suo ID come secondo argomento. La selezione resta
esplicita: la verifica non cerca un problema per semplici parole comuni.

Una seconda fixture mantiene due prezzi neutrali e tre lamentele esplicite,
come controllo separato non copiato nel prompt del revisore:

```bash
node scripts/check-social-relevance.mjs /percorso/report.json ID_PROBLEMA_COSTO scripts/fixtures/social-cost-relevance-9.0.2.json
```

La valutazione richiede una decisione valida per ogni commento di controllo;
nei report legacy, senza registro per record, richiede la copertura completa.
L'assenza causata da un batch fallito non vale come esclusione corretta.
Non riscrive report, associazioni o conteggi archiviati.

La successiva revisione distingue tre esiti: supporto, assenza di supporto e
incertezza. Il caso “those dinners” della vecchia fixture binaria è stato
riconosciuto come lamentela con referente non dimostrabile dal singolo commento;
la nuova specifica lo attende incerto. La vecchia fixture e il suo fallimento
4/5 restano conservati come evidenza storica, non sono reinterpretati come un
successo. La nuova fixture è `scripts/fixtures/social-context-relevance-9.0.2.json`.

```bash
node scripts/check-social-outcomes.mjs report.json fixture-preregistrata.json ID_PROBLEMA
```

La definizione del problema nella fixture deve coincidere esattamente con
quella del report. Per un nuovo collaudo live, si fissano descrizione, ID e casi
attesi dopo l'estrazione e prima della finalizzazione; non si modificano dopo
aver visto l'attribuzione. Il controllo verifica anche che un caso incerto non
sia semplicemente un record mai elaborato. I test locali con risposte simulate
verificano il contratto, non la qualità del modello reale.

Le viste report e storico usano un formato numerico con raggruppamento
esplicito, anche per quattro cifre, e date nel fuso Europe/Rome. Il prefisso
YYMMDD del nome PDF usa lo stesso fuso della data visibile, anche se il browser
è in America o Asia e l'istante cade vicino alla mezzanotte. Questo evita
differenze tra ICU del server e browser durante l'hydration e non cambia
valori, formule, precisione richiesta, ordinamento o payload dell'AI.

Esito locale:

- Nove file di test superati: Reddit, report legacy, scoring/ROI, target,
  corpus e aggregazione, pipeline/export, rendering U/T/M, formattazione e
  verifica indipendente. Sono inclusi i casi di identità canale con display
  name `[deleted]` e prefissi Reddit scambiati fra commento e post.
- TypeScript dell'intero progetto e `git diff --check`: superati.
- Lint: 5 errori e 13 avvisi già presenti nella base; zero nuove segnalazioni.
- `lib/scoring.ts`, `lib/prompts.ts`, `lib/reddit-corpus.ts`, `lib/upstash.ts`,
  dipendenze e configurazione Next invariati rispetto al commit base.
- Build di produzione completata con `npm run build -- --webpack`: compilazione,
  TypeScript, generazione di tutte le 20 pagine statiche e raccolta delle trace
  superati. Il precedente errore `next/font` dipendeva dall'accesso di rete del
  comando al proxy: abilitando la rete per la build, il download di Geist e
  Geist Mono è riuscito senza modifiche a sorgenti o configurazione Next.
- L'importazione del commit remoto e della sua storia è stata verificata per
  SHA, albero dei file e connettività Git. Questa ricostruzione della base ha
  importato commit già esistenti senza modificare i rami remoti.
