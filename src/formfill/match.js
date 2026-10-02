// Choosing an option for an answer. Pure functions, no DOM.
//
// The order of the checks is the logic:
//   1. exact match, then first word ("Yes" against "Yes, I am authorized"), then prefix
//   2. the same fact in other words (Male / Man)
//   3. a number against numeric bands: the TIGHTEST band the number satisfies wins, and when the
//      options are bands and none is satisfied the answer is -1. A digit appearing inside a label
//      is never a match ("5" does not satisfy "More than 5 years").
//   4. containment, prefix-anchored first. "New York" matches "New York, NY, United States"
//      before it matches "West New York, New Jersey", because words in front change the place.
//   5. a decline answer matches whichever decline wording the form offers.

const lower = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

export const DECLINE = /decline|prefer not|don'?t wish|do not wish|not to answer|choose not|no answer|(?:do not|don'?t) want to (?:answer|say|disclose)|not to (?:self[- ]?)?(?:identify|disclose)/i;

const SAME = {
  male: ['man', 'cisgender man', 'cis man'],
  female: ['woman', 'cisgender woman', 'cis woman'],
  man: ['male'],
  woman: ['female'],
  yes: ['y', 'true'],
  no: ['n', 'false'],
};

/** Index of the option that states `want`, or -1. `options` is an array of strings. */
export function bestOptionIndex(options, want) {
  const L = options.map(lower);
  const w = lower(want);
  if (!w) return -1;

  if (DECLINE.test(w)) {
    const i = L.findIndex((o) => DECLINE.test(o));
    if (i >= 0) return i;
  }

  let i = L.indexOf(w);
  if (i >= 0) return i;
  // The answer followed by punctuation: "Yes, I am authorized", "No (I do not)". A space is not
  // enough: "Denver City" is a different place from "Denver".
  const lead = (x) => new RegExp(`^${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,(:.;/-]`);
  i = L.findIndex((o) => lead(w).test(o));
  if (i >= 0) return i;

  for (const alt of SAME[w] || []) {
    i = L.findIndex((o) => o === alt || lead(alt).test(o) || o.split(/\s/)[0] === alt);
    if (i >= 0) return i;
  }

  const n = /^\d+(\.\d+)?$/.test(w) ? Number(w) : NaN;
  if (!Number.isNaN(n)) {
    const cands = [];
    let sawBand = false;
    L.forEach((s, j) => {
      let m;
      if ((m = s.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/))) {
        sawBand = true;
        if (n >= +m[1] && n <= +m[2]) cands.push({ j, rank: 0, tight: +m[2] - +m[1] });
        return;
      }
      if ((m = s.match(/(?:more than|greater than|over|at least|minimum(?: of)?)\s*(\d+)/)) || (m = s.match(/(\d+)\s*\+/)) || (m = s.match(/(\d+)\s*(?:years?|yrs?)?\s*or more/))) {
        sawBand = true;
        const floor = +m[1];
        const strict = /more than|greater than|over/.test(s) && !/or more|at least/.test(s);
        if (strict ? n > floor : n >= floor) cands.push({ j, rank: 1, tight: -floor });
        return;
      }
      if ((m = s.match(/(?:less than|fewer than|under|up to|at most|no more than)\s*(\d+)/)) || (m = s.match(/(\d+)\s*(?:years?|yrs?)?\s*or (?:less|fewer)/))) {
        sawBand = true;
        const ceil = +m[1];
        const strict = /less than|fewer than|under/.test(s) && !/or less|or fewer|at most/.test(s);
        if (strict ? n < ceil : n <= ceil) cands.push({ j, rank: 2, tight: ceil });
        return;
      }
      if ((m = s.match(/^(\d+)\s*(?:years?|yrs?)?$/)) && +m[1] === n) cands.push({ j, rank: -1, tight: 0 });
    });
    if (cands.length) {
      cands.sort((a, b) => a.rank - b.rank || a.tight - b.tight || a.j - b.j);
      return cands[0].j;
    }
    if (sawBand) return -1;
  }

  // Prefix-anchored containment, then ranked infix containment.
  const anchored = L.map((o, j) => ({ o, j })).filter(({ o }) => o.startsWith(w));
  if (anchored.length) return anchored.sort((a, b) => a.o.length - b.o.length)[0].j;
  if (w.length >= 3) {
    const infix = L.map((o, j) => ({ j, at: o.indexOf(w), len: o.length })).filter((x) => x.at > 0);
    if (infix.length) return infix.sort((a, b) => a.at - b.at || a.len - b.len)[0].j;
  }
  return -1;
}

/** Map a boolean fact to the Yes or No option of a question. Returns -1 when the options are not a Yes/No pair. */
export function yesNoIndex(options, value) {
  const L = options.map(lower);
  const yes = L.findIndex((o) => /^(yes|y|true)\b/.test(o));
  const no = L.findIndex((o) => /^(no|n|false)\b/.test(o));
  if (yes < 0 || no < 0) return -1;
  return value ? yes : no;
}
