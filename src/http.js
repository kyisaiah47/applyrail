// One HTTP client for the harvesters and the ATS readers. Requests are anonymous: no cookies,
// no account, no session. The user agent names ApplyRail so a site can tell who is asking.
import { blockSignal, RunStop } from './stop.js';

export const USER_AGENT = 'ApplyRail/0.1 (+https://github.com/kyisaiah47/applyrail)';

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} ${url}: ${String(body).slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

/**
 * fetch with a timeout and a retry on transport errors and 5xx. A 429 is a stop, not a retry:
 * the site asked us to slow down, so the run ends and the operator decides what to do.
 */
export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 30000, retries = 1, fetchImpl = globalThis.fetch } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        body,
        redirect: 'follow',
        signal: ac.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
      });
      if (res.status === 429 || res.status === 999) {
        throw new RunStop('rate_limit', `HTTP ${res.status} from ${new URL(url).hostname}`, { url });
      }
      if (res.status >= 500 && attempt < retries) { last = new HttpError(res.status, url, ''); continue; }
      return res;
    } catch (e) {
      if (e?.name === 'RunStop') throw e;
      last = e;
      if (attempt >= retries) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

export async function getText(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'text/html,application/xhtml+xml,*/*', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  const block = blockSignal({ url: res.url || url, text: text.slice(0, 3000), status: res.status });
  if (block && opts.stopOnBlock !== false && /<html/i.test(text.slice(0, 500)) && text.length < 60000) {
    throw new RunStop('block', block, { url });
  }
  return { text, url: res.url || url };
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  try { return JSON.parse(text); } catch { throw new HttpError(res.status, url, `not JSON: ${text.slice(0, 120)}`); }
}

export async function postJson(url, payload, opts = {}) {
  const res = await request(url, {
    ...opts,
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* caller reads text */ }
  return { ok: res.ok, status: res.status, json, text };
}
