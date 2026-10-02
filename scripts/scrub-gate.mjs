#!/usr/bin/env node
// The scrub gate. It fails closed: any finding, or a missing key, exits non-zero.
// It has no allowlist, no skip flag and no known-issues file.
//
//   APPLYRAIL_SCRUB_KEY=... node scripts/scrub-gate.mjs
//
// It scans every file git would commit (tracked plus untracked, minus .gitignore) for:
//   1. personal email addresses, the maintainers' machine paths, project and account ids,
//      internal secret tools, social handles and DIDs
//   2. key-shaped strings (API keys, tokens, private keys)
//   3. bot-detection bypass code: stealth plugins, captcha-solving services, webdriver overrides
//   4. personal data, through keyed digests in scripts/scrub-hashes.json: the maintainer's real
//      name, phone, street address, resume text and the employers in their application history.
//      Only HMAC digests are stored, so the repo never contains the values. The check needs the
//      key in APPLYRAIL_SCRUB_KEY, which only the maintainers hold. Without it the gate fails.
//      On a match it prints the file and line, never the matched text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));
const HASHES = 'scripts/scrub-hashes.json';

// The gate's own definition files are the only files exempt from the patterns they define.
const EXEMPT = new Set([SELF, HASHES]);

const PATTERNS = [
  // 1. personal addresses, paths, ids, internal tools, handles
  ['personal email', /kyisaiah47@gmail|kyisaiah96@|isaiah\.kynth@|kynth\.studios@|fetchdue@gmail|kyysaua@/i],
  ['maintainer machine path', /\/Users\/admin\b/],
  ['database project id', /xowekqdsttxwbhfxvusa/],
  ['Stripe account id', /\bacct_1T[0-9A-Za-z]*/],
  ['internal secret tool', /\bcompound-(secret|vault)\b/],
  ['social handle or DID', /did:plc:[a-z0-9]{12,}|\bcompoundlabsinc\b|@thecompoundlabs\b|\bkynthstudios\b|\bTillDramatic1\b|(?<!github\.com\/)\bkyi+saiahh?47\b/i],
  ['real name', /\bIsaiah\b/i],
  // 2. key shapes
  ['API key shape', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\b[sr]k_live_[0-9A-Za-z]{16,}|\bpk_live_[0-9A-Za-z]{16,}|\bnpm_[A-Za-z0-9]{36}\b|\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
  // 3. bot-detection bypass
  ['stealth plugin', /puppeteer-extra-plugin-stealth|playwright-extra|puppeteer-extra\b|StealthPlugin|undetected-chromedriver/i],
  ['solver service for captchas', /2captcha|anti-?captcha|capsolver|capmonster|deathbycaptcha|captcha.?solv/i],
  ['webdriver override', /defineProperty\(\s*navigator\s*,\s*['"]webdriver|navigator\.webdriver\s*=|AutomationControlled/],
];

function files() {
  let list;
  try {
    list = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    list = [];
    const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { if (['node_modules', '.git', '.applyrail'].includes(e.name)) continue; const r = path.join(d, e.name); if (e.isDirectory()) walk(r); else list.push(r); } };
    walk('.');
  }
  return [...new Set(list)].filter((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());
}

const binary = (buf) => buf.subarray(0, 8000).includes(0);
const findings = [];

// ── keyed personal-data check ────────────────────────────────────────────────────────────────
const KEY = process.env.APPLYRAIL_SCRUB_KEY || '';
let keyed = null;
if (!KEY) {
  findings.push({ file: '(gate)', line: 0, what: 'APPLYRAIL_SCRUB_KEY is not set; the personal-data check cannot run, so the gate fails' });
} else if (!fs.existsSync(path.join(ROOT, HASHES))) {
  findings.push({ file: HASHES, line: 0, what: 'the digest file is missing' });
} else {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, HASHES), 'utf8'));
  const toSets = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [Number(k), new Set(v)]));
  keyed = { phrases: toSets(d.sets.phrases), shingles: toSets(d.sets.shingles), employers: toSets(d.sets.employers), phones: new Set(d.sets.phones || []) };
}
const hm = (s) => crypto.createHmac('sha256', KEY).update(s).digest('hex').slice(0, 16);

function tokensWithLines(text, re, lower) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const norm = ln.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    for (const m of (lower ? norm.toLowerCase() : norm).matchAll(re)) out.push({ t: m[0], line: i + 1 });
  });
  return out;
}

function keyedScan(rel, text) {
  const lower = tokensWithLines(text, /[a-z0-9]+/g, true);
  const cased = tokensWithLines(text, /[A-Za-z0-9]+/g, false);
  const slide = (toks, bySize, setName) => {
    for (const [k, set] of Object.entries(bySize)) {
      const n = Number(k);
      for (let i = 0; i + n <= toks.length; i++) {
        if (set.has(hm(toks.slice(i, i + n).map((x) => x.t).join(' ')))) {
          findings.push({ file: rel, line: toks[i].line, what: `personal-data match (${setName}); the text is not printed` });
          return;
        }
      }
    }
  };
  slide(lower, keyed.phrases, 'name, address or profile URL');
  slide(lower, keyed.shingles, 'resume text');
  slide(cased, keyed.employers, 'employer from the application history');
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 10 && keyed.phones.has(hm(digits.slice(-10)))) findings.push({ file: rel, line: i + 1, what: 'personal-data match (phone); the text is not printed' });
    }
  });
}

let scanned = 0;
for (const rel of files()) {
  if (EXEMPT.has(rel)) continue;
  const buf = fs.readFileSync(path.join(ROOT, rel));
  if (binary(buf)) continue;
  const text = buf.toString('utf8');
  scanned++;
  text.split('\n').forEach((line, i) => {
    for (const [what, re] of PATTERNS) if (re.test(line)) findings.push({ file: rel, line: i + 1, what });
  });
  if (keyed) keyedScan(rel, text);
}

if (findings.length) {
  for (const f of findings) console.error(`SCRUB FAIL  ${f.file}:${f.line}  ${f.what}`);
  console.error(`scrub gate: ${findings.length} finding(s) in ${scanned} file(s)`);
  process.exit(1);
}
console.log(`scrub gate: clean (${scanned} files, patterns and keyed personal-data check)`);
