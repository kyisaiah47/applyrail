import { NextResponse } from 'next/server';
import { readApplications } from '@/lib/applications';

export const dynamic = 'force-dynamic';

/* The queue as JSON, newest first. */
export function GET() {
  return NextResponse.json({ applications: readApplications() });
}
