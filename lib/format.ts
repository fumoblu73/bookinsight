/** Formattazione di sola presentazione, coerente tra ICU del server e browser. */
export function formatItalianNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return value.toLocaleString('it-IT', { ...options, useGrouping: 'always' })
}

/** La data del report usa lo stesso fuso anche durante il rendering sul server. */
export function formatItalianDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString('it-IT', { ...options, timeZone: 'Europe/Rome' })
}
