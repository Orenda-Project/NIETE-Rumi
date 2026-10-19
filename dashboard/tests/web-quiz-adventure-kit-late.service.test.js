/**
 * The adventure look's kit (public/wq/wq-adv.js) when it runs AFTER the page is parsed: the one-response Home and the
 * early Home draw the Home before the kit's script runs, so the kit dresses it at once (no DOMContentLoaded to wait for).
 * Before, that first dressing ran before the kit had named its own helpers, threw "UR is not a function", and the Home
 * lost its "Next stop!" bubble, the trail and the primary's words. Run in a vm with a small fake page. Invented content.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-adv.js'), 'utf8');

function page(lang) {
  const html = { next: [], go: [], after: [] };
  const go = { insertAdjacentHTML: (w, h) => html.go.push(h) };
  const nx = { getAttribute: () => 'quiz', querySelector: (q) => (q === '.wq-ngo' ? go : null),
    insertAdjacentHTML: (w, h) => (w === 'afterend' ? html.after : html.next).push(h) };
  const home = { nodeType: 1, matches: (q) => q === 'section.wq-home[data-screen=home]', querySelectorAll: () => [],
    querySelector: (q) => (q === '.wq-next' ? nx : null) };
  const body = { nodeType: 1, nodeName: 'BODY', matches: () => false, querySelectorAll: () => [],
    querySelector: (q) => (q === 'section.wq-home[data-screen=home]' ? home : null) };
  const document = {
    readyState: 'complete', currentScript: { src: '/wq/wq-adv.js?v=0123456789' },
    documentElement: { lang, classList: { contains: (c) => c === 'wq-adv' } }, body,
    head: { appendChild: (n) => n }, createElement: () => ({}), addEventListener() {},
    createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [], querySelector: () => null,
  };
  const window = { document, navigator: { userAgent: 'test', connection: {} }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {} }, addEventListener() {} };
  window.window = window;
  const errors = [];
  try {
    vm.runInNewContext(SRC, { window, document, navigator: window.navigator, RegExp, Math, Date, Object, Array, String, Number });
  } catch (e) { errors.push(e.message); }
  return { html, errors, WQA: window.WQA };
}

describe.each(['en', 'ur'])('the kit loaded after the Home is drawn (%s)', (lang) => {
  test('dresses the Home at once without an error: the bubble, the trail and the primary\'s words', () => {
    const p = page(lang);
    expect(p.errors).toEqual([]);
    expect(p.WQA).toBeTruthy();
    expect(p.html.next.join('')).toContain('wqa-bub');
    expect(p.html.go.join('')).toMatch(/^<b>.+<\/b>$/);
    expect(p.html.after.join('')).not.toBe('');
  });
});
