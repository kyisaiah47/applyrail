// The queue. Harvesters add items; the drain leases them and moves them through their states.
// Each item records where it came from (source, sourceUrl), where it is applied (atsUrl,
// platform) and what happened to it (state, reason, history).
//
// Storage is one JSON Lines file, rewritten atomically. A lock directory keeps two processes
// from writing at once. Items are never deleted: a submitted job stays in the file, which is
// what stops the same job from ever being applied to twice.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { platformFor } from './ats/platforms.js';

export const STATES = {
  queued: 'waiting to be applied to',
  screened_out: 'removed by the title, location or description screen',
  filling: 'a drain is filling the form now',
  dry_filled: 'filled in --dry mode; nothing was submitted',
  needs_input: 'a required question has no answer in the profile',
  review_blocked: 'the presubmit review blocked the form',
  manual: 'needs a person (a write-once host, a sign-in, an unresolved link)',
  skipped: 'the employer asks applicants not to use automation, or the posting is not applicable',
  stopped: 'a captcha or a block page stopped the run here',
  submitted: 'submitted',
  failed: 'an error; it can be retried',
  closed: 'the posting is gone',
};

const TRANSITIONS = {
  queued: ['filling', 'screened_out', 'skipped', 'manual', 'closed'],
  filling: ['dry_filled', 'needs_input', 'review_blocked', 'manual', 'skipped', 'screened_out', 'stopped', 'submitted', 'failed', 'closed', 'queued'],
  dry_filled: ['queued', 'filling'],
  needs_input: ['queued'],
  review_blocked: ['queued'],
  manual: ['queued', 'submitted'],
  stopped: ['queued'],
  failed: ['queued'],
  skipped: [],
  screened_out: ['queued'],
  submitted: [],
  closed: [],
};

const TRACKING = /^(utm_|gh_src$|source$|src$|ref$|refId$|trk|lever-source|lever-origin|ashby_src|mode$|iis$|iisn$)/i;

/** The canonical form of an ATS URL, so one job is one item however it was linked. */
export function normalizeAtsUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return String(raw || '').trim(); }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);

  if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
    const forParam = u.searchParams.get('for');
    const jid = u.searchParams.get('token') || u.searchParams.get('gh_jid');
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (m) return `https://job-boards.greenhouse.io/${m[1].toLowerCase()}/jobs/${m[2]}`;
    if (forParam && jid) return `https://job-boards.greenhouse.io/${forParam.toLowerCase()}/jobs/${jid}`;
  }
  if (u.hostname === 'jobs.lever.co') {
    const [site, id] = u.pathname.replace(/^\/+/, '').split('/');
    if (site && id) return `https://jobs.lever.co/${site.toLowerCase()}/${id.toLowerCase()}`;
  }
  if (u.hostname === 'jobs.ashbyhq.com') {
    const [org, id] = u.pathname.replace(/^\/+/, '').split('/');
    if (org && id) return `https://jobs.ashbyhq.com/${org.toLowerCase()}/${id.toLowerCase()}`;
  }
  if (u.hostname === 'apply.workable.com') {
    const m = u.pathname.match(/^\/([^/]+)\/j\/([A-Za-z0-9]+)/);
    if (m) return `https://apply.workable.com/${m[1].toLowerCase()}/j/${m[2].toUpperCase()}/`;
  }
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}

export const itemId = (atsUrl) => crypto.createHash('sha1').update(normalizeAtsUrl(atsUrl)).digest('hex').slice(0, 12);

function employerKey(item) {
  return String(item.company || '').toLowerCase().replace(/[^a-z0-9]/g, '') || new URL(item.atsUrl).hostname;
}

export class Queue {
  constructor(file) {
    this.file = file;
    this.lockDir = `${file}.lock`;
  }

  read() {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  #write(items) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));
    fs.renameSync(tmp, this.file);
  }

