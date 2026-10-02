'use client';

import type { Application } from '@/lib/states';
import { NEEDS_YOU, STATE_TEXT } from '@/lib/states';
import Disclosure from './Disclosure';
import './simple.css';

/* THE SIMPLE VIEW. What went out, then what needs you, then everything else. Each application
 * is one readable card; its history and its review sit behind a disclosure. */
export default function SimpleView({ apps }: { apps: Application[] }) {
  const sent = apps.filter((a) => a.state === 'submitted');
  const needs = apps.filter((a) => NEEDS_YOU.includes(a.state));
  const rest = apps.filter((a) => a.state !== 'submitted' && !NEEDS_YOU.includes(a.state));

  return (
    <main className="sv-page">
      <section className="sv-intro">
        <h1>Your job applications</h1>
        <p>
          ApplyRail fills each employer&rsquo;s application form, checks it against your profile, and submits it
          only when the check passes. This page reads your ApplyRail queue.
        </p>
        <p className="sv-sentence">
          {sent.length === 1 ? '1 application was submitted.' : `${sent.length} applications were submitted.`}{' '}
          {needs.length === 1 ? '1 application needs you.' : `${needs.length} applications need you.`}
        </p>
      </section>

      {!apps.length ? (
        <p className="sv-note">The queue is empty. Run <code>applyrail harvest</code>, then <code>applyrail drain --dry</code>.</p>
      ) : null}

      {needs.length ? <Group title="These need you" apps={needs} /> : null}
      {sent.length ? <Group title="Submitted" apps={sent} /> : null}
      {rest.length ? <Group title="Everything else" apps={rest} /> : null}
    </main>
  );
}

function Group({ title, apps }: { title: string; apps: Application[] }) {
  return (
    <section className="sv-group">
      <h2>{title}</h2>
      <ul>
        {apps.map((a) => (
          <li key={a.id} className="sv-card">
            <div className="sv-card-top">
              <div>
                <h3>{a.title || '(untitled)'}</h3>
                <p>{a.company || 'Unknown company'}{a.location ? `, ${a.location}` : ''}</p>
              </div>
              <span className="state" data-state={a.state}>{STATE_TEXT[a.state] || a.state}</span>
            </div>
            {a.reason ? <p className="sv-reason">{a.reason}</p> : null}
            <Disclosure title="Details">
              <p>
                Application page: <a href={a.atsUrl} target="_blank" rel="noreferrer">{a.atsUrl}</a>
              </p>
              {a.sourceUrl ? (
                <p>
                  Found on <a href={a.sourceUrl} target="_blank" rel="noreferrer">{a.source}</a>.
                </p>
              ) : null}
              {a.lastRun?.review && !a.lastRun.review.ok ? (
                <ul className="sv-list">
                  {a.lastRun.review.blockers.map((b, i) => (
                    <li key={i}>{b.field}: {b.why}</li>
                  ))}
                </ul>
              ) : null}
              <ol className="sv-list">
                {a.history.map((h, i) => (
                  <li key={i}>{h.at.slice(0, 10)}: {STATE_TEXT[h.to] || h.to}{h.reason ? `. ${h.reason}` : ''}</li>
                ))}
              </ol>
            </Disclosure>
          </li>
        ))}
      </ul>
    </section>
  );
}
