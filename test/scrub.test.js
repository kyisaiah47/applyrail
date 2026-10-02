// The scrub gate fails closed. It runs here against a temporary copy with a synthetic digest file
// and a test key, so this test needs no maintainer data. Planted strings are assembled at run
// time so this file does not itself trip the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, tmp } from './helpers.js';

const KEY = 'test-key-not-a-secret';
const hm = (s) => crypto.createHmac('sha256', KEY).update(s).digest('hex').slice(0, 16);

function sandbox(files) {
  const dir = tmp('applyrail-scrub-');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'scrub-gate.mjs'), path.join(dir, 'scripts', 'scrub-gate.mjs'));
  fs.writeFileSync(path.join(dir, 'scripts', 'scrub-hashes.json'), JSON.stringify({
    version: 1,
    sets: {
      phrases: { 2: [hm('pat sample')] },
      phones: [hm('3035550199')],
      shingles: { 8: [hm('shipped the quarterly ledger rewrite for nine teams')] },
      employers: { 2: [hm('Zyxwv Analytics')] },
    },
  }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const run = (dir, env = { APPLYRAIL_SCRUB_KEY: KEY }) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'scrub-gate.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

test('a clean tree passes', () => {
  const r = run(sandbox({ 'a.js': 'export const x = 1; // Jane Example applies to Example Co\n' }));
  assert.equal(r.status, 0, r.stderr);
});

test('a missing key fails the gate', () => {
  const r = run(sandbox({ 'a.js': 'ok\n' }), {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /APPLYRAIL_SCRUB_KEY is not set/);
});

test('every class of finding fails, and personal-data matches never print the text', () => {
  const planted = [
    `path ${'/Users/'}${'admin'}/x`,
    `id ${'xowekqdstt'}${'xwbhfxvusa'}`,
    `key ${'sk-ant-'}${'a'.repeat(30)}`,
    `import ${'Stealth'}${'Plugin'} from 'x'`,
    `use ${'2cap'}${'tcha'}`,
    `Object.defineProperty(navigator, ${"'web"}${"driver'"}, {})`,
    `tool ${'compound-'}${'secret'}`,
  ].join('\n');
  const personal = ['Pat Sample lives here.', 'Call +1 (303) 555-0199.', 'I shipped the quarterly ledger rewrite for nine teams last year.', 'Applied to Zyxwv Analytics.'].join('\n');
  const r = run(sandbox({ 'planted.js': planted, 'personal.md': personal }));
  assert.equal(r.status, 1);
  for (const what of ['maintainer machine path', 'database project id', 'API key shape', 'stealth plugin', 'solver service for captchas', 'webdriver override', 'internal secret tool']) {
    assert.match(r.stderr, new RegExp(`planted\\.js:\\d+  ${what}`));
  }
  for (const what of ['name, address or profile URL', 'phone', 'resume text', 'employer from the application history']) {
    assert.match(r.stderr, new RegExp(`personal\\.md:\\d+  personal-data match \\(${what.replace(/[()]/g, '\\$&')}\\)`));
  }
  assert.doesNotMatch(r.stderr, /Zyxwv|Pat Sample|555-0199|ledger rewrite/);
});
