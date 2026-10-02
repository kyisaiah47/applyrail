// Browser harvesters: Indeed, ZipRecruiter, Wellfound and LinkedIn.
//
// These run in the user's own Chrome, attached over CDP (`--cdp http://127.0.0.1:9222`). The user
// signs in to a board there if the board needs it. ApplyRail never signs in, never solves a
// captcha and never clicks an Easy Apply control. Each harvester reads the search results,
// keeps only postings that apply on the employer's own site, captures that URL, and queues it
// for the ATS drain. A block page, a sign-in wall or a captcha stops the harvest.
//
// LinkedIn is OFF by default. It runs only when the config sets harvest.linkedin.enabled to true.
// It reads the external "Apply on company website" link from the job pane and never clicks Apply.
// LinkedIn Easy Apply is not part of ApplyRail.
//
// Every page-side function below takes `doc` as its first argument and is self-contained, so the
// same function runs in Chrome through driver.evaluate() and in jsdom in the tests.
import { RunStop } from '../stop.js';
import { resolveToAts } from './resolve.js';

// ── shared page checks ────────────────────────────────────────────────────────────────────────
export function pageBlocked(doc) {
  const href = String(doc.location && doc.location.href || '');
  const text = String(doc.body ? doc.body.textContent : '').slice(0, 2000);
  if (/\/(checkpoint|authwall|uas\/login|captcha|challenge|blocked)\b/i.test(href)) return `block URL ${href}`;
  const m = text.match(/security (check|verification)|unusual (traffic|activity)|verify you are (a )?human|press (&|and) hold|additional verification|restricted your account|temporarily restricted|access denied/i);
  return m ? m[0] : null;
}

async function guard(driver, board) {
  const why = await driver.evaluate(pageBlocked);
  if (why) throw new RunStop('block', why, { board });
}

// ── Indeed ────────────────────────────────────────────────────────────────────────────────────
export const indeed = {
  name: 'indeed',
  searchUrl: ({ query, location = 'Remote', start = 0, days = null }) => `https://www.indeed.com/jobs?${new URLSearchParams({ q: query, l: location, ...(start ? { start: String(start) } : {}), ...(days ? { fromage: String(days) } : {}) })}`,
  jobUrl: (id) => `https://www.indeed.com/viewjob?jk=${id}`,
  /** Search result cards. "Easily apply" marks Indeed's own apply flow; those are skipped. */
  cards(doc) {
    const out = []; const seen = new Set();
    for (const a of doc.querySelectorAll('a[data-jk], a.jcs-JobTitle')) {
      const jk = a.getAttribute('data-jk') || ((a.getAttribute('href') || '').match(/[?&]jk=([0-9a-f]+)/i) || [])[1];
      if (!jk || seen.has(jk)) continue;
      const card = a.closest('.job_seen_beacon, [data-testid="slider_item"], li');
      if (!card) continue;
      seen.add(jk);
      const text = card.textContent || '';
      const company = card.querySelector('[data-testid="company-name"], .companyName');
      const loc = card.querySelector('[data-testid="text-location"], .companyLocation');
      out.push({ id: jk, title: (a.textContent || '').trim(), company: company ? company.textContent.trim() : null, location: loc ? loc.textContent.trim() : null, easy: /easily apply/i.test(text) });
    }
    return out;
  },
  /** The selector of the external apply control on a job page, or null. */
  externalControl(doc) {
    const els = [...doc.querySelectorAll('button, a')];
    const el = els.find((e) => /apply on company site/i.test(`${e.getAttribute('aria-label') || ''} ${e.textContent || ''}`));
    if (!el) return null;
    el.setAttribute('data-applyrail-ext', '1');
    return '[data-applyrail-ext="1"]';
  },
  description(doc) {
    const d = doc.querySelector('#jobDescriptionText, [data-testid="jobsearch-JobComponent-description"]');
    return d ? d.textContent.replace(/\s+/g, ' ').trim() : '';
  },
};

