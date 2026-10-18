'use strict';
/**
 * Every page the teacher home's switches can ask for (paged × named × early × counts × grade-fast) is built from today's
 * script by text swaps, at require time. The page module must load, each of the thirty-two pages must build, the counts
 * page must keep the home's counts on a grade change, and the early-pick page must keep its "no home yet" guard ahead of
 * it — on the fast grade chips' one library ask too. Each fast-off page is the fast-off page byte for byte.
 * (A swap that no longer matches throws at require, and the routes that require the page are then never mounted.)
 */
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const COMBOS = [];
[false, true].forEach((paged) => [false, true].forEach((named) => [false, true].forEach((early) => [false, true].forEach((counts) => [false, true].forEach((gradeFast) => COMBOS.push({ paged, named, early, counts, gradeFast }))))));
const scriptOf = (html) => html.slice(html.lastIndexOf('<script'), html.lastIndexOf('</script>'));

describe('the page for every switch combination', () => {
  let Page = null;
  test('the page module loads (no switched part has lost its place in the script)', () => {
    expect(() => { jest.isolateModules(() => { Page = require('../../shared/services/first-touch/teacher-home.page'); }); }).not.toThrow();
    expect(Page).not.toBeNull();
  });

  test.each(COMBOS)('%j: builds, in English and Urdu', (sw) => {
    expect(Page).not.toBeNull();
    ['en', 'ur'].forEach((lang) => {
      const built = Page.buildShell({ token: 't', lang, switchTo: null, asked: null, ...sw });
      expect(built.html).toContain('<script');
      expect(built.csp).toContain('script-src');
    });
  });

  test('the thirty-two pages are thirty-two different scripts', () => {
    expect(Page).not.toBeNull();
    const all = new Set(COMBOS.map((sw) => scriptOf(Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw }).html)));
    expect(all.size).toBe(32);
  });

  test.each(COMBOS.filter((sw) => sw.gradeFast))('%j: the fast grade chips are there, the early pick asked before the idle asking', (sw) => {
    expect(Page).not.toBeNull();
    const s = scriptOf(Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw }).html);
    expect(s).toContain('function libGet(n){');
    expect(s).toContain("setAttribute('data-ready','1')" + (sw.early ? ';var n=pend;pend=null;if(n!=null)pickGrade(n)' : '') + ';seed();soon()}');
    expect(s.includes('function render(){err(false);hello();')).toBe(sw.early);
    // the old one-off library ask is gone: the fast chips' libGet is the only one
    expect(s.split("getj('/api/th/library?").length).toBe(2);
  });

  test.each(COMBOS.filter((sw) => !sw.gradeFast))('%j: fast off → the same page as no fast switch at all; no fast name in it', (sw) => {
    expect(Page).not.toBeNull();
    const a = Page.buildShell({ token: 't', lang: 'ur', switchTo: null, asked: null, ...sw });
    const { gradeFast, ...rest } = sw;
    const b = Page.buildShell({ token: 't', lang: 'ur', switchTo: null, asked: null, ...rest });
    expect(a.html).toBe(b.html);
    expect(a.csp).toBe(b.csp);
    const s = scriptOf(a.html);
    ['C', 'P', 'ck', 'libGet', 'libWait', 'lite', 'next', 'pf', 'pfOn', 'press', 'seed', 'show', 'soon']
      .forEach((n) => expect([n, new RegExp(`(^|[^.\\w$'"])${n}\\b`).test(s)]).toEqual([n, false]));
  });

  test.each(COMBOS)('%j: counts → the line and the carry on a grade change; early → its guard first', (sw) => {
    expect(Page).not.toBeNull();
    const built = Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw });
    const s = scriptOf(built.html);
    const carry = 'if(d.library&&d.library.counts&&!L.counts)L.counts=d.library.counts;';
    const next = sw.gradeFast ? 'delete P[k];C[k]=L;' : 'd.library=L;'; // the fast chips hold the answer, carry included
    expect(s.includes(carry + next)).toBe(sw.counts);
    expect(s.includes("kc=q('#th-counts')")).toBe(sw.counts);
    expect(built.html.includes('id="th-counts"')).toBe(sw.counts);
    const ask = ".then(function(L){" + (sw.early ? 'if(!d)return;' : '') + (sw.counts ? carry : '') + next;
    expect(s).toContain(ask);
  });
});
