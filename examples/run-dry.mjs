#!/usr/bin/env node
// The worked example. Jane Example (a synthetic profile) applies to a fictional job on three
// local forms built like Greenhouse, Lever and Ashby application pages. Everything runs in
// --dry mode: each form is filled and reviewed, and nothing is submitted.
//
//   node examples/run-dry.mjs            two questions need written answers; an example stub
//                                        writes them from Jane's facts, and says so
//   node examples/run-dry.mjs --gemini   use Gemini for those answers (needs GEMINI_API_KEY)
//   node examples/run-dry.mjs examples/my-product
//                                        run the same three forms with the profile, resume and
//                                        job description in another directory
//
// It also renders the master resume to a PDF in the plain ATS register and uses it as the
// resume upload. The PDF and one JSON record per form are written to out/<directory name>/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsdomDriver } from '../src/formfill/drivers.js';
import { applyToForm } from '../src/ats/apply.js';
import { renderMaster } from '../src/resume/tailor.js';
import { createProvider, stubProvider, asProvider } from '../src/providers/index.js';
import { formatReview } from '../src/review/presubmit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ex = (...p) => path.join(HERE, ...p);
const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DIR = dirArg ? path.resolve(dirArg) : ex('jane-example');
const profile = JSON.parse(fs.readFileSync(path.join(DIR, 'profile.json'), 'utf8'));
const resume = JSON.parse(fs.readFileSync(path.join(DIR, 'resume.json'), 'utf8'));
const jd = fs.readFileSync(path.join(DIR, 'job-description.txt'), 'utf8');

/** An example stub for the two questions only a model can answer. It reads the prompt it is
 *  given and answers from Jane's facts and the job text, so the example runs with no key. */
export function exampleStub() {
  return asProvider(stubProvider((req) => {
    const qs = JSON.parse(req.prompt.slice(req.prompt.indexOf('QUESTIONS:') + 'QUESTIONS:'.length));
    return {
      answers: qs.map((q) => {
        if (/level best describes/i.test(q.question)) return { id: q.id, answer: 'Senior' };
        if (/why do you want to work/i.test(q.question)) {
          return { id: q.id, answer: 'I want to work at Example Co because your team owns a GraphQL API shared by the web and mobile apps, and I designed a GraphQL layer over 4 services at Example Corp. I have built React and Node.js features end to end for 8 years, and I cut p95 latency by 40 percent when I moved a billing service to PostgreSQL. I want to help clinics book patients faster.' };
        }
        return { id: q.id, answer: null };
      }),
    };
  }));
}

export async function runExample({ useGemini = false, log = console.log, outDir = path.join(HERE, '..', 'out', path.basename(DIR)) } = {}) {
  const out = outDir;
  fs.mkdirSync(out, { recursive: true });
  const files = { resume: renderMaster(resume, out).pdf, coverLetter: null };
  const provider = useGemini ? createProvider({ provider: 'gemini', model: 'gemini-2.5-flash' }) : exampleStub();
  log(`profile: ${path.relative(process.cwd(), DIR) || '.'}`);
  log(`resume: ${path.basename(files.resume)}, rendered from resume.json in the plain ATS register`);
  log(`written answers: ${useGemini ? 'Gemini (gemini-2.5-flash)' : 'example stub (pass --gemini to use Gemini)'}`);

  const results = {};
  for (const name of ['greenhouse', 'lever', 'ashby']) {
    const driver = await jsdomDriver();
    try {
      const fixture = ex('fixtures', `${name}.html`);
      const r = await applyToForm({
        driver,
        item: { atsUrl: `https://example.invalid/${name}`, company: 'Example Co', title: 'Senior Full-Stack Engineer', description: jd },
        gotoUrl: fixture,
        profile, files, provider, dry: true,
      });
      log(`\n${name}: ${r.state}`);
      for (const row of r.fill?.after || []) {
        if (row.value === '' || (Array.isArray(row.value) && !row.value.length)) continue;
        log(`  ${row.label.slice(0, 58).padEnd(58)} ${String(row.value).slice(0, 70)}`);
      }
      log(`  ${r.review ? formatReview(r.review) : r.reason}`);
      fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify({ form: name, state: r.state, reason: r.reason || null, fields: (r.fill?.after || []).map((row) => ({ label: row.label, value: row.value })), review: r.review || null }, null, 2)}\n`);
      results[name] = r;
    } finally {
      await driver.close();
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runExample({ useGemini: process.argv.includes('--gemini') }).then((r) => {
    const bad = Object.entries(r).filter(([, v]) => v.state !== 'dry_filled');
    if (bad.length) { console.error(`\nnot clean: ${bad.map(([k, v]) => `${k} ${v.state}: ${v.reason}`).join('; ')}`); process.exitCode = 1; }
    else console.log(`\nAll three forms were filled and passed the review. Nothing was submitted.\nThe resume PDF and one record per form are in ${path.relative(process.cwd(), path.join(HERE, '..', 'out', path.basename(DIR)))}/.`);
  });
}
