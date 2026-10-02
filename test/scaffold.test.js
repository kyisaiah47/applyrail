import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scaffoldApp } from '../src/app/scaffold.js';
import { tmp } from './helpers.js';

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('--app console writes the Console view only', () => {
  const dir = path.join(tmp(), 'dash');
  scaffoldApp({ dir, app: 'console' });
  assert.match(read(dir, 'app/page.tsx'), /<ConsoleView apps=\{apps\} \/>/);
  assert.ok(fs.existsSync(path.join(dir, 'components/ConsoleView.tsx')));
  assert.ok(!fs.existsSync(path.join(dir, 'components/SimpleView.tsx')));
  assert.ok(!fs.existsSync(path.join(dir, 'components/site-view')));
  assert.match(read(dir, 'lib/applications.ts'), /APPLYRAIL_QUEUE/);
});

test('--app simple writes the Simple view only', () => {
  const dir = path.join(tmp(), 'dash');
  scaffoldApp({ dir, app: 'simple' });
  assert.match(read(dir, 'app/page.tsx'), /<SimpleView apps=\{apps\} \/>/);
  assert.ok(fs.existsSync(path.join(dir, 'components/Disclosure.tsx')));
  assert.ok(!fs.existsSync(path.join(dir, 'components/ConsoleView.tsx')));
});

test('--app both writes both views, the welcome dialog and the view controls', () => {
  const dir = path.join(tmp(), 'dash');
  const r = scaffoldApp({ dir, app: 'both' });
  assert.match(read(dir, 'app/page.tsx'), /PageViews consoleView=/);
  assert.match(read(dir, 'app/layout.tsx'), /<SiteViewProvider example=/);
  assert.match(read(dir, 'app/layout.tsx'), /<ViewControls \/>/);
  assert.match(read(dir, 'components/site-view/SiteViewProvider.tsx'), /'applyrail:view'/);
  assert.match(read(dir, 'components/site-view/Welcome.tsx'), /Which of your applications went out, and which need you\?/);
  assert.ok(r.files.length > 10);
  assert.throws(() => scaffoldApp({ dir, app: 'both' }), /not empty/);
  assert.throws(() => scaffoldApp({ dir: path.join(tmp(), 'x'), app: 'fancy' }), /--app must be one of/);
});
