// The plain ATS register. One column, black on white, every section a heading followed by
// lines. The same content renders three ways: blocks for the PDF writer, plain text for the
// model and for checks, and HTML for a person to look at.
import { renderPdf } from './pdf.js';

export const REGISTERS = {
  plain: { description: 'Single column, Helvetica, black on white. Text extracts in reading order with the name on line 1.' },
};

/** Throws for any register that does not exist. There is no silent fallback. */
export function assertRegister(register = 'plain') {
  if (!REGISTERS[register]) throw new Error(`unknown resume register "${register}"; available: ${Object.keys(REGISTERS).join(', ')}`);
  return register;
}

const joinNonEmpty = (parts, sep) => parts.filter((p) => p != null && String(p).trim() !== '').join(sep);

export function contactLine(r) {
  const c = r.contact || {};
  return joinNonEmpty([c.email, c.phone, c.location, ...(c.links || [])], ' | ');
}

/** Resume JSON to an ordered list of blocks. */
export function toBlocks(r) {
  const blocks = [];
  blocks.push({ text: r.name, bold: true, size: 18 });
  if (r.headline) blocks.push({ text: r.headline, size: 11, gapBefore: 2 });
  blocks.push({ text: contactLine(r), size: 9.5, gapBefore: 2 });

  const heading = (t) => blocks.push({ text: t, bold: true, size: 11.5, gapBefore: 12 });

  if (r.summary) { heading('Summary'); blocks.push({ text: r.summary, size: 10, gapBefore: 2 }); }

  if (r.experience?.length) {
    heading('Work Experience');
    for (const job of r.experience) {
      blocks.push({ text: joinNonEmpty([job.company, job.title, job.dates, job.location], ' | '), bold: true, size: 10.5, gapBefore: 6 });
      for (const b of job.bullets || []) blocks.push({ text: b, size: 10, hang: '•', indent: 6, gapBefore: 1 });
    }
  }

  if (r.skills?.length) {
    heading('Skills');
    for (const s of r.skills) blocks.push({ text: `${s.label}: ${(s.items || []).join(', ')}`, size: 10, gapBefore: 1 });
  }

  if (r.projects?.length) {
    heading('Selected Projects');
    for (const p of r.projects) {
      blocks.push({ text: joinNonEmpty([p.name, p.link], ' | '), bold: true, size: 10, gapBefore: 4 });
      if (p.description) blocks.push({ text: p.description, size: 10, gapBefore: 1 });
    }
  }

  if (r.education?.length) {
    heading('Education');
    for (const e of r.education) blocks.push({ text: joinNonEmpty([e.degree, e.school, e.dates], ' | '), size: 10, gapBefore: 2 });
  }

  if (r.awards?.length) {
    heading('Awards');
    for (const a of r.awards) blocks.push({ text: a, size: 10, gapBefore: 1 });
  }
  return blocks;
}

export function toText(r) {
  return toBlocks(r).map((b) => (b.hang ? `${b.hang} ${b.text}` : b.text)).join('\n');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toHtml(r) {
  const body = [];
  body.push(`<h1>${esc(r.name)}</h1>`);
  if (r.headline) body.push(`<p class="headline">${esc(r.headline)}</p>`);
  body.push(`<p class="contact">${esc(contactLine(r))}</p>`);
  if (r.summary) body.push(`<h2>Summary</h2><p>${esc(r.summary)}</p>`);
  if (r.experience?.length) {
    body.push('<h2>Work Experience</h2>');
    for (const j of r.experience) {
      body.push(`<h3>${esc(joinNonEmpty([j.company, j.title, j.dates, j.location], ' | '))}</h3><ul>${(j.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
    }
  }
  if (r.skills?.length) body.push(`<h2>Skills</h2>${r.skills.map((s) => `<p>${esc(s.label)}: ${esc((s.items || []).join(', '))}</p>`).join('')}`);
  if (r.projects?.length) body.push(`<h2>Selected Projects</h2>${r.projects.map((p) => `<h3>${esc(joinNonEmpty([p.name, p.link], ' | '))}</h3><p>${esc(p.description || '')}</p>`).join('')}`);
  if (r.education?.length) body.push(`<h2>Education</h2>${r.education.map((e) => `<p>${esc(joinNonEmpty([e.degree, e.school, e.dates], ' | '))}</p>`).join('')}`);
  if (r.awards?.length) body.push(`<h2>Awards</h2>${r.awards.map((a) => `<p>${esc(a)}</p>`).join('')}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.name)} resume</title>
<style>body{font:14px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:#000;background:#fff;margin:40px auto;max-width:720px;padding:0 16px}h1{font-size:26px;margin:0}h2{font-size:15px;margin:22px 0 6px}h3{font-size:14px;margin:12px 0 4px}p,ul{margin:4px 0}</style>
</head><body>${body.join('\n')}</body></html>`;
}

export function toPdf(r, { register = 'plain' } = {}) {
  assertRegister(register);
  return renderPdf(toBlocks(r), { title: `${r.name} Resume`, author: r.name });
}
