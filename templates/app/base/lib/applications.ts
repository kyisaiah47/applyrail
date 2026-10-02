import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Application } from './states';

export type { Application } from './states';

/* Reads the ApplyRail queue file on the server. Set APPLYRAIL_QUEUE to its path; the default is
 * the queue of an ApplyRail project one directory up. */
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
