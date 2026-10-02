// The ATS drain. It leases queued items and applies to each one through applyToForm().
//
//   - One employer is never worked by two sessions at once (Queue.lease enforces it).
//   - `width` workers run in parallel, each with its own clean browser context.
//   - Pacing and daily caps come from the config.
//   - A captcha, a block page or a rate limit stops every worker. The item is marked `stopped`
//     with what was seen, and the run ends. Nothing retries into it.
//   - A write-once host (Workday, iCIMS) is attempted once and never retried.
import { applyToForm } from './apply.js';
import { platformFor } from './platforms.js';
import { isRunStop } from '../stop.js';
import { screenPosting } from '../screen.js';
import { tailorResume } from '../resume/tailor.js';

/**
 * @param {object} o
 * @param {import('../queue.js').Queue} o.queue
 * @param {() => Promise<object>} o.makeDriver a fresh page driver per application
 * @param {object} o.profile
 * @param {object} o.files { resume, coverLetter }
 * @param {object} [o.resume] master resume JSON, for tailoring
 * @param {object} [o.bank] fact bank, for tailoring
 * @param {object} [o.provider]
 * @param {import('../pacing.js').Pacer} o.pacer
 * @param {object} [o.config] { width, tailor, modelReview, allowAccountHosts, platforms, screen, outDir }
 * @param {boolean} [o.dry=true]
 * @param {number} [o.limit] stop after this many items
 * @param {(line:string)=>void} [o.log]
 */
export async function drain(o) {
  const { queue, makeDriver, profile, files, provider = null, pacer, config = {}, dry = true, limit = Infinity, log = () => {} } = o;
  const width = Math.max(1, Number(config.width) || 1);
  const results = [];
  let stop = null;
  let taken = 0;
  const answersCache = o.answersCache || new Map();

  async function one(item) {
    const job = { company: item.company, title: item.title, description: item.description, url: item.atsUrl };
    const screened = screenPosting(item, config.screen);
    if (!screened.keep) {
      queue.transition(item.id, 'screened_out', screened.why);
      return { id: item.id, state: 'screened_out', reason: screened.why };
    }
    const platform = platformFor(item.atsUrl);
    if (platform?.writeOnce && (item.attempts || 0) > 1) {
      queue.transition(item.id, 'manual', `${platform.name} is write-once; it was already attempted and is never retried`);
      return { id: item.id, state: 'manual' };
    }
    if (!dry) {
      const cap = pacer.canApply(item.platform);
      if (!cap.ok) { queue.transition(item.id, 'queued', cap.why); stop = stop || { kind: 'cap', detail: cap.why }; return { id: item.id, state: 'queued', reason: cap.why }; }
    }

    let jobFiles = files;
    let resumeText = '';
    if (config.tailor && o.resume) {
      const t = await tailorResume({ resume: o.resume, bank: o.bank || {}, job, provider, outDir: config.outDir || '.applyrail/resumes' });
      jobFiles = { ...files, resume: t.files.pdf };
      resumeText = JSON.stringify(t.resume);
      log(`resume for ${item.company}: ${t.status}${t.problems.length ? ` (${t.problems.join('; ')})` : ''}`);
    }

    const driver = await makeDriver(item);
    try {
      log(`applying: ${item.title || '?'} at ${item.company || '?'} (${item.platform}) ${item.atsUrl}`);
      const r = await applyToForm({
        driver, item, profile, files: jobFiles, provider, pacer, dry,
        modelReview: !!config.modelReview, allowAccountHosts: !!config.allowAccountHosts,
        answersCache, resumeText, log,
      });
      queue.transition(item.id, r.state, r.reason, { lastRun: { at: new Date().toISOString(), dry, steps: r.steps, review: r.review ? { ok: r.review.ok, by: r.review.by, blockers: r.review.blockers } : null, filled: r.fill ? r.fill.actions.length : 0 } });
      if (r.state === 'submitted') pacer.record(item.platform);
      log(`${r.state}: ${r.reason}`);
      return { id: item.id, state: r.state, reason: r.reason, review: r.review, fill: r.fill };
    } catch (e) {
      if (isRunStop(e)) {
        stop = { kind: e.kind, detail: e.detail, url: e.where?.url || item.atsUrl };
        queue.transition(item.id, 'stopped', `${e.kind}: ${e.detail}`);
        log(`STOP (${e.kind}): ${e.detail} at ${stop.url}. The run ends here; nothing retries into a captcha or a block.`);
        return { id: item.id, state: 'stopped', reason: `${e.kind}: ${e.detail}` };
      }
      queue.transition(item.id, 'failed', String(e.message || e).slice(0, 300));
      log(`failed: ${e.message}`);
      return { id: item.id, state: 'failed', reason: e.message };
    } finally {
      await driver.close().catch(() => {});
    }
  }

  async function worker() {
    while (!stop && taken < limit) {
      const [item] = queue.lease(1, { platforms: config.platforms || null });
      if (!item) return;
      taken++;
      results.push(await one(item));
      if (!stop) await pacer.betweenApplications();
    }
  }

  await Promise.all(Array.from({ length: width }, worker));
  return { results, stop };
}
