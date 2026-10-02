// Resume tailoring: one composition per job, validated, in the plain ATS register.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tailorResume, applyPatch } from '../src/resume/tailor.js';
import { validateTailored } from '../src/resume/validate.js';
import { assertRegister } from '../src/resume/render.js';
import { stubProvider, asProvider } from '../src/providers/index.js';
import { example, jd, tmp } from './helpers.js';

const resume = example('resume.json');
const bank = example('bank.json');
const job = { title: 'Senior Full-Stack Engineer', company: 'Example Co', description: jd() };

const GOOD_PATCH = {
  headline: 'Senior Full-Stack Engineer',
  summary: 'Full-stack engineer with 8 years in TypeScript, React, Node.js and PostgreSQL, focused on product teams that ship weekly.',
  experience: [
    { company: 'Example Corp', bullets: [
      'Designed a GraphQL layer over 4 internal services so the web and mobile apps share one API.',
      'Led the move of the billing service to PostgreSQL, cutting p95 latency by 40 percent.',
      'Set up Playwright tests in CI that run on every pull request in under 9 minutes.',
      'Built the customer dashboard in React and TypeScript, used by 2 million people a month.',
    ] },
    { company: 'Sample Labs', bullets: [
      'Wrote the Node.js API behind the mobile app and kept it at 99.9 percent uptime.',
      'Added end-to-end tests that cut release rollbacks from 6 a quarter to 1.',
    ] },
    { company: 'Demo Systems', bullets: ['Maintained the internal admin tools in JavaScript and Python.'] },
  ],
  skills: [
    { label: 'Languages', items: ['TypeScript', 'JavaScript', 'SQL'] },
    { label: 'Frameworks and testing', items: ['React', 'Node.js', 'GraphQL', 'Playwright'] },
    { label: 'Data and infrastructure', items: ['PostgreSQL', 'Redis', 'Docker', 'AWS'] },
  ],
};

const pdftotextAvailable = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a valid patch tailors the resume, and pdftotext reads the name on line 1', { skip: !pdftotextAvailable && 'pdftotext is not installed' }, async () => {
  const provider = asProvider(stubProvider(() => GOOD_PATCH));
  const r = await tailorResume({ resume, bank, job, provider, outDir: tmp() });
  assert.equal(r.status, 'tailored', r.problems.join('; '));
  assert.equal(r.resume.headline, 'Senior Full-Stack Engineer');
  const text = execFileSync('pdftotext', [r.files.pdf, '-'], { encoding: 'utf8' });
  const lines = text.split('\n');
  assert.equal(lines[0].trim(), 'Jane Example');
  assert.equal(lines[1].trim(), 'Senior Full-Stack Engineer');
  assert.match(text, /GraphQL layer over 4 internal services/);
  assert.match(fs.readFileSync(r.files.txt, 'utf8'), /^Jane Example\n/);
});

test('one composition per job: a second call reuses the first', async () => {
  const provider = asProvider(stubProvider(() => GOOD_PATCH));
  const outDir = tmp();
  const a = await tailorResume({ resume, bank, job, provider, outDir });
  const b = await tailorResume({ resume, bank, job, provider, outDir });
  assert.equal(a.status, 'tailored');
  assert.equal(b.status, 'reused');
  assert.equal(provider.calls.length, 1);
});

test('an invented number sends the master resume instead', async () => {
  const bad = structuredClone(GOOD_PATCH);
  bad.experience[0].bullets[0] = 'Designed a GraphQL layer over 17 internal services.';
  const r = await tailorResume({ resume, bank, job, provider: asProvider(stubProvider(() => bad)), outDir: tmp() });
  assert.equal(r.status, 'master');
  assert.match(r.problems.join('\n'), /numbers not found in the sources: 17/);
  assert.equal(r.resume.headline, resume.headline);
});

test('the validator holds the skeleton, the skills, the headline and the gap rule', () => {
  const { resume: t } = applyPatch(resume, GOOD_PATCH);
  assert.deepEqual(validateTailored(resume, t, bank), []);
  const moved = structuredClone(t); moved.experience[1].dates = '2017 to 2021';
  assert.match(validateTailored(resume, moved, bank).join(), /role 2 dates changed/);
  const skill = structuredClone(t); skill.skills[0].items.push('Haskell');
  assert.match(validateTailored(resume, skill, bank).join(), /skill "Haskell"/);
  const head = structuredClone(t); head.headline = 'Principal Architect';
  assert.match(validateTailored(resume, head, bank).join(), /not one of the approved headlines/);
  const gap = structuredClone(t); gap.summary = 'Engineer with limited experience with Go.';
  assert.match(validateTailored(resume, gap, bank).join(), /announces a gap/);
});

test('a patch that renames a role is refused', () => {
  const { problems } = applyPatch(resume, { experience: [{ company: 'Other Inc', bullets: ['x'] }] });
  assert.match(problems.join(), /the master has "Example Corp"/);
});

test('no model means the master resume, said plainly', async () => {
  const r = await tailorResume({ resume, bank, job, provider: null, outDir: tmp() });
  assert.equal(r.status, 'master');
  assert.match(r.problems[0], /no model configured/);
});

test('only the plain register exists', () => {
  assert.equal(assertRegister('plain'), 'plain');
  assert.throws(() => assertRegister('branded'), /unknown resume register/);
});
