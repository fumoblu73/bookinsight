import type { Solvibilita } from './types'

export const SOLVIBILITA_LABEL: Record<Solvibilita, string> = {
  affrontabile:    'affrontabile',
  vincolo_formato: 'vincolo di formato',
  mai_fatto:       'mai fatto',
  fuori_portata:   'richiede un professionista',
}

/** Classi Tailwind per il badge. rose e amber sono riservati altrove. */
export const SOLVIBILITA_BADGE: Record<Solvibilita, string> = {
  affrontabile:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  vincolo_formato: 'bg-violet-50 text-violet-700 border-violet-200',
  mai_fatto:       'bg-sky-50 text-sky-700 border-sky-200',
  fuori_portata:   'bg-zinc-100 text-zinc-500 border-zinc-300',
}
