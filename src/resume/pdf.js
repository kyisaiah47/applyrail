// A small PDF writer for the plain ATS register. No dependency, no browser.
//
// Why write PDF directly: an applicant tracking system reads a resume's text before any person
// sees its design, and a PDF holds glyphs at coordinates, not rows. A grid or a two-column layout
// extracts column by column, which can put the candidate's name on line 4 inside the contact
// block. This writer draws one column, top to bottom, one line at a time, in the standard
// Helvetica fonts, so extraction order is reading order and line 1 is the name.

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, from the standard
// Adobe font metrics.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667,
  722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556,
  222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722,
  722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611,
  722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584];

// Unicode to WinAnsiEncoding for the characters a resume commonly carries.
const WINANSI = new Map([
  [0x2022, 0x95], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94],
  [0x2013, 0x96], [0x2014, 0x97], [0x2026, 0x85], [0x20ac, 0x80], [0x2122, 0x99],
]);
const WIDE = new Map([[0x95, 350], [0x91, 222], [0x92, 222], [0x93, 333], [0x94, 333], [0x96, 556], [0x97, 1000], [0x85, 1000], [0x80, 556], [0x99, 1000]]);

/** Encode a string to WinAnsi byte codes. Unknown characters become '?'. */
export function winAnsi(str) {
  const out = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 160 && cp <= 255) out.push(cp);
    else if (WINANSI.has(cp)) out.push(WINANSI.get(cp));
    else if (cp === 9) out.push(32);
    else out.push(63);
  }
  return out;
}

export function textWidth(str, bold, size) {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const c of winAnsi(str)) w += c >= 32 && c <= 126 ? table[c - 32] : (WIDE.get(c) || 556);
  return (w * size) / 1000;
}

/** Break a string into lines no wider than maxWidth points. */
export function wrap(str, bold, size, maxWidth) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, bold, size) <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const escapePdf = (codes) => codes.map((c) => {
  if (c === 0x28 || c === 0x29 || c === 0x5c) return `\\${String.fromCharCode(c)}`;
  return String.fromCharCode(c);
}).join('');

/**
 * Render blocks to a PDF Buffer.
 * A block: { text, bold?, size?, indent?, hang?, gapBefore? }
 *   hang: text drawn in front of the first line only (a bullet), with wrapped lines aligned after it.
 */
export function renderPdf(blocks, { title = 'Resume', author = '', pageWidth = 612, pageHeight = 792, margin = 54 } = {}) {
  const maxWidth = pageWidth - margin * 2;
  const pages = [[]];
  let y = pageHeight - margin;

  for (const b of blocks) {
    const size = b.size || 10;
    const lead = size * 1.32;
    const indent = b.indent || 0;
    const hangW = b.hang ? textWidth(`${b.hang} `, !!b.bold, size) : 0;
    y -= b.gapBefore || 0;
    const lines = b.text ? wrap(b.text, !!b.bold, size, maxWidth - indent - hangW) : [''];
    lines.forEach((line, i) => {
      if (y - lead < margin) { pages.push([]); y = pageHeight - margin; }
      y -= lead;
      const x = margin + indent + (b.hang && i > 0 ? hangW : 0);
      const text = b.hang && i === 0 ? `${b.hang} ${line}` : line;
      if (text) pages[pages.length - 1].push({ x, y, size, bold: !!b.bold, text });
    });
  }

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const items of pages) {
    const ops = items.map((it) => `BT /${it.bold ? 'F2' : 'F1'} ${it.size} Tf 1 0 0 1 ${it.x.toFixed(2)} ${it.y.toFixed(2)} Tm (${escapePdf(winAnsi(it.text))}) Tj ET`).join('\n');
    const stream = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Title (${escapePdf(winAnsi(title))}) /Author (${escapePdf(winAnsi(author))}) /Producer (ApplyRail) >>`);

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
