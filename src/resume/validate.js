// The tailoring validator. A tailored resume ships only when every check passes. Otherwise the
// master resume is used for that job. The checks catch invention, not wording:
//   - the name, contact line, employers, titles, dates and their order never change
//   - education, projects and awards never change
//   - every number in the tailored text exists in the master resume or the fact bank
//   - every skill exists in the master resume or the fact bank
//   - the headline is one the user approved
//   - no sentence announces something the candidate has not done
//   - each role keeps between minBullets and maxBullets bullets

const digitRuns = (s) => new Set(String(s).replace(/,/g, '').match(/\d+/g) || []);
const lc = (s) => String(s || '').toLowerCase();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const GAP = /\b(no|limited|little|some) (professional |hands-on |direct )?experience (with|in)\b|\b(have|has) not (yet )?(used|worked|built)\b|\b(am|is) (still )?learning\b|\bnot (yet )?familiar\b/i;

/** Every string the tailored resume may draw a fact from. */
export function sourcesText(master, bank = {}) {
  return JSON.stringify(master) + '\n' + JSON.stringify(bank);
}

export function validateTailored(master, tailored, bank = {}, { minBullets = 1, maxBullets = 8 } = {}) {
  const problems = [];
  if (tailored.name !== master.name) problems.push('the name changed');
  if (!same(tailored.contact, master.contact)) problems.push('the contact line changed');

  const mx = master.experience || [];
  const tx = tailored.experience || [];
  if (mx.length !== tx.length) problems.push(`the number of roles changed (${mx.length} to ${tx.length})`);
  mx.forEach((m, i) => {
    const t = tx[i];
    if (!t) return;
    for (const k of ['company', 'title', 'dates', 'location']) {
      if ((m[k] || '') !== (t[k] || '')) problems.push(`role ${i + 1} ${k} changed ("${m[k]}" to "${t[k]}")`);
    }
    const n = (t.bullets || []).length;
    if (n < minBullets || n > maxBullets) problems.push(`role ${i + 1} has ${n} bullets; allowed ${minBullets} to ${maxBullets}`);
    for (const b of t.bullets || []) {
      if (!String(b).trim()) problems.push(`role ${i + 1} has an empty bullet`);
      if (String(b).length > 400) problems.push(`role ${i + 1} has a bullet over 400 characters`);
    }
  });

  for (const k of ['education', 'projects', 'awards']) {
    if (!same(tailored[k], master[k])) problems.push(`${k} changed`);
  }

  const allowedHeadlines = [master.headline, ...(bank.headlines || [])].filter(Boolean);
  if (tailored.headline && !allowedHeadlines.includes(tailored.headline)) {
    problems.push(`the headline "${tailored.headline}" is not one of the approved headlines`);
  }

  const src = sourcesText(master, bank);
  const allowed = digitRuns(src);
  const written = [tailored.headline, tailored.summary, ...tx.flatMap((t) => t.bullets || []), ...(tailored.skills || []).flatMap((s) => [s.label, ...(s.items || [])])].join(' ');
  const invented = [...digitRuns(written)].filter((d) => !allowed.has(d));
  if (invented.length) problems.push(`numbers not found in the sources: ${invented.join(', ')}`);

  const lsrc = lc(src);
  for (const s of tailored.skills || []) {
    for (const item of s.items || []) {
      if (!lsrc.includes(lc(item))) problems.push(`skill "${item}" is not in the master resume or the bank`);
    }
  }

  const gap = [tailored.summary, ...tx.flatMap((t) => t.bullets || [])].find((x) => GAP.test(String(x || '')));
  if (gap) problems.push(`announces a gap: "${String(gap).slice(0, 100)}"`);

  return problems;
}
