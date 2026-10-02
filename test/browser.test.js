// The same three fixtures in real headless Chrome, through the browser driver the drain uses.
// Runs when puppeteer is installed (it is a dev dependency); skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { browserDriver } from '../src/formfill/drivers.js';
import { applyToForm } from '../src/ats/apply.js';
import { exampleStub } from '../examples/run-dry.mjs';
import { fixture, example, jd, resumePdf, JOB, valueOf } from './helpers.js';

let hasPuppeteer = true;
try { await import('puppeteer'); } catch { hasPuppeteer = false; }

const profile = example('profile.json');

for (const [name, checks] of Object.entries({
  greenhouse: [[/^Location/, 'Denver, Colorado, United States'], [/require sponsorship/, 'No'], [/^Resume/, 'Jane-Example-Resume.pdf']],
  lever: [[/How many years/, '6-9 years'], [/^Full name$/, 'Jane Example']],
  ashby: [[/^Location$/, 'Denver, Colorado, United States'], [/^Name$/, 'Jane Example']],
})) {
  test(`chrome: ${name} fixture fills and passes the review`, { skip: !hasPuppeteer && 'puppeteer is not installed', timeout: 120000 }, async () => {
    const driver = await browserDriver({ headless: true });
    try {
      const r = await applyToForm({
        driver, item: { ...JOB, description: jd() }, gotoUrl: pathToFileURL(fixture(name)).href, profile,
        files: { resume: resumePdf(), coverLetter: null }, provider: exampleStub(), dry: true,
      });
      assert.equal(r.state, 'dry_filled', r.reason);
      assert.equal(r.review.ok, true);
      for (const [re, want] of checks) assert.equal(valueOf(r.fill.after, re), want);
    } finally {
      await driver.close();
    }
  });
}
