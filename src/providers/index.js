// One provider interface for every model. The user brings their own model and key.
//
//   const provider = createProvider({ provider: 'gemini', model: 'gemini-2.5-flash' });
//   const text = await provider.complete({ system, prompt });
//   const obj  = await provider.completeJson({ system, prompt });
//
// Providers:
//   openai             api.openai.com, key from OPENAI_API_KEY (or apiKeyEnv)
//   openai-compatible  any server that speaks the OpenAI chat API at `baseURL`: a local model
//                      (Ollama, LM Studio, llama.cpp, vLLM) or a hosted gateway. Key optional.
//   anthropic          api.anthropic.com, key from ANTHROPIC_API_KEY (or apiKeyEnv)
//   gemini             generativelanguage.googleapis.com, key from GEMINI_API_KEY (or apiKeyEnv)
//   command            any CLI that reads the prompt on stdin and prints the answer
//   stub               canned answers, for tests and dry runs
//
// A key is read from the environment variable the config names, at call time, and only for the
// provider the user chose.
import { spawn } from 'node:child_process';

const DEFAULT_KEY_ENV = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', 'openai-compatible': null };
const DEFAULT_MODEL = { openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-latest', gemini: 'gemini-2.5-flash' };

export class ProviderError extends Error {
  constructor(provider, message, status = 0) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/** Pull the first JSON object or array out of a model reply. */
export function parseJsonReply(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const start = s.search(/[{[]/);
  if (start >= 0) {
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { break; } }
    }
  }
  throw new Error(`model reply is not JSON: ${s.slice(0, 160)}`);
}

function keyFrom(cfg, name) {
  const env = cfg.apiKeyEnv === undefined ? DEFAULT_KEY_ENV[name] : cfg.apiKeyEnv;
  if (cfg.apiKey) return cfg.apiKey;
  if (!env) return null;
  const v = process.env[env];
  if (!v && name !== 'openai-compatible') throw new ProviderError(name, `no API key: set ${env} or apiKey in the config`);
  return v || null;
}

async function postJson(fetchImpl, url, headers, body, name) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  try { return JSON.parse(text); } catch { throw new ProviderError(name, `non-JSON response: ${text.slice(0, 200)}`); }
}

function openaiProvider(cfg, name) {
  const baseURL = String(cfg.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.model || DEFAULT_MODEL.openai;
  const fetchImpl = cfg.fetch || globalThis.fetch;
  return {
    name, model,
    async complete({ system = '', prompt, json = false, maxTokens = 1500, temperature = 0.2 }) {
      const key = keyFrom(cfg, name);
      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
        ...(json && cfg.jsonMode !== false ? { response_format: { type: 'json_object' } } : {}),
      };
      const data = await postJson(fetchImpl, `${baseURL}/chat/completions`, key ? { Authorization: `Bearer ${key}` } : {}, body, name);
      return data?.choices?.[0]?.message?.content ?? '';
    },
  };
}

function anthropicProvider(cfg) {
  const baseURL = String(cfg.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const model = cfg.model || DEFAULT_MODEL.anthropic;
  const fetchImpl = cfg.fetch || globalThis.fetch;
  return {
    name: 'anthropic', model,
    async complete({ system = '', prompt, maxTokens = 1500, temperature = 0.2 }) {
      const key = keyFrom(cfg, 'anthropic');
      const data = await postJson(fetchImpl, `${baseURL}/messages`,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: maxTokens, temperature, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] },
        'anthropic');
      return (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    },
  };
}

function geminiProvider(cfg) {
  const baseURL = String(cfg.baseURL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = cfg.model || DEFAULT_MODEL.gemini;
  const fetchImpl = cfg.fetch || globalThis.fetch;
  return {
    name: 'gemini', model,
    async complete({ system = '', prompt, json = false, maxTokens = 1500, temperature = 0.2 }) {
      const key = keyFrom(cfg, 'gemini');
      const data = await postJson(fetchImpl, `${baseURL}/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key },
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
        },
        'gemini');
      return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  };
}

function commandProvider(cfg) {
  const argv = Array.isArray(cfg.command) ? cfg.command : String(cfg.command || '').split(/\s+/).filter(Boolean);
  if (!argv.length) throw new ProviderError('command', 'set "command" to an argv array, e.g. ["llm", "-m", "my-model"]');
  return {
    name: 'command', model: argv[0],
    complete({ system = '', prompt }) {
      return new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new ProviderError('command', 'timed out')); }, cfg.timeoutMs || 300000);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(new ProviderError('command', e.message)); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new ProviderError('command', `exit ${code}: ${err.slice(0, 300)}`));
          else resolve(out.trim());
        });
        child.stdin.end(system ? `${system}\n\n${prompt}` : prompt);
      });
    },
  };
}

/**
 * A stub. `responses` is a function (request) => string|object, or an array used in order.
 * Objects are serialised as JSON. Every request is recorded on `.calls`.
 */
export function stubProvider(responses = () => '{}') {
  const calls = [];
  let i = 0;
  return {
    name: 'stub', model: 'stub', calls,
    async complete(req) {
      calls.push(req);
      const r = typeof responses === 'function' ? responses(req) : responses[Math.min(i++, responses.length - 1)];
      const v = await r;
      if (v instanceof Error) throw v;
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
  };
}

function withJson(p) {
  return {
    ...p,
    async completeJson(req) {
      const text = await p.complete({ ...req, json: true });
      return parseJsonReply(text);
    },
  };
}

/** Build a provider from config. Returns null when no model is configured. */
export function createProvider(cfg) {
  if (!cfg || !cfg.provider || cfg.provider === 'none') return null;
  switch (cfg.provider) {
    case 'openai': return withJson(openaiProvider(cfg, 'openai'));
    case 'openai-compatible':
      if (!cfg.baseURL) throw new ProviderError('openai-compatible', 'set baseURL, e.g. http://localhost:11434/v1');
      return withJson(openaiProvider(cfg, 'openai-compatible'));
    case 'anthropic': return withJson(anthropicProvider(cfg));
    case 'gemini': return withJson(geminiProvider(cfg));
    case 'command': return withJson(commandProvider(cfg));
    case 'stub': return withJson(stubProvider(cfg.responses));
    default: throw new ProviderError(String(cfg.provider), 'unknown provider; use openai, openai-compatible, anthropic, gemini, command or stub');
  }
}

/** Wrap an existing provider object (for example a stub) with completeJson. */
export const asProvider = withJson;
