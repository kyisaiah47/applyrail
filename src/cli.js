#!/usr/bin/env node
// applyrail: the command line.
//
//   applyrail init [dir]                      write a starter config, profile and resume
//   applyrail doctor                          check the config, the profile and the model settings
//   applyrail harvest [--only a,b] [--cdp u]  run the harvesters and queue what passes the screen
//   applyrail queue [stats|list|add <url>|show <id>|retry <id>]
//   applyrail drain --dry|--submit [--limit n] [--cdp u] [--headed]
//   applyrail apply <url> --dry|--submit      add one URL to the queue and apply to it
//   applyrail fill <file.html> [--job jd.txt] fill a local HTML form in --dry mode and print the review
//   applyrail tailor --job <jd.txt> [--title t] [--company c]
//   applyrail lane <board> --dry|--submit --cdp <url>
//   applyrail new-app <dir> --app console|simple|both
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadProfile, loadResume, loadBank, fileMap, profileGaps } from './config.js';
import { Queue, STATES } from './queue.js';
import { Pacer } from './pacing.js';
import { createProvider } from './providers/index.js';
import { runHarvest } from './harvest/index.js';
import { drain } from './ats/drain.js';
import { applyToForm } from './ats/apply.js';
import { jsdomDriver, browserDriver } from './formfill/drivers.js';
import { tailorResume, renderMaster } from './resume/tailor.js';
import { runBoardLane, LANES } from './boards/lanes.js';
import { scaffoldApp } from './app/scaffold.js';
import { formatReview } from './review/presubmit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const log = (line) => process.stdout.write(`${line}\n`);

function mode(flags) {
  if (flags.dry && flags.submit) throw new Error('pass --dry or --submit, not both');
  if (!flags.dry && !flags.submit) throw new Error('pass --dry to fill and review without submitting, or --submit to submit');
  return { dry: !!flags.dry };
}

function setup(flags) {
  const cfg = loadConfig(flags.config || 'applyrail.config.json');
  const profile = loadProfile(cfg);
  const provider = createProvider(cfg.model);
  const pacer = new Pacer(cfg.pacing, { stateFile: cfg.paths.pacing });
  const queue = new Queue(cfg.paths.queue);
  return { cfg, profile, provider, pacer, queue };
}

function files(cfg) {
  let resume = cfg.paths.resumePdf;
  if (!resume) {
    const master = loadResume(cfg);
    if (master) resume = renderMaster(master, path.join(cfg.paths.resumes, 'master')).pdf;
  }
  return { resume, coverLetter: cfg.paths.coverLetter };
}

function makeDriverFactory(cfg, flags) {
  const cdpUrl = flags.cdp || cfg.browser.cdpUrl || null;
  const headless = flags.headed ? false : cfg.browser.headless !== false;
  return () => browserDriver({ cdpUrl, headless });
}

