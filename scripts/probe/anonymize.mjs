// Anonimizzazione delle fixture della sonda 9.0.2. NON usato in produzione.
//
// Obiettivo: conservare la STRUTTURA dei payload (chiavi, tipi, prefissi degli ID,
// relazioni id/parentId, valori sentinella come [deleted]) eliminando ogni dato
// riconducibile a persone: autori, testi, ID originali, URL di profilo.
//
// - Gli ID sono sostituiti in modo coerente (stesso ID → stesso pseudonimo) con
//   HMAC-SHA256 su un sale casuale per esecuzione, non salvato. Prefissi Reddit
//   (t1_, t3_ …), prefisso canale YouTube (UC) e lunghezza/alfabeto sono conservati,
//   così parentId "t1_x" continua a puntare all'ID "x" anonimizzato.
// - I testi diventano «anon:text len=N»; restano invariati "", [deleted], [removed].
// - Gli autori diventano anon_user_N; restano invariati i valori sentinella e
//   AutoModerator (serve a verificare la normalizzazione dei bot).
// - Le stringhe non classificate con spazi o lunghe sono trattate come testo.
// Il controllo manuale delle fixture prima del commit resta obbligatorio.

import { createHmac } from 'node:crypto'

const SENTINELS = new Set(['', '[deleted]', '[removed]', 'AutoModerator'])

const AUTHOR_KEYS = new Set([
  'author', 'authordisplayname', 'authorname', 'author_name', 'username', 'user_name',
  'reviewer', 'reviewer_name', 'profile_name', 'author_fullname_display',
])
const AUTHOR_URL_KEYS = new Set([
  'authorchannelurl', 'authorprofileimageurl', 'avatar', 'profile_link', 'profile_url',
  'author_url', 'author_link', 'thumbnail', 'image', 'images',
])
const ID_KEYS = new Set([
  'id', 'parentid', 'parent_id', 'postid', 'post_id', 'link_id', 'commentid', 'comment_id',
  'authorchannelid', 'channelid', 'videoid', 'review_id', 'reviewid', 'author_fullname',
  'fullname', 'name', 'etag', 'nextpagetoken', 'value', 'asin', 'parentasin',
  'userid', 'user_id', 'reviewerid', 'profileid',
])
const TEXT_KEYS = new Set([
  'body', 'selftext', 'text', 'textoriginal', 'textdisplay', 'title', 'content', 'review',
  'description', 'body_html', 'selftext_html', 'html', 'snippet', 'comment', 'summary',
  'reviewtitle', 'reviewdescription', 'reviewtext', 'reviewtextshort',
])
const KEEP_KEYS = new Set(['kind', 'subreddit', 'subreddit_name_prefixed', 'type', 'distinguished',
  'moderationstatus', 'canrate', 'viewerrating', 'country', 'rating', 'verified_purchase',
  'reviewedin', 'reviewreaction', 'productasin', 'post_hint', 'suggested_sort', 'whitelist_status', 'kind_label', 'amazon_domain', 'engine', 'status'])
const DATE_KEY = /(date|time|created|published|updated|edited)/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/
const STRUCTURAL_PATH = new Set(['r', 'comments', 'dp', 'watch', 'channel', 'product-reviews', 'gp',
  'customer-reviews', 'shorts', 'embed', 's'])

const B36 = 'abcdefghijklmnopqrstuvwxyz0123456789'
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const UPPER_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function alphabetFor(core) {
  if (/^[a-z0-9]+$/.test(core)) return B36
  if (/^[A-Z0-9]+$/.test(core)) return UPPER_ALNUM
  return B64
}

