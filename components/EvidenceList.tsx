'use client'

import { useState } from 'react'
import type { EvidenceRecord } from '../lib/evidence-review'

export default function EvidenceList({ records, selectedIds, onToggle, disabled = false, title = 'Testimonianze', problem = '' }: {
  records: EvidenceRecord[]
  selectedIds?: string[]
  onToggle?: (id: string) => void
  disabled?: boolean
  title?: string
  problem?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = new Set(selectedIds ?? records.map(r => r.id))
  return <div className="mt-2 space-y-2">
    <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="text-xs font-medium text-indigo-700 hover:text-indigo-900">
      {open ? 'Nascondi' : 'Mostra'} {title.toLowerCase()} ({onToggle ? `${selected.size}/` : ''}{records.length})
    </button>
    {records.length === 0 && <p className="text-xs text-amber-700">Nessuna testimonianza collegata a questo pain point.</p>}
    {open && <ul className="space-y-3">
      {records.map((r, i) => {
        const safeUrl = r.url && /^https:\/\/(?:[\w-]+\.)*(?:reddit\.com|youtube\.com|amazon\.(?:com|co\.uk|it|de|fr|es))\//i.test(r.url) ? r.url : undefined
        return <li key={r.id} data-record-id={r.id} className={`rounded-lg border p-3 ${selected.has(r.id) ? 'border-indigo-200 bg-white' : 'border-zinc-200 bg-zinc-50 opacity-70'}`}>
          <div className="flex items-start gap-2">
            {onToggle && <input type="checkbox" checked={selected.has(r.id)} disabled={disabled}
              onChange={() => onToggle(r.id)} aria-label={`Mantieni testimonianza ${i + 1} per ${problem}`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600" />}
            <div className="min-w-0 flex-1 space-y-1 text-xs">
              <p className="font-medium text-zinc-700">{r.source === 'amazon' ? 'Amazon' : r.source === 'reddit' ? 'Reddit' : 'YouTube'}{r.rating ? ` · ${r.rating}/5` : ''} · {r.title}</p>
              <p className="whitespace-pre-wrap break-words text-zinc-700">{r.text.length > 220 ? `${r.text.slice(0, 220)}…` : r.text}</p>
              <details className="text-zinc-500">
                <summary className="cursor-pointer">Testo raccolto e provenienza</summary>
                <p className="mt-1 whitespace-pre-wrap break-words text-zinc-700">{r.text}</p>
                <p>Autore: {r.authorKey?.split(':').slice(2).join(':') || (r.authorStatus === 'deleted' ? 'cancellato' : 'non disponibile')}</p>
                <p>{r.sourceId ? `ID originale: ${r.sourceId}` : 'ID originale della testimonianza non disponibile.'}</p>
                <p>{r.source === 'amazon' ? 'Libro (ASIN)' : 'Thread/video'}: {r.containerId ?? 'non disponibile'}</p>
                {r.parentId && <p>Risposta a: {r.parentId}</p>}
              </details>
              {safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-indigo-700 underline">
                {r.urlKind === 'book' ? 'Apri libro Amazon' : r.urlKind === 'comment' ? 'Apri commento originale' : 'Apri thread/video originale'}
              </a>}
            </div>
          </div>
        </li>
      })}
    </ul>}
  </div>
}
