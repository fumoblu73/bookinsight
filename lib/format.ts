/** Formattazione di sola presentazione, coerente tra ICU del server e browser. */
export function formatItalianNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return value.toLocaleString('it-IT', { ...options, useGrouping: 'always' })
}

const REPORT_TIME_ZONE = 'Europe/Rome'

/** La data del report usa lo stesso fuso anche durante il rendering sul server. */
export function formatItalianDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString('it-IT', { ...options, timeZone: REPORT_TIME_ZONE })
}

/** Prefisso YYMMDD della stampa, coerente con la data visibile del report. */
export function formatReportFileDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: '2-digit', month: '2-digit', day: '2-digit', timeZone: REPORT_TIME_ZONE,
  }).formatToParts(new Date(value))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('')
}
