// The in-page half of the form filler. It maps every control on a form and applies one action
// at a time. It decides nothing: Node resolves every answer and tells the page what to set.
//
// installApplyRail() must stay self-contained. The browser driver injects it with
// Function.prototype.toString(), so it cannot use imports or anything from module scope.
// The jsdom driver calls it directly with the jsdom window.

export function installApplyRail(win) {
  if (win.__applyrail) return true;
  const doc = win.document;
  const ATTR = 'data-applyrail';
  let seq = 0;

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const text = (el) => norm(el ? (typeof el.innerText === 'string' && el.innerText ? el.innerText : el.textContent) : '');
  const cleanLabel = (s) => norm(String(s || '').replace(/[*✱]+/g, ' ').replace(/\(required\)/i, ' '));

  function handle(el) {
    if (!el.getAttribute(ATTR)) el.setAttribute(ATTR, String(++seq));
    return `[${ATTR}="${el.getAttribute(ATTR)}"]`;
  }

  function hidden(el) {
    if (!el || !el.isConnected) return true;
    if (el.closest('[hidden]')) return true;
    // react-select style phantom inputs: aria-hidden and out of the tab order. They exist only to
    // block native submit and are never a question of their own.
    if (el.getAttribute('aria-hidden') === 'true' && el.getAttribute('tabindex') === '-1') return true;
    let node = el;
    while (node && node.nodeType === 1) {
      const st = win.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden') return true;
      node = node.parentElement;
    }
    return false;
  }

  // The container that holds one question: its title and its control(s).
  const CONTAINER = [
    'fieldset', '[role="group"]', '[role="radiogroup"]',
    '.application-question', '.field-wrapper', '.field', '.form-group', '.form-field',
    '[class*="field-entry"]', '[class*="question"]', 'li',
  ].join(',');

  function titleOf(container, control) {
    if (!container) return '';
    const lb = container.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => text(doc.getElementById(id))).join(' ');
      if (norm(t)) return t;
    }
    const legend = container.querySelector(':scope > legend');
    if (legend) return text(legend);
    const head = container.querySelector(
      ':scope > label, :scope > .application-label, :scope > label > .application-label, ' +
      ':scope > [class*="question-title"], :scope > [class*="label"], :scope > h3, :scope > h4, :scope > p',
    );
    if (head && !(control && head.contains(control) && head.tagName === 'LABEL' && head.querySelectorAll('input,select,textarea').length > 0 && !head.querySelector('.application-label'))) {
      const own = head.querySelector('.application-label');
      return text(own || head);
    }
    return '';
  }

  // The question container of a radio or checkbox group: the nearest ancestor that holds every
  // option AND carries a title. An option's own <li> or <label> is never the question.
  function groupBox(group) {
    let node = group[0] && group[0].parentElement;
    while (node && !group.every((g) => node.contains(g))) node = node.parentElement;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      if (node.matches && node.matches(CONTAINER) && titleOf(node, null)) return node;
    }
    return group[0] ? group[0].closest(CONTAINER) : null;
  }

  function labelOf(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => text(doc.getElementById(id))).join(' ');
      if (norm(t)) return { text: t, source: 'aria-labelledby' };
    }
    if (el.id) {
      const l = doc.querySelector(`label[for="${(win.CSS && win.CSS.escape) ? win.CSS.escape(el.id) : el.id}"]`);
      if (l && text(l)) return { text: text(l), source: 'label-for', node: l };
    }
    const wrap = el.closest('label');
    if (wrap) {
      const inner = wrap.querySelector('.application-label');
      const t = text(inner || wrap);
      if (t) return { text: t, source: 'wrapping-label', node: inner || wrap };
    }
    if (el.getAttribute('aria-label')) return { text: el.getAttribute('aria-label'), source: 'aria-label' };
    const box = el.closest(CONTAINER);
    const t = titleOf(box, el);
    if (t) return { text: t, source: 'container' };
    if (el.placeholder) return { text: el.placeholder, source: 'placeholder' };
    return { text: el.name || '', source: 'name' };
  }

  function requiredOf(el, labelNode) {
    if (el.required) return true;
    if (el.getAttribute('aria-required') === 'true') return true;
    const box = el.closest(CONTAINER);
    const nodes = [labelNode, box && box.querySelector(':scope > label, :scope > legend, :scope > .application-label, :scope > label > .application-label')].filter(Boolean);
    for (const n of nodes) {
      if (n.querySelector && n.querySelector('.required, [class*="required" i], [aria-label="required" i]')) return true;
      if (/[*✱]\s*$/.test(text(n))) return true;
      if (n.className && /\brequired\b|_required/i.test(String(n.className))) return true;
    }
    return false;
  }

  function optionLabel(input) {
    if (input.id) {
      const l = doc.querySelector(`label[for="${input.id}"]`);
      if (l && text(l)) return text(l);
    }
    const wrap = input.closest('label');
    if (wrap) return text(wrap);
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
    return input.value || '';
  }

  function comboValue(el) {
    // A committed combobox shows its choice in a sibling node, not in the input.
    const box = el.closest('[class*="container"], .select, [class*="select"]') || el.parentElement;
    const single = box && box.querySelector('[class*="single-value"], [class*="singleValue"], [data-value-display]');
    if (single && text(single)) return text(single);
    return el.value || '';
  }

  function listboxFor(el) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (id) return doc.getElementById(id);
    const box = el.closest('[class*="container"], .select, [class*="select"]') || el.parentElement;
    return box ? box.querySelector('[role="listbox"]') : null;
  }

  function mapForm(rootSel) {
    const root = (rootSel && doc.querySelector(rootSel)) || doc.querySelector('form') || doc.body;
    const fields = [];
    const seenGroups = new Set();
    const controls = root.querySelectorAll('input, select, textarea, [role="combobox"], [role="radiogroup"]');

    for (const el of controls) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
      if (type !== 'file' && hidden(el)) continue;
      if (el.getAttribute('role') === 'radiogroup') continue; // handled through its radios

      if (type === 'radio' || type === 'checkbox') {
        const key = el.name ? `name:${el.name}` : `node:${handle(el.closest(CONTAINER) || el)}`;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const group = el.name
          ? [...root.querySelectorAll(`input[type="${type}"][name="${el.name}"]`)].filter((x) => !hidden(x))
          : [el];
        const box = groupBox(group);
        let question = titleOf(box, el);
        const single = group.length === 1 && type === 'checkbox';
        if (single && !question) question = optionLabel(el);
        if (!question) question = labelOf(el).text;
        fields.push({
          kind: type === 'radio' ? 'radio' : (single ? 'checkbox' : 'checkboxes'),
          selector: handle(el),
          name: el.name || null,
          label: cleanLabel(question),
          required: group.some((g) => requiredOf(g, null)) || requiredOf(box && box.querySelector('input') || el, null),
          options: group.map((g) => ({ label: cleanLabel(optionLabel(g)), value: g.value, selector: handle(g) })),
          value: group.filter((g) => g.checked).map((g) => cleanLabel(optionLabel(g))),
        });
        continue;
      }

      const lab = labelOf(el);
      const base = {
        selector: handle(el),
        name: el.name || null,
        id: el.id || null,
        label: cleanLabel(lab.text),
        labelSource: lab.source,
        required: requiredOf(el, lab.node),
        placeholder: el.getAttribute('placeholder') || null,
        maxLength: Number(el.getAttribute('maxlength')) > 0 ? Number(el.getAttribute('maxlength')) : null,
      };

      if (tag === 'select') {
        const opts = [...el.options].map((o, i) => ({ label: norm(o.textContent), value: o.value, index: i }));
        const real = opts.filter((o) => o.value !== '' && !/^(select|choose|please select|--)/i.test(o.label));
        fields.push({ ...base, kind: el.multiple ? 'multiselect' : 'select', options: real,
          value: el.selectedIndex >= 0 && el.options[el.selectedIndex] && el.options[el.selectedIndex].value !== '' ? norm(el.options[el.selectedIndex].textContent) : '' });
        continue;
      }
      if (el.getAttribute('role') === 'combobox') {
        const lb = listboxFor(el);
        const opts = lb ? [...lb.querySelectorAll('[role="option"]')].map((o) => ({ label: text(o), selector: handle(o) })) : [];
        fields.push({ ...base, kind: 'combobox', options: opts, value: comboValue(el) });
        continue;
      }
      if (tag === 'textarea') { fields.push({ ...base, kind: 'textarea', value: el.value || '' }); continue; }
      if (type === 'file') {
        const files = el.files ? [...el.files].map((f) => f.name) : [];
        const box = el.closest(CONTAINER);
        const shown = box && box.querySelector('.filename, [class*="file-name"], [class*="filename"]');
        fields.push({ ...base, kind: 'file', accept: el.getAttribute('accept') || null,
          value: files.length ? files.join(', ') : (shown ? text(shown) : '') });
        continue;
      }
      const kind = ['email', 'tel', 'url', 'number', 'date'].includes(type) ? type : 'text';
      fields.push({ ...base, kind, inputType: type || 'text', value: el.value || '' });
    }

    // Yes/No answered with buttons (one pressed state per question), as some ATS render it.
    const pressed = (b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true'
      || /(^|[\s_-])(active|selected)([\s_-]|$)/i.test(String(b.className || ''));
    for (const box of root.querySelectorAll(CONTAINER)) {
      if (box.querySelector('input:not([type="hidden"]), select, textarea')) continue;
      const btns = [...box.querySelectorAll('button[type="button"], [role="button"], [role="radio"]')]
        .filter((b) => !hidden(b) && !b.closest('form button[type="submit"]') && text(b).length > 0 && text(b).length < 60);
      if (btns.length < 2 || btns.length > 6) continue;
      const question = titleOf(box, null);
      if (!question) continue;
      const key = `buttons:${handle(btns[0])}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      fields.push({
        kind: 'buttons',
        selector: handle(box),
        label: cleanLabel(question),
        required: requiredOf(btns[0], box.querySelector(':scope > label, :scope > legend, :scope > [class*="label"], :scope > [class*="title"]')),
        options: btns.map((b) => ({ label: text(b), selector: handle(b) })),
        value: btns.filter(pressed).map((b) => text(b)),
      });
    }

    return { url: String(win.location && win.location.href || ''), title: doc.title || '', fields, submit: findSubmit(root) };
  }

  function findSubmit(root) {
    const scope = root || doc;
    const cands = [...scope.querySelectorAll('button, input[type="submit"], [role="button"]')].filter((b) => !hidden(b));
    const label = (b) => norm(b.value && b.tagName === 'INPUT' ? b.value : text(b));
    const submit = cands.find((b) => /^(submit( application)?|apply( now)?|send( application)?)$/i.test(label(b)))
      || cands.find((b) => (b.getAttribute('type') || '').toLowerCase() === 'submit');
    const next = cands.find((b) => /^(next|continue|save and continue|review( application)?)$/i.test(label(b)));
    return {
      submit: submit ? { selector: handle(submit), text: label(submit) } : null,
      next: next ? { selector: handle(next), text: label(next) } : null,
    };
  }

  function fire(el, type) {
    el.dispatchEvent(new win.Event(type, { bubbles: true }));
  }

  // React and similar frameworks track the value through the native setter. Setting el.value
  // directly leaves their state empty, so the form shows text and validates it as missing.
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }

  function setText(selector, value) {
    const el = doc.querySelector(selector);
    if (!el) return { ok: false, why: 'control not found' };
    let v = String(value);
    const cap = Number(el.getAttribute('maxlength'));
    if (cap > 0 && v.length > cap) {
      const cut = v.slice(0, cap);
      const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
      v = (stop > cap * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
    }
    el.focus && el.focus();
    setNativeValue(el, v);
    fire(el, 'input');
    fire(el, 'change');
    el.blur && el.blur();
    fire(el, 'blur');
    return { ok: el.value === v, value: el.value };
  }

  function selectIndex(selector, optionValue) {
    const el = doc.querySelector(selector);
    if (!el) return { ok: false, why: 'control not found' };
    const idx = [...el.options].findIndex((o) => o.value === optionValue);
    if (idx < 0) return { ok: false, why: 'option not found' };
    setNativeValue(el, el.options[idx].value);
    el.selectedIndex = idx;
    fire(el, 'input');
    fire(el, 'change');
    return { ok: el.selectedIndex === idx, value: norm(el.options[idx].textContent) };
  }

  function check(selector, want = true) {
    const el = doc.querySelector(selector);
    if (!el) return { ok: false, why: 'control not found' };
    if (!!el.checked !== !!want) el.click();
    if (!!el.checked !== !!want) { el.checked = !!want; fire(el, 'input'); fire(el, 'change'); }
    return { ok: !!el.checked === !!want };
  }

  function press(selector) {
    const el = doc.querySelector(selector);
    if (!el) return { ok: false, why: 'control not found' };
    el.click();
    return { ok: true };
  }

  function openCombobox(selector, query) {
    const el = doc.querySelector(selector);
    if (!el) return { ok: false, why: 'control not found', options: [] };
    el.focus && el.focus();
    fire(el, 'focus');
    el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    el.click();
    if (query != null) {
      setNativeValue(el, String(query));
      fire(el, 'input');
    }
    return { ok: true };
  }

  function listOptions(selector) {
    const el = doc.querySelector(selector);
    if (!el) return [];
    const lb = listboxFor(el);
    const opts = lb ? [...lb.querySelectorAll('[role="option"]')].filter((o) => !hidden(o)) : [];
    return opts.map((o) => ({ label: text(o), selector: handle(o) }));
  }

  function closeCombobox(selector) {
    const el = doc.querySelector(selector);
    if (!el) return { ok: false };
    el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.blur && el.blur();
    fire(el, 'blur');
    return { ok: true };
  }

  function pickOption(comboSelector, optionSelector) {
    const combo = doc.querySelector(comboSelector);
    const opt = doc.querySelector(optionSelector);
    if (!combo || !opt) return { ok: false, why: 'option not found' };
    opt.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    opt.click();
    return { ok: true, value: comboValue(combo) };
  }

  function readForm(rootSel) {
    return mapForm(rootSel).fields.map((f) => ({
      label: f.label, kind: f.kind, required: f.required, value: f.value, selector: f.selector,
      options: f.options ? f.options.map((o) => o.label) : null,
    }));
  }

  // A captcha that wants a person: a visible checkbox or challenge widget. An invisible score
  // (reCAPTCHA v3, an invisible hCaptcha that has not escalated) is not a challenge and is not
  // touched; the site's own script runs it when the form is submitted.
  function detectCaptcha() {
    const frames = [...doc.querySelectorAll('iframe')].filter((f) => !hidden(f));
    for (const f of frames) {
      const src = f.getAttribute('src') || '';
      if (/recaptcha\/(api2|enterprise)\/(anchor|bframe)/i.test(src) && !/size=invisible/i.test(src)) return 'reCAPTCHA challenge';
      if (/hcaptcha\.com/i.test(src) && /(challenge|frame=checkbox)/i.test(src)) return 'hCaptcha challenge';
      if (/challenges\.cloudflare\.com/i.test(src)) return 'Cloudflare Turnstile challenge';
      if (/arkoselabs|funcaptcha/i.test(src)) return 'Arkose challenge';
    }
    const widget = [...doc.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')]
      .find((w) => !hidden(w) && !/invisible/i.test(w.getAttribute('data-size') || ''));
    if (widget) return 'captcha widget on the form';
    const body = text(doc.body).slice(0, 2000);
    if (/i'?m not a robot|verify you are (a )?human|complete the (security )?challenge/i.test(body)) return 'captcha prompt in page text';
    return null;
  }

  function pageText(limit = 4000) {
    return { url: String(win.location && win.location.href || ''), title: doc.title || '', text: text(doc.body).slice(0, limit) };
  }

  function errorsShown() {
    const nodes = [...doc.querySelectorAll('[role="alert"], [aria-invalid="true"], .error, [class*="error-message"], [class*="field-error"]')]
      .filter((n) => !hidden(n));
    return nodes.map((n) => text(n) || (n.getAttribute('aria-invalid') === 'true' ? `invalid: ${labelOf(n).text}` : '')).filter(Boolean).slice(0, 20);
  }

  function confirmation() {
    const t = text(doc.body).slice(0, 4000);
    const m = t.match(/thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application/i);
    return m ? m[0] : null;
  }

  win.__applyrail = { mapForm, readForm, setText, selectIndex, check, press, openCombobox, listOptions, closeCombobox, pickOption, detectCaptcha, pageText, errorsShown, confirmation, findSubmit };
  return true;
}
