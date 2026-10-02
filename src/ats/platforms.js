// The applicant tracking systems ApplyRail knows by URL, and what each needs.
//
// None of these platforms has a candidate submit API. Their "create candidate" endpoints take
// the EMPLOYER's API key and exist for a company wiring its own careers site. ApplyRail reads
// public job data over anonymous HTTP and fills the employer's own application page in a browser.
import { getJson } from '../http.js';

const host = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export const PLATFORMS = [
  {
    name: 'greenhouse',
    match: (h) => h === 'greenhouse.io' || h.endsWith('.greenhouse.io'),
    // The job page carries the application form below the description.
    applyUrl: (url) => url,
    parse(url) {
      const m = new URL(url).pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
      return m ? { board: m[1], id: m[2] } : null;
    },
    /** Public Job Board API: every open job for one board token, with descriptions. */
    async listJobs(board, opts) {
      const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`, opts);
      return (data.jobs || []).map((j) => ({
        atsUrl: `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`,
        title: j.title, company: j.company_name || board, location: j.location?.name || null,
        description: strip(j.content ? j.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''),
        postedAt: j.updated_at || null,
      }));
    },
  },
  {
    name: 'lever',
    match: (h) => h === 'jobs.lever.co',
    applyUrl: (url) => `${url.replace(/\/+$/, '').replace(/\/apply$/, '')}/apply`,
    parse(url) {
      const [site, id] = new URL(url).pathname.replace(/^\/+/, '').split('/');
      return site && id ? { site, id } : null;
    },
    async listJobs(site, opts) {
      const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`, opts);
      return (Array.isArray(data) ? data : []).map((j) => ({
        atsUrl: j.hostedUrl || `https://jobs.lever.co/${site}/${j.id}`,
        title: j.text, company: site, location: j.categories?.location || null,
        description: j.descriptionPlain || strip(j.description), postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      }));
    },
  },
  {
    name: 'ashby',
    match: (h) => h === 'jobs.ashbyhq.com',
    applyUrl: (url) => `${url.replace(/\/+$/, '').replace(/\/application$/, '')}/application`,
    parse(url) {
      const [org, id] = new URL(url).pathname.replace(/^\/+/, '').split('/');
      return org && id ? { org, id } : null;
    },
    async listJobs(org, opts) {
      const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`, opts);
      return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
        atsUrl: j.jobUrl || `https://jobs.ashbyhq.com/${org}/${j.id}`,
        title: j.title, company: org, location: j.location || null,
        description: j.descriptionPlain || strip(j.descriptionHtml), postedAt: j.publishedAt || null,
        salary: j.compensation?.compensationTierSummary || null,
      }));
    },
  },
  {
    name: 'workable',
    match: (h) => h === 'apply.workable.com',
    applyUrl: (url) => `${url.replace(/\/+$/, '').replace(/\/apply$/, '')}/apply/`,
    parse(url) {
      const m = new URL(url).pathname.match(/^\/([^/]+)\/j\/([A-Za-z0-9]+)/);
      return m ? { account: m[1], shortcode: m[2] } : null;
    },
  },
  {
    name: 'workday',
    match: (h) => h.endsWith('.myworkdayjobs.com') || h.endsWith('.myworkdaysite.com'),
    // Workday asks for a candidate account on each employer's tenant and saves a record from
    // the first step. ApplyRail never creates accounts or signs in, so a Workday job is filled
    // only when the user is already signed in to that tenant in an attached browser, and it is
    // attempted once, never retried.
    accountRequired: true,
    writeOnce: true,
    applyUrl: (url) => url,
  },
  { name: 'smartrecruiters', match: (h) => h === 'jobs.smartrecruiters.com', applyUrl: (url) => url },
  { name: 'icims', match: (h) => h.endsWith('.icims.com'), writeOnce: true, accountRequired: true, applyUrl: (url) => url },
  { name: 'jobvite', match: (h) => h === 'jobs.jobvite.com', applyUrl: (url) => url },
  { name: 'bamboohr', match: (h) => h.endsWith('.bamboohr.com'), applyUrl: (url) => url },
  { name: 'rippling', match: (h) => h === 'ats.rippling.com', applyUrl: (url) => url },
  { name: 'recruitee', match: (h) => h.endsWith('.recruitee.com'), applyUrl: (url) => url },
  { name: 'teamtailor', match: (h) => h.endsWith('.teamtailor.com'), applyUrl: (url) => url },
  { name: 'breezy', match: (h) => h.endsWith('.breezy.hr'), applyUrl: (url) => url },
];

export const LONGTAIL = { name: 'longtail', match: () => true, applyUrl: (url) => url };

/** The platform that serves this URL. Unknown hosts are the long tail. */
export function platformFor(url) {
  const h = host(url);
  if (!h) return null;
  return PLATFORMS.find((p) => p.match(h)) || LONGTAIL;
}

/** Is this URL an employer's ATS (as opposed to a board's own page or a tracker)? */
export function isKnownAts(url) {
  const p = platformFor(url);
  return !!p && p.name !== 'longtail';
}

export const ATS_HOST_RE = /https?:\/\/(?:job-boards\.|boards\.)?greenhouse\.io\/[^\s"'<>]+|https?:\/\/jobs\.lever\.co\/[^\s"'<>]+|https?:\/\/jobs\.ashbyhq\.com\/[^\s"'<>]+|https?:\/\/apply\.workable\.com\/[^\s"'<>]+|https?:\/\/[a-z0-9-]+\.(?:wd\d+\.)?myworkdayjobs\.com\/[^\s"'<>]+|https?:\/\/jobs\.smartrecruiters\.com\/[^\s"'<>]+/gi;
