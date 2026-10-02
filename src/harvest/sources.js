// HTTP harvesters. No browser and no account: each reads a public API or a public page.
//
//   companies  the public job board APIs of companies the user lists (Greenhouse, Lever, Ashby)
//   yc         Y Combinator companies (the public yc-oss list), each resolved to its own ATS board
//   anywhere   work-from-anywhere boards: Remote OK and Working Nomads by default; Remotive,
//              Himalayas and Jobicy opt-in. Each posting is resolved to the employer's ATS.
//   dice       Dice search results. External-apply postings only; Easy Apply is never queued.
//
// Every harvester returns postings: { source, sourceUrl, atsUrl, company, title, location,
// description, salary, postedAt }. Board terms that ask for attribution are kept by recording
// the board's own URL in sourceUrl, which the queue and the dashboard show.
import fs from 'node:fs';
import path from 'node:path';
import { getJson, getText } from '../http.js';
import { PLATFORMS } from '../ats/platforms.js';
import { resolveToAts } from './resolve.js';

const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const LISTERS = Object.fromEntries(PLATFORMS.filter((p) => p.listJobs).map((p) => [p.name, p]));

// ── companies ─────────────────────────────────────────────────────────────────────────────────
/** @param {{ companies: { platform: 'greenhouse'|'lever'|'ashby', token: string }[] }} cfg */
export async function harvestCompanies(cfg, { pacer, log = () => {} } = {}) {
  const out = [];
  for (const c of cfg.companies || []) {
    const p = LISTERS[c.platform];
    if (!p) { log(`companies: unknown platform ${c.platform}`); continue; }
    try {
      const jobs = await p.listJobs(c.token);
      for (const j of jobs) out.push({ source: `${c.platform}:${c.token}`, sourceUrl: j.atsUrl, ...j, company: c.name || j.company });
      log(`companies: ${c.platform}/${c.token} has ${jobs.length} open job(s)`);
    } catch (e) {
      log(`companies: ${c.platform}/${c.token} failed: ${e.message}`);
    }
    if (pacer) await pacer.betweenRequests();
  }
  return out;
}

// ── yc ────────────────────────────────────────────────────────────────────────────────────────
export const YC_LIST_URL = 'https://yc-oss.github.io/api/companies/all.json';

/** Board-token candidates for one company, cheapest first. */
export function tokenCandidates(company) {
  const slug = String(company.slug || '').toLowerCase();
  const name = String(company.name || '').toLowerCase();
  const site = (() => { try { return new URL(company.website).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } })();
  return [...new Set([slug, slug.replace(/-/g, ''), name.replace(/[^a-z0-9]/g, ''), site].filter(Boolean))];
}

/**
 * @param {object} cfg { limit, cacheFile, companies (optional pre-fetched list) }
 * The token cache records hits and misses, so each company is looked up once.
 */
export async function harvestYc(cfg = {}, { pacer, log = () => {} } = {}) {
  const list = cfg.companiesList || await getJson(YC_LIST_URL);
  const hiring = list.filter((c) => c.isHiring && c.status === 'Active');
  const cacheFile = cfg.cacheFile || null;
  let cache = {};
  if (cacheFile) { try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; } }
  const save = () => { if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1)); } };

  const out = [];
  let looked = 0;
  for (const c of hiring) {
    if (cfg.limit && looked >= cfg.limit) break;
    looked++;
    let hit = cache[c.slug];
    if (hit === undefined) {
      hit = null;
      for (const token of tokenCandidates(c)) {
        for (const platform of ['greenhouse', 'ashby', 'lever']) {
          try {
            const jobs = await LISTERS[platform].listJobs(token);
            if (jobs.length) { hit = { platform, token }; break; }
          } catch { /* 404 means no board under this token */ }
          if (pacer) await pacer.betweenRequests();
        }
        if (hit) break;
      }
      cache[c.slug] = hit;
      save();
    }
    if (!hit) continue;
    try {
      const jobs = await LISTERS[hit.platform].listJobs(hit.token);
      for (const j of jobs) out.push({ source: 'yc', sourceUrl: c.url || `https://www.ycombinator.com/companies/${c.slug}`, ...j, company: c.name });
      log(`yc: ${c.name} has ${jobs.length} job(s) on ${hit.platform}`);
    } catch (e) {
      log(`yc: ${c.name} listing failed: ${e.message}`);
    }
    if (pacer) await pacer.betweenRequests();
  }
  return out;
}

