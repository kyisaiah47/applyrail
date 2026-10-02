// `applyrail new-app <dir> --app console|simple|both` writes a Next.js dashboard of applications.
//
//   console  a dense working view: states, every application, the chosen one's history and review
//   simple   a roomier view: what went out, what needs you, each application behind a disclosure
//   both     both views, a welcome dialog that explains the page and offers the choice, and view
//            controls in the footer. The choice is kept in localStorage as applyrail:view.
//
// The app reads the ApplyRail queue file (APPLYRAIL_QUEUE, or ../.applyrail/queue.jsonl).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'app');
export const APP_MODES = ['console', 'simple', 'both'];

function copyTree(from, to, written) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyTree(a, b, written); } else { fs.copyFileSync(a, b); written.push(b); }
  }
}

const EXAMPLE = `{
  doc: ['Senior Software Engineer at Example Co', 'Remote, United States', 'Found on Remote OK'],
  fields: [
    { label: 'state', value: 'needs an answer from you' },
    { label: 'question', value: 'Do you have a current security clearance?' },
  ],
}`;

function pageFor(mode) {
  const imports = {
    console: "import ConsoleView from '@/components/ConsoleView';",
    simple: "import SimpleView from '@/components/SimpleView';",
    both: "import ConsoleView from '@/components/ConsoleView';\nimport SimpleView from '@/components/SimpleView';\nimport PageViews from '@/components/site-view/PageViews';",
  }[mode];
  const body = {
    console: '<ConsoleView apps={apps} />',
    simple: '<SimpleView apps={apps} />',
    both: '<PageViews consoleView={<ConsoleView apps={apps} />} simpleView={<SimpleView apps={apps} />} />',
  }[mode];
  return `import { readApplications } from '@/lib/applications';
${imports}

export const dynamic = 'force-dynamic';

export default function Home() {
  const apps = readApplications();
  return ${body};
}
`;
}

function layoutFor(mode) {
  const both = mode === 'both';
  return `import type { ReactNode } from 'react';
import './globals.css';
${both ? "import SiteViewProvider from '@/components/site-view/SiteViewProvider';\nimport ViewControls from '@/components/site-view/ViewControls';\nimport Mark from '@/components/site-view/Mark';\n" : ''}
export const metadata = { title: 'Applications', description: 'Job applications run by ApplyRail.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        ${both ? `<SiteViewProvider example={${EXAMPLE.replace(/\n/g, '\n        ')}}>` : ''}
        <header className="head">
          <a className="brand" href="/">${both ? '<Mark />' : '<span className="brand-dot" aria-hidden="true" />'}Applications</a>
          <a href="/api/applications">JSON</a>
        </header>
        {children}
        <footer className="foot">
          <p>
            Run by <a href="https://github.com/kyisaiah47/applyrail">ApplyRail</a>, an open-source agent from{' '}
            <a href="https://thecompound.tech">Compound Labs</a>.
          </p>
          ${both ? '<ViewControls />' : ''}
        </footer>
        ${both ? '</SiteViewProvider>' : ''}
      </body>
    </html>
  );
}
`;
}

/**
 * @param {{ dir: string, app?: 'console'|'simple'|'both', name?: string }} o
 * @returns {{ dir, app, files: string[] }}
 */
export function scaffoldApp({ dir, app = 'both', name = null }) {
  if (!APP_MODES.includes(app)) throw new Error(`--app must be one of ${APP_MODES.join(', ')}`);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  copyTree(path.join(TEMPLATES, 'base'), dir, written);
  const comp = path.join(dir, 'components');
  fs.mkdirSync(comp, { recursive: true });
  if (app === 'console' || app === 'both') copyTree(path.join(TEMPLATES, 'console', 'components'), comp, written);
  if (app === 'simple' || app === 'both') copyTree(path.join(TEMPLATES, 'simple', 'components'), comp, written);
  if (app === 'both') copyTree(path.join(TEMPLATES, 'both', 'components'), comp, written);

  const write = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); written.push(p); };
  write('app/page.tsx', pageFor(app));
  write('app/layout.tsx', layoutFor(app));
  write('package.json', `${JSON.stringify({
    name: name || path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: { next: '^15.5.0', react: '^19.1.0', 'react-dom': '^19.1.0' },
    devDependencies: { typescript: '^5.6.0', '@types/react': '^19.1.0', '@types/node': '^22.0.0' },
  }, null, 2)}\n`);
  write('tsconfig.json', `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: false, skipLibCheck: true, strict: true, noEmit: true,
      esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
      jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }], paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2)}\n`);
  write('next.config.mjs', 'export default {};\n');
  write('.gitignore', 'node_modules/\n.next/\n');
  write('README.md', `# Applications\n\nA dashboard of the job applications ApplyRail ran. It reads the ApplyRail queue file.\n\n- Set \`APPLYRAIL_QUEUE\` to the path of \`.applyrail/queue.jsonl\`, or put this app one directory below your ApplyRail project.\n- Run \`npm install\`, then \`npm run dev\`.\n\nView: ${app}.\n`);
  return { dir, app, files: written };
}
