// Board lanes: applying through a board's own apply flow (Indeed Apply, ZipRecruiter 1-Click,
// Wellfound, Dice Easy Apply, YC Work at a Startup). Every lane is OFF unless the config turns it
// on, because each board's terms restrict automation; the README quotes each clause. The person
// running a lane carries the risk to their own account.
//
// A lane runs in the user's own Chrome, attached over CDP, where the user has signed in to the
// board themselves. ApplyRail never signs in. A sign-in wall, a captcha or a block page stops
// the lane. LinkedIn Easy Apply is not a lane and is not part of ApplyRail.
//
// Each lane uses the same form filler, the same answers and the same presubmit review as the
// ATS drain, and records every application in the same queue, so a job is never applied to twice.
import { RunStop } from '../stop.js';
import { applyToForm } from '../ats/apply.js';
import { screenPosting } from '../screen.js';
import { pageBlocked } from '../harvest/boards.js';

function controlByText(doc, re) {
  const el = [...doc.querySelectorAll('button, a, [role="button"]')].find((e) => re.test(`${e.getAttribute('aria-label') || ''} ${e.textContent || ''}`.trim()));
  if (!el) return null;
  el.setAttribute('data-applyrail-apply', '1');
  return '[data-applyrail-apply="1"]';
}

export const LANES = {
  indeed: {
    name: 'indeed',
    searchUrl: ({ query, location = 'Remote', start = 0 }) => `https://www.indeed.com/jobs?${new URLSearchParams({ q: query, l: location, ...(start ? { start: String(start) } : {}) })}`,
    jobUrl: (id) => `https://www.indeed.com/viewjob?jk=${id}`,
    cards(doc) {
      const out = []; const seen = new Set();
      for (const a of doc.querySelectorAll('a[data-jk], a.jcs-JobTitle')) {
        const jk = a.getAttribute('data-jk') || ((a.getAttribute('href') || '').match(/[?&]jk=([0-9a-f]+)/i) || [])[1];
        const card = a.closest('.job_seen_beacon, [data-testid="slider_item"], li');
        if (!jk || !card || seen.has(jk)) continue;
        seen.add(jk);
        out.push({ id: jk, title: (a.textContent || '').trim(), native: /easily apply/i.test(card.textContent || '') });
      }
      return out;
    },
    applyControl: (doc) => controlByText(doc, /^apply now$|^apply$|indeed apply/i),
    signedOut: (doc) => !!doc.querySelector('a[href*="/account/login"], a[href*="secure.indeed.com/auth"]'),
  },
  ziprecruiter: {
    name: 'ziprecruiter',
    searchUrl: ({ query, location = 'USA' }) => `https://www.ziprecruiter.com/jobs-search?${new URLSearchParams({ search: query, location, refine_by_location_type: 'only_remote', refine_by_apply_type: 'has_zipapply' })}`,
    cards(doc) {
      return [...doc.querySelectorAll('button[aria-label^="View "]')].map((b, i) => {
        b.setAttribute('data-applyrail-card', String(i));
        return { id: `${i}`, selector: `[data-applyrail-card="${i}"]`, title: (b.getAttribute('aria-label') || '').replace(/^View\s+/, ''), native: true };
      });
    },
    applyControl: (doc) => { const b = doc.querySelector('button[aria-label*="1-Click Apply" i]'); if (!b) return null; b.setAttribute('data-applyrail-apply', '1'); return '[data-applyrail-apply="1"]'; },
    signedOut: (doc) => !!doc.querySelector('a[href*="/login"]') && !doc.querySelector('[data-testid*="user" i], [aria-label*="account" i]'),
  },
  wellfound: {
    name: 'wellfound',
    searchUrl: ({ role = 'software-engineer' }) => `https://wellfound.com/role/r/${role}`,
    cards(doc) {
      const out = []; const seen = new Set();
      for (const a of doc.querySelectorAll('a[href*="/jobs/"]')) {
        const m = (a.getAttribute('href') || '').match(/\/jobs\/(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ id: m[1], url: new URL(a.getAttribute('href'), 'https://wellfound.com').toString(), title: (a.textContent || '').trim(), native: true });
      }
      return out;
    },
    applyControl: (doc) => controlByText(doc, /^apply$|^apply now$/i),
    signedOut: (doc) => /\/login\b/.test(String(doc.location && doc.location.pathname || '')) || !!doc.querySelector('a[href="/login"]'),
  },
  dice: {
    name: 'dice',
    searchUrl: ({ query }) => `https://www.dice.com/jobs?${new URLSearchParams({ q: query, 'filters.workplaceTypes': 'Remote', 'filters.easyApply': 'true' })}`,
    cards(doc) {
      const out = []; const seen = new Set();
      for (const a of doc.querySelectorAll('a[href*="/job-detail/"]')) {
        const m = (a.getAttribute('href') || '').match(/\/job-detail\/([0-9a-f-]{36})/i);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        const card = a.closest('[data-testid*="card" i], article, li') || a.parentElement;
        out.push({ id: m[1], url: `https://www.dice.com/job-detail/${m[1]}`, title: (a.textContent || '').trim(), native: /easy apply/i.test(card ? card.textContent : '') });
      }
      return out;
    },
    applyControl: (doc) => controlByText(doc, /^easy apply$|continue application/i),
    signedOut: (doc) => /\/(dashboard\/)?login\b/.test(String(doc.location && doc.location.pathname || '')),
  },
  yc: {
    name: 'yc',
    // On Work at a Startup the application is a message to the founder. The message is written
    // by the user's model from the profile and the posting, and goes through the same review.
    searchUrl: () => 'https://www.workatastartup.com/companies?demographic=any&hasEquity=any&hasSalary=any&industry=any&interviewProcess=any&jobType=fulltime&layout=list-compact&remote=yes&role=eng&sortBy=created_desc&tab=any&usVisaNotRequired=any',
    cards(doc) {
      const out = []; const seen = new Set();
      for (const a of doc.querySelectorAll('a[href*="/jobs/"]')) {
        const m = (a.getAttribute('href') || '').match(/\/jobs\/(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ id: m[1], url: `https://www.workatastartup.com/jobs/${m[1]}`, title: (a.textContent || '').trim(), native: true });
      }
      return out;
    },
    applyControl: (doc) => controlByText(doc, /^apply$|^apply to /i),
    signedOut: (doc) => !!doc.querySelector('a[href*="/account/login"], a[href*="account.ycombinator.com"]') && !doc.querySelector('a[href*="/logout"]'),
  },
};