const commands = {
  async init({ pos }) {
    const dir = path.resolve(pos[0] || '.');
    fs.mkdirSync(dir, { recursive: true });
    const ex = path.join(HERE, '..', 'examples', 'jane-example');
    for (const f of ['applyrail.config.json', 'profile.json', 'resume.json', 'bank.json']) {
      const to = path.join(dir, f);
      if (fs.existsSync(to)) { log(`kept ${to} (already exists)`); continue; }
      fs.copyFileSync(path.join(ex, f), to);
      log(`wrote ${to}`);
    }
    log('Replace the example values with your own. Then run: applyrail doctor');
  },

  async doctor({ flags }) {
    const cfg = loadConfig(flags.config || 'applyrail.config.json');
    log(`config: ${cfg.file || '(none found; defaults in use)'}`);
    let profile = null;
    try { profile = loadProfile(cfg); log(`profile: ${cfg.paths.profile}`); } catch (e) { log(`profile: MISSING (${e.message})`); }
    if (profile) {
      const gaps = profileGaps(profile);
      log(gaps.length ? `profile gaps: ${gaps.join(', ')}` : 'profile: required keys present');
    }
    log(`resume: ${loadResume(cfg) ? cfg.paths.resume : 'none (tailoring off)'}`);
    const m = cfg.model || {};
    log(`model: ${m.provider || 'none'}${m.model ? ` ${m.model}` : ''}${m.baseURL ? ` at ${m.baseURL}` : ''}`);
    if (m.apiKeyEnv) log(`model key variable: ${m.apiKeyEnv} is ${process.env[m.apiKeyEnv] ? 'set' : 'NOT set'}`);
    for (const pkg of ['puppeteer', 'jsdom']) {
      try { await import(pkg); log(`${pkg}: installed`); } catch { log(`${pkg}: not installed${pkg === 'puppeteer' ? ' (needed to fill live forms: npm install puppeteer)' : ' (needed for local fixtures: npm install jsdom)'}`); }
    }
    const on = Object.entries(cfg.harvest).filter(([k, v]) => v && v.enabled && (k !== 'linkedin' || v.enabled === true)).map(([k]) => k);
    log(`harvest sources on: ${on.join(', ') || 'none'}`);
    const lanes = Object.entries(cfg.boardLanes).filter(([, v]) => v.enabled === true).map(([k]) => k);
    log(`board lanes on: ${lanes.join(', ') || 'none'}`);
  },

  async harvest({ flags }) {
    const { cfg, provider, pacer, queue } = setup(flags);
    const only = flags.only ? String(flags.only).split(',') : null;
    const hc = { ...cfg.harvest, yc: { ...cfg.harvest.yc, cacheFile: cfg.paths.tokens }, anywhere: { ...cfg.harvest.anywhere, stateFile: cfg.paths.anywhereState } };
    const needsBrowser = ['indeed', 'ziprecruiter', 'wellfound', 'linkedin'].some((n) => (only ? only.includes(n) : cfg.harvest[n]?.enabled));
    const makeDriver = needsBrowser && (flags.cdp || cfg.browser.cdpUrl) ? makeDriverFactory(cfg, flags) : null;
    const r = await runHarvest({ config: hc, screen: cfg.screen, queue, only, makeDriver, provider, pacer, log });
    if (r.stop) { log(`harvest stopped by ${r.stop.source}: ${r.stop.kind}: ${r.stop.detail}`); process.exitCode = 3; }
  },

  async queue({ pos, flags }) {
    const cfg = loadConfig(flags.config || 'applyrail.config.json');
    const queue = new Queue(cfg.paths.queue);
    const sub = pos[0] || 'stats';
    if (sub === 'stats') { const s = queue.stats(); for (const k of Object.keys(STATES)) if (s[k]) log(`${k.padEnd(15)} ${s[k]}  ${STATES[k]}`); if (!Object.keys(s).length) log('the queue is empty'); return; }
    if (sub === 'list') { for (const i of queue.read().filter((x) => !flags.state || x.state === flags.state)) log(`${i.id}  ${i.state.padEnd(14)} ${(i.platform || '').padEnd(11)} ${(i.company || '?').slice(0, 24).padEnd(24)} ${(i.title || '?').slice(0, 40)}`); return; }
    if (sub === 'add') { const r = queue.add([{ source: 'manual', atsUrl: pos[1], company: flags.company, title: flags.title }]); log(r.added.length ? `added ${r.added[0].id}` : 'already in the queue'); return; }
    if (sub === 'show') { log(JSON.stringify(queue.get(pos[1]), null, 2)); return; }
    if (sub === 'retry') { const i = queue.transition(pos[1], 'queued', 'retry requested'); log(`${i.id} is queued again`); return; }
    throw new Error(`unknown queue command ${sub}`);
  },

  async drain({ flags }) {
    const { dry } = mode(flags);
    const { cfg, profile, provider, pacer, queue } = setup(flags);
    const r = await drain({
      queue, profile, files: files(cfg), provider, pacer, dry, log,
      resume: loadResume(cfg), bank: loadBank(cfg), answersCache: fileMap(cfg.paths.answers),
      config: { ...cfg.drain, screen: cfg.screen, outDir: cfg.paths.resumes },
      makeDriver: makeDriverFactory(cfg, flags),
      limit: flags.limit ? Number(flags.limit) : Infinity,
    });
    const tally = {};
    for (const x of r.results) tally[x.state] = (tally[x.state] || 0) + 1;
    log(`drain done: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to do'}`);
    if (r.stop) { log(`stopped: ${r.stop.kind}: ${r.stop.detail}`); process.exitCode = 3; }
  },

  async apply({ pos, flags }) {
    if (!pos[0]) throw new Error('usage: applyrail apply <url> --dry|--submit');
    const { cfg } = setup(flags);
    const queue = new Queue(cfg.paths.queue);
    const { added } = queue.add([{ source: 'manual', atsUrl: pos[0], company: flags.company, title: flags.title }]);
    const id = added[0]?.id;
    if (!id) { log('this URL is already in the queue; use applyrail queue retry <id> to queue it again'); return; }
    await commands.drain({ flags: { ...flags, limit: 1 } });
  },

  async fill({ pos, flags }) {
    if (!pos[0]) throw new Error('usage: applyrail fill <file.html> [--job jd.txt]');
    const cfg = loadConfig(flags.config || 'applyrail.config.json');
    const profile = loadProfile(cfg);
    const driver = await jsdomDriver();
    const job = { atsUrl: `file://${path.resolve(pos[0])}`, company: flags.company || null, title: flags.title || null, description: flags.job ? fs.readFileSync(flags.job, 'utf8') : null };
    try {
      const r = await applyToForm({ driver, item: job, gotoUrl: path.resolve(pos[0]), profile, files: files(cfg), provider: createProvider(cfg.model), dry: true, log });
      for (const a of r.fill?.actions || []) log(`  ${a.ok ? 'ok ' : 'BAD'} ${a.label.slice(0, 50).padEnd(50)} ${String(a.value ?? '').slice(0, 60)}`);
      for (const u of r.fill?.unanswered || []) log(`  ??? ${u.label}: ${u.reason}`);
      if (r.review) log(formatReview(r.review));
      log(`${r.state}: ${r.reason}`);
    } finally { await driver.close(); }
  },

  async tailor({ flags }) {
    const cfg = loadConfig(flags.config || 'applyrail.config.json');
    const resume = loadResume(cfg);
    if (!resume) throw new Error(`no master resume at ${cfg.paths.resume}`);
    if (!flags.job) throw new Error('usage: applyrail tailor --job <jd.txt> [--title t] [--company c]');
    const job = { title: flags.title || '', company: flags.company || '', description: fs.readFileSync(flags.job, 'utf8') };
    const r = await tailorResume({ resume, bank: loadBank(cfg), job, provider: createProvider(cfg.model), outDir: flags.out || cfg.paths.resumes, reuse: !flags.fresh });
    log(`${r.status}: ${r.files.pdf}`);
    for (const p of r.problems) log(`  ${p}`);
  },

  async lane({ pos, flags }) {
    const board = pos[0];
    if (!LANES[board]) throw new Error(`usage: applyrail lane <${Object.keys(LANES).join('|')}> --dry|--submit --cdp <url>`);
    const { dry } = mode(flags);
    const { cfg, profile, provider, pacer, queue } = setup(flags);
    const cdpUrl = flags.cdp || cfg.browser.cdpUrl;
    if (!cdpUrl) throw new Error('a board lane runs in your own signed-in Chrome: start Chrome with --remote-debugging-port=9222 and pass --cdp http://127.0.0.1:9222');
    const driver = await browserDriver({ cdpUrl });
    try {
      const r = await runBoardLane({ board, driver, config: cfg.boardLanes[board], queue, profile, files: files(cfg), provider, pacer, dry, log });
      log(`${board} lane done: ${r.results.length} application(s) handled`);
      if (r.stop) process.exitCode = 3;
    } finally { await driver.close(); }
  },

  async 'new-app'({ pos, flags }) {
    const dir = pos[0];
    if (!dir) throw new Error('usage: applyrail new-app <dir> --app console|simple|both');
    const r = scaffoldApp({ dir: path.resolve(dir), app: flags.app || 'both', queueFile: flags.queue || null });
    log(`wrote ${r.files.length} files to ${r.dir} (${r.app})`);
    log(`next: cd ${dir} && npm install && npm run dev`);
  },

  async help() {
    log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   applyrail')).map((l) => l.slice(5)).join('\n'));
  },
};

const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = pos.shift() || 'help';
const fn = commands[cmd] || commands.help;
fn({ pos, flags }).catch((e) => { process.stderr.write(`applyrail ${cmd}: ${e.message}\n`); process.exitCode = 1; });
