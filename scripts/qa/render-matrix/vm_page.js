/**
 * The render matrix without a browser: the shipped page (dashboard/public/wq/wq.js) in a vm with a
 * small fake DOM, booted with ONE case's real page payload (build_matrix.js pageFor). It proves every shape renders
 * through question() and feedback() without throwing, and checks what can be checked on the
 * markup itself: every option shows something, and no maths reaches the child as raw TeX or
 * as a TeX command spelled out in letters. Layout (overflow, overlap, fonts) is the browser's
 * job (run_matrix.py).
 *
 * The only change to the page source: the IIFE tail hands question() and feedback() back.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'dashboard', 'public', 'wq', 'wq.js'), 'utf8');
const TAIL = '  else landing();\n})();';
const EXPOSE = '  else landing();\n  window.__wq = { question: question, feedback: feedback, QS: QS };\n})();';
if (SRC.indexOf(TAIL) < 0) throw new Error('render-matrix: wq.js tail changed; update vm_page.js');
const EXPOSED = SRC.replace(TAIL, EXPOSE);

function fakeEl(sel) {
  return {
    sel, listeners: {}, attrs: {}, style: {}, textContent: '', innerHTML: '', parentNode: null, className: '',
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild() {}, removeChild() {}, pause() {}, play() { return Promise.resolve(); },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    focus() {}, scrollIntoView() {},
  };
}

/** The boot JSON the real shell (renderQuizPage) put in the page: what the page reads at start. */
function bootOf(shellHtml) {
  const m = /<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(String(shellHtml));
  if (!m) throw new Error('render-matrix: no boot JSON in the page shell');
  return JSON.parse(m[1]);
}

/** Boot the page on one page's boot JSON; returns { wq, html(), fb() }. */
function boot(bootJson) {
  const els = {};
  const root = fakeEl('#wq');
  root.querySelector = (sel) => { if (!els[sel]) els[sel] = fakeEl(sel); return els[sel]; };
  root.querySelectorAll = () => [];
  const bootEl = { textContent: JSON.stringify(bootJson) };
  const store = new Map();
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById: (id) => (id === 'boot' ? bootEl : id === 'wq' ? root : null),
      createElement: () => fakeEl('new'), addEventListener() {}, body: fakeEl('body'), visibilityState: 'visible',
      documentElement: fakeEl('html'),
    },
    history: { length: 1, state: null, pushState() {}, replaceState() {}, back() {} },
    location: { search: '', origin: 'https://example.test', pathname: '/q/RMTX01', assign() {}, replace() {} },
    navigator: { userAgent: 'test' },
    localStorage: { setItem: (k, v) => store.set(k, String(v)), getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => store.delete(k) },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    URLSearchParams,
    Image: function Image() {},
    setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, clearInterval() {},
    scrollTo() {}, addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(EXPOSED, ctx);
  return { wq: ctx.__wq, html: () => root.innerHTML, fb: () => (els['#wq-fb'] || {}).innerHTML || '' };
}

// ─── markup checks ────────────────────────────────────────────────────────────

const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Text a child reads, outside <math> (maths is checked on its own). */
function visibleText(html) {
  return decode(String(html)
    .replace(/<math[\s\S]*?<\/math>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}

/** Maths faults on the markup: raw TeX in the text, or a TeX command spelled out inside <math>. */
function texFaults(html) {
  const out = [];
  const text = visibleText(html);
  const raw = /\$[^$\n]+\$/.exec(text) || /\\[a-zA-Z]+/.exec(text);
  if (raw) out.push(`raw TeX shown: ${raw[0].slice(0, 40)}`);
  for (const m of String(html).matchAll(/<math[\s\S]*?<\/math>/g)) {
    // A letter run inside <mi> is a command the page did not know (\Omega shown as "Omega").
    for (const mi of m[0].matchAll(/<mi>([^<]*)<\/mi>/g)) {
      if ([...decode(mi[1])].length > 1) out.push(`TeX command shown as letters: ${decode(mi[1])}`);
    }
    // A column separator (&) or a row break (\\) that reached the page as a character; an escaped < or > is fine.
    if (/<m[io]>&amp;<\/m[io]>|<m[io]>\\<\/m[io]>/.test(m[0])) out.push('TeX layout characters shown (& or \\\\)');
  }
  return out;
}

/** Every answer control shows something: a word, or a picture/glyph. */
function optionFaults(html, q) {
  const out = [];
  const kind = String(q.type || '');
  if (kind === 'label') {
    const hot = (String(html).match(/class="wq-hot"/g) || []).length;
    if (!hot) out.push('label item drew no hotspots');
    return out;
  }
  const btns = [...String(html).matchAll(/<button class="wq-(?:opt|mr)\b[^"]*"[^>]*data-slot="([A-D])"[^>]*>([\s\S]*?)<\/button>/g)];
  if (btns.length !== (q.options || []).length) out.push(`options drawn ${btns.length} of ${(q.options || []).length}`);
  for (const [, slot, inner] of btns) {
    const words = visibleText(inner.replace(/<span class="wq-shp">[\s\S]*?<\/span>/, '')).trim();
    const math = /<math/.test(inner);
    const pic = /<svg|<img|wq-glyph|wq-emoji/.test(inner.replace(/<span class="wq-shp">[\s\S]*?<\/span>/, ''));
    if (!words && !math && !pic) out.push(`option ${slot} is blank`);
  }
  return out;
}

/** Render the question at index i through question() and both feedback screens; returns { faults, screens }. */
function renderCase(q, shellHtml, i, a) {
  const faults = [];
  const screens = {};
  let page;
  try {
    page = boot(bootOf(shellHtml));
    page.wq.question(i);
    screens.question = page.html();
  } catch (e) {
    return { faults: [`question() threw: ${e.message}`], screens };
  }
  faults.push(...optionFaults(screens.question, q), ...texFaults(screens.question));
  for (const [name, slot, ok] of [['wrong', a.wrong, false], ['right', a.right, true]]) {
    try {
      page.wq.question(i);
      page.wq.feedback(page.wq.QS[i], i, slot, ok, false);
      screens[name] = page.fb();
      faults.push(...texFaults(screens[name]).map((f) => `${name}: ${f}`));
    } catch (e) {
      faults.push(`feedback(${name}) threw: ${e.message}`);
    }
  }
  return { faults, screens };
}

module.exports = { boot, bootOf, renderCase, texFaults, optionFaults, visibleText, EXPOSED, SRC };
