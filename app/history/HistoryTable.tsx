'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

export interface HistoryRow {
  id: string
  keyword: string
  market: string
  score?: number
  trendSignal?: string
  difficulty?: string
  monthlyRevenue?: number
  status: string
  createdAt: string
}

type SortKey = keyof Omit<HistoryRow, 'id'>
type SortDir = 'asc' | 'desc'

const COL_FIRST_DIR: Partial<Record<SortKey, SortDir>> = {
  score: 'desc',
  monthlyRevenue: 'desc',
  createdAt: 'desc',
}

function compare(a: HistoryRow, b: HistoryRow, key: SortKey, dir: SortDir): number {
  const va = a[key]
  const vb = b[key]
  if (va === undefined && vb === undefined) return 0
  if (va === undefined) return 1
  if (vb === undefined) return -1
  const cmp = typeof va === 'number' && typeof vb === 'number'
    ? va - vb
    : String(va).localeCompare(String(vb), 'it')
  return dir === 'asc' ? cmp : -cmp
}

function scoreColor(s?: number) {
  if (s === undefined) return 'text-zinc-400'
  if (s >= 70) return 'text-emerald-600 font-bold'
  if (s >= 45) return 'text-amber-500 font-bold'
  return 'text-rose-500 font-bold'
}

function trendCls(t?: string) {
  if (t === 'CRESCITA') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (t === 'DECLINO')  return 'text-rose-600 bg-rose-50 border-rose-200'
  if (t === 'STABILE')  return 'text-zinc-500 bg-zinc-100 border-zinc-200'
  return null
}

function difficultyCls(d?: string) {
  if (d === 'FACILE')    return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (d === 'DIFFICILE') return 'text-rose-600 bg-rose-50 border-rose-200'
  if (d === 'MEDIO')     return 'text-amber-600 bg-amber-50 border-amber-200'
  return null
}


function ThBase({
  col, label, sortKey, sortDir, onSort, className = '',
}: {
  col: SortKey; label: string
  sortKey: SortKey; sortDir: SortDir
  onSort: (col: SortKey) => void
  className?: string
}) {
  const active = sortKey === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer select-none hover:bg-zinc-100 transition-colors whitespace-nowrap ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] leading-none ${active ? 'text-indigo-500' : 'text-zinc-300'}`}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

export default function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(col)
      setSortDir(COL_FIRST_DIR[col] ?? 'asc')
    }
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compare(a, b, sortKey, sortDir)),
    [rows, sortKey, sortDir],
  )

  const thProps = { sortKey, sortDir, onSort: handleSort }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center">
        <p className="text-zinc-500 mb-4">Nessun report ancora generato.</p>
        <Link href="/" className="inline-block rounded-lg bg-indigo-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-indigo-700 transition-colors">
          Inizia la prima analisi
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <ThBase {...thProps} col="keyword"       label="Argomento"  className="pl-5 min-w-44" />
              <ThBase {...thProps} col="market"        label="Mercato" />
              <ThBase {...thProps} col="score"         label="Score" />
              <ThBase {...thProps} col="trendSignal"   label="Trend" />
              <ThBase {...thProps} col="difficulty"    label="Difficoltà" />
              <ThBase {...thProps} col="monthlyRevenue" label="Ric./mese" />
              <ThBase {...thProps} col="createdAt"     label="Data" className="pr-3" />
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Azioni
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.map(r => {
              const date = new Date(r.createdAt).toLocaleString('it-IT', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })
              const tCls  = trendCls(r.trendSignal)
              const dCls  = difficultyCls(r.difficulty)
              return (
                <tr key={r.id} className="hover:bg-zinc-50 transition-colors group">

                  {/* Argomento */}
                  <td className="px-3 py-3 pl-5">
                    <Link
                      href={`/report/${r.id}`}
                      className="font-medium text-zinc-900 hover:text-indigo-600 group-hover:underline underline-offset-2 transition-colors"
                    >
                      {r.keyword}
                    </Link>
                  </td>

                  {/* Mercato */}
                  <td className="px-3 py-3">
                    <span className="text-xs font-semibold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">
                      {r.market}
                    </span>
                  </td>

                  {/* Score */}
                  <td className="px-3 py-3 tabular-nums">
                    {r.score !== undefined
                      ? <span className={`text-base ${scoreColor(r.score)}`}>{r.score}<span className="text-xs font-normal text-zinc-400">/100</span></span>
                      : <span className="text-zinc-300">—</span>
                    }
                  </td>

                  {/* Trend */}
                  <td className="px-3 py-3">
                    {tCls
                      ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tCls}`}>{r.trendSignal}</span>
                      : <span className="text-zinc-300 text-xs">—</span>
                    }
                  </td>

                  {/* Difficoltà */}
                  <td className="px-3 py-3">
                    {dCls
                      ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${dCls}`}>{r.difficulty}</span>
                      : <span className="text-zinc-300 text-xs">—</span>
                    }
                  </td>

                  {/* Ric./mese */}
                  <td className="px-3 py-3 tabular-nums text-zinc-600">
                    {r.monthlyRevenue && r.monthlyRevenue > 0
                      ? `$${Math.round(r.monthlyRevenue).toLocaleString('it-IT')}`
                      : <span className="text-zinc-300">—</span>
                    }
                  </td>

                  {/* Data */}
                  <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap">
                    {date}
                  </td>

                  {/* Azioni */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Link href={`/report/${r.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        Apri
                      </Link>
                      <span className="text-zinc-200">·</span>
                      <a href={`/api/export/${r.id}`} download className="text-xs text-zinc-500 hover:text-zinc-700 font-medium">
                        Export
                      </a>
                      <span className="text-zinc-200">·</span>
                      <Link href={`/log/${r.id}`} className="text-xs text-zinc-400 hover:text-zinc-600 font-medium">
                        Log
                      </Link>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-2.5 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-400">
        <span>{rows.length} report</span>
        <span>
          Ordinato per <strong className="text-zinc-600">{sortKey === 'createdAt' ? 'data' : sortKey === 'monthlyRevenue' ? 'ric./mese' : sortKey}</strong>{' '}
          {sortDir === 'asc' ? '▲ A→Z' : '▼ Z→A'}
        </span>
      </div>
    </div>
  )
}
