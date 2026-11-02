# Sonda payload reali — BookInsight 9.0.2

Script **di sviluppo, non usato in produzione** (nessun import da `app/` o `lib/`).
Raccoglie un piccolo campione reale delle tre fonti per confermare i campi su cui
si basa la frequenza verificabile 9.0.2, poi salva fixture anonimizzate.

## Cosa deve confermare

| Fonte | Domande |
| --- | --- |
| Apify `fatihtahta~reddit-scraper-search-fast` | nome e formato del campo parent dei commenti (`parentId`?), prefissi `t1_`/`t3_` su `id`, `postId`, parent; presenza di `author` sul **post**; formato di `created_utc` |
| YouTube `commentThreads` + `videos` | `topLevelComment.snippet.authorChannelId` (oggetto `{value}`?), `snippet.channelId` del thread rispetto al canale del video, presenza di `textOriginal` con sola API key, `parentId` delle risposte |
| SerpApi `amazon_product` | `helpful_votes` vs `helpful_count` (il codice attuale legge `helpful_count`), presenza di autore, data e ID della recensione |

## Esecuzione

Le credenziali vanno passate **solo come variabili d'ambiente nel proprio
terminale**; non vanno scritte in file del repository né incollate in chat.
Lo script non le stampa e ripulisce i messaggi d'errore.

Costi: 1 esecuzione dell'actor Apify (1 URL, fino a 40 commenti), circa 2-3 unità
di quota YouTube, 1 ricerca SerpApi. Ogni fonte senza credenziale o input è saltata.

```bash
export APIFY_TOKEN=... YOUTUBE_API_KEY=... SERPAPI_KEY=...
```

```bash
PROBE_REDDIT_URL='https://www.reddit.com/r/<subreddit>/comments/<id>/<slug>/' PROBE_YT_VIDEO_ID='<videoId>' PROBE_ASIN='<asin>' PROBE_AMAZON_DOMAIN=amazon.com node scripts/probe/probe-sources.mjs
```

Scegliere un thread Reddit con risposte annidate (per osservare `t1_`) e commenti
`[deleted]` se possibile, un video con commenti e risposte, un libro con recensioni.

Output in `lib/__fixtures__/probe-9.0.2/`:

- `probe-report.json`: solo struttura (chiavi, tipi, conteggi, formati e prefissi
  degli ID, risoluzione dei parent). **Nessun valore testuale.** È il file da
  condividere per decidere i passi successivi.
- `<fonte>.sample.json`: payload anonimizzati (autori → `anon_user_N`, testi →
  `«anon:text len=N»`, ID sostituiti in modo coerente conservando prefissi e
  lunghezze, URL di profilo rimossi, query string eliminate). Il sale è casuale
  per esecuzione e non viene salvato.

`PROBE_SAVE_RAW=1` salva anche i payload grezzi in `.probe-raw/` (escluso da git):
contengono dati personali, vanno cancellati dopo l'uso.

## Prima del commit

L'anonimizzazione è euristica. Controllare a mano le fixture (cercare nomi utente,
frasi, URL di profilo, handle `@...`) prima di aggiungerle a git. Test dell'anonimizzatore:

```bash
node --test scripts/probe/anonymize.test.mjs
```
