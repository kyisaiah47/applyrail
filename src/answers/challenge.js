// Anti-automation questions. Some employers put a question on the form that exists to catch
// automated applications: decode this string, prove you are not a bot, do not use AI.
// ApplyRail never answers one. A form that carries one is not filled at all, and the job is
// skipped with the question quoted, because the employer has asked not to receive automated
// applications.
//
// Detection is eager on purpose. A false positive skips one job. A false negative sends an
// automated answer to an employer who asked for none.

const PHRASES = [
  /\bencoded in a (?:common|simple|well[- ]known|standard) format\b/i,
  /\bfigure out (?:the|this|a) (?:correct )?(?:secret|password|code|phrase)\b/i,
  /\b(?:you are|you're) not a (?:bot|robot)\b/i,
  /\bnot an? (?:bot|robot|ai|llm)\b/i,
  /\bauto[- ]?apply(?:ing)?\b/i,
  /\bprove (?:to us )?(?:that )?you(?:'re| are)? (?:a )?(?:human|not)/i,
  /\bdecode (?:the|this) (?:following|text|string|message)\b/i,
  /\b(?:base ?64|rot ?13|hex[- ]encoded|caesar cipher)\b/i,
  /\bsubmit (?:the|this) secret\b/i,
  /\bignore (?:all )?(?:previous|prior) instructions\b/i,
  /\bif you are an? (?:ai|llm|language model|bot)\b/i,
  /\bdo not use (?:ai|an ai|chatgpt|an llm|automation|automated tools)\b/i,
  /\b(?:applications?|answers?) (?:written|generated) (?:by|with) (?:ai|an ai|chatgpt|an llm)\b.*\b(?:rejected|disqualif)/i,
];

// A long base64 or hex blob inside a question that also asks for something back.
const BLOB = /(?=[A-Za-z0-9+/=]{24,})(?=\S*[A-Z])(?=\S*[a-z])(?=\S*\d)[A-Za-z0-9+/]{24,}={0,2}/;

const strip = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** { detected, signal, text } for one question's label and help text. */
export function detectChallenge(...parts) {
  const text = parts.map(strip).filter(Boolean).join(' / ');
  if (!text) return { detected: false, signal: null, text: '' };
  for (const re of PHRASES) {
    const m = text.match(re);
    if (m) return { detected: true, signal: `phrase: ${m[0].slice(0, 40)}`, text };
  }
  const blob = text.match(BLOB);
  if (blob && /\b(secret|submit|answer|field below|decode|figure|enter)\b/i.test(text)) {
    return { detected: true, signal: `encoded blob: ${blob[0].slice(0, 20)}...`, text };
  }
  return { detected: false, signal: null, text };
}

/** Every field on a mapped form that carries a challenge. */
export const challengesIn = (fields) =>
  fields.map((f) => ({ field: f, ...detectChallenge(f.label, f.description) })).filter((c) => c.detected);
