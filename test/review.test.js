// The presubmit review catches a wrong field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsdomDriver } from '../src/formfill/drivers.js';
import { fillForm } from '../src/formfill/fill.js';
import { resolveFields } from '../src/answers/resolve.js';
import { reviewForm, corruption, embeddedInstruction } from '../src/review/presubmit.js';
import { stubProvider, asProvider } from '../src/providers/index.js';
import { fixture, example, resumePdf, JOB } from './helpers.js';

const profile = example('profile.json');
const files = () => ({ resume: resumePdf(), coverLetter: null });

/** Fill the Greenhouse fixture, then hand back the driver and the filled form for tampering. */
async function filledGreenhouse() {
  const driver = await jsdomDriver();
  await driver.goto(fixture('greenhouse'));
  const fill = await fillForm(driver, { resolve: (f) => resolveFields(f, profile, { files: files(), job: JOB }) });
  return { driver, fill };
}
const field = (fill, re) => fill.fields.find((f) => re.test(f.label));

test('a clean form passes', async () => {
  const { driver, fill } = await filledGreenhouse();
  const r = await reviewForm(fill.after, { profile, files: files(), job: JOB });
  assert.equal(r.ok, true, JSON.stringify(r.blockers));
  await driver.close();
});

test('sponsorship answered Yes for someone who needs none is blocked', async () => {
  const { driver, fill } = await filledGreenhouse();
  const f = field(fill, /require sponsorship/);
  await driver.call('openCombobox', f.selector, 'Yes');
  const opts = await driver.call('listOptions', f.selector);
  await driver.call('pickOption', f.selector, opts.find((o) => o.label === 'Yes').selector);
  const r = await reviewForm(await driver.call('readForm', null), { profile, files: files(), job: JOB });
  assert.equal(r.ok, false);
  const b = r.blockers.find((x) => /sponsorship/.test(x.field));
  assert.ok(b, 'the sponsorship field is a blocker');
  assert.match(b.why, /requiresSponsorship is no/);
  await driver.close();
});

test('a different city with the same first word is blocked', async () => {
  const { driver, fill } = await filledGreenhouse();
  const f = field(fill, /^Location/);
  await driver.call('openCombobox', f.selector, 'Denver City');
  const opts = await driver.call('listOptions', f.selector);
  await driver.call('pickOption', f.selector, opts[0].selector);
  const r = await reviewForm(await driver.call('readForm', null), { profile, files: files(), job: JOB });
  const b = r.blockers.find((x) => /^Location/.test(x.field));
  assert.ok(b, 'Denver City, Texas is caught');
  assert.match(b.found, /Denver City, Texas/);
  await driver.close();
});

test('an autocomplete-corrupted value, an email in a name box and the resume as a cover letter are blocked', async () => {
  const { driver, fill } = await filledGreenhouse();
  await driver.call('setText', field(fill, /^Last Name$/).selector, 'jane@example.com');
  await driver.call('setText', field(fill, /^How did you hear/).selector, 'Comp, Compa, Compan, Company, Company careers page');
  await driver.uploadFile(field(fill, /^Cover Letter$/).selector, resumePdf());
  const r = await reviewForm(await driver.call('readForm', null), { profile, files: files(), job: JOB });
  const why = r.blockers.map((b) => `${b.field}: ${b.why}`).join('\n');
  assert.match(why, /Last Name: .*email address is in a field/);
  assert.match(why, /How did you hear about this job\?: the value grows one keystroke at a time/);
  assert.match(why, /Cover Letter: the same file is in two slots|Cover Letter: the resume is in the cover letter slot/);
  await driver.close();
});

test('the review repairs a tampered field and only then passes', async () => {
  const { applyToForm } = await import('../src/ats/apply.js');
  // Tamper during the fill: a page script rewrites the phone after the filler sets it once.
  const driver = await jsdomDriver();
  const r = await applyToForm({
    driver, item: JOB, gotoUrl: fixture('greenhouse'), profile, files: files(), dry: true,
    pacer: { action: async () => {
      const el = driver.window.document.getElementById('phone');
      if (el.value && !el.dataset.tampered) { el.dataset.tampered = '1'; el.value = '555'; }
    } },
  });
  assert.equal(r.state, 'dry_filled', r.reason);
  assert.equal(driver.window.document.getElementById('phone').value, '+1 303 555 0142');
  await driver.close();
});

test('the model layer of the review fails closed', async () => {
  const { driver, fill } = await filledGreenhouse();
  const broken = asProvider(stubProvider(() => new Error('quota exceeded')));
  const r = await reviewForm(fill.after, { profile, files: files(), job: JOB, provider: broken, modelReview: true });
  assert.equal(r.ok, false);
  assert.match(r.blockers[0].why, /model review failed/);
  await driver.close();
});

test('an anti-automation question with an answer in it is a blocker', async () => {
  const rows = [{ label: 'Prove you are not a bot: decode the following string', kind: 'text', required: true, value: 'hello' }];
  const r = await reviewForm(rows, { profile });
  assert.equal(r.ok, false);
});

test('an instruction inside a question must be followed', () => {
  assert.match(embeddedInstruction('Tell us about a bug you fixed. End your answer with the phrase "works on my machine".', 'I fixed a race in the cache.'), /end with/);
  assert.equal(embeddedInstruction('End your answer with the phrase "works on my machine".', 'I fixed it, and it works on my machine.'), null);
  assert.match(embeddedInstruction('In under 10 words, why us?', 'one two three four five six seven eight nine ten eleven'), /at most 10 words/);
});

test('a why-this-company answer that never names the company is blocked', async () => {
  const rows = [{ label: 'Why do you want to work here?', kind: 'textarea', required: true, value: 'I like building products with great teams and solving hard problems every day.' }];
  const r = await reviewForm(rows, { profile, job: JOB });
  assert.equal(r.ok, false);
  assert.match(r.blockers[0].why, /never names Example Co/);
});

test('corruption detector', () => {
  assert.ok(corruption('Denver, D, De, Den, Denv, Denve, Denver'));
  assert.equal(corruption('Denver, Colorado, United States'), null);
});