export function createAnonymizer(salt) {
  if (!salt || salt.length < 16) throw new Error('sale mancante o troppo corto')
  const idMap = new Map()
  const authorMap = new Map()

  function pseudoCore(core) {
    if (idMap.has(core)) return idMap.get(core)
    const alphabet = alphabetFor(core)
    let out = ''
    let counter = 0
    while (out.length < core.length) {
      const digest = createHmac('sha256', salt).update(`${counter++}:${core}`).digest()
      for (const byte of digest) {
        if (out.length >= core.length) break
        out += alphabet[byte % alphabet.length]
      }
    }
    if (out === core) out = out.split('').reverse().join('') // evita identità accidentali
    idMap.set(core, out)
    return out
  }

  function pseudoId(raw) {
    if (SENTINELS.has(raw)) return raw
    // ID composti (es. risposta YouTube "<parent>.<reply>") restano composti.
    return raw.split('.').map(part => {
      const m = part.match(/^(t[1-6]_|UC)(.+)$/)
      return m ? m[1] + pseudoCore(m[2]) : pseudoCore(part)
    }).join('.')
  }

  function pseudoAuthor(raw) {
    if (SENTINELS.has(raw)) return raw
    const key = raw.trim().replace(/^\/?u\//i, '').toLowerCase()
    if (!authorMap.has(key)) authorMap.set(key, `anon_user_${authorMap.size + 1}`)
    return authorMap.get(key)
  }

  function pseudoText(raw) {
    if (SENTINELS.has(raw.trim())) return raw
    return `«anon:text len=${raw.length}»`
  }

  function pseudoUrl(raw) {
    try {
      const u = new URL(raw)
      const segs = u.pathname.split('/').map((seg, i, all) => {
        if (!seg || STRUCTURAL_PATH.has(seg)) return seg
        if (all[i - 1] === 'r') return seg // nome subreddit: non personale
        if (all[i - 1] === 'u' || all[i - 1] === 'user') return pseudoAuthor(seg)
        return /^[A-Za-z0-9_-]+$/.test(seg) ? pseudoId(seg) : 'anon'
      })
      // Query string e frammento rimossi: possono contenere token o riferimenti personali.
      return `${u.protocol}//${u.host}${segs.join('/')}`
    } catch {
      return pseudoText(raw)
    }
  }

  function anonString(value, key, parentKey) {
    const k = (key ?? '').toLowerCase()
    const pk = (parentKey ?? '').toLowerCase()
    if (AUTHOR_URL_KEYS.has(k)) return /^https?:/i.test(value) ? 'https://example.invalid/anon' : pseudoText(value)
    if (AUTHOR_KEYS.has(k) || (k === 'name' && /(author|profile|user)/.test(pk))) return pseudoAuthor(value)
    if (k === 'value' && pk === 'authorchannelid') return pseudoId(value)
    if (/^https?:\/\//i.test(value)) return pseudoUrl(value)
    if (ID_KEYS.has(k)) return pseudoId(value)
    if (TEXT_KEYS.has(k)) return pseudoText(value)
    if (KEEP_KEYS.has(k)) return value
    if (DATE_KEY.test(k) || ISO_DATE.test(value)) return value
    if (/^(true|false|null)$/i.test(value) || /^-?\d+(\.\d+)?$/.test(value)) return value
    // Prudenza: una stringa breve non classificata potrebbe essere un nome utente.
    return /\s/.test(value) || value.length > 40 ? pseudoText(value) : `«anon:token len=${value.length}»`
  }

  function walk(value, key, parentKey) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'string') return anonString(value, key, parentKey)
    if (Array.isArray(value)) return value.map(v => walk(v, key, parentKey))
    if (typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k, key)
      return out
    }
    return null
  }

  return {
    anonymize: value => walk(value, undefined, undefined),
    stats: () => ({ ids: idMap.size, authors: authorMap.size }),
  }
}

// ─── Descrizione strutturale (nessun valore, solo forme) ────────────────────

export function describeShape(value, path = '$', acc = new Map()) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const entry = acc.get(path) ?? { types: {}, count: 0 }
  entry.count++
  entry.types[type] = (entry.types[type] ?? 0) + 1
  acc.set(path, entry)
  if (Array.isArray(value)) value.forEach(v => describeShape(v, `${path}[]`, acc))
  else if (type === 'object') for (const [k, v] of Object.entries(value)) describeShape(v, `${path}.${k}`, acc)
  return acc
}

/** Classifica il formato di un ID senza restituirne il valore. */
export function idFormat(raw) {
  if (typeof raw !== 'string') return raw === undefined ? 'absent' : `non-string:${raw === null ? 'null' : typeof raw}`
  if (raw === '') return 'empty'
  const prefix = raw.match(/^(t[1-6]_|UC|Ug)/)?.[1] ?? 'none'
  const charset = /^[a-z0-9_]+$/.test(raw) ? 'lower-alnum' : /^[A-Za-z0-9_-]+$/.test(raw) ? 'b64url' : 'other'
  return `prefix:${prefix} len:${raw.length} charset:${charset}${raw.includes('.') ? ' dotted' : ''}`
}