// ── anywhere ──────────────────────────────────────────────────────────────────────────────────
const WORLDWIDE = /\b(anywhere|worldwide|global|world)\b/i;

/**
 * Parsers for each board's public feed. Each takes the parsed payload and returns raw postings.
 *
 * `defaultOn` follows each board's published terms (quoted in the README):
 *   remoteok       on. Its API terms ask for a link back and a mention, which sourceUrl keeps.
 *   workingnomads  on. No automated-access clause; its job links are plain redirects.
 *   remotive       off. Its site terms ban automated access to remotive.com without written
 *                  permission, and finding the employer link means opening a remotive.com page.
 *                  Its API advises polling at most 4 times a day and blocks more than 2 a minute.
 *   himalayas      off. Its site terms ban robots and scraping on himalayas.app, and the employer
 *                  link is on a himalayas.app page.
 *   jobicy         off. Its site terms allow data only through the official API, its API asks
 *                  that apply buttons go to the Jobicy job URL, and polling is capped at once an hour.
 * We Work Remotely is not included: its API terms require applying through weworkremotely.com.
 */
export const ANYWHERE = {
  remoteok: {
    defaultOn: true,
    url: () => 'https://remoteok.com/api',
    // The first element is the API's legal notice, not a job.
    parse: (d) => (Array.isArray(d) ? d.slice(1) : []).filter((j) => j && j.position).map((j) => ({ sourceUrl: j.url, applyUrl: j.apply_url, title: j.position, company: j.company, location: j.location, description: strip(j.description), salary: j.salary_min ? `${j.salary_min}-${j.salary_max}` : null, postedAt: j.date })),
  },
  workingnomads: {
    defaultOn: true,
    url: () => 'https://www.workingnomads.com/api/exposed_jobs/',
    parse: (d) => (Array.isArray(d) ? d : []).map((j) => ({ sourceUrl: j.url, title: j.title, company: j.company_name, location: j.location, description: strip(j.description), postedAt: j.pub_date })),
  },
  remotive: {
    defaultOn: false,
    minIntervalMs: 30000,
    minPollMs: 6 * 3600000,
    url: (q) => `https://remotive.com/api/remote-jobs?category=software-dev${q ? `&search=${encodeURIComponent(q)}` : ''}`,
    parse: (d) => (d.jobs || []).map((j) => ({ sourceUrl: j.url, title: j.title, company: j.company_name, location: j.candidate_required_location, description: strip(j.description), salary: j.salary || null, postedAt: j.publication_date })),
  },
  himalayas: {
    defaultOn: false,
    url: () => 'https://himalayas.app/jobs/api?limit=50',
    parse: (d) => (d.jobs || []).map((j) => ({ sourceUrl: j.applicationLink, title: j.title, company: j.companyName, location: (j.locationRestrictions || []).join(', ') || 'Worldwide', description: strip(j.description), salary: j.minSalary ? `${j.minSalary}-${j.maxSalary} ${j.currency || ''}`.trim() : null, postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null })),
  },
  jobicy: {
    defaultOn: false,
    minPollMs: 3600000,
    url: (q) => `https://jobicy.com/api/v2/remote-jobs?count=50${q ? `&tag=${encodeURIComponent(q)}` : ''}`,
    parse: (d) => (d.jobs || []).map((j) => ({ sourceUrl: j.url, title: j.jobTitle, company: j.companyName, location: j.jobGeo, description: strip(j.jobDescription), postedAt: j.pubDate })),
  },
};

