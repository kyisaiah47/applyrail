// Harvester parsers, on synthetic payloads shaped like each source's real response.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { flightOf, diceJobsFromHtml, diceClassify, ANYWHERE, DEFAULT_ANYWHERE_BOARDS, tokenCandidates, harvestAnywhere } from '../src/harvest/sources.js';
import { indeed, ziprecruiter, linkedin, pageBlocked } from '../src/harvest/boards.js';
import { atsLinkIn } from '../src/harvest/resolve.js';
import { runHarvest } from '../src/harvest/index.js';
import { screenPosting } from '../src/screen.js';
import { platformFor } from '../src/ats/platforms.js';
import { Queue } from '../src/queue.js';
import { tmp } from './helpers.js';

const doc = (html, url = 'https://example.invalid/') => new JSDOM(html, { url }).window.document;
const push = (obj) => `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(obj))}])</script>`;

test('dice: the flight payload yields jobs with their easyApply flag', () => {
  const html = `<html><body>${push({ data: { jobList: [
    { id: '1', guid: '11111111-1111-1111-1111-111111111111', title: 'Senior Engineer', companyName: 'Acme', easyApply: false, detailsPageUrl: 'https://www.dice.com/job-detail/11111111-1111-1111-1111-111111111111', isRemote: true, summary: 'x' },
    { id: '2', guid: '22222222-2222-2222-2222-222222222222', title: 'Engineer II', companyName: 'Beta', easyApply: true, detailsPageUrl: 'https://www.dice.com/job-detail/22222222-2222-2222-2222-222222222222', isRemote: true },
  ] } })}</body></html>`;
  assert.ok(flightOf(html).includes('"easyApply"'));
  const jobs = diceJobsFromHtml(html);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.easyApply), [false, true]);
});

test('dice: a job is external only when both of its own signals agree', () => {
  const page = (jobsData, detail) => `<html>${push({ jobsData })}${push({ applyButtonData: { jobApplyData: { applicationDetail: detail } } })}</html>`;
  const ext = diceClassify(page({ title: 'T', applyType: 'External', description: 'd' }, { type: 'APPLY_TO_URL', url: 'https://jobs.lever.co/acme/1' }));
  assert.equal(ext.kind, 'external');
  assert.equal(ext.url, 'https://jobs.lever.co/acme/1');
  assert.equal(diceClassify(page({ title: 'T', applyType: 'Internal' }, { type: 'APPLY_TO_EMAIL', url: null })).kind, 'easy');
  assert.equal(diceClassify(page({ title: 'T', applyType: 'External' }, { type: 'APPLY_TO_URL', url: 'https://www.dice.com/x' })).kind, 'unknown');
});

