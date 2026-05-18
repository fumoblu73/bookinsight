# BookInsight

Analisi di nicchia per Kindle Direct Publishing (KDP) basata su AI.  
Scrape Amazon, Google Trends, Reddit e YouTube, poi passa tutto a Claude per generare un report editoriale completo: gap analysis, pain point, strategia di serie e stima ROI.

---

## Funzionamento

1. L'utente inserisce una keyword e seleziona un mercato (US · UK · DE · IT · ES · FR)
2. Il backend raccoglie dati in parallelo:
   - **Amazon** — top 15 libri (SerpApi) + dettagli prodotto/recensioni (Apify)
   - **Google Trends** — timeline 5 anni, query correlate, stagionalità
   - **Reddit** — post e commenti per estrarre pain point
   - **YouTube** — video e commenti per segnali di domanda
3. Pipeline AI (streaming, aggiornamenti in tempo reale):
   - Passo 0 — analisi competitor principale (Sonnet)
   - Pain point Reddit/YouTube → score F/I/S (Haiku)
   - Key Insights (Sonnet)
   - Trend Forecast (Sonnet)
   - Gap Analysis + tesi libro (Sonnet)
   - Series Strategy — verdetto INVEST / PARTIAL / PASS (Sonnet)
   - ROI Narrative (Haiku)
   - Sub-niche detection semantica (Haiku)
4. Il report viene salvato su Redis (Upstash) e visualizzato con grafici interattivi

---

## Stack

| Layer | Tecnologia |
|---|---|
| Framework | Next.js 15 (App Router) |
| AI | Anthropic Claude — Sonnet 4.6 (analisi) · Haiku 4.5 (estrazione) |
| Dati Amazon | SerpApi + Apify |
| Trend | SerpApi Google Trends |
| Social | Reddit (scraping) · YouTube Data API |
| Cache / DB | Upstash Redis |
| Deploy | Vercel |

---

## Struttura

```
app/
  page.tsx                    — form analisi + visualizzazione report in-page
  history/
    page.tsx                  — tabella storico report (ordinabile per KPI)
    HistoryTable.tsx          — componente client con sorting
  report/[id]/page.tsx        — report archiviato stand-alone
  log/[id]/page.tsx           — log esecuzione pipeline
  api/
    analyze/route.ts          — pipeline principale (streaming SSE)
    amazon/route.ts           — SERP Amazon
    amazon/product/route.ts   — dettagli singolo ASIN
    autocomplete/route.ts     — suggerimenti keyword Amazon
    credits/route.ts          — saldo SerpApi + Apify
    export/[id]/route.ts      — esportazione report JSON
    reddit/route.ts           — dati Reddit
    trends/route.ts           — Google Trends
    trends-multimarket/route.ts — panoramica trend 5 mercati alternativi (on-demand)
    youtube/route.ts          — dati YouTube

lib/
  ai.ts          — client Anthropic, retry, funzioni per ogni sezione
  amazon.ts      — SerpApi/Apify wrapper, scoring, sub-niche detection
  prompts.ts     — template prompt (output JSON strutturato)
  scoring.ts     — scoring pain point (F/I/S), profitabilità, ROI
  trends.ts      — client Google Trends, normalizzazione date, segnali
  reddit.ts      — scraping Reddit
  youtube.ts     — YouTube API wrapper
  types.ts       — TypeScript interfaces
  upstash.ts     — Redis helper (save/get/list report)
  compliance.ts  — controlli copyright e TOS

components/
  ReportView.tsx — renderer report (tutte le sezioni, grafici, calcolatori)
```

---

## Variabili d'ambiente

Creare un file `.env.local` nella root del progetto:

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# SerpApi (Amazon SERP + Google Trends)
SERPAPI_KEY=...

# Apify (dettagli prodotto Amazon + recensioni)
APIFY_TOKEN=apify_api_...

# Upstash Redis (cache crediti + archiviazione report)
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=...
REDIS_URL=redis://...

# YouTube Data API v3
YOUTUBE_API_KEY=AIza...
```

---

## Avvio locale

```bash
npm install
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

---

## Costo per analisi

| Servizio | Costo stimato |
|---|---|
| SerpApi | ~14 crediti (1 SERP + 8 product + 5 recensioni) |
| Apify | ~$0.29 |
| Anthropic | ~$0.04–0.10 (Sonnet × 5 + Haiku × 3) |

---

## Sezioni del report

| § | Titolo | Modello |
|---|---|---|
| §1 | Key Insights | Sonnet |
| §2 | Sub-nicchie rilevate | Haiku (semantico) |
| §3 | Competitor target | Sonnet |
| §4 | Analisi Trend | Sonnet + multi-mercato on-demand |
| §5 | Gap Analysis | Sonnet |
| §5A | Pain Point (Reddit/YouTube) | Haiku |
| §6 | Series Strategy | Sonnet |
| §7 | ROI & Budget | Haiku |

---

## Feature da implementare

- **CPC Amazon Ads storico** — proxy stagionalità domanda. Le API disponibili (Amazon Ads API, DataForSEO) non hanno window > 60–95 giorni o richiedono account advertiser OAuth; nessuna fonte economicamente sostenibile trovata finora.
