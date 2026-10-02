import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Queue, normalizeAtsUrl } from '../src/queue.js';
import { Pacer } from '../src/pacing.js';
import { tmp } from './helpers.js';

test('one job is one item however it was linked', () => {
  assert.equal(normalizeAtsUrl('https://boards.greenhouse.io/exampleco/jobs/123?gh_src=abc'), 'https://job-boards.greenhouse.io/exampleco/jobs/123');
  assert.equal(normalizeAtsUrl('https://job-boards.greenhouse.io/embed/job_app?for=exampleco&token=123'), 'https://job-boards.greenhouse.io/exampleco/jobs/123');
  assert.equal(normalizeAtsUrl('https://jobs.lever.co/exampleco/AB12-cd/apply?lever-source=x'), 'https://jobs.lever.co/exampleco/ab12-cd');
  assert.equal(normalizeAtsUrl('https://jobs.ashbyhq.com/ExampleCo/1234-abcd/application'), 'https://jobs.ashbyhq.com/exampleco/1234-abcd');
});

test('add dedupes, records source and state, and keeps history', () => {
  const q = new Queue(path.join(tmp(), 'queue.jsonl'));
  const a = q.add([{ source: 'yc', sourceUrl: 'https://www.ycombinator.com/companies/x', atsUrl: 'https://jobs.lever.co/x/1', company: 'X', title: 'Engineer' }]);
  const b = q.add([{ source: 'dice', atsUrl: 'https://jobs.lever.co/x/1/apply' }]);
  assert.equal(a.added.length, 1);
  assert.equal(b.added.length, 0);
  assert.equal(b.duplicates, 1);
  const item = q.read()[0];
  assert.equal(item.source, 'yc');
  assert.equal(item.platform, 'lever');
  assert.equal(item.state, 'queued');
  assert.equal(item.history[0].to, 'queued');
});

test('transitions follow the state machine; submitted is final', () => {
  const q = new Queue(path.join(tmp(), 'queue.jsonl'));
  const { added: [item] } = q.add([{ source: 'x', atsUrl: 'https://jobs.lever.co/x/2' }]);
  q.transition(item.id, 'filling');
  q.transition(item.id, 'submitted', 'confirmation');
  assert.throws(() => q.transition(item.id, 'queued'), /cannot move/);
  assert.equal(q.get(item.id).history.length, 3);
});

test('lease never hands out two jobs from one employer at once', () => {
  const q = new Queue(path.join(tmp(), 'queue.jsonl'));
  q.add([
    { source: 'x', atsUrl: 'https://jobs.lever.co/acme/1', company: 'Acme' },
    { source: 'x', atsUrl: 'https://jobs.lever.co/acme/2', company: 'Acme' },
    { source: 'x', atsUrl: 'https://jobs.lever.co/other/3', company: 'Other' },
  ]);
  const first = q.lease(5);
  assert.deepEqual(first.map((i) => i.company).sort(), ['Acme', 'Other']);
  assert.equal(q.lease(5).length, 0, 'Acme is busy until its first job finishes');
});

test('pacing caps are per day and per platform', () => {
  const p = new Pacer({ maxApplicationsPerDay: 2, maxPerPlatformPerDay: { lever: 1 } }, { sleep: async () => {} });
  assert.equal(p.canApply('lever').ok, true);
  p.record('lever');
  assert.equal(p.canApply('lever').ok, false);
  assert.equal(p.canApply('greenhouse').ok, true);
  p.record('greenhouse');
  assert.match(p.canApply('ashby').why, /daily cap 2/);
});
