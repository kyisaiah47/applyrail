// applyrail.config.json: where the user's files are, which model to use, and which sources,
// lanes and caps are on. Paths are relative to the config file.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PACING } from './pacing.js';
import { DEFAULT_SCREEN } from './screen.js';

export const DEFAULT_CONFIG = {
  profile: 'profile.json',
  resume: 'resume.json',
  bank: null,
  files: { resume: null, coverLetter: null },
  dataDir: '.applyrail',
  model: { provider: 'none' },
  pacing: DEFAULT_PACING,
  screen: DEFAULT_SCREEN,
  harvest: {
    companies: { enabled: true, companies: [] },
    yc: { enabled: false, limit: 50 },
    anywhere: { enabled: true, boards: ['remoteok', 'workingnomads'], worldwideOnly: false, resolveLimit: 25 },
    dice: { enabled: false, queries: ['software engineer'], pages: 1, limit: 20 },
    indeed: { enabled: false, queries: ['software engineer'], location: 'Remote', pages: 1, limit: 10 },
    ziprecruiter: { enabled: false, queries: ['software engineer'], limit: 10 },
    wellfound: { enabled: false, role: 'software-engineer', limit: 10 },
    linkedin: { enabled: false, query: 'software engineer', pages: 1, limit: 25, dwellMs: 15000 },
  },
  drain: { width: 1, tailor: true, modelReview: false, allowAccountHosts: false, platforms: null },
  boardLanes: {
    indeed: { enabled: false }, ziprecruiter: { enabled: false }, wellfound: { enabled: false }, dice: { enabled: false }, yc: { enabled: false },
  },
  browser: { cdpUrl: null, headless: true },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Load the config and everything it points to. */
export function loadConfig(file = 'applyrail.config.json') {
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  const raw = fs.existsSync(abs) ? readJson(abs) : {};
  const cfg = merge(DEFAULT_CONFIG, raw);
  const at = (p) => (p ? path.resolve(dir, p) : null);
  cfg.dir = dir;
  cfg.file = fs.existsSync(abs) ? abs : null;
  cfg.paths = {
    profile: at(cfg.profile),
    resume: at(cfg.resume),
    bank: at(cfg.bank),
    resumePdf: at(cfg.files?.resume),
    coverLetter: at(cfg.files?.coverLetter),
    data: at(cfg.dataDir),
  };
  cfg.paths.queue = path.join(cfg.paths.data, 'queue.jsonl');
  cfg.paths.pacing = path.join(cfg.paths.data, 'pacing.json');
  cfg.paths.answers = path.join(cfg.paths.data, 'answers-cache.json');
  cfg.paths.resumes = path.join(cfg.paths.data, 'resumes');
  cfg.paths.tokens = path.join(cfg.paths.data, 'yc-tokens.json');
  cfg.paths.anywhereState = path.join(cfg.paths.data, 'anywhere-state.json');
  return cfg;
}

export function loadProfile(cfg) {
  if (!cfg.paths.profile || !fs.existsSync(cfg.paths.profile)) throw new Error(`no profile at ${cfg.paths.profile}; run applyrail init`);
  return readJson(cfg.paths.profile);
}

export function loadResume(cfg) {
  return cfg.paths.resume && fs.existsSync(cfg.paths.resume) ? readJson(cfg.paths.resume) : null;
}

export function loadBank(cfg) {
  return cfg.paths.bank && fs.existsSync(cfg.paths.bank) ? readJson(cfg.paths.bank) : {};
}

/** A Map persisted to a JSON file, for the answers cache. */
export function fileMap(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1)); },
  };
}

/** Required profile keys, and the ones most forms ask for. */
export const PROFILE_REQUIRED = ['firstName', 'lastName', 'email', 'phone', 'location', 'workAuthorized', 'requiresSponsorship'];
export function profileGaps(profile) {
  return PROFILE_REQUIRED.filter((k) => profile[k] === undefined || profile[k] === null || profile[k] === '');
}
