import fs from 'node:fs';
import path from 'node:path';

/* Reads the ApplyRail queue file. Set APPLYRAIL_QUEUE to its path; the default is the queue
 * of an ApplyRail project one directory up. */
export type HistoryEntry = { at: string; from?: string | null; to: string; reason?: string | null };
export type Application = {
  id: string;
  source: string;
  sourceUrl: string | null;
  atsUrl: string;
  platform: string;
  company: string | null;
  title: string | null;
  location: string | null;
  state: string;
  reason: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
  lastRun?: { at: string; dry: boolean; review?: { ok: boolean; by: string; blockers: { field: string; found: string; why: string }[] } | null } | null;
};

export const STATE_TEXT: Record<string, string> = {
  queued: 'Waiting to be applied to',
  screened_out: 'Removed by your screen',
  filling: 'Being filled now',
  dry_filled: 'Filled in a dry run; not submitted',
  needs_input: 'Needs an answer from you',
  review_blocked: 'Blocked by the review before submit',
  manual: 'Needs you to finish it',
  skipped: 'Skipped',
  stopped: 'Stopped by a captcha or a block',
  submitted: 'Submitted',
  failed: 'Failed; can be retried',
  closed: 'Posting closed',
};

/* States that need the person running ApplyRail to do something. */
export const NEEDS_YOU = ['needs_input', 'review_blocked', 'manual', 'stopped', 'failed'];

export function queueFile(): string {
  return process.env.APPLYRAIL_QUEUE || path.resolve(process.cwd(), '..', '.applyrail', 'queue.jsonl');
}

export function readApplications(): Application[] {
  const file = queueFile();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Application)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function countBy(apps: Application[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of apps) out[a.state] = (out[a.state] || 0) + 1;
  return out;
}
