// Page drivers. Both expose the same small surface, so the filler, the reviewer and the drain
// never know which one they are using:
//
//   goto(url)                 load a page, returns { status, url }
//   call(name, ...args)       run window.__applyrail[name](...args) in the page
//   uploadFile(selector, p)   attach a local file to a file input
//   wait(ms)
//   close()
//
// jsdom runs local HTML fixtures with no browser. The browser driver runs puppeteer, either
// launching a clean headless Chrome or attaching to the user's own Chrome over CDP.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installApplyRail } from './page.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function importOptional(name, why) {
  try {
    return await import(name);
  } catch {
    throw new Error(`${why} needs the "${name}" package. Install it with: npm install ${name}`);
  }
}

/** A driver over jsdom. `goto` accepts a file path or a file:// URL. */
export async function jsdomDriver({ runScripts = true } = {}) {
  const { JSDOM } = await importOptional('jsdom', 'Filling local HTML fixtures');
  let dom = null;
  const api = () => {
    installApplyRail(dom.window);
    return dom.window.__applyrail;
  };
  return {
    name: 'jsdom',
    async goto(target) {
      const file = target.startsWith('file:') ? fileURLToPath(target) : path.resolve(target);
      const html = fs.readFileSync(file, 'utf8');
      dom = new JSDOM(html, {
        url: pathToFileURL(file).href,
        runScripts: runScripts ? 'dangerously' : undefined,
        pretendToBeVisual: true,
      });
      return { status: 200, url: dom.window.location.href };
    },
    async call(name, ...args) {
      const fn = api()[name];
      if (typeof fn !== 'function') throw new Error(`page has no ${name}()`);
      return fn(...args);
    },
    async uploadFile(selector, filePath) {
      const el = dom.window.document.querySelector(selector);
      if (!el) return { ok: false, why: 'file input not found' };
      const bytes = fs.readFileSync(filePath);
      const file = new dom.window.File([bytes], path.basename(filePath), { type: filePath.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' });
      const list = Object.assign([file], { item: (i) => (i === 0 ? file : null) });
      Object.defineProperty(el, 'files', { value: list, configurable: true });
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      return { ok: true, value: file.name };
    },
    /** Run fn(document, ...args) in the page. */
    async evaluate(fn, ...args) { return fn(dom.window.document, ...args); },
    async popupFrom() { return null; },
    async wait(ms) { await sleep(Math.min(ms, 20)); },
    get window() { return dom && dom.window; },
    async close() { if (dom) dom.window.close(); dom = null; },
  };
}

/**
 * A driver over puppeteer.
 * @param {object} opts
 * @param {string} [opts.cdpUrl] attach to a running Chrome (e.g. http://127.0.0.1:9222). The user
 *   signs in to any board in that Chrome themselves. ApplyRail never signs in.
 * @param {boolean} [opts.headless] when launching
 */
export async function browserDriver({ cdpUrl = null, headless = true, viewport = { width: 1440, height: 900 } } = {}) {
  const mod = await importOptional('puppeteer', 'The browser driver');
  const puppeteer = mod.default || mod;
  const attached = !!cdpUrl;
  // The launched browser is muted: an unattended run never plays sound.
  const browser = attached
    ? await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null })
    : await puppeteer.launch({ headless, defaultViewport: viewport, args: ['--mute-audio'] });
  // A clean, separate context per driver when launching, so one employer never sees another's cookies.
  const context = attached ? browser : (browser.createBrowserContext ? await browser.createBrowserContext() : browser);
  const page = await context.newPage();
  const install = `(${installApplyRail.toString()})(window)`;
  return {
    name: attached ? 'browser-attached' : 'browser',
    page,
    async goto(url) {
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => { throw new Error(`could not load ${url}: ${e.message}`); });
      return { status: res ? res.status() : 0, url: page.url() };
    },
    async call(name, ...args) {
      await page.evaluate(install);
      return page.evaluate((fn, rest) => window.__applyrail[fn](...rest), name, args);
    },
    async uploadFile(selector, filePath) {
      const el = await page.$(selector);
      if (!el) return { ok: false, why: 'file input not found' };
      await el.uploadFile(filePath);
      return { ok: true, value: path.basename(filePath) };
    },
    /** Run fn(document, ...args) in the page. Evaluated as an expression, so page CSP does not block it. */
    async evaluate(fn, ...args) {
      return page.evaluate(`(${fn.toString()})(document, ...${JSON.stringify(args)})`);
    },
    /** Click a control that opens a new tab, return that tab's URL, and close the tab. */
    async popupFrom(selector, { timeoutMs = 12000 } = {}) {
      const opened = new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), timeoutMs);
        page.once('popup', (p) => { clearTimeout(t); resolve(p); });
      });
      const el = await page.$(selector);
      if (!el) return null;
      await el.click();
      const tab = await opened;
      if (!tab) return page.url();
      await tab.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      const url = tab.url();
      await tab.close().catch(() => {});
      return url;
    },
    async wait(ms) { await sleep(ms); },
    async screenshot(file) { await page.screenshot({ path: file, fullPage: true }); return file; },
    async close() {
      await page.close().catch(() => {});
      if (attached) await browser.disconnect();
      else { if (context !== browser) await context.close().catch(() => {}); await browser.close(); }
    },
  };
}
