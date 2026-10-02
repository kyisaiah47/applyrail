// Run the configured harvesters, screen what they find, and queue the keepers.
import { harvestCompanies, harvestYc, harvestAnywhere, harvestDice } from './sources.js';
import { harvestIndeed, harvestZip, harvestWellfound, harvestLinkedIn } from './boards.js';
import { screenPosting, screenWithModel } from '../screen.js';
import { isRunStop } from '../stop.js';

export const HTTP_SOURCES = { companies: harvestCompanies, yc: harvestYc, anywhere: harvestAnywhere, dice: harvestDice };
export const BROWSER_SOURCES = { indeed: harvestIndeed, ziprecruiter: harvestZip, wellfound: harvestWellfound, linkedin: harvestLinkedIn };

/**
 * @param {object} o
 * @param {object} o.config the `harvest` section of applyrail.config.json
 * @param {import('../queue.js').Queue} o.queue
 * @param {string[]} [o.only] run only these sources
 * @param {() => Promise<object>} [o.makeDriver] needed by the browser sources
 * @returns {Promise<{ found, kept, added, duplicates, screened, stop }>}
 */
export async function runHarvest({ config = {}, screen = {}, queue, only = null, makeDriver = null, provider = null, pacer = null, log = () => {} }) {
  const enabled = (name) => (only ? only.includes(name) : !!config[name] && config[name].enabled !== false && (name !== 'linkedin' || config.linkedin?.enabled === true));
  const found = [];
  let stop = null;

  for (const [name, fn] of Object.entries(HTTP_SOURCES)) {
    if (!enabled(name)) continue;
    try { found.push(...await fn(config[name] || {}, { pacer, log })); } catch (e) {
      if (isRunStop(e)) { stop = { source: name, kind: e.kind, detail: e.detail }; log(`STOP ${name}: ${e.detail}`); break; }
      log(`${name}: failed: ${e.message}`);
    }
  }

  const browserNames = Object.keys(BROWSER_SOURCES).filter(enabled);
  if (!stop && browserNames.length) {
    if (!makeDriver) {
      log(`skipping ${browserNames.join(', ')}: these read boards in your own browser; pass --cdp <url> to attach to it`);
    } else {
      for (const name of browserNames) {
        if (name === 'linkedin' && config.linkedin?.enabled !== true) { log('linkedin: off'); continue; }
        const driver = await makeDriver();
        try { found.push(...await BROWSER_SOURCES[name](driver, { ...(config[name] || {}), enabled: name === 'linkedin' ? config.linkedin?.enabled === true : true }, { pacer, log })); } catch (e) {
          if (isRunStop(e)) { stop = { source: name, kind: e.kind, detail: e.detail }; log(`STOP ${name}: ${e.detail}. The harvest ends here.`); break; }
          log(`${name}: failed: ${e.message}`);
        } finally { await driver.close().catch(() => {}); }
      }
    }
  }

  const kept = [];
  const screened = [];
  for (const p of found) {
    const r = screenPosting(p, screen);
    if (!r.keep) { screened.push({ title: p.title, company: p.company, why: r.why }); continue; }
    const m = await screenWithModel(p, provider, screen);
    if (m && !m.keep) { screened.push({ title: p.title, company: p.company, why: `model: ${m.why}` }); continue; }
    kept.push(p);
  }
  const { added, duplicates } = queue.add(kept);
  log(`harvest: found ${found.length}, kept ${kept.length}, queued ${added.length} new, ${duplicates} already in the queue`);
  return { found: found.length, kept: kept.length, added: added.length, duplicates, screened, stop };
}
