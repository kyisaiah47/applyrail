// The provider interface. Every request here goes to a fake fetch; no key is read from the
// environment. The last test calls the free Gemini API only when GEMINI_API_KEY is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, parseJsonReply } from '../src/providers/index.js';

function fakeFetch(reply) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  fn.seen = seen;
  return fn;
}

test('openai: chat completions at the configured base URL, JSON mode on request', async () => {
  const f = fakeFetch({ choices: [{ message: { content: '{"ok":true}' } }] });
  const p = createProvider({ provider: 'openai', model: 'm', apiKey: 'test-key', fetch: f });
  assert.deepEqual(await p.completeJson({ system: 's', prompt: 'p' }), { ok: true });
  assert.equal(f.seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(f.seen[0].init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(f.seen[0].body.response_format, { type: 'json_object' });
});

test('openai-compatible: a local model at any base URL, no key needed', async () => {
  const f = fakeFetch({ choices: [{ message: { content: 'hi' } }] });
  const p = createProvider({ provider: 'openai-compatible', baseURL: 'http://localhost:11434/v1/', model: 'llama3', fetch: f });
  assert.equal(await p.complete({ prompt: 'p' }), 'hi');
  assert.equal(f.seen[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(f.seen[0].init.headers.Authorization, undefined);
});

test('anthropic: messages API with the version header', async () => {
  const f = fakeFetch({ content: [{ type: 'text', text: 'hello' }] });
  const p = createProvider({ provider: 'anthropic', model: 'm', apiKey: 'test-key', fetch: f });
  assert.equal(await p.complete({ system: 's', prompt: 'p' }), 'hello');
  assert.equal(f.seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.seen[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(f.seen[0].body.system, 's');
});

test('gemini: generateContent with a system instruction and JSON output', async () => {
  const f = fakeFetch({ candidates: [{ content: { parts: [{ text: '[1,2]' }] } }] });
  const p = createProvider({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'test-key', fetch: f });
  assert.deepEqual(await p.completeJson({ system: 's', prompt: 'p' }), [1, 2]);
  assert.match(f.seen[0].url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(f.seen[0].body.generationConfig.responseMimeType, 'application/json');
});

test('command: any CLI that reads the prompt on stdin', async () => {
  const p = createProvider({ provider: 'command', command: ['node', '-e', 'process.stdin.on("data", d => process.stdout.write(String(d).toUpperCase()))'] });
  assert.equal(await p.complete({ prompt: 'abc' }), 'ABC');
});

test('a missing key is an error naming the variable', async () => {
  const p = createProvider({ provider: 'gemini', apiKeyEnv: 'APPLYRAIL_TEST_UNSET_KEY', fetch: fakeFetch({}) });
  await assert.rejects(() => p.complete({ prompt: 'p' }), /APPLYRAIL_TEST_UNSET_KEY/);
});

test('JSON is pulled out of fenced or chatty replies', () => {
  assert.deepEqual(parseJsonReply('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('Here: {"a":{"b":"}"}} done'), { a: { b: '}' } });
  assert.throws(() => parseJsonReply('no json here'));
});

test('live: Gemini free tier answers one question (runs only with GEMINI_API_KEY)', { skip: !process.env.GEMINI_API_KEY && 'GEMINI_API_KEY is not set' }, async () => {
  const p = createProvider({ provider: 'gemini', model: 'gemini-2.5-flash' });
  const r = await p.completeJson({ system: 'Return only JSON.', prompt: 'Return {"answer": "yes"} and nothing else.' });
  assert.equal(String(r.answer).toLowerCase(), 'yes');
});
