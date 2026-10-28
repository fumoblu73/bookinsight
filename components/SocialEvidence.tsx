import type { SocialEvidenceReport } from '../lib/types'

/** Solo dati descrittivi: nessuna interazione con F/I/S o ordinamento. */
export default function SocialEvidence({ painPointId, evidence }: {
  painPointId?: string
  evidence?: SocialEvidenceReport
}) {
  const metrics = painPointId ? evidence?.metrics[painPointId] : undefined
  const uncertain = evidence?.manifest.records.filter(r => painPointId && evidence.uncertainRecordIds?.[painPointId]?.includes(r.recordId)) ?? []
  const unresolved = painPointId ? evidence?.unresolvedRecordIds?.[painPointId]?.length ?? 0 : 0
  const verification = evidence?.verification
  const offTopic = new Set(verification?.decisions.filter(v => v.painPointId === painPointId && v.reason === 'out_of_topic').map(v => v.recordId)).size
  const uncertainDetails = uncertain.length > 0 && (
    <details className="pt-1 text-amber-800">
      <summary className="cursor-pointer">Commenti con pertinenza o contesto incerti ({uncertain.length})</summary>
      <ul className="mt-2 space-y-2">{uncertain.map(r => <li key={r.recordId}>
        <p className="italic">“{r.transmittedText}”</p>
        <p>{r.platform === 'reddit' ? 'Reddit' : 'YouTube'} · Commento: {r.sourceCommentId ?? 'ID originale assente'}</p>
        <p>Escluso dai conteggi confermati; valutazione incerta.</p>
        {verification?.decisions.some(v => v.recordId === r.recordId && v.painPointId === painPointId && v.reason === 'unclear_topic') && <p>Collegamento con l’argomento iniziale non dimostrato.</p>}
        {verification?.decisions.some(v => v.recordId === r.recordId && v.painPointId === painPointId && v.evidenceKind === 'hypothesis') && <p>Giudizio ipotetico: non dimostra un problema vissuto o un bisogno attuale.</p>}
      </li>)}</ul>
    </details>
  )
  if (!metrics || metrics.M === null) return (
    <div className="mt-2 text-xs text-zinc-500 space-y-1">
      <p>U/T/M non disponibili{uncertain.length ? ': pertinenza o contesto incerti' : evidence?.processing?.budgetExhausted ? ': tempo di analisi esaurito' : metrics?.status === 'failed' ? ': attribuzione non riuscita' : ''}.</p>
      {unresolved > 0 && <p>Commenti senza una decisione valida: {unresolved}.</p>}
      {uncertainDetails}
    </div>
  )
  const associations = evidence!.associations.filter(a => a.painPointId === painPointId)
  return (
    <div className="mt-2 text-xs text-zinc-600 space-y-1">
      <p className="font-semibold" aria-label="Conteggi delle testimonianze">
        U: {metrics.U} · T: {metrics.T} · M: {metrics.M}
      </p>
      <p>U: autori identificabili · T: thread/video distinti · M: commenti pertinenti distinti.</p>
      <p>Conteggi riferiti al campione analizzato; non misurano la prevalenza nel mercato.</p>
      {verification?.version === 'topic-problem-support-v4'
        ? <p>Verifica automatica: coerenza con l’argomento iniziale e sostegno al problema.</p>
        : <p className="text-amber-700">{verification?.version === 'topic-problem-support-v3'
          ? 'Questi conteggi precedono il controllo su oggetto del problema e tipo di testimonianza.'
          : verification?.version === 'problem-support-v2'
          ? 'Questi conteggi precedono il controllo rispetto all’argomento iniziale.'
          : 'Questi conteggi precedono la nuova verifica di pertinenza.'}</p>}
      {offTopic > 0 && <p>Proposte escluse perché riguardano un altro argomento: {offTopic}.</p>}
      {metrics.status === 'partial' && <p className="text-amber-700">Attribuzione parziale: {metrics.reviewedComments}/{metrics.totalComments} commenti esaminati; i conteggi possono essere incompleti.</p>}
      {unresolved > 0 && <p>Commenti senza una decisione valida: {unresolved}.</p>}
      {uncertainDetails}
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
