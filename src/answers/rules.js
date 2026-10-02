// The rule ladder: a question's label to a fact in the user's profile.
//
// First match wins, so the order is the logic. Three orderings matter most:
//   1. "authorized to work WITHOUT sponsorship" is tested before "sponsorship" and before
//      "authorized to work", because one sentence names both and the answer depends on both.
//   2. Eligibility is tested before geography. "Are you authorized to work in your current
//      country?" is an eligibility question; the country is only where it applies.
//   3. A question that asks "are you located in X or willing to relocate" is not a relocation
//      question. It needs the place compared with where the user lives, so the ladder returns
//      nothing and the question goes to the model with the facts.
//
// A rule returns a Fact: { kind: 'string'|'bool'|'number', value, key } or null when the
// profile has no answer. Null is never turned into a guess.

const s = (key, value) => (value == null || value === '' ? null : { kind: 'string', value: String(value), key });
const b = (key, value) => (typeof value === 'boolean' ? { kind: 'bool', value, key } : null);
const n = (key, value) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : { kind: 'number', value: Number(value), key });

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export const EEO_RULES = [
  [/\bpronoun/i, 'pronouns'],
  [/\bsexual orientation\b/i, 'sexualOrientation'],
  [/\btransgender\b/i, 'transgender'],
  [/\bhispanic\b|\blatin[oax]\b/i, 'hispanicLatino'],
  [/\brace\b|\bethnic/i, 'race'],
  [/\bveteran\b|\bmilitary\b|\bprotected veteran\b/i, 'veteran'],
  [/\bdisabilit/i, 'disability'],
  [/\bgender\b|\bsex\b/i, 'gender'],
];

/** The EEO key a label asks about, or null. */
export function eeoKeyFor(label) {
  for (const [re, key] of EEO_RULES) if (re.test(label)) return key;
  return null;
}

