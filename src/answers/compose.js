// Written and judged answers, from the user's own model, working only from the user's profile.
// One batched call per form. A failed call answers nothing: every question it held is reported
// as unanswered, so a model outage can never become a submitted guess.
import crypto from 'node:crypto';
import { bestOptionIndex } from '../formfill/match.js';

const SYSTEM = `You answer job application questions for one candidate.
Rules:
1. Use only the FACTS and the JOB given. Never invent an employer, a date, a number, a credential, a link or a skill.
2. If the FACTS do not answer a question, return null for it. A null is always better than a guess.
3. For a question with options, the answer must be one option, copied exactly.
4. For a question about why this company or this role, name the company and refer to something specific in the JOB text.
5. If a question tells you how to write the answer (a phrase to include, how to begin or end, a length), follow it exactly.
6. Stay under each question's character limit. Write plain sentences in the first person.
7. Never answer a question that asks you to decode text, solve a puzzle or prove you are human. Return null.
Return only JSON of the form {"answers":[{"id":"q1","answer":"..."}]}.`;

const EEO_KEYS = new Set(['eeo']);

/** The facts sheet the model may use: the profile minus EEO data, plus the resume text. */
export function factsSheet(profile, { resumeText = '' } = {}) {
  const lines = [];
  for (const [k, v] of Object.entries(profile)) {
    if (EEO_KEYS.has(k) || k === 'answers' || k === 'facts' || v == null || v === '') continue;
    if (typeof v === 'object') lines.push(`${k}: ${JSON.stringify(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  for (const f of profile.facts || []) lines.push(`- ${f}`);
  if (resumeText) lines.push('', 'RESUME:', resumeText.slice(0, 6000));
  return lines.join('\n');
}

function cacheKey(field, job) {
  const about = /\b(this|our) (company|role|team|position|mission)\b|\bwhy\b[\s\S]{0,40}\b(us|here|join|apply|company)\b/i.test(field.label);
  return crypto.createHash('sha1')
    .update([field.label, (field.options || []).map((o) => o.label).join('|'), about ? `${job?.company}|${job?.title}` : ''].join('\n'))
    .digest('hex').slice(0, 16);
}

export function buildPrompt(fields, profile, ctx = {}) {
  const job = ctx.job || {};
  const qs = fields.map((f, i) => ({
    id: `q${i + 1}`,
    question: f.label,
    type: f.kind,
    required: !!f.required,
    ...(f.options && f.options.length ? { options: f.options.map((o) => o.label) } : {}),
    ...(f.maxLength ? { maxCharacters: f.maxLength } : {}),
  }));
  return [
    'FACTS:',
    factsSheet(profile, ctx),
    '',
    'JOB:',
    `company: ${job.company || 'unknown'}`,
    `title: ${job.title || 'unknown'}`,
    String(job.description || '').slice(0, 6000),
    '',
    'QUESTIONS:',
    JSON.stringify(qs, null, 1),
  ].join('\n');
}

export async function composeAnswers(fields, profile, ctx = {}) {
  const cache = ctx.cache || null;
  const out = new Array(fields.length);
  const ask = [];
  fields.forEach((f, i) => {
    const key = cacheKey(f, ctx.job);
    const hit = cache && cache.get(key);
    if (hit != null) out[i] = toDecision(f, hit, 'model (cached)');
    else ask.push(i);
  });
  if (!ask.length) return out;

  let parsed;
  try {
    parsed = await ctx.provider.completeJson({ system: SYSTEM, prompt: buildPrompt(ask.map((i) => fields[i]), profile, ctx) });
  } catch (e) {
    ask.forEach((i) => { out[i] = { action: 'none', reason: `model call failed: ${String(e.message || e).slice(0, 160)}` }; });
    return out;
  }
  const byId = new Map((parsed?.answers || []).map((a) => [String(a.id), a.answer]));
  ask.forEach((i, k) => {
    const ans = byId.get(`q${k + 1}`);
    if (ans != null && ans !== '' && cache) cache.set(cacheKey(fields[i], ctx.job), ans);
    out[i] = toDecision(fields[i], ans, 'model');
  });
  return out;
}

function toDecision(field, answer, source) {
  if (answer == null || answer === '' || /^null$/i.test(String(answer))) {
    return { action: 'none', reason: 'the profile does not answer this question', options: (field.options || []).map((o) => o.label) };
  }
  const opts = (field.options || []).map((o) => o.label);
  if (opts.length) {
    const idx = bestOptionIndex(opts, String(answer));
    if (idx < 0) return { action: 'none', reason: `model answer "${String(answer).slice(0, 60)}" is not an option`, options: opts };
    return { action: 'choose', index: idx, value: opts[idx], source };
  }
  if (field.kind === 'combobox') return { action: 'combobox', want: String(answer), source };
  if (field.kind === 'checkbox') return { action: 'checkbox', checked: /^(yes|true)$/i.test(String(answer)), source };
  return { action: 'text', value: String(answer), source };
}