export const DEFAULT_ANYWHERE_BOARDS = Object.keys(ANYWHERE).filter((k) => ANYWHERE[k].defaultOn);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} cfg { boards: string[], query, worldwideOnly, resolveLimit, stateFile }
 */
export async function harvestAnywhere(cfg = {}, { pacer, log = () => {}, fetchPayload = null } = {}) {
  const boards = cfg.boards || DEFAULT_ANYWHERE_BOARDS;
  let state = {};
  if (cfg.stateFile) { try { state = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); } catch { state = {}; } }
  const out = [];
  for (const b of boards) {
    const src = ANYWHERE[b];
    if (!src) { log(`anywhere: unknown board ${b}${b === 'weworkremotely' ? ' (not included: its API terms require applying through weworkremotely.com)' : ''}`); continue; }
    if (src.minPollMs && state[b] && Date.now() - state[b] < src.minPollMs) {
      log(`anywhere: ${b} was polled less than ${Math.round(src.minPollMs / 60000)} minutes ago; its terms cap polling`);
      continue;
    }
    let raw;
    try {
      const payload = fetchPayload ? await fetchPayload(b) : await getJson(src.url(cfg.query));
      raw = src.parse(payload);
      state[b] = Date.now();
    } catch (e) { log(`anywhere: ${b} failed: ${e.message}`); continue; }
    const kept = raw.filter((r) => !cfg.worldwideOnly || WORLDWIDE.test(String(r.location || '')));
    let resolved = 0;
    for (const r of kept.slice(0, cfg.resolveLimit || 25)) {
      if (src.minIntervalMs && !fetchPayload) await sleep(src.minIntervalMs);
      const hit = await resolveToAts(r.applyUrl || r.sourceUrl).catch(() => null);
      if (pacer) await pacer.betweenRequests();
      if (!hit || !isKnownAtsOrOffBoard(hit.atsUrl, b)) continue;
      resolved++;
      out.push({ source: b, sourceUrl: r.sourceUrl, atsUrl: hit.atsUrl, company: r.company, title: r.title, location: r.location, description: r.description, salary: r.salary || null, postedAt: r.postedAt || null });
    }
    log(`anywhere: ${b} returned ${raw.length}, kept ${kept.length}, resolved ${resolved}`);
  }
  if (cfg.stateFile) { fs.mkdirSync(path.dirname(cfg.stateFile), { recursive: true }); fs.writeFileSync(cfg.stateFile, JSON.stringify(state)); }
  return out;
}

/** A resolved link must leave the board: a board's own page is never queued as an application. */
function isKnownAtsOrOffBoard(url, board) {
  try {
    const h = new URL(url).hostname;
    const boardHosts = { remoteok: /remoteok\.com$/, workingnomads: /workingnomads\.com$/, remotive: /remotive\.com$/, himalayas: /himalayas\.app$/, jobicy: /jobicy\.com$/ };
    return !(boardHosts[board] && boardHosts[board].test(h));
  } catch { return false; }
}

// ── dice ──────────────────────────────────────────────────────────────────────────────────────
// Dice renders its search results on the server and ships them as structured data inside the
// page (the self.__next_f.push flight payload). An anonymous GET returns the same results a
// signed-in browser sees, including each job's easyApply flag. A job is queued only on positive
// proof from its own detail page that it applies on an external URL.

/** Concatenate the flight payload strings of a Next.js App Router page. */
export function flightOf(html) {
  const parts = [...String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)];
  return parts.map((m) => { try { return JSON.parse(`"${m[1]}"`); } catch { return ''; } }).join('');
}

