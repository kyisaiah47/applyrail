import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMaster } from '../src/resume/tailor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..');
export const fixture = (name) => path.join(ROOT, 'examples', 'fixtures', `${name}.html`);
export const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'jane-example', name), 'utf8'));
export const jd = () => fs.readFileSync(path.join(ROOT, 'examples', 'jane-example', 'job-description.txt'), 'utf8');
export const tmp = (p = 'applyrail-test-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

let resumeFile = null;
export function resumePdf() {
  if (!resumeFile) resumeFile = renderMaster(example('resume.json'), tmp()).pdf;
  return resumeFile;
}

/** Write a variant of a fixture with `edit(html)` applied, and return its path. */
export function variant(name, edit) {
  const dir = tmp('applyrail-fixture-');
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, edit(fs.readFileSync(fixture(name), 'utf8')));
  return file;
}

export const JOB = { atsUrl: 'https://example.invalid/job', company: 'Example Co', title: 'Senior Full-Stack Engineer' };

/** Read the final value of the field whose label matches `re`. */
export const valueOf = (rows, re) => {
  const row = rows.find((r) => re.test(r.label));
  if (!row) throw new Error(`no field matching ${re}`);
  return row.value;
};
