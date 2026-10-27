/** Accetta l'equivalenza NFC; allinea soltanto apostrofi/virgolette tipografiche
 * ricopiando il testo ricevuto, senza correggere parole, spazi o omissioni. */
export function resolveSocialQuote(text: string, value: unknown): { quote: string; adjusted: boolean } | undefined {
  if (typeof value !== 'string') return
  const quote = value.trim()
  if (!quote || quote.length > 300) return
  if (text.normalize('NFC').includes(quote.normalize('NFC'))) return { quote, adjusted: false }
  // Ogni sostituzione conserva gli indici UTF-16 del testo originale.
  const fold = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  const source = fold(text), candidate = fold(quote), start = source.indexOf(candidate)
  if (start < 0 || source.indexOf(candidate, start + 1) !== -1) return
  return { quote: text.slice(start, start + quote.length), adjusted: true }
}