export const RULES = [
  // Combined place questions need meaning, not a lookup.
  [/(currently\s+)?(located|based|living|resid\w*)\b[\s\S]{0,60}\b(or|and)\b[\s\S]{0,40}relocat/i, () => null],

  [/\b(authori[sz]ed|eligible|legally able)\b[\s\S]{0,80}\bwithout\b[\s\S]{0,60}\bsponsor/i,
    (p) => (typeof p.workAuthorized === 'boolean' && typeof p.requiresSponsorship === 'boolean'
      ? { kind: 'bool', value: p.workAuthorized && !p.requiresSponsorship, key: 'workAuthorized && !requiresSponsorship' } : null)],
  [/\bsponsor/i, (p) => b('requiresSponsorship', p.requiresSponsorship)],
  [/\b(authori[sz]ed|eligible|legally (able|permitted)) to work\b|\bright to work\b|\bwork (authori[sz]ation|permit)\b/i,
    (p) => b('workAuthorized', p.workAuthorized)],
  [/\bcitizenship\b|\bcitizen of\b/i, (p) => s('citizenship', p.citizenship)],
  [/\b(18|eighteen) years\b|\bage of (18|majority)\b|\blegal (working )?age\b/i, (p) => b('over18', p.over18)],

  [/\bpreferred (first )?name\b/i, (p) => s('preferredName', p.preferredName || p.firstName)],
  [/\bfirst\s*name\b|\bgiven\s*name\b/i, (p) => s('firstName', p.firstName)],
  [/\blast\s*name\b|\bfamily\s*name\b|\bsurname\b/i, (p) => s('lastName', p.lastName)],
  [/\bmiddle\s*name\b/i, (p) => s('middleName', p.middleName)],
  [/\bfull\s*(legal\s*)?name\b|^\s*(legal\s*)?name\s*$|^your name$/i, (p) => s('fullName', p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' '))],

  [/\bconfirm (your )?e-?mail\b|^\s*e-?mail( address)?\s*$|\byour e-?mail\b|\be-?mail address\b/i, (p) => s('email', p.email)],
  [/^(?![\s\S]*\bexperience\b)[\s\S]*\b(phone|mobile (phone|number)|cell( phone)?|telephone)\b/i, (p) => s('phone', p.phone)],

  [/\blinked\s*in\b/i, (p) => s('linkedin', p.linkedin)],
  [/\bgit\s*hub\b/i, (p) => s('github', p.github)],
  [/\btwitter\b|\bx\.com\b/i, (p) => s('twitter', p.twitter)],
  [/\bportfolio\b|\bpersonal (web)?site\b|^\s*website\s*$|\bother website\b|\bwebsite url\b/i, (p) => s('website', p.website)],

  [/\bcurrent (or most recent )?(employer|company)\b|^\s*(company|employer)\s*$/i, (p) => s('currentCompany', p.currentCompany)],
  [/\bcurrent (or most recent )?(job )?(title|role|position)\b/i, (p) => s('currentTitle', p.currentTitle)],

  [/\b(school|university|college|institution)\b/i, (p) => s('school', p.school)],
  [/\b(field of study|major|discipline|area of study)\b/i, (p) => s('fieldOfStudy', p.fieldOfStudy)],
  [/\bdegree\b/i, (p) => s('degree', p.degree)],
  [/\bgraduat\w* (year|date)\b|\byear of graduation\b/i, (p) => s('graduationYear', p.graduationYear)],

  [/\bcountry\b/i, (p) => s('country', p.country)],
  [/\b(state|province|region)\b/i, (p) => s('state', p.state)],
  [/\b(zip|postal)\s*(code)?\b/i, (p) => s('postalCode', p.postalCode)],
  [/\baddress\b/i, (p) => s('address1', p.address1)],
  [/^\s*city\s*$|\bcity\b/i, (p) => s('city', p.city)],
  [/\blocation\b|\bwhere are you (currently )?(based|located)\b|\bwhere do you (live|plan to work|intend to work)\b/i, (p) => s('location', p.location)],

  [/\b(salary|compensation|pay)\b[\s\S]{0,40}\b(expect|requirement|range|desired|target)/i, (p) => s('salaryExpectation', p.salaryExpectation)],
  [/\b(expected|desired|target) (annual )?(salary|compensation|pay)\b/i, (p) => s('salaryExpectation', p.salaryExpectation)],
  [/\bnotice period\b/i, (p) => s('noticePeriod', p.noticePeriod)],
  [/\bstart date\b|\bwhen (can|could) you start\b|\bearliest (start|available)\b|\bavailab(le|ility) to start\b/i, (p) => s('startDate', p.startDate)],
  [/\byears? of (?:[a-z-]+ ){0,4}experience\b(?!\s+(with|in|using)\b)/i, (p) => n('yearsExperience', p.yearsExperience)],
  [/\byears? of (professional )?experience (with|in|using) ([A-Za-z0-9.+# -]{2,30})/i,
    (p, label) => {
      const tech = label.match(/experience (?:with|in|using) ([A-Za-z0-9.+# -]{2,30})/i)?.[1]?.trim().toLowerCase();
      const map = p.skillYears || {};
      const hit = Object.keys(map).find((k) => k.toLowerCase() === tech || (tech && tech.startsWith(k.toLowerCase())));
      return hit ? n(`skillYears.${hit}`, map[hit]) : null;
    }],
  [/\brelocat/i, (p) => b('willingToRelocate', p.willingToRelocate)],
  [/\btravel\b/i, (p) => (typeof p.willingToTravel === 'boolean' ? b('willingToTravel', p.willingToTravel) : s('willingToTravel', p.willingToTravel))],
  [/\bsecurity clearance\b/i, (p) => s('securityClearance', p.securityClearance)],
  [/\bhow did you (hear|learn|find)\b|\breferral source\b|^\s*source\s*$/i, (p) => s('howDidYouHear', p.howDidYouHear)],
  [/\b(remote|on-?site|hybrid)\b[\s\S]{0,40}\b(prefer|preference|comfortable|open)\b|\bwork (arrangement|setting) preference\b/i, (p) => s('remotePreference', p.remotePreference)],

  // Consents. Only the user's own recorded choice is used.
  [/\b(text|sms) message/i, (p) => b('consent.textMessages', get(p, 'consent.textMessages'))],
  [/\b(retain|keep|store)\b[\s\S]{0,60}\b(future|other) (opportunit|role|position)/i, (p) => b('consent.dataRetention', get(p, 'consent.dataRetention'))],
  [/\bprivacy (policy|notice)\b|\bi (have read|acknowledge|agree|certify|consent)\b|\bterms (and|&) conditions\b|\bapplicant (privacy|notice)\b/i,
    (p) => b('consent.privacyPolicy', get(p, 'consent.privacyPolicy'))],
];

/** The profile fact a label asks for, or null. */
export function factFor(label, profile) {
  const l = String(label || '');
  for (const [re, fn] of RULES) {
    if (re.test(l)) return fn(profile, l);
  }
  return null;
}
