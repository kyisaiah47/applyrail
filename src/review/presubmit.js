// The presubmit review. It reads the finished form back from the page and checks it against the
// user's profile before anything is submitted. It is a gate, not a report: the drain submits only
// when this returns ok:true, and a review that fails to run is a block, never a pass.
//
// Two layers:
//   1. Rules, always. Deterministic checks for the mistakes a filler makes with confidence:
//      a required field left empty, a value corrupted by an autocomplete, an answer that
//      contradicts the profile (work authorization with the wrong polarity, a different city),
//      the resume in the cover letter slot, a URL in a name box, an anti-automation question
//      with an answer in it, an instruction inside a question that the answer does not follow,
//      and a "why this company" answer that never names the company.
//   2. The user's model, optional. It reads the same form dump with the same rules. If it errors,
//      the form is blocked.
import { factFor, eeoKeyFor } from '../answers/rules.js';
import { detectChallenge } from '../answers/challenge.js';
import { yesNoIndex, DECLINE } from '../formfill/match.js';

const PLACEHOLDER = /^(select\.{0,3}|select an option|select one|choose\.{0,3}|choose one|type here\.{0,3}|start typing\.{0,3}|e\.g\..*|undefined|null|\[object object\]|nan|--+)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const PHONE = /^\+?[\d\s().-]{7,}$/;
const ABOUT_THEM = /\bwhy\b[\s\S]{0,60}\b(us|here|join|apply|company|team|role|position|interested)\b|\bwhat (interests|excites|draws|attracts) you\b|\binterest(ed)? in (working|joining)\b/i;

const asText = (v) => (Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v));
const digits = (s) => String(s || '').replace(/\D/g, '');
const lc = (s) => String(s || '').toLowerCase().trim();

/** A value an autocomplete or a retry loop corrupted. Returns the reason or null. */
export function corruption(value) {
  const s = asText(value);
  if (s.length < 12) return null;
  const parts = s.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  let run = 1;
  for (let i = 1; i < parts.length; i++) {
    run = parts[i].length > parts[i - 1].length && parts[i].startsWith(parts[i - 1]) ? run + 1 : 1;
    if (run >= 3) return 'the value grows one keystroke at a time';
  }
  const counts = {};
  for (const p of parts) { const k = p.toLowerCase(); if (k.length >= 3) counts[k] = (counts[k] || 0) + 1; }
  if (Object.values(counts).some((c) => c >= 3)) return 'the same part repeats three or more times';
  if (/(.{4,}?)\1{2,}/.test(s.replace(/\s+/g, ' '))) return 'a fragment repeats back to back';
  return null;
}