test('anywhere: feeds parse; Remote OK skips its legal notice; We Work Remotely is not included', async () => {
  const ro = ANYWHERE.remoteok.parse([{ legal: 'API Terms of Service' }, { position: 'Senior Engineer', company: 'Acme', url: 'https://remoteok.com/remote-jobs/1', apply_url: 'https://jobs.lever.co/acme/1', location: 'Worldwide', description: '<p>Hi</p>' }]);
  assert.equal(ro.length, 1);
  assert.equal(ro[0].applyUrl, 'https://jobs.lever.co/acme/1');
  assert.deepEqual(DEFAULT_ANYWHERE_BOARDS, ['remoteok', 'workingnomads']);
  assert.equal(ANYWHERE.weworkremotely, undefined);
  const out = await harvestAnywhere({ boards: ['remoteok'] }, { fetchPayload: async () => [{ legal: 'x' }, { position: 'Senior Engineer', company: 'Acme', url: 'https://remoteok.com/remote-jobs/1', apply_url: 'https://jobs.lever.co/acme/1', location: 'Worldwide' }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].atsUrl, 'https://jobs.lever.co/acme/1');
  assert.equal(out[0].sourceUrl, 'https://remoteok.com/remote-jobs/1', 'the board URL is kept for attribution');
});

test('yc: board token candidates come from the slug, the name and the website', () => {
  assert.deepEqual(tokenCandidates({ slug: 'acme-robotics', name: 'Acme Robotics', website: 'https://www.acmebots.com' }), ['acme-robotics', 'acmerobotics', 'acmebots']);
});

test('indeed: cards marked Easily apply are left out; the external control is found by its words', () => {
  const d = doc('<ul><li class="job_seen_beacon"><a data-jk="abc123" class="jcs-JobTitle">Senior Engineer</a><span>Easily apply</span></li><li class="job_seen_beacon"><a data-jk="def456" class="jcs-JobTitle">Staff Engineer</a></li></ul>');
  const cards = indeed.cards(d);
  assert.deepEqual(cards.map((c) => [c.id, c.easy]), [['abc123', true], ['def456', false]]);
  const job = doc('<div><button aria-label="Apply on company site (opens in a new tab)">Apply on company site</button></div>');
  assert.equal(indeed.externalControl(job), '[data-applyrail-ext="1"]');
});

test('ziprecruiter: external is proven by the outbound redirect, 1-Click is skipped', () => {
  const ext = ziprecruiter.pane(doc('<div><a aria-label="Apply" href="/job-redirect?match_token=abc">Apply</a></div>'));
  assert.match(ext.external, /^https:\/\/www\.ziprecruiter\.com\/job-redirect\?match_token=abc/);
  const one = ziprecruiter.pane(doc('<div><button aria-label="1-Click Apply">1-Click Apply</button></div>'));
  assert.equal(one.external, null);
  assert.equal(one.oneClick, true);
});

test('linkedin: the company-website link is unwrapped from the interstitial; Easy Apply cards are marked', () => {
  const pane = doc('<a aria-label="Apply on company website" href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjobs.ashbyhq.com%2Facme%2F123&urlhash=x">Apply</a>');
  assert.equal(linkedin.external(pane), 'https://jobs.ashbyhq.com/acme/123');
  const list = doc('<div componentkey="job-card-component-ref-111">Engineer Easy Apply</div><div componentkey="job-card-component-ref-222">Engineer</div>');
  assert.deepEqual(linkedin.cards(list).map((c) => [c.id, c.easy]), [['111', true], ['222', false]]);
  assert.match(pageBlocked(doc('<p>Let us do a quick security check</p>', 'https://www.linkedin.com/checkpoint/challenge')), /block URL/);
});

test('linkedin is off unless the config turns it on', async () => {
  const q = new Queue(path.join(tmp(), 'q.jsonl'));
  const lines = [];
  const r = await runHarvest({ config: { linkedin: { enabled: false } }, queue: q, only: ['linkedin'], makeDriver: async () => ({ close: async () => {} }), log: (l) => lines.push(l) });
  assert.equal(r.found, 0);
  assert.match(lines.join('\n'), /linkedin: off/);
});

test('a careers page link resolves to the ATS', () => {
  assert.equal(atsLinkIn('<a href="https://job-boards.greenhouse.io/acme/jobs/4567">Apply</a>'), 'https://job-boards.greenhouse.io/acme/jobs/4567');
  assert.deepEqual(atsLinkIn('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>'), { greenhouseToken: 'acme' });
  assert.equal(platformFor('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/x').name, 'workday');
});

test('the screen: title, location and description', () => {
  assert.equal(screenPosting({ title: 'Sales Engineer' }).keep, false);
  assert.equal(screenPosting({ title: 'Senior Engineer', location: 'Berlin, Germany' }, { locations: ['remote', 'united states'] }).keep, false);
  assert.equal(screenPosting({ title: 'Senior Engineer', location: 'Remote, US', description: 'x'.repeat(300) }).keep, true);
  assert.equal(screenPosting({ title: 'Senior Engineer', description: 'Test job' }).keep, false);
});
