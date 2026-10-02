// Field to decision. Every answer comes from the user's profile file, from the user's own answer
// list, or from the user's model working only from that profile. Nothing is guessed: a field the
// profile cannot answer comes back as { action: 'none', reason } and the caller reports it.
import { factFor, eeoKeyFor } from './rules.js';
import { detectChallenge } from './challenge.js';
import { composeAnswers } from './compose.js';
import { bestOptionIndex, yesNoIndex, DECLINE } from '../formfill/match.js';

const PROSE_OPENER = /^\s*(why\b|describe\b|explain\b|tell (us|me)\b|walk us\b|share\b|what (interests|excites|draws|attracts|motivates|made you)\b|how would you\b|please (describe|explain|elaborate|provide|tell us|share)\b|if yes[,:]?\s*(please\s*)?(provide|describe|explain)\b|what is (one|a) (thing|project)\b)/i;

const none = (reason, extra = {}) => ({ action: 'none', reason, ...extra });
const skip = (reason) => ({ action: 'skip', reason });
const MODEL = Symbol('model');

const labelsOf = (field) => (field.options || []).map((o) => o.label);

export function isProse(field) {
  if (field.options && field.options.length) return false;
  if (field.kind === 'textarea') return true;
  const l = field.label || '';
  return l.length > 90 && PROSE_OPENER.test(l);
}

function userAnswer(field, profile) {
  for (const a of profile.answers || []) {
    if (!a || !a.match) continue;
    const m = String(a.match);
    let hit;
    if (m.length > 2 && m.startsWith('/') && m.lastIndexOf('/') > 0) {
      const end = m.lastIndexOf('/');
      try { hit = new RegExp(m.slice(1, end), m.slice(end + 1) || 'i').test(field.label); } catch { hit = false; }
    } else {
      hit = field.label.toLowerCase().includes(m.toLowerCase());
    }
    if (hit) return a.answer;
  }
  return null;
}

/** Turn one profile fact into an action for this field's control. */
export function decideFromFact(field, fact, source, profile = {}) {
  const opts = labelsOf(field);
  const word = (v) => (v ? 'Yes' : 'No');
  // A place picked from a list is matched as "City, State", never by the city name alone:
  // "Denver" would also match "Denver City, Texas".
  const choice = ['select', 'combobox', 'radio', 'buttons'].includes(field.kind);
  if (choice && (fact.key === 'city' || fact.key === 'location') && profile.city && profile.state) {
    fact = { ...fact, value: `${profile.city}, ${profile.state}` };
  }
  switch (field.kind) {
    case 'text': case 'email': case 'tel': case 'url': case 'number': case 'date': case 'textarea':
      return { action: 'text', value: fact.kind === 'bool' ? word(fact.value) : String(fact.value), source };
    case 'select': case 'multiselect': case 'radio': case 'buttons': case 'combobox': case 'checkboxes': {
      if (field.kind === 'combobox' && !opts.length) {
        return { action: 'combobox', want: fact.kind === 'bool' ? word(fact.value) : String(fact.value), source };
      }
      const idx = fact.kind === 'bool' ? yesNoIndex(opts, fact.value) : bestOptionIndex(opts, String(fact.value));
      if (idx < 0) return none(`profile ${fact.key} is "${fact.value}", which matches no option`, { options: opts });
      return { action: 'choose', index: idx, value: opts[idx], source };
    }
    case 'checkbox':
      if (fact.kind === 'bool') return { action: 'checkbox', checked: fact.value, source };
      return none('a single checkbox needs a yes or no fact');
    default:
      return none(`no way to apply a fact to a ${field.kind} control`);
  }
}

function decideEeo(field, profile, key) {
  const eeo = profile.eeo || {};
  const v = eeo[key];
  const opts = labelsOf(field);
  if (v == null || v === '') {
    return field.required ? none(`EEO question and profile.eeo.${key} is empty; it is never guessed`, { options: opts }) : skip('optional EEO question with no profile answer');
  }
  if (!opts.length) {
    if (field.kind === 'combobox') return { action: 'combobox', want: String(v), source: `profile.eeo.${key}` };
    if (field.kind === 'checkbox') return none('EEO checkbox has no stated meaning');
    return { action: 'text', value: String(v), source: `profile.eeo.${key}` };
  }
  let idx = bestOptionIndex(opts, String(v));
  let source = `profile.eeo.${key}`;
  if (idx < 0 && DECLINE.test(String(v)) && eeo[`${key}IfRequired`]) {
    idx = bestOptionIndex(opts, String(eeo[`${key}IfRequired`]));
    source = `profile.eeo.${key}IfRequired (this form offers no decline option)`;
  }
  if (idx < 0) return none(`profile.eeo.${key} is "${v}", which is not on this form's menu`, { options: opts });
  return { action: 'choose', index: idx, value: opts[idx], source };
}

function decideFile(field, files = {}) {
  const l = field.label || '';
  if (/cover\s*letter/i.test(l)) {
    if (files.coverLetter) return { action: 'file', path: files.coverLetter, source: 'files.coverLetter' };
    return field.required ? none('a cover letter file is required and none is configured; the resume is never sent in its place') : skip('optional cover letter, none configured');
  }
  if (!l || /resume|résumé|\bcv\b|curriculum/i.test(l)) {
    return files.resume ? { action: 'file', path: files.resume, source: 'files.resume' } : none('no resume file configured');
  }
  return field.required ? none(`"${l.slice(0, 60)}" asks for a file that is not the resume`) : skip('optional file that is not the resume');
}

/** The decision for one field, or MODEL when only the user's model can answer it. */
export function resolveOne(field, profile, ctx = {}) {
  if (detectChallenge(field.label, field.description).detected) return none('anti-automation question; never answered');

  const own = userAnswer(field, profile);
  if (own != null) {
    const fact = typeof own === 'boolean' ? { kind: 'bool', value: own, key: 'answers' } : { kind: 'string', value: String(own), key: 'answers' };
    return decideFromFact(field, fact, 'profile.answers');
  }

  if (field.kind === 'file') return decideFile(field, ctx.files);

  const eeo = eeoKeyFor(field.label);
  if (eeo) return decideEeo(field, profile, eeo);

  if (isProse(field)) return field.required || ctx.answerOptionalProse ? MODEL : skip('optional written question');

  const fact = factFor(field.label, profile);
  if (fact) return decideFromFact(field, fact, `profile.${fact.key}`, profile);

  if (field.required) return MODEL;
  return skip('optional and the profile has no answer');
}

/**
 * Resolve every field. Questions only the model can answer are sent in one batch.
 * @returns {Promise<object[]>} one decision per field, same order
 */
export async function resolveFields(fields, profile, ctx = {}) {
  const out = new Array(fields.length);
  const toModel = [];
  fields.forEach((f, i) => {
    const d = resolveOne(f, profile, ctx);
    if (d === MODEL) toModel.push(i); else out[i] = d;
  });
  if (toModel.length) {
    if (ctx.provider) {
      const answers = await composeAnswers(toModel.map((i) => fields[i]), profile, ctx);
      toModel.forEach((i, k) => { out[i] = answers[k]; });
    } else {
      toModel.forEach((i) => { out[i] = none('needs a written or judged answer and no model is configured', { options: labelsOf(fields[i]) }); });
    }
  }
  return out;
}
