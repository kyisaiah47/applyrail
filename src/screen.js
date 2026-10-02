// The screen. It runs on each posting before it is queued, cheapest check first:
//   1. title: a denylist of roles the user does not want, and an optional allowlist
//   2. location: the posting's location field against the user's accepted locations
//   3. description: a posting with a description under 200 characters is not a real posting
//   4. optional: the user's model reads the description against the user's target
// A model that fails gives no verdict. The posting stays unscreened; it is never rejected or
// kept because a call failed.

export const DEFAULT_SCREEN = {
  titleDeny: ['intern', 'internship', 'sales', 'account executive', 'recruiter', 'marketing', 'nurse', 'physician', 'driver', 'warehouse'],
  titleAllow: [],                 // empty means any title that is not denied
  locations: ['remote'],          // a posting passes when its location mentions one of these, or is empty
  denyLocations: [],              // e.g. ['hybrid', 'on-site']
  minDescription: 200,
  model: false,                   // ask the user's model to judge fit
  target: '',                     // one paragraph: the roles and seniority the user wants
};

const has = (hay, needles) => needles.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay));

/** { keep: true } or { keep: false, why } for one posting, without a model. */
export function screenPosting(p, cfg = {}) {
  const c = { ...DEFAULT_SCREEN, ...cfg };
  const title = String(p.title || '');
  if (title && has(title, c.titleDeny)) return { keep: false, why: `title "${title}" matches the deny list` };
  if (title && c.titleAllow.length && !has(title, c.titleAllow)) return { keep: false, why: `title "${title}" matches nothing on the allow list` };
  const loc = String(p.location || '');
  if (loc) {
    if (c.denyLocations.length && has(loc, c.denyLocations)) return { keep: false, why: `location "${loc}" is on the deny list` };
    if (c.locations.length && !has(loc, c.locations)) return { keep: false, why: `location "${loc}" is not one of: ${c.locations.join(', ')}` };
  }
  if (p.description != null && String(p.description).trim().length < c.minDescription) {
    return { keep: false, why: `the description is under ${c.minDescription} characters` };
  }
  return { keep: true };
}

/** The model layer. Returns { keep, why } or null when the model could not decide. */
export async function screenWithModel(p, provider, cfg = {}) {
  if (!provider || !cfg.model || !p.description) return null;
  try {
    const r = await provider.completeJson({
      system: 'You decide whether one job posting fits a job seeker. Return only JSON {"keep":bool,"why":"one sentence"}.',
      prompt: `TARGET:\n${cfg.target || '(no target given; keep anything in software engineering)'}\n\nPOSTING:\ntitle: ${p.title}\ncompany: ${p.company}\nlocation: ${p.location || ''}\n\n${String(p.description).slice(0, 6000)}`,
    });
    if (typeof r?.keep !== 'boolean') return null;
    return { keep: r.keep, why: String(r.why || '') };
  } catch {
    return null;
  }
}
