// Pacing. Every delay and cap is a config value. Pacing limits how hard ApplyRail works a site.
// It is a rate limit and nothing else: it does not imitate a person and it does not hide the tool.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PACING = {
  actionDelayMs: [250, 900],          // between two field actions on one form
  betweenApplicationsMs: [20000, 60000],
  betweenRequestsMs: [1500, 4000],    // harvesters, between two HTTP requests to one host
  maxApplicationsPerDay: 40,
  maxPerPlatformPerDay: {},           // e.g. { "greenhouse": 20 }
  perEmployerConcurrency: 1,          // never two sessions on one employer at once
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Pacer {
  /**
   * @param {object} cfg pacing config, merged over DEFAULT_PACING
   * @param {object} [opts] { stateFile, random, sleep, now }
   */
  constructor(cfg = {}, opts = {}) {
    this.cfg = { ...DEFAULT_PACING, ...cfg };
    this.random = opts.random || Math.random;
    this.sleep = opts.sleep || sleep;
    this.now = opts.now || (() => new Date());
    this.stateFile = opts.stateFile || null;
    this.state = this.#load();
  }

  #load() {
    if (!this.stateFile) return { day: null, total: 0, perPlatform: {} };
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { return { day: null, total: 0, perPlatform: {} }; }
  }

  #save() {
    if (!this.stateFile) return;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  #today() {
    const day = this.now().toISOString().slice(0, 10);
    if (this.state.day !== day) this.state = { day, total: 0, perPlatform: {} };
    return this.state;
  }

  #pick([min, max]) {
    return Math.round(min + (max - min) * this.random());
  }

  action() { return this.sleep(this.#pick(this.cfg.actionDelayMs)); }
  betweenApplications() { return this.sleep(this.#pick(this.cfg.betweenApplicationsMs)); }
  betweenRequests() { return this.sleep(this.#pick(this.cfg.betweenRequestsMs)); }

  /** Is there budget left today for one more application on this platform? */
  canApply(platform) {
    const s = this.#today();
    if (s.total >= this.cfg.maxApplicationsPerDay) return { ok: false, why: `daily cap ${this.cfg.maxApplicationsPerDay} reached` };
    const cap = this.cfg.maxPerPlatformPerDay?.[platform];
    if (cap != null && (s.perPlatform[platform] || 0) >= cap) return { ok: false, why: `${platform} daily cap ${cap} reached` };
    return { ok: true };
  }

  /** Count one submitted application against today's caps. */
  record(platform) {
    const s = this.#today();
    s.total += 1;
    s.perPlatform[platform] = (s.perPlatform[platform] || 0) + 1;
    this.#save();
  }
}

/** A pacer with no delays, for tests and for filling local fixtures. */
export const instantPacer = (cfg = {}) =>
  new Pacer({ ...cfg, actionDelayMs: [0, 0], betweenApplicationsMs: [0, 0], betweenRequestsMs: [0, 0] }, { sleep: async () => {} });
