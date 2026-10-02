// Resume tailoring. One composition per job.
//
// The model selects and rewords from the user's own master resume and fact bank. It writes a
// patch, never a document: a headline, a summary, each role's bullets and the skills rows.
// The patch is applied to the master, the validator checks it, and the result renders in the
// plain ATS register. If the model fails or the validator finds a problem, the job gets the
// master resume, and the problems are recorded. A tailored resume never ships unvalidated.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateTailored } from './validate.js';
import { toPdf, toText, toHtml, assertRegister } from './render.js';

const SYSTEM = `You tailor one resume to one job. You select and reword. You never add a fact.
Rules:
1. Keep every role, in the same order. For each role, choose 2 to 6 bullets from that role's MASTER bullets and BANK bullets, ordered by relevance to the JOB. You may reword a bullet into the job's vocabulary without changing what it claims.
2. Copy every number exactly as it appears in the sources. Never write a number that is not in the sources.
3. The headline must be one of HEADLINES, copied exactly.
4. Skills rows may only contain skills listed in SKILLS. Order them by relevance to the JOB.
5. The summary is 2 or 3 sentences built only from facts in the sources.
6. Never write a sentence about something the candidate has not done.
Return only JSON: {"headline":"","summary":"","experience":[{"company":"","bullets":[""]}],"skills":[{"label":"","items":[""]}]}`;

export function jobKey(job) {
  const base = `${job.company || ''}|${job.title || ''}|${job.url || ''}`;
  const slug = `${job.company || 'job'}-${job.title || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${slug}-${crypto.createHash('sha1').update(base).digest('hex').slice(0, 8)}`;
}

export function buildTailorPrompt(master, bank, job) {
  const skills = [...new Set([...(master.skills || []).flatMap((s) => s.items || []), ...(bank.skills || [])])];
  const headlines = [master.headline, ...(bank.headlines || [])].filter(Boolean);
  const roles = (master.experience || []).map((r) => ({
    company: r.company,
    title: r.title,
    masterBullets: r.bullets || [],
    bankBullets: bank.experience?.[r.company] || [],
  }));
  return [
    'JOB:',
    `title: ${job.title || ''}`,
    `company: ${job.company || ''}`,
    String(job.description || '').slice(0, 8000),
    '',
    'HEADLINES:', JSON.stringify(headlines),
    'SKILLS:', JSON.stringify(skills),
    'MASTER SUMMARY:', master.summary || '',
    'BANK SUMMARIES:', JSON.stringify(bank.summaries || []),
    'ROLES:', JSON.stringify(roles, null, 1),
  ].join('\n');
}

/** Apply a patch to a copy of the master. Roles are matched by position and must name the same company. */
export function applyPatch(master, patch) {
  const out = JSON.parse(JSON.stringify(master));
  const problems = [];
  if (patch.headline) out.headline = String(patch.headline);
  if (patch.summary) out.summary = String(patch.summary);
  if (Array.isArray(patch.experience)) {
    patch.experience.forEach((p, i) => {
      const role = out.experience?.[i];
      if (!role) { problems.push(`the patch names a role ${i + 1} that does not exist`); return; }
      if (p.company && p.company !== role.company) { problems.push(`patch role ${i + 1} is "${p.company}", the master has "${role.company}"`); return; }
      if (Array.isArray(p.bullets)) role.bullets = p.bullets.map(String);
    });
  }
  if (Array.isArray(patch.skills) && patch.skills.length) {
    out.skills = patch.skills.map((s) => ({ label: String(s.label || 'Skills'), items: (s.items || []).map(String) }));
  }
  return { resume: out, problems };
}

function writeOutputs(dir, resume, register) {
  fs.mkdirSync(dir, { recursive: true });
  const base = `${String(resume.name || 'Resume').replace(/[^A-Za-z0-9]+/g, '-')}-Resume`;
  const pdf = path.join(dir, `${base}.pdf`);
  fs.writeFileSync(pdf, toPdf(resume, { register }));
  fs.writeFileSync(path.join(dir, `${base}.txt`), toText(resume));
  fs.writeFileSync(path.join(dir, `${base}.html`), toHtml(resume));
  return { pdf, txt: path.join(dir, `${base}.txt`), html: path.join(dir, `${base}.html`) };
}

/**
 * Tailor the master resume to one job.
 * @param {object} args
 * @param {object} args.resume the master resume JSON
 * @param {object} [args.bank] the fact bank: { experience: { Company: [bullets] }, skills, headlines, summaries }
 * @param {object} args.job { title, company, description, url }
 * @param {object} [args.provider] from createProvider(); without one the master is used
 * @param {string} args.outDir where the job's files go: <outDir>/<jobKey>/
 * @param {string} [args.register] 'plain' (the only register)
 * @param {boolean} [args.reuse] return an existing composition for this job
 * @returns {Promise<{ status: 'tailored'|'master'|'reused', problems: string[], resume, files, key }>}
 */
export async function tailorResume({ resume, bank = {}, job, provider = null, outDir, register = 'plain', reuse = true }) {
  assertRegister(register);
  const key = jobKey(job);
  const dir = path.join(outDir, key);
  const record = path.join(dir, 'tailor.json');
  if (reuse && fs.existsSync(record)) {
    const prev = JSON.parse(fs.readFileSync(record, 'utf8'));
    return { ...prev, status: 'reused', key };
  }

  let status = 'master';
  let problems = [];
  let finalResume = resume;
  if (provider) {
    try {
      const patch = await provider.completeJson({ system: SYSTEM, prompt: buildTailorPrompt(resume, bank, job), maxTokens: 2500 });
      const applied = applyPatch(resume, patch || {});
      problems = [...applied.problems, ...validateTailored(resume, applied.resume, bank)];
      if (!problems.length) { finalResume = applied.resume; status = 'tailored'; }
    } catch (e) {
      problems = [`model call failed: ${String(e.message || e).slice(0, 200)}`];
    }
  } else {
    problems = ['no model configured; the master resume is used'];
  }

  const files = writeOutputs(dir, finalResume, register);
  const result = { status, problems, resume: finalResume, files, key, job: { title: job.title, company: job.company, url: job.url } };
  fs.writeFileSync(record, JSON.stringify(result, null, 2));
  return result;
}

/** Render the master resume with no tailoring. */
export function renderMaster(resume, outDir, register = 'plain') {
  assertRegister(register);
  return writeOutputs(outDir, resume, register);
}