/** An instruction inside a question about the answer's form, and whether the answer follows it. */
export function embeddedInstruction(label, value) {
  const v = asText(value).trim();
  if (!v) return null;
  const q = String(label || '');
  const quoted = '["“‘\']([^"”’\']{2,80})["”’\']';
  let m;
  if ((m = q.match(new RegExp(`\\b(?:begin|start)\\s+(?:your\\s+)?(?:answer|response|reply)?\\s*with\\s+(?:the\\s+)?(?:word|phrase)?\\s*${quoted}`, 'i')))) {
    if (!lc(v).startsWith(lc(m[1]))) return `the question asks the answer to begin with "${m[1]}"`;
  }
  if ((m = q.match(new RegExp(`\\bend\\s+(?:your\\s+)?(?:answer|response|reply)?\\s*with\\s+(?:the\\s+)?(?:word|phrase)?\\s*${quoted}`, 'i')))) {
    if (!lc(v).replace(/[\s.!"”]+$/, '').endsWith(lc(m[1]).replace(/[\s.!]+$/, ''))) return `the question asks the answer to end with "${m[1]}"`;
  }
  if ((m = q.match(new RegExp(`\\b(?:include|write|add|use|mention|type)\\s+(?:the\\s+)?(?:exact\\s+)?(?:word|phrase|words|text)?\\s*${quoted}`, 'i')))) {
    if (!lc(v).includes(lc(m[1]))) return `the question asks the answer to include "${m[1]}"`;
  }
  if ((m = q.match(/\b(?:under|fewer than|less than|no more than|at most|maximum of|max(?:imum)?)\s+(\d+)\s+words\b/i))) {
    const words = v.split(/\s+/).filter(Boolean).length;
    if (words > Number(m[1])) return `the question asks for at most ${m[1]} words and the answer has ${words}`;
  }
  return null;
}

function checkFact(field, profile) {
  const fact = factFor(field.label, profile);
  if (!fact) return null;
  const v = asText(field.value).trim();
  if (!v) return null;
  if (fact.kind === 'bool') {
    const saysYes = /^(yes|y|true)\b/i.test(v);
    const saysNo = /^(no|n|false)\b/i.test(v);
    if ((saysYes && !fact.value) || (saysNo && fact.value)) {
      return `the profile says ${fact.key} is ${fact.value ? 'yes' : 'no'}, and the form says "${v}"`;
    }
    if (!saysYes && !saysNo && field.options && field.options.length) {
      const idx = yesNoIndex(field.options, fact.value);
      if (idx >= 0 && lc(v) !== lc(field.options[idx])) {
        return `the profile says ${fact.key} is ${fact.value ? 'yes' : 'no'}, so the answer should be "${field.options[idx]}"`;
      }
    }
    return null;
  }
  const want = String(fact.value);
  switch (fact.key) {
    case 'email':
      return lc(v) === lc(want) ? null : `the email does not match the profile (${want})`;
    case 'phone':
      return digits(v).slice(-10) === digits(want).slice(-10) ? null : 'the phone number does not match the profile';
    case 'firstName': case 'lastName': case 'preferredName': case 'fullName':
      return lc(v) === lc(want) ? null : `the ${fact.key} does not match the profile (${want})`;
    case 'city': case 'location': {
      if (lc(v) === lc(want)) return null;
      const city = lc(profile.city || want.split(',')[0]);
      const parts = v.split(',').map((x) => lc(x));
      if (parts[0] !== city) return `the location "${v}" is not the profile's city (${profile.city || want})`;
      const st = lc(profile.state); const sc = lc(profile.stateCode);
      if (parts[1] && st && parts[1] !== st && parts[1] !== sc) return `the location "${v}" is not in the profile's state (${profile.state})`;
      return null;
    }
    case 'linkedin': case 'github': case 'website':
      return lc(v).replace(/\/+$/, '') === lc(want).replace(/\/+$/, '') ? null : `the ${fact.key} URL does not match the profile`;
    default:
      return null;
  }
}

/**
 * Review a filled form.
 * @param {object[]} form readback rows: { label, kind, required, value, options, selector }
 * @param {object} ctx { profile, files, job, provider, modelReview }
 * @returns {Promise<{ ok, blockers, warnings, by }>}
 */
export async function reviewForm(form, ctx = {}) {
  const { profile = {}, files = {}, job = {} } = ctx;
  const blockers = [];
  const warnings = [];
  const block = (f, why) => blockers.push({ field: f.label, selector: f.selector, found: asText(f.value).slice(0, 200), why });

  const fileSlots = [];
  for (const f of form) {
    const v = asText(f.value).trim();

    if (detectChallenge(f.label).detected && v) { block(f, 'an anti-automation question has an answer in it'); continue; }

    if (f.required && (!v || PLACEHOLDER.test(v))) { block(f, v ? 'a required field holds placeholder text' : 'a required field is empty'); continue; }
    if (!v) continue;
    if (PLACEHOLDER.test(v)) { block(f, 'the field holds placeholder text'); continue; }

    const bad = corruption(f.value);
    if (bad) block(f, bad);

    if (f.kind === 'file') { fileSlots.push(f); continue; }

    const eeo = eeoKeyFor(f.label);
    if (eeo) {
      const stated = profile.eeo?.[eeo];
      if (stated && DECLINE.test(stated) && !DECLINE.test(v) && !profile.eeo?.[`${eeo}IfRequired`]) {
        block(f, `the profile declines to answer ${eeo}, and the form holds an answer`);
      } else if (!stated) {
        block(f, `the profile has no ${eeo} answer, and the form holds one`);
      }
      continue;
    }

    const wrong = checkFact(f, profile);
    if (wrong) block(f, wrong);

    if (f.kind !== 'email' && !/e-?mail/i.test(f.label) && EMAIL.test(v)) block(f, 'an email address is in a field that does not ask for one');
    if (/\b(name|city|company|employer|title)\b/i.test(f.label) && (URL_RE.test(v) || (PHONE.test(v) && digits(v).length >= 7))) {
      block(f, 'a URL or a phone number is in a name, place or company field');
    }
    if (/\b(website|portfolio|personal site)\b/i.test(f.label) && /linkedin\.com/i.test(v) && profile.website && !/linkedin\.com/i.test(profile.website)) {
      block(f, 'the LinkedIn URL is in the website field');
    }

    const instr = embeddedInstruction(f.label, v);
    if (instr) block(f, instr);

    if (ABOUT_THEM.test(f.label) && job.company && v.length > 40 && !lc(v).includes(lc(job.company))) {
      block(f, `the answer to a question about this employer never names ${job.company}`);
    }
  }

  const seen = new Map();
  for (const f of fileSlots) {
    const name = lc(asText(f.value));
    if (seen.has(name)) block(f, `the same file is in two slots ("${seen.get(name)}" and "${f.label}")`);
    else seen.set(name, f.label);
    if (/cover\s*letter/i.test(f.label) && files.resume && name.includes(lc(files.resume.split('/').pop()))) {
      block(f, 'the resume is in the cover letter slot');
    }
  }

  let by = 'rules';
  if (ctx.provider && ctx.modelReview) {
    by = 'rules+model';
    try {
      const r = await ctx.provider.completeJson({ system: MODEL_RULES, prompt: modelPrompt(form, profile, job) });
      for (const b of r?.blockers || []) blockers.push({ field: String(b.field || '?'), found: String(b.found || '').slice(0, 200), why: `model review: ${b.why || 'blocked'}` });
      for (const w of r?.warnings || []) warnings.push({ field: String(w.field || '?'), why: String(w.why || '') });
    } catch (e) {
      blockers.push({ field: '(review)', found: '', why: `the model review failed (${String(e.message || e).slice(0, 120)}); an unreviewed form is never submitted` });
    }
  }

  return { ok: blockers.length === 0, blockers, warnings, by };
}

const MODEL_RULES = `You are the last check before a job application is submitted. It cannot be recalled.
Read the FIELDS (every control's full value) against the FACTS. Block on any of these:
1. A corrupted or repeated value.
2. A value that contradicts the facts: name, email, phone, city, state, country.
3. Work authorization or sponsorship answered with the wrong polarity. Read negations.
4. The same file in two slots, or the resume in a cover letter slot.
5. A required field that is empty or holds placeholder text.
6. A field holding another field's value.
7. An answered question that asked the applicant to decode text or prove they are human.
8. An instruction inside a question about the answer's form that the answer does not follow.
9. An answer to a question about this employer that would fit any employer unchanged.
Do not block on an empty optional field, on salary or fit judgements, or on the same place written two ways.
Return only JSON: {"ok":bool,"blockers":[{"field":"","found":"","why":""}],"warnings":[{"field":"","why":""}]}`;

function modelPrompt(form, profile, job) {
  const facts = Object.entries(profile).filter(([k]) => k !== 'eeo' && k !== 'answers').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
  const fields = form.map((f) => `- ${f.label}${f.required ? ' (required)' : ''} [${f.kind}] = ${JSON.stringify(f.value)}${f.options ? ` options: ${JSON.stringify(f.options.slice(0, 12))}` : ''}`).join('\n');
  return `FACTS:\n${facts}\n\nJOB: ${job.title || '?'} at ${job.company || '?'}\n\nFIELDS:\n${fields}`;
}

/** One-paragraph summary of a review for logs. */
export function formatReview(r) {
  if (r.ok) return `review passed (${r.by})${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ''}`;
  return `review BLOCKED (${r.by}): ${r.blockers.map((b) => `${b.field}: ${b.why}`).join('; ')}`;
}
