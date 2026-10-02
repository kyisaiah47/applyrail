'use client';

import { useMemo, useState } from 'react';
import type { Application } from '@/lib/applications';
import { STATE_TEXT } from '@/lib/applications';
import './console.css';

/* THE CONSOLE. Three columns edge to edge: the states on the left, every application in the
 * middle, and the chosen application on the right with its history and its review. */
export default function ConsoleView({ apps }: { apps: Application[] }) {
  const [filter, setFilter] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(apps[0]?.id ?? null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) c[a.state] = (c[a.state] || 0) + 1;
    return c;
  }, [apps]);
  const shown = filter === 'all' ? apps : apps.filter((a) => a.state === filter);
  const chosen = apps.find((a) => a.id === sel) ?? shown[0] ?? null;

  if (!apps.length) {
    return (
      <p className="empty">
        The queue is empty. Run <code>applyrail harvest</code>, then <code>applyrail drain --dry</code>.
      </p>
    );
  }

  return (
    <div className="console">
      <nav className="console-states" aria-label="Filter by state">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          <span>All</span>
          <span className="n">{apps.length}</span>
        </button>
        {Object.keys(STATE_TEXT)
          .filter((s) => counts[s])
          .map((s) => (
            <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              <span>{STATE_TEXT[s]}</span>
              <span className="n">{counts[s]}</span>
            </button>
          ))}
      </nav>

      <div className="console-table" role="region" aria-label="Applications" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Role</th>
              <th scope="col">ATS</th>
              <th scope="col">Source</th>
              <th scope="col">State</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} data-selected={chosen?.id === a.id} onClick={() => setSel(a.id)}>
                <td>{a.company || '?'}</td>
                <td>
                  <button type="button" onClick={() => setSel(a.id)}>{a.title || '(untitled)'}</button>
                </td>
                <td className="mono">{a.platform}</td>
                <td className="mono">{a.source}</td>
                <td><span className="state" data-state={a.state}>{a.state}</span></td>
                <td className="mono">{a.updatedAt.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="console-detail" aria-label="Selected application">
        {chosen ? (
          <>
            <h2>{chosen.title || '(untitled)'}</h2>
            <p className="dim">{chosen.company || '?'}{chosen.location ? ` · ${chosen.location}` : ''}</p>
            <p><span className="state" data-state={chosen.state}>{STATE_TEXT[chosen.state] || chosen.state}</span></p>
            {chosen.reason ? <p className="reason">{chosen.reason}</p> : null}
            <dl>
              <div><dt>Application page</dt><dd><a href={chosen.atsUrl} target="_blank" rel="noreferrer">{chosen.atsUrl}</a></dd></div>
              {chosen.sourceUrl ? <div><dt>Found on</dt><dd><a href={chosen.sourceUrl} target="_blank" rel="noreferrer">{chosen.source}</a></dd></div> : null}
              <div><dt>Attempts</dt><dd>{chosen.attempts}</dd></div>
            </dl>
            {chosen.lastRun?.review && !chosen.lastRun.review.ok ? (
              <section>
                <h3>What the review blocked</h3>
                <ul>
                  {chosen.lastRun.review.blockers.map((b, i) => (
                    <li key={i}><b>{b.field}</b>: {b.why}{b.found ? <> (found <code>{b.found}</code>)</> : null}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <h3>History</h3>
              <ol className="history">
                {chosen.history.map((h, i) => (
                  <li key={i}><span className="mono">{h.at.slice(0, 16).replace('T', ' ')}</span> {h.to}{h.reason ? `: ${h.reason}` : ''}</li>
                ))}
              </ol>
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
}
