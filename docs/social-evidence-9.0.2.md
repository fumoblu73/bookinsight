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
4. In finalizzazione un passaggio separato Haiku associa i commenti ai soli
   pain point sociali selezionati. È eseguito in parallelo alla finalizzazione,
   senza cambiare le chiamate AI o i payload strategici esistenti.
5. Il codice valida associazioni e citazioni, calcola U/T/M e salva il risultato
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

## Completezza e limiti operativi

- Budget complessivo di 45 secondi, massimo tre richieste concorrenti,
  batch di 30 commenti dello stesso contenitore.
- Ogni richiesta ha timeout di 12 secondi, nessun retry SDK e massimo 8192
  token di output. Risposte interrotte/troncate sono trattate come fallimenti.
- Batch completati, omessi e falliti sono distinguibili. I conteggi di una
  lavorazione parziale sono accompagnati da stato e numero di commenti esaminati.
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

La validazione certifica coerenza dei riferimenti e presenza delle citazioni,
non la pertinenza semantica delle associazioni, che resta affidata al modello.
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
legacy. La finalizzazione con e senza attribuzione viene confrontata per
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

Esito locale:

- 108 verifiche superate: Reddit 37, report legacy 3, scoring/ROI 24,
  target 21, nuove evidenze 19, pipeline/export 1, rendering U/T/M 3.
  I due casi aggiunti durante la revisione riproducevano e ora prevengono
  la perdita dell'identità canale con display name `[deleted]` e l'accettazione
  di prefissi Reddit scambiati fra commento e post.
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