// ── ZipRecruiter ──────────────────────────────────────────────────────────────────────────────
// A ZipRecruiter card has no job URL. The posting opens as a pane. An external posting carries
// ZipRecruiter's own outbound redirect (a[href*="/job-redirect?"]); a 1-Click posting carries a
// "1-Click Apply" button and no redirect. External is decided by the redirect's presence only.
export const ziprecruiter = {
  name: 'ziprecruiter',
  searchUrl: ({ query, location = 'USA', page = 1, days = '' }) => `https://www.ziprecruiter.com/jobs-search?${new URLSearchParams({ search: query, location, location_explicitly_set: 'true', refine_by_location_type: 'only_remote', days, ...(page > 1 ? { page: String(page) } : {}) })}`,
  cards(doc) {
    return [...doc.querySelectorAll('button[aria-label^="View "]')].map((b, i) => {
      b.setAttribute('data-applyrail-card', String(i));
      return { id: String(i), selector: `[data-applyrail-card="${i}"]`, title: (b.getAttribute('aria-label') || '').replace(/^View\s+/, '').trim() };
    });
  },
  pane(doc) {
    const ext = doc.querySelector('a[href*="/job-redirect?"], a[href*="/job-redirect%3F"]');
    const oneClick = doc.querySelector('button[aria-label*="1-Click Apply" i]');
    const company = doc.querySelector('[data-testid="job-details-company"], a[href*="/co/"]');
    const desc = doc.querySelector('[data-testid="job-details-scroll-container"], .job_description');
    return {
      external: ext ? new URL(ext.getAttribute('href'), 'https://www.ziprecruiter.com').toString() : null,
      oneClick: !!oneClick,
      company: company ? company.textContent.trim() : null,
      description: desc ? desc.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  },
};

// ── Wellfound ─────────────────────────────────────────────────────────────────────────────────
// Wellfound search needs the user's own signed-in session. A posting whose apply control says
// "Apply on Wellfound" is Wellfound's own flow and is skipped; a posting with an external apply
// link is captured.
export const wellfound = {
  name: 'wellfound',
  searchUrl: ({ role = 'software-engineer', remote = true }) => `https://wellfound.com/role/${remote ? 'r/' : ''}${role}`,
  cards(doc) {
    const out = []; const seen = new Set();
    for (const a of doc.querySelectorAll('a[href*="/jobs/"]')) {
      const m = (a.getAttribute('href') || '').match(/\/jobs\/(\d+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ id: m[1], url: new URL(a.getAttribute('href'), 'https://wellfound.com').toString(), title: (a.textContent || '').trim() });
    }
    return out;
  },
  external(doc) {
    const inDomain = [...doc.querySelectorAll('button, a')].some((e) => /apply on wellfound/i.test(e.textContent || ''));
    const ext = [...doc.querySelectorAll('a[href^="http"]')].find((a) => /apply/i.test(`${a.textContent} ${a.getAttribute('aria-label') || ''}`) && !/wellfound\.com/i.test(a.getAttribute('href')));
    return { inDomain, url: ext ? ext.getAttribute('href') : null };
  },
  signedOut(doc) {
    return /\/login\b/.test(String(doc.location && doc.location.pathname || '')) || !!doc.querySelector('a[href="/login"]');
  },
};

// ── LinkedIn (opt-in, off by default) ─────────────────────────────────────────────────────────
export const linkedin = {
  name: 'linkedin',
  searchUrl: ({ url = null, query, location = 'United States', start = 0 }) => {
    if (url) { const u = new URL(url); u.searchParams.set('start', String(start)); u.searchParams.delete('currentJobId'); return u.toString(); }
    return `https://www.linkedin.com/jobs/search-results/?${new URLSearchParams({ keywords: query, location, f_WT: '2', start: String(start) })}`;
  },
  /** Cards on the 2026 search UI carry componentkey="job-card-component-ref-<jobId>". */
  cards(doc) {
    return [...doc.querySelectorAll('[componentkey^="job-card-component-ref-"]')].map((el) => {
      const id = (el.getAttribute('componentkey') || '').replace('job-card-component-ref-', '');
      return { id, selector: `[componentkey="job-card-component-ref-${id}"]`, title: (el.textContent || '').trim().split('\n')[0].slice(0, 120), easy: /easy apply/i.test(el.textContent || '') };
    }).filter((c) => c.id);
  },
  /** The external apply target in the open pane, unwrapped from LinkedIn's /safety/go interstitial. */
  external(doc) {
    const a = doc.querySelector('a[aria-label^="Apply on company"], a[aria-label^="Apply on the company"]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    try {
      const u = new URL(href, 'https://www.linkedin.com');
      if (/linkedin\.com$/.test(u.hostname) && u.pathname.startsWith('/safety/go')) return u.searchParams.get('url');
      if (!/linkedin\.com$/.test(u.hostname)) return u.toString();
    } catch { /* not a URL */ }
    return null;
  },
};

// ── runners ───────────────────────────────────────────────────────────────────────────────────

/** Indeed: open each non-Easy-Apply job, click "Apply on company site", read the new tab's URL. */
export async function harvestIndeed(driver, cfg = {}, { pacer, log = () => {} } = {}) {
  const out = [];
  for (const query of cfg.queries || ['software engineer']) {
    for (let page = 0; page < (cfg.pages || 1); page++) {
      await driver.goto(indeed.searchUrl({ query, location: cfg.location || 'Remote', start: page * 10, days: cfg.days }));
      await guard(driver, 'indeed');
      const cards = (await driver.evaluate(indeed.cards)).filter((c) => !c.easy);
      log(`indeed: "${query}" page ${page + 1}: ${cards.length} external card(s)`);
      for (const c of cards.slice(0, cfg.limit || 15)) {
        if (pacer) await pacer.betweenRequests();
        await driver.goto(indeed.jobUrl(c.id));
        await guard(driver, 'indeed');
        const sel = await driver.evaluate(indeed.externalControl);
        if (!sel) continue;
        const description = await driver.evaluate(indeed.description);
        const target = await driver.popupFrom(sel);
        if (!target || /indeed\.com/i.test(target)) continue;
        const hit = await resolveToAts(target).catch(() => null);
        out.push({ source: 'indeed', sourceUrl: indeed.jobUrl(c.id), atsUrl: hit?.atsUrl || target, company: c.company, title: c.title, location: c.location, description });
      }
    }
  }
  return out;
}

/** ZipRecruiter: open each card's pane and keep only panes with an outbound redirect. */
export async function harvestZip(driver, cfg = {}, { pacer, log = () => {} } = {}) {
  const out = [];
  for (const query of cfg.queries || ['software engineer']) {
    await driver.goto(ziprecruiter.searchUrl({ query, location: cfg.location || 'USA' }));
    await guard(driver, 'ziprecruiter');
    const cards = await driver.evaluate(ziprecruiter.cards);
    for (const c of cards.slice(0, cfg.limit || 15)) {
      if (pacer) await pacer.betweenRequests();
      await driver.call('press', c.selector);
      await driver.wait(2500);
      await guard(driver, 'ziprecruiter');
      const pane = await driver.evaluate(ziprecruiter.pane);
      if (!pane.external || pane.oneClick) continue;
      // The redirect is resolved at apply time, only for postings that pass the screen.
      out.push({ source: 'ziprecruiter', sourceUrl: pane.external, atsUrl: pane.external, company: pane.company, title: c.title, description: pane.description });
    }
    log(`ziprecruiter: "${query}": ${out.length} external posting(s) so far`);
  }
  return out;
}

export async function harvestWellfound(driver, cfg = {}, { pacer, log = () => {} } = {}) {
  const out = [];
  await driver.goto(wellfound.searchUrl({ role: cfg.role || 'software-engineer', remote: cfg.remote !== false }));
  await guard(driver, 'wellfound');
  if (await driver.evaluate(wellfound.signedOut)) throw new RunStop('signed_out', 'Wellfound search needs you signed in to Wellfound in the attached browser. ApplyRail never signs in.', { board: 'wellfound' });
  const cards = await driver.evaluate(wellfound.cards);
  for (const c of cards.slice(0, cfg.limit || 15)) {
    if (pacer) await pacer.betweenRequests();
    await driver.goto(c.url);
    await guard(driver, 'wellfound');
    const ext = await driver.evaluate(wellfound.external);
    if (ext.inDomain || !ext.url) continue;
    const hit = await resolveToAts(ext.url).catch(() => null);
    out.push({ source: 'wellfound', sourceUrl: c.url, atsUrl: hit?.atsUrl || ext.url, title: c.title });
  }
  log(`wellfound: ${out.length} external posting(s)`);
  return out;
}

/** LinkedIn, only when enabled. Pacing is slow by default and any block stops the harvest. */
export async function harvestLinkedIn(driver, cfg = {}, { pacer, log = () => {} } = {}) {
  if (!cfg.enabled) { log('linkedin: off (set harvest.linkedin.enabled to true to opt in)'); return []; }
  const out = [];
  for (let page = 0; page < (cfg.pages || 1); page++) {
    await driver.goto(linkedin.searchUrl({ url: cfg.searchUrl || null, query: cfg.query || 'software engineer', start: page * 25 }));
    await guard(driver, 'linkedin');
    const cards = (await driver.evaluate(linkedin.cards)).filter((c) => !c.easy);
    for (const c of cards.slice(0, cfg.limit || 25)) {
      if (pacer) await pacer.betweenRequests();
      await driver.call('press', c.selector);
      await driver.wait(cfg.dwellMs || 12000);
      await guard(driver, 'linkedin');
      const target = await driver.evaluate(linkedin.external);
      if (!target) continue;
      const hit = await resolveToAts(target).catch(() => null);
      out.push({ source: 'linkedin', sourceUrl: `https://www.linkedin.com/jobs/view/${c.id}/`, atsUrl: hit?.atsUrl || target, title: c.title });
    }
    log(`linkedin: page ${page + 1}: ${out.length} external posting(s) so far`);
  }
  return out;
}
