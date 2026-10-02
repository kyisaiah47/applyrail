// Stop signals. A captcha, a block page, a sign-in wall or an anti-automation question ends the
// run. ApplyRail never solves, bypasses or retries into any of them.

export class RunStop extends Error {
  /**
   * @param {'captcha'|'block'|'signed_out'|'challenge_question'|'rate_limit'} kind
   * @param {string} detail what was seen, quoted from the page where possible
   * @param {object} [where] { url, platform, board }
   */
  constructor(kind, detail, where = {}) {
    super(`${kind}: ${detail}`);
    this.name = 'RunStop';
    this.kind = kind;
    this.detail = detail;
    this.where = where;
  }
}

export const isRunStop = (e) => e instanceof RunStop || e?.name === 'RunStop';

// Text that only appears on a block or challenge page. Checked against the page title, the URL
// and the first part of the body text.
export const BLOCK_PATTERNS = [
  /access denied/i,
  /unusual (traffic|activity)/i,
  /verify (that )?you('| a)re (a )?human/i,
  /verify you are (a )?human/i,
  /are you a robot/i,
  /request (has been )?blocked/i,
  /too many requests/i,
  /temporarily (blocked|restricted)/i,
  /attention required/i,
  /checking your browser/i,
  /security check/i,
  /press (&|and) hold/i,
  /restricted your account/i,
];

const BLOCK_URL = /\/(captcha|challenge|blocked|checkpoint|authwall|cdn-cgi\/challenge)/i;

/** Returns the matching phrase when the text or URL reads as a block page, else null. */
export function blockSignal({ url = '', title = '', text = '', status = 0 } = {}) {
  if (status === 429) return 'HTTP 429 Too Many Requests';
  if (status === 999) return 'HTTP 999 (request refused)';
  if (BLOCK_URL.test(url)) return `block URL ${url}`;
  const hay = `${title}\n${String(text).slice(0, 1500)}`;
  for (const re of BLOCK_PATTERNS) {
    const m = hay.match(re);
    if (m) return m[0];
  }
  return null;
}
