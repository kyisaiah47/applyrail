// One application, start to finish: open the employer's form, fill it, review it, repair what
// the review blocked, review again, and submit only on a passing review. In --dry mode it stops
// after the review and submits nothing.
import { platformFor, LONGTAIL } from './platforms.js';
import { fillForm, applyDecision, assertClear } from '../formfill/fill.js';
import { resolveFields } from '../answers/resolve.js';
import { challengesIn } from '../answers/challenge.js';
import { reviewForm, formatReview } from '../review/presubmit.js';
import { RunStop } from '../stop.js';

const MAX_STEPS = 8;

async function repair(driver, fill, blockers, pacer) {
  let touched = 0;
  for (const b of blockers) {
    if (!b.selector) continue;
    const i = fill.fields.findIndex((f) => f.selector === b.selector);
    if (i < 0) continue;
    const d = fill.decisions[i];
    if (!d || d.action === 'none' || d.action === 'skip') continue;
    if (pacer) await pacer.action();
    if (d.action === 'text') await driver.call('setText', fill.fields[i].selector, '');
    await applyDecision(driver, fill.fields[i], d);
    touched++;
  }
  return touched;
}

/**
 * @param {object} a
 * @param {object} a.driver a page driver
 * @param {object} a.item a queue item, or { atsUrl, company, title, description }
 * @param {object} a.profile
 * @param {object} a.files { resume, coverLetter }
 * @param {object} [a.provider]
 * @param {object} [a.pacer]
 * @param {boolean} [a.dry=true]
 * @param {boolean} [a.modelReview=false] add the model layer to the presubmit review
 * @param {boolean} [a.allowAccountHosts=false] fill Workday or iCIMS in a browser where the user is signed in
 * @param {Map} [a.answersCache]
 * @param {string} [a.resumeText]
 * @returns {Promise<{ state, reason, fill?, review?, steps }>}
 */
export async function applyToForm(a) {
  const { driver, item, profile, files = {}, provider = null, pacer = null, dry = true, modelReview = false,
    allowAccountHosts = false, answersCache = null, resumeText = '', log = () => {}, maxRepairs = 2, gotoUrl = null, onPage = false } = a;
  const platform = onPage ? { name: item.platform || 'board', applyUrl: (u) => u } : (platformFor(item.atsUrl) || LONGTAIL);
  const where = { platform: platform.name, url: item.atsUrl };

  if (platform.accountRequired && !allowAccountHosts) {
    return { state: 'manual', reason: `${platform.name} needs a candidate account on the employer's site; ApplyRail never creates accounts or signs in`, steps: 0 };
  }

  const target = gotoUrl || platform.applyUrl(item.atsUrl);
  if (!onPage) {
    const nav = await driver.goto(target);
    if (nav.status === 404 || nav.status === 410) return { state: 'closed', reason: `HTTP ${nav.status} at ${target}`, steps: 0 };
    if (nav.status === 429) throw new RunStop('rate_limit', `HTTP 429 at ${target}`, where);
  }
  await assertClear(driver, where);

  const job = { company: item.company, title: item.title, description: item.description, url: item.atsUrl };
  const resolve = (fields) => resolveFields(fields, profile, { files, job, provider, cache: answersCache, resumeText });

  let steps = 0;
  let fill = null;
  let review = null;
  for (;;) {
    steps++;
    const first = await driver.call('mapForm', null);
    if (!first.fields.length) {
      return { state: steps === 1 ? 'failed' : 'manual', reason: steps === 1 ? `no form found at ${target}` : 'a step after the first shows no form', steps, fill, review };
    }
    const challenges = challengesIn(first.fields);
    if (challenges.length) {
      return { state: 'skipped', reason: `the employer asks applicants not to use automation: "${challenges[0].text.slice(0, 200)}"`, steps };
    }

    fill = await fillForm(driver, { resolve, pacer, log });
    if (fill.unanswered.length) {
      return { state: 'needs_input', reason: `required question(s) with no answer in the profile: ${fill.unanswered.map((u) => `"${u.label}" (${u.reason})`).join('; ')}`, fill, steps };
    }

    review = await reviewForm(fill.after, { profile, files, job, provider, modelReview });
    log(formatReview(review));
    for (let round = 1; !review.ok && round <= maxRepairs; round++) {
      const touched = await repair(driver, fill, review.blockers, pacer);
      if (!touched) break;
      fill.after = await driver.call('readForm', null);
      review = await reviewForm(fill.after, { profile, files, job, provider, modelReview });
      log(`after repair round ${round}: ${formatReview(review)}`);
    }
    if (!review.ok) return { state: 'review_blocked', reason: formatReview(review), fill, review, steps };

    if (dry) {
      return { state: 'dry_filled', reason: `filled and reviewed step ${steps}; --dry, nothing was submitted${fill.submit?.submit ? '' : ' and no further step was opened'}`, fill, review, steps };
    }

    await assertClear(driver, where);
    const controls = await driver.call('findSubmit', null);
    if (controls.submit) {
      await driver.call('press', controls.submit.selector);
      await driver.wait(5000);
      await assertClear(driver, where);
      const conf = await driver.call('confirmation');
      if (conf) return { state: 'submitted', reason: `confirmation on the page: "${conf}"`, fill, review, steps };
      const errs = await driver.call('errorsShown');
      if (errs.length) return { state: 'failed', reason: `the form showed errors after submit: ${errs.join('; ').slice(0, 300)}`, fill, review, steps };
      return { state: 'submitted', reason: 'submitted with no confirmation text on the page; it is counted as submitted and never retried', fill, review, steps, unconfirmed: true };
    }
    if (controls.next && steps < MAX_STEPS) {
      await driver.call('press', controls.next.selector);
      await driver.wait(3000);
      await assertClear(driver, where);
      continue;
    }
    return { state: 'manual', reason: 'no submit or next button was found', fill, review, steps };
  }
}
