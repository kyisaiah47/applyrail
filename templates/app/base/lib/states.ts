/* Types and labels shared by the server reader and the client views. No Node imports here, so
 * client components can use it. */
export type HistoryEntry = { at: string; from?: string | null; to: string; reason?: string | null };
export type Blocker = { field: string; found: string; why: string };
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
  lastRun?: { at: string; dry: boolean; review?: { ok: boolean; by: string; blockers: Blocker[] } | null } | null;
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
