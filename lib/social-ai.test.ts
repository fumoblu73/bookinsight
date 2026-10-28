import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callSocialAttribution, callSocialVerification, SOCIAL_VERIFICATION_MODEL } from './ai'

test('il revisore usa Sonnet e l’estrattore sociale resta Haiku, senza richieste esterne nel test', async t => {
  const previous = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-only-key'
  t.after(() => { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous })
  const models: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : input instanceof Request ? await input.clone().json() : null
    assert.ok(body)
    models.push(body.model)
    return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text: '{"checks":[]}' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  })
  const signal = new AbortController().signal
  assert.deepEqual(await callSocialAttribution('Test only', signal), { checks: [] })
  assert.deepEqual(await callSocialVerification('Test only', signal), { checks: [] })
  assert.deepEqual(models, ['claude-haiku-4-5', SOCIAL_VERIFICATION_MODEL])
  assert.equal(SOCIAL_VERIFICATION_MODEL, 'claude-sonnet-4-6')
})