  #locked(fn) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const deadline = Date.now() + 10000;
    for (;;) {
      try { fs.mkdirSync(this.lockDir); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(this.lockDir).mtimeMs > 60000) fs.rmdirSync(this.lockDir); } catch { /* raced */ }
        if (Date.now() > deadline) throw new Error(`queue is locked: ${this.lockDir}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    try { return fn(); } finally { try { fs.rmdirSync(this.lockDir); } catch { /* gone */ } }
  }

  /**
   * Add postings. Duplicates (same normalized ATS URL) are ignored, whatever their state.
   * @param {object[]} postings { source, sourceUrl?, atsUrl, company?, title?, location?, description?, salary?, postedAt? }
   * @returns {{ added: object[], duplicates: number }}
   */
  add(postings) {
    return this.#locked(() => {
      const items = this.read();
      const ids = new Set(items.map((i) => i.id));
      const added = [];
      let duplicates = 0;
      const now = new Date().toISOString();
      for (const p of postings) {
        if (!p || !p.atsUrl) continue;
        const atsUrl = normalizeAtsUrl(p.atsUrl);
        const id = itemId(atsUrl);
        if (ids.has(id)) { duplicates++; continue; }
        ids.add(id);
        const item = {
          id,
          source: p.source || 'manual',
          sourceUrl: p.sourceUrl || null,
          atsUrl,
          platform: platformFor(atsUrl)?.name || 'longtail',
          company: p.company || null,
          title: p.title || null,
          location: p.location || null,
          salary: p.salary || null,
          postedAt: p.postedAt || null,
          description: p.description ? String(p.description).slice(0, 20000) : null,
          state: 'queued',
          reason: null,
          attempts: 0,
          createdAt: now,
          updatedAt: now,
          history: [{ at: now, to: 'queued', reason: `harvested from ${p.source || 'manual'}` }],
        };
        items.push(item);
        added.push(item);
      }
      this.#write(items);
      return { added, duplicates };
    });
  }

  /** Move an item to a new state. Refuses a transition the state machine does not allow. */
  transition(id, to, reason = null, patch = {}) {
    if (!STATES[to]) throw new Error(`unknown state ${to}`);
    return this.#locked(() => {
      const items = this.read();
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error(`no queue item ${id}`);
      if (item.state !== to && !(TRANSITIONS[item.state] || []).includes(to)) {
        throw new Error(`cannot move ${id} from ${item.state} to ${to}`);
      }
      const at = new Date().toISOString();
      Object.assign(item, patch, { state: to, reason, updatedAt: at });
      if (to === 'filling') item.attempts = (item.attempts || 0) + 1;
      item.history = [...(item.history || []), { at, from: item.history?.length ? item.history[item.history.length - 1].to : null, to, reason }];
      this.#write(items);
      return item;
    });
  }

  /**
   * Lease up to `limit` queued items for filling, never two from the same employer, and never an
   * employer that already has an item in `filling`.
   */
  lease(limit = 1, { platforms = null, filter = null } = {}) {
    return this.#locked(() => {
      const items = this.read();
      const busy = new Set(items.filter((i) => i.state === 'filling').map(employerKey));
      const out = [];
      const at = new Date().toISOString();
      for (const item of items) {
        if (out.length >= limit) break;
        if (item.state !== 'queued') continue;
        if (platforms && !platforms.includes(item.platform)) continue;
        if (filter && !filter(item)) continue;
        const key = employerKey(item);
        if (busy.has(key)) continue;
        busy.add(key);
        item.state = 'filling';
        item.attempts = (item.attempts || 0) + 1;
        item.updatedAt = at;
        item.history = [...(item.history || []), { at, from: 'queued', to: 'filling', reason: 'leased by the drain' }];
        out.push({ ...item });
      }
      this.#write(items);
      return out;
    });
  }

  stats() {
    const out = {};
    for (const i of this.read()) out[i.state] = (out[i.state] || 0) + 1;
    return out;
  }

  get(id) { return this.read().find((i) => i.id === id) || null; }
}
