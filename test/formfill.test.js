// The form filler, end to end on the three fixtures in --dry mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsdomDriver } from '../src/formfill/drivers.js';
import { applyToForm } from '../src/ats/apply.js';
import { exampleStub } from '../examples/run-dry.mjs';
import { fixture, example, jd, resumePdf, JOB, valueOf } from './helpers.js';

const profile = example('profile.json');

async function fill(name, opts = {}) {
  const driver = await jsdomDriver();
  try {
    const r = await applyToForm({
      driver, item: { ...JOB, description: jd() }, gotoUrl: fixture(name), profile,
      files: { resume: resumePdf(), coverLetter: null }, provider: exampleStub(), dry: true, ...opts,
    });
    return r;
  } finally { await driver.close(); }
}

test('greenhouse fixture: every field is filled correctly and nothing is submitted', async () => {
  const r = await fill('greenhouse');
  assert.equal(r.state, 'dry_filled', r.reason);
  const v = (re) => valueOf(r.fill.after, re);
  assert.equal(v(/^First Name$/), 'Jane');
  assert.equal(v(/^Last Name$/), 'Example');
  assert.equal(v(/^Email$/), 'jane@example.com');
  assert.equal(v(/^Phone$/), '+1 303 555 0142');
  assert.equal(v(/^Location/), 'Denver, Colorado, United States', 'picks Denver, Colorado, not Denver City, Texas');
  assert.equal(v(/^Resume/), 'Jane-Example-Resume.pdf');
  assert.equal(v(/^Cover Letter$/), '', 'the resume is never put in the cover letter slot');
  assert.equal(v(/^LinkedIn/), 'https://www.linkedin.com/in/jane-example');
  assert.equal(v(/^Website$/), 'https://jane.example.com');
  assert.equal(v(/authorized to work/), 'Yes');
  assert.equal(v(/require sponsorship/), 'No');
  assert.equal(v(/^Gender$/), 'Decline To Self Identify');
  assert.equal(v(/Hispanic/), 'Decline To Self Identify');
  assert.equal(v(/^Veteran Status$/), "I don't wish to answer");
  assert.equal(v(/^Disability Status$/), 'I do not want to answer');
  assert.equal(v(/anything else/), '', 'an optional essay is left alone');
  assert.equal(r.review.ok, true);
  assert.ok(r.fill.submit.submit, 'the submit button was found');
  assert.ok(!r.fill.after.some((row) => row.label === '' && row.required), 'phantom required inputs are not mapped');
});

test('lever fixture: every field is filled correctly', async () => {
  const r = await fill('lever');
  assert.equal(r.state, 'dry_filled', r.reason);
  const v = (re) => valueOf(r.fill.after, re);
  assert.equal(v(/^Resume/), 'Jane-Example-Resume.pdf');
  assert.equal(v(/^Full name$/), 'Jane Example');
  assert.equal(v(/^Email$/), 'jane@example.com');
  assert.equal(v(/^Phone$/), '+1 303 555 0142');
  assert.equal(v(/^Current location$/), 'Denver, CO');
  assert.equal(v(/^Current company$/), 'Example Corp');
  assert.equal(v(/^LinkedIn URL$/), 'https://www.linkedin.com/in/jane-example');
  assert.equal(v(/^GitHub URL$/), 'https://github.com/jane-example');
  assert.equal(v(/^Portfolio URL$/), 'https://jane.example.com');
  assert.deepEqual(v(/authorized to work/), ['Yes']);
  assert.equal(v(/How many years/), '6-9 years', '8 years lands in the 6-9 band');
  assert.equal(v(/^Gender$/), 'Decline to self-identify');
  assert.equal(v(/^Race$/), 'Decline to self-identify');
  assert.equal(v(/^Veteran status$/), 'Decline to self-identify');
  assert.equal(r.review.ok, true);
});

test('ashby fixture: system fields, a location combobox, Yes/No buttons, a radio group, an essay and a consent box', async () => {
  const r = await fill('ashby');
  assert.equal(r.state, 'dry_filled', r.reason);
  const v = (re) => valueOf(r.fill.after, re);
  assert.equal(v(/^Name$/), 'Jane Example');
  assert.equal(v(/^Email$/), 'jane@example.com');
  assert.equal(v(/^Phone$/), '+1 303 555 0142');
  assert.equal(v(/^Resume$/), 'Jane-Example-Resume.pdf');
  assert.equal(v(/^Location$/), 'Denver, Colorado, United States');
  assert.deepEqual(v(/visa sponsorship/), ['No']);
  assert.deepEqual(v(/level best describes/), ['Senior']);
  assert.match(v(/Why do you want to work/), /Example Co/);
  assert.equal(v(/Applicant Privacy Notice/).length, 1, 'the consent box is checked');
  assert.equal(r.review.ok, true);
});

test('without a model, questions that need a written answer are reported, never guessed', async () => {
  const r = await fill('ashby', { provider: null });
  assert.equal(r.state, 'needs_input');
  assert.match(r.reason, /Why do you want to work at Example Co/);
  assert.match(r.reason, /level best describes/);
});
