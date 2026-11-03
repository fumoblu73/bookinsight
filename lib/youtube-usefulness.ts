import Anthropic from '@anthropic-ai/sdk'

// Classificatore AI dell'utilità dei commenti YouTube (richiesto dall'utente al posto
// della sola euristica). Una chiamata per analisi, output JSON vincolato da schema.
// In caso di errore, timeout, rifiuto o JSON non valido restituisce null: il chiamante
// conserva il risultato dell'euristica (nessun blocco del report).

export const USEFULNESS_MODEL = 'claude-opus-5-5'
const MAX_TEXT_CHARS = 300 // stesso troncamento del prompt di estrazione

export interface UsefulnessInput { id: string; text: string }

let _client: Anthropic | null = null
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  if (!_client) _client = new Anthropic({ apiKey, timeout: 40_000, maxRetries: 1 })
  return _client
}

export function buildUsefulnessPrompt(keyword: string, comments: UsefulnessInput[]): string {
  const lines = comments.map((c, i) => `c${i + 1}: ${c.text.substring(0, MAX_TEXT_CHARS).replace(/\s+/g, ' ').trim()}`)
  return `These are YouTube comments under videos about "${keyword}". They will be used as voice-of-customer evidence for a non-fiction book on this topic.

Mark a comment as useful when it carries content about the topic: a problem or difficulty, a need or request, a question, a concrete personal experience, an objection or disagreement, an opinion about a method, ingredient, product or approach, or a practical tip.

Mark it as not useful when it is only generic praise or thanks, a greeting, chatter about the creator or the channel, a joke or reaction without content, off-topic, spam or self-promotion, or a reply that only addresses another user without adding content.

When unsure, keep the comment.

Return the ids of the useful comments.

${lines.join('\n')}`
}

/** Restituisce gli ID dei commenti utili, oppure null se la classificazione non è disponibile. */
export async function classifyUsefulComments(
  keyword: string,
  comments: UsefulnessInput[],
  client: Anthropic | null = getClient(),
): Promise<Set<string> | null> {
  if (!client || comments.length === 0) return null
  try {
    const response = await client.messages.create({
      model: USEFULNESS_MODEL,
      max_tokens: 16000,
      output_config: {
        effort: 'low', // classificazione semplice e ad alto volume
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { useful_ids: { type: 'array', items: { type: 'string' } } },
            required: ['useful_ids'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: buildUsefulnessPrompt(keyword, comments) }],
    })
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      console.log(`[youtube-usefulness] stop_reason:${response.stop_reason}, uso solo l'euristica`)
      return null
    }
    const block = response.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') return null
    const parsed = JSON.parse(block.text) as { useful_ids?: unknown }
    if (!Array.isArray(parsed.useful_ids)) return null
    const useful = new Set<string>()
    for (const alias of parsed.useful_ids) {
      const m = typeof alias === 'string' ? alias.trim().match(/^c(\d+)$/) : null
      const idx = m ? Number(m[1]) - 1 : -1
      if (idx >= 0 && idx < comments.length) useful.add(comments[idx].id)
    }
    return useful
  } catch (err) {
    console.log(`[youtube-usefulness] classificazione non riuscita (${err instanceof Error ? err.name : 'errore'}), uso solo l'euristica`)
    return null
  }
}
