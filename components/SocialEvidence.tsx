import type { SocialEvidenceReport } from '../lib/types'

/** Solo dati descrittivi: nessuna interazione con F/I/S o ordinamento. */
export default function SocialEvidence({ painPointId, evidence }: {
  painPointId?: string
  evidence?: SocialEvidenceReport
}) {
  const metrics = painPointId ? evidence?.metrics[painPointId] : undefined
  if (!metrics || metrics.M === null) return (
    <p className="mt-2 text-xs text-zinc-500">U/T/M non disponibili{evidence?.processing?.budgetExhausted ? ': tempo di analisi esaurito' : metrics?.status === 'failed' ? ': attribuzione non riuscita' : ''}.</p>
  )
  const associations = evidence!.associations.filter(a => a.painPointId === painPointId)
  return (
    <div className="mt-2 text-xs text-zinc-600 space-y-1">
      <p className="font-semibold" aria-label="Conteggi delle testimonianze">
        U: {metrics.U} · T: {metrics.T} · M: {metrics.M}
      </p>
      <p>U: autori identificabili · T: thread/video distinti · M: commenti pertinenti distinti.</p>
      <p>Conteggi confermati nel campione analizzato; non misurano la prevalenza nel mercato.</p>
      {!evidence?.verification && <p className="text-amber-700">Questi conteggi precedono la nuova verifica di pertinenza.</p>}
      {metrics.status === 'partial' && <p className="text-amber-700">Attribuzione parziale: {metrics.reviewedComments}/{metrics.totalComments} commenti esaminati; i conteggi possono essere incompleti.</p>}
      {metrics.unknownAuthorMentions > 0 && <p>{metrics.unknownAuthorMentions} menzioni con autore sconosciuto: U include solo gli autori identificabili.</p>}
      {metrics.uncertainIdentityMentions > 0 && <p>{metrics.uncertainIdentityMentions} evidenze con identità incerta, escluse dai conteggi confermati.</p>}
      {metrics.ambiguousConfirmations > 0 && <p>{metrics.ambiguousConfirmations} conferme ambigue escluse dai conteggi.</p>}
      {metrics.rejectedAssociations > 0 && <p>{metrics.rejectedAssociations} associazioni rifiutate dalla verifica dei riferimenti.</p>}
      {metrics.M === 0 && <p>Nessun supporto validato per questo pain point nell’attribuzione effettuata.</p>}
      {associations.length > 0 && (
        <details className="pt-1">
          <summary className="cursor-pointer text-indigo-700">Testimonianze e provenienza ({associations.length})</summary>
          <ul className="mt-2 space-y-3">
            {associations.map(a => {
              const record = evidence!.manifest.records.find(r => r.recordId === a.recordId)
              const context = evidence!.manifest.contexts.find(c => c.contextId === record?.contextId)
              if (!record) return null
              const href = record.commentUrl ?? context?.sourceUrl
              // Difesa anche per report importati: il browser non apre schemi arbitrari.
              const safeUrl = href && /^https:\/\/(?:[\w-]+\.)*(?:reddit\.com|youtube\.com)\//i.test(href) ? href : undefined
              return (
                <li key={a.recordId} className="border-l-2 border-indigo-200 pl-2 space-y-1">
                  <p className="italic">“{a.quote}”</p>
                  <p>{record.platform === 'reddit' ? 'Reddit' : 'YouTube'} · {context?.title}</p>
                  <p>Commento: {record.sourceCommentId ?? 'ID originale assente'} · Thread/video: {record.containerId ?? 'ID originale assente'}</p>
                  <p>Autore: {record.authorKey ?? (record.authorStatus === 'deleted' ? 'cancellato' : 'sconosciuto')}</p>
                  {record.truncated && <p>Testo analizzato troncato a 300 caratteri.</p>}
                  {record.identityStatus !== 'original' && <p>Identità del commento {record.identityStatus === 'conflict' ? 'in conflitto' : 'non verificabile'}.</p>}
                  {record.possibleCopy && <p>Testo uguale a un altro commento: possibile copia.</p>}
                  {a.supportType === 'confirmation' && <p>Conferma contestualizzata; riferimento: {a.contextRecordIds.join(', ')}.</p>}
                  {safeUrl && <a className="inline-block text-indigo-700 underline" href={safeUrl} target="_blank" rel="noopener noreferrer">Apri {record.commentUrl ? 'commento' : 'thread/video'} originale{(record.commentUrl ? record.commentUrlOrigin : context?.sourceUrlOrigin) === 'reconstructed' ? ' (URL ricostruito)' : ''}</a>}
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}