/** Every JSON object in `buf` that contains `marker`, parsed. */
export function objectsWith(buf, marker, { maxBack = 6000 } = {}) {
  const out = [];
  let at = buf.indexOf(marker);
  const seen = new Set();
  while (at >= 0) {
    for (let start = buf.lastIndexOf('{', at); start >= 0 && at - start < maxBack; start = buf.lastIndexOf('{', start - 1)) {
      let depth = 0; let inStr = false; let esc = false; let end = -1;
      for (let i = start; i < buf.length && i - start < maxBack * 2; i++) {
        const c = buf[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i; break; }
      }
      if (end > at) {
        try {
          const obj = JSON.parse(buf.slice(start, end + 1));
          if (!seen.has(start)) { seen.add(start); out.push(obj); }
          break;
        } catch { /* not a full object; widen */ }
      }
    }
    at = buf.indexOf(marker, at + marker.length);
  }
  return out;
}

export function diceSearchUrl(q, page = 1) {
  return `https://www.dice.com/jobs?${new URLSearchParams({ q, 'filters.workplaceTypes': 'Remote', page: String(page) })}`;
}

export function diceJobsFromHtml(html) {
  return objectsWith(flightOf(html), '"easyApply":')
    .filter((j) => j && j.guid && typeof j.easyApply === 'boolean' && j.title)
    .map((j) => ({ guid: j.guid, title: j.title, company: j.companyName, easyApply: j.easyApply, detailsPageUrl: j.detailsPageUrl, location: j.jobLocation?.displayName || (j.isRemote ? 'Remote' : ''), summary: j.summary || '', postedAt: j.postedDate || null, salary: j.salary || null }));
}

/**
 * Classify a Dice job detail page. Both signals must agree: the job's own applyType is
 * "External" and the apply button's application detail is APPLY_TO_URL with an off-Dice URL.
 * Anything else is 'easy' or 'unknown', and neither is queued.
 */
export function diceClassify(html) {
  const buf = flightOf(html);
  const jobsData = objectsWith(buf, '"applyType":').find((o) => typeof o.applyType === 'string' && (o.title || o.guid || o.description));
  const detail = objectsWith(buf, '"applicationDetail":').map((o) => o.applicationDetail).find((d) => d && d.type);
  const applyType = jobsData?.applyType || null;
  const url = detail?.url || null;
  let offsite = false;
  try { offsite = !!url && !/(^|\.)dice\.com$/i.test(new URL(url).hostname); } catch { offsite = false; }
  if (applyType === 'External' && detail?.type === 'APPLY_TO_URL' && offsite) {
    return { kind: 'external', url, description: strip(jobsData?.description || '') };
  }
  if (applyType === 'Internal' && detail?.type !== 'APPLY_TO_URL') return { kind: 'easy' };
  return { kind: 'unknown', applyType, detailType: detail?.type || null };
}

/** @param {object} cfg { queries: string[], pages, limit } */
export async function harvestDice(cfg = {}, { pacer, log = () => {} } = {}) {
  const out = [];
  for (const q of cfg.queries || ['software engineer']) {
    for (let page = 1; page <= (cfg.pages || 1); page++) {
      const { text } = await getText(diceSearchUrl(q, page));
      const jobs = diceJobsFromHtml(text).filter((j) => !j.easyApply);
      log(`dice: "${q}" page ${page}: ${jobs.length} non-Easy-Apply job(s)`);
      for (const j of jobs.slice(0, cfg.limit || 30)) {
        if (pacer) await pacer.betweenRequests();
        const { text: detail } = await getText(j.detailsPageUrl || `https://www.dice.com/job-detail/${j.guid}`);
        const c = diceClassify(detail);
        if (c.kind !== 'external') continue;
        const hit = await resolveToAts(c.url).catch(() => null);
        out.push({ source: 'dice', sourceUrl: j.detailsPageUrl, atsUrl: hit?.atsUrl || c.url, company: j.company, title: j.title, location: j.location, description: c.description || j.summary, salary: j.salary, postedAt: j.postedAt });
      }
      if (pacer) await pacer.betweenRequests();
    }
  }
  return out;
}
