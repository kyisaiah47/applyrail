// A captcha, a block page or an anti-automation question is a stop, never a bypass.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { jsdomDriver } from '../src/formfill/drivers.js';
import { applyToForm } from '../src/ats/apply.js';
import { drain } from '../src/ats/drain.js';
import { Queue } from '../src/queue.js';
import { instantPacer } from '../src/pacing.js';
import { blockSignal } from '../src/stop.js';
import { exampleStub } from '../examples/run-dry.mjs';
import { fixture, variant, example, jd, resumePdf, JOB, tmp } from './helpers.js';

const profile = example('profile.json');
const files = () => ({ resume: resumePdf(), coverLetter: null });

test('a visible captcha widget stops the run before anything is filled', async () => {
  const file = variant('lever', (h) => h.replace('data-size="invisible"', 'data-size="normal"'));
  const driver = await jsdomDriver();
  await assert.rejects(
    () => applyToForm({ driver, item: JOB, gotoUrl: file, profile, files: files(), dry: true }),
    (e) => e.name === 'RunStop' && e.kind === 'captcha',
  );
  await driver.close();
});

test('a block page stops the run', async () => {
  const file = variant('greenhouse', (h) => h.replace('<h1>Senior Full-Stack Engineer</h1>', '<h1>Access denied</h1><p>Unusual traffic from your network.</p>'));
  const driver = await jsdomDriver();
  await assert.rejects(
    () => applyToForm({ driver, item: JOB, gotoUrl: file, profile, files: files(), dry: true }),
    (e) => e.name === 'RunStop' && e.kind === 'block',
  );
  await driver.close();
  assert.equal(blockSignal({ status: 429 }), 'HTTP 429 Too Many Requests');
});

test('an anti-automation question skips the job and fills nothing', async () => {
  const q = '<div class="field-wrapper"><label for="q9">Here is some text encoded in a common format. Figure out the correct secret and submit it below: SGVsbG9Xb3JsZDEyMzQ1Njc4OTA=<span class="required">*</span></label><input id="q9" type="text" aria-required="true"></div>';
  const file = variant('greenhouse', (h) => h.replace('<div class="grecaptcha-badge"', `${q}<div class="grecaptcha-badge"`));
  const driver = await jsdomDriver();
  const r = await applyToForm({ driver, item: JOB, gotoUrl: file, profile, files: files(), dry: true });
  assert.equal(r.state, 'skipped');
  assert.match(r.reason, /asks applicants not to use automation/);
  assert.equal(driver.window.document.getElementById('first_name').value, '', 'nothing was filled');
  await driver.close();
});

test('the drain marks the item stopped, ends the run, and leaves the rest queued', async () => {
  const q = new Queue(path.join(tmp(), 'queue.jsonl'));
  const captcha = variant('lever', (h) => h.replace('data-size="invisible"', 'data-size="normal"'));
  q.add([
    { source: 'test', atsUrl: pathToFileURL(fixture('greenhouse')).href, company: 'Alpha', title: 'Senior Engineer', location: 'Remote', description: jd() },
    { source: 'test', atsUrl: pathToFileURL(captcha).href, company: 'Bravo', title: 'Senior Engineer', location: 'Remote', description: jd() },
    { source: 'test', atsUrl: pathToFileURL(fixture('ashby')).href, company: 'Charlie', title: 'Senior Engineer', location: 'Remote', description: jd() },
  ]);
  const r = await drain({
    queue: q, makeDriver: () => jsdomDriver(), profile, files: files(), provider: exampleStub(),
    pacer: instantPacer(), dry: true, config: { width: 1 },
  });
  const byCompany = Object.fromEntries(q.read().map((i) => [i.company, i.state]));
  assert.equal(byCompany.Alpha, 'dry_filled');
  assert.equal(byCompany.Bravo, 'stopped');
  assert.equal(byCompany.Charlie, 'queued', 'nothing runs after a stop');
  assert.equal(r.stop.kind, 'captcha');
});
