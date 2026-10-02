'use client';

/* START HERE. What this dashboard shows, one labelled illustration of an application, and the
 * choice of view. Opens by itself on `/` unless the visitor turned it off or `?welcome=0` is
 * present. Closing or choosing never turns it off; the checkbox does.
 *
 * The illustration is a made-up application. The layout passes it in. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Mark from './Mark';
import { useSiteView, WELCOME_EVENT, WELCOME_OFF_KEY, type SiteView } from './SiteViewProvider';

export interface WelcomeExample {
  doc: string[];
  fields: { label: string; value: string }[];
}

function readOff(): boolean {
  try {
    return localStorage.getItem(WELCOME_OFF_KEY) === '1';
  } catch {
    return false; /* storage blocked: treat as not suppressed */
  }
}

export default function Welcome({ example }: { example: WelcomeExample }) {
  const mode = useSiteView();
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [off, setOff] = useState(false);
  const [visible, setVisible] = useState(false);
  /* The body mounts only while the dialog is open, so its heading and paragraph are never part of
   * a page's own content (scripts/derive-guide-faqs.mjs reads every h2 on a guide). */
  const [mounted, setMounted] = useState(false);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOff(readOff());
    const el = dialog.current;
    if (!el) return;
    setMounted(true);
    if (!el.open) {
      previous.current = document.activeElement as HTMLElement | null;
      el.showModal();
    }
    requestAnimationFrame(() => {
      setVisible(true);
      /* The body mounted after showModal, so autofocus may not have run; focus the close button. */
      if (!el.contains(document.activeElement) || document.activeElement === el) el.querySelector<HTMLElement>('.sv-welcome-top > button')?.focus();
    });
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setMounted(false);
      const back = previous.current;
      if (back && back.isConnected && back !== document.body) back.focus();
      else document.querySelector<HTMLElement>('#start .sv-select-btn, .sv-nav a, .head .brand')?.focus({ preventScroll: true });
    }, reduced ? 0 : 220);
  }, []);

  useEffect(() => {
    const disabled = readOff();
    const q = new URLSearchParams(window.location.search);
    // The dialog opens from browser-only facts (storage and the URL), so it opens after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (path === '/' && !disabled && q.get('welcome') !== '0') show();
    window.addEventListener(WELCOME_EVENT, show);
    return () => {
      window.removeEventListener(WELCOME_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path, show]);

  function select(view: SiteView) {
    mode?.choose(view);
    close();
  }

  return (
    <dialog
      ref={dialog}
      className="sv-welcome"
      data-visible={visible}
      aria-labelledby="sv-welcome-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      {mounted ? (
        <>
      <header className="sv-welcome-top">
        <span className="sv-brand">
          <Mark width={22} height={16} />
          ApplyRail <small>/ START HERE</small>
        </span>
        <button type="button" aria-label="Close welcome" onClick={close} autoFocus>
          ×
        </button>
      </header>
      <div className="sv-welcome-intro">
        <span className="sv-eyebrow">YOUR APPLICATIONS</span>
        <h2 id="sv-welcome-title">Which of your applications went out, and which need you?</h2>
        <p>
          ApplyRail fills each employer&rsquo;s application form from your profile, checks the finished form, and
          submits it only when the check passes. This page reads your ApplyRail queue and shows what happened to each job.
        </p>
      </div>
      <section className="sv-illustration" aria-label="Illustration of one application">
        <div>
          <span>ONE APPLICATION</span>
          <span>ILLUSTRATION</span>
        </div>
        <p>ApplyRail found this job and filled its form.</p>
        <pre className="sv-illustration-doc">{example.doc.join('\n')}</pre>
        <p>The review held it back until you answer one question.</p>
        <dl className="sv-illustration-answer">
          {example.fields.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        <p>This example is made up. Your own applications are on the page behind this dialog.</p>
      </section>
      <section className="sv-welcome-choose">
        <div>
          <h3>How would you like to explore?</h3>
          <p>You can switch anytime.</p>
        </div>
        <div className="sv-choices">
          <button type="button" onClick={() => select('console')}>
            <span>
              ▦ <b>Console</b>
              <span aria-hidden="true">↗</span>
            </span>
            <strong>See more at once.</strong>
            <span>A compact layout with more data and controls on screen.</span>
          </button>
          <button type="button" onClick={() => select('simple')}>
            <span>
              ☰ <b>Simple</b>
              <span aria-hidden="true">↗</span>
            </span>
            <strong>Start with the essentials.</strong>
            <span>A roomier overview with details you can open as you go.</span>
          </button>
        </div>
      </section>
      <footer>
        <label>
          <input
            type="checkbox"
            checked={off}
            onChange={(e) => {
              const value = e.target.checked;
              setOff(value);
              try {
                if (value) localStorage.setItem(WELCOME_OFF_KEY, '1');
                else localStorage.removeItem(WELCOME_OFF_KEY);
              } catch {
                /* storage blocked: the choice lasts this visit */
              }
            }}
          />
          Don&rsquo;t open this when I come back
        </label>
      </footer>
        </>
      ) : null}
    </dialog>
  );
}