const sleepish = (driver, ms) => driver.wait(ms);

/**
 * Run one board lane.
 * @param {object} o
 * @param {string} o.board one of Object.keys(LANES)
 * @param {object} o.driver an attached browser driver (the user's own signed-in Chrome)
 * @param {object} o.config the lane's config: { enabled, queries, limit, screen }
 * @param {import('../queue.js').Queue} o.queue
 */
export async function runBoardLane(o) {
  const { board, driver, config = {}, queue, profile, files, provider = null, pacer, dry = true, log = () => {} } = o;
  const lane = LANES[board];
  if (!lane) throw new Error(`no board lane named ${board}`);
  if (config.enabled !== true) { log(`${board} lane: off (set boardLanes.${board}.enabled to true to opt in)`); return { results: [], stop: null }; }

  const results = [];
  const check = async () => {
    const block = await driver.evaluate(pageBlocked);
    if (block) throw new RunStop('block', block, { board });
    if (await driver.evaluate(lane.signedOut)) throw new RunStop('signed_out', `${board} shows a sign-in wall. Sign in yourself in the attached browser; ApplyRail never signs in.`, { board });
  };

  try {
    for (const query of config.queries || ['software engineer']) {
      await driver.goto(lane.searchUrl({ query, location: config.location }));
      await check();
      const cards = (await driver.evaluate(lane.cards)).filter((c) => c.native);
      log(`${board} lane: "${query}": ${cards.length} posting(s) with the board's own apply flow`);
      for (const c of cards.slice(0, config.limit || 5)) {
        const jobUrl = c.url || (lane.jobUrl ? lane.jobUrl(c.id) : null);
        if (!jobUrl && !c.selector) continue;
        const key = jobUrl || `${board}:${c.id}:${c.title}`;
        const { added } = queue.add([{ source: `${board}-lane`, sourceUrl: jobUrl, atsUrl: jobUrl || `https://${board}.invalid/${encodeURIComponent(key)}`, title: c.title, company: c.company || null }]);
        if (!added.length) continue;                       // already in the queue: never applied to twice
        const item = added[0];
        const screened = screenPosting({ title: c.title }, config.screen);
        if (!screened.keep) { queue.transition(item.id, 'screened_out', screened.why); continue; }

        queue.transition(item.id, 'filling', `${board} lane`);
        if (pacer) await pacer.betweenApplications();
        if (jobUrl) await driver.goto(jobUrl); else await driver.call('press', c.selector);
        await sleepish(driver, 2500);
        await check();
        const apply = await driver.evaluate(lane.applyControl);
        if (!apply) { queue.transition(item.id, 'skipped', `no ${board} apply control on the posting`); continue; }
        await driver.call('press', apply);
        await sleepish(driver, 3000);
        try {
          const r = await applyToForm({ driver, item: { ...item, platform: board }, onPage: true, profile, files, provider, pacer, dry, log });
          queue.transition(item.id, r.state, r.reason);
          if (r.state === 'submitted' && pacer) pacer.record(board);
          results.push({ id: item.id, state: r.state, reason: r.reason });
        } catch (e) {
          if (e?.name === 'RunStop') { queue.transition(item.id, 'stopped', `${e.kind}: ${e.detail}`); throw e; }
          queue.transition(item.id, 'failed', String(e.message || e).slice(0, 300));
        }
      }
    }
  } catch (e) {
    if (e?.name === 'RunStop') { log(`${board} lane STOP (${e.kind}): ${e.detail}`); return { results, stop: { kind: e.kind, detail: e.detail } }; }
    throw e;
  }
  return { results, stop: null };
}
