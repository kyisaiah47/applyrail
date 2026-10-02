// Fill one form: map it, resolve every field, apply each decision, then read the form back.
// It never presses submit. Submitting is the drain's decision, after the presubmit review.
import { bestOptionIndex } from './match.js';
import { RunStop } from '../stop.js';
import { blockSignal } from '../stop.js';

/** Throw a RunStop when the page is a block page or shows a captcha that wants a person. */
export async function assertClear(driver, where = {}) {
  const page = await driver.call('pageText', 3000);
  const block = blockSignal({ url: page.url, title: page.title, text: page.text });
  if (block) throw new RunStop('block', block, { ...where, url: page.url });
  const captcha = await driver.call('detectCaptcha');
  if (captcha) throw new RunStop('captcha', captcha, { ...where, url: page.url });
}

/** Comboboxes often render their options only when opened. List them so the resolver can choose. */
async function hydrateComboboxes(driver, fields) {
  for (const f of fields) {
    if (f.kind !== 'combobox' || (f.options && f.options.length)) continue;
    await driver.call('openCombobox', f.selector, null);
    await driver.wait(250);
    f.options = await driver.call('listOptions', f.selector);
    await driver.call('closeCombobox', f.selector);
  }
}

async function applyCombobox(driver, field, want) {
  const queries = [want, String(want).split(/[,(]/)[0].trim()].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of queries) {
    await driver.call('openCombobox', field.selector, q);
    await driver.wait(400);
    const opts = await driver.call('listOptions', field.selector);
    const idx = bestOptionIndex(opts.map((o) => o.label), want);
    if (idx >= 0) {
      const r = await driver.call('pickOption', field.selector, opts[idx].selector);
      return { ok: r.ok, value: r.value || opts[idx].label };
    }
  }
  await driver.call('closeCombobox', field.selector);
  return { ok: false, why: `no option matches "${want}"` };
}

/** Apply one decision to one field. Returns { ok, value, why }. */
export async function applyDecision(driver, field, d) {
  switch (d.action) {
    case 'text':
      return driver.call('setText', field.selector, d.value);
    case 'choose': {
      const opt = field.options[d.index];
      if (field.kind === 'select' || field.kind === 'multiselect') return driver.call('selectIndex', field.selector, opt.value);
      if (field.kind === 'radio' || field.kind === 'checkboxes') return driver.call('check', opt.selector, true);
      if (field.kind === 'buttons') return driver.call('press', opt.selector);
      if (field.kind === 'combobox') return applyCombobox(driver, field, opt.label);
      return { ok: false, why: `cannot choose on a ${field.kind}` };
    }
    case 'combobox':
      return applyCombobox(driver, field, d.want);
    case 'checkbox':
      return driver.call('check', field.selector, d.checked);
    case 'file':
      return driver.uploadFile(field.selector, d.path);
    default:
      return { ok: false, why: d.reason || 'no action' };
  }
}

const alreadyHolds = (field, d) => {
  if (d.action === 'text') return String(field.value || '') === String(d.value);
  if (d.action === 'choose') {
    const want = field.options[d.index]?.label;
    return Array.isArray(field.value) ? field.value.includes(want) : field.value === want;
  }
  return false;
};

/**
 * Fill the form on the driver's current page.
 * @param {object} driver
 * @param {object} opts
 * @param {(fields:object[]) => Promise<object[]>} opts.resolve one decision per field
 * @param {object} [opts.pacer] has action()
 * @param {string} [opts.rootSelector]
 * @returns {Promise<{ fields, decisions, actions, unanswered, after, submit }>}
 */
export async function fillForm(driver, { resolve, pacer = null, rootSelector = null, log = () => {} } = {}) {
  const map = await driver.call('mapForm', rootSelector);
  await hydrateComboboxes(driver, map.fields);
  const decisions = await resolve(map.fields);

  // Files first: several ATS parse an uploaded resume into the form, and the profile's own
  // values must be written after that parse, not before it.
  const order = map.fields.map((f, i) => i).sort((a, b) => (decisions[a].action === 'file' ? -1 : 0) - (decisions[b].action === 'file' ? -1 : 0));

  const actions = [];
  const unanswered = [];
  for (const i of order) {
    const field = map.fields[i];
    const d = decisions[i];
    if (d.action === 'skip') continue;
    if (d.action === 'none') {
      if (field.required) unanswered.push({ label: field.label, kind: field.kind, reason: d.reason, options: d.options || null });
      continue;
    }
    if (alreadyHolds(field, d)) { actions.push({ label: field.label, ok: true, value: d.value ?? d.want, source: d.source, unchanged: true }); continue; }
    if (pacer) await pacer.action();
    let r;
    try { r = await applyDecision(driver, field, d); } catch (e) { r = { ok: false, why: e.message }; }
    actions.push({ label: field.label, kind: field.kind, ok: !!r.ok, value: r.value ?? d.value ?? d.want ?? d.path, source: d.source, why: r.why || null });
    log(`${r.ok ? 'filled' : 'FAILED'} ${field.label.slice(0, 60)}${r.ok ? '' : `: ${r.why}`}`);
    if (!r.ok && field.required) unanswered.push({ label: field.label, kind: field.kind, reason: r.why || 'the control did not take the value' });
  }

  const after = await driver.call('readForm', rootSelector);
  return { fields: map.fields, decisions, actions, unanswered, after, submit: map.submit };
}
