// From a board's link to the employer's own application URL, over plain HTTP.
import { request, getText } from '../http.js';
import { isKnownAts, ATS_HOST_RE } from '../ats/platforms.js';

const TRACKER_HOST = /(^|\.)(grnh\.se|lnkd\.in|prng\.co|talent\.com|adzuna\.[a-z.]+|jobs2careers\.com|appcast\.io|clickcast\.[a-z]+|jobrapido\.com|neuvoo\.[a-z.]+|bit\.ly|t\.co)$/i;

/** Follow tracker redirects until the URL is not a tracker. */
export async function followTrackers(url, { hops = 4, fetchImpl } = {}) {
  let current = url;
  for (let i = 0; i < hops; i++) {
    let host;
    try { host = new URL(current).hostname; } catch { return current; }
    if (!TRACKER_HOST.test(host) && !/\/(redirect|go|click)\b/i.test(new URL(current).pathname)) return current;
    try {
      const res = await request(current, { method: 'GET', fetchImpl, retries: 0, timeoutMs: 15000 });
      if (res.url && res.url !== current) { current = res.url; continue; }
      return current;
    } catch { return current; }
  }
  return current;
}

/** Find an employer ATS link inside an HTML page. */
export function atsLinkIn(html) {
  const found = String(html).match(ATS_HOST_RE) || [];
  const clean = found.map((u) => u.replace(/&amp;/g, '&').replace(/[)\].,;]+$/, ''));
  const job = clean.find((u) => /\/jobs\/\d+|jobs\.lever\.co\/[^/]+\/[0-9a-f-]{8,}|jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{8,}|\/j\/[A-Z0-9]{6,}|myworkdayjobs\.com\/.+\/job\//i.test(u));
  if (job) return job;
  // A careers page that embeds Greenhouse names the board token and passes the job id as gh_jid.
  const token = String(html).match(/greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\?for=([A-Za-z0-9_-]+)/);
  return token ? { greenhouseToken: token[1] } : null;
}

/**
 * Resolve a board link to an employer ATS URL. Returns { atsUrl, via } or null.
 * A link that already is an ATS URL is returned as is.
 */
export async function resolveToAts(url, { fetchImpl } = {}) {
  if (!url) return null;
  if (isKnownAts(url)) return { atsUrl: url, via: 'direct' };
  const followed = await followTrackers(url, { fetchImpl });
  if (isKnownAts(followed)) return { atsUrl: followed, via: 'redirect' };
  try {
    const { text, url: finalUrl } = await getText(followed, { fetchImpl, retries: 0, timeoutMs: 20000 });
    if (isKnownAts(finalUrl)) return { atsUrl: finalUrl, via: 'redirect' };
    const link = atsLinkIn(text);
    if (typeof link === 'string') return { atsUrl: link, via: 'link on page' };
    const jid = new URL(finalUrl).searchParams.get('gh_jid');
    if (link?.greenhouseToken && jid) return { atsUrl: `https://job-boards.greenhouse.io/${link.greenhouseToken}/jobs/${jid}`, via: 'greenhouse embed' };
    return { atsUrl: finalUrl, via: 'company page (long tail)' };
  } catch {
    return null;
  }
}
