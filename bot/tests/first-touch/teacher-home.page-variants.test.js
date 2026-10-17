'use strict';
/**
 * Every page the teacher home's switches can ask for (paged × named × early × counts) is built from today's script by
 * text swaps, at require time. The page module must load, each of the sixteen pages must build, the counts page must
 * keep the home's counts on a grade change, and the early-pick page must keep its "no home yet" guard ahead of it.
 * (A swap that no longer matches throws at require, and the routes that require the page are then never mounted.)
 */
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const COMBOS = [];
[false, true].forEach((paged) => [false, true].forEach((named) => [false, true].forEach((early) => [false, true].forEach((counts) => COMBOS.push({ paged, named, early, counts })))));
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

  test('the sixteen pages are sixteen different scripts', () => {
    expect(Page).not.toBeNull();
    const all = new Set(COMBOS.map((sw) => scriptOf(Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw }).html)));
    expect(all.size).toBe(16);
  });

  test.each(COMBOS)('%j: counts → the line and the carry on a grade change; early → its guard first', (sw) => {
    expect(Page).not.toBeNull();
    const built = Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw });
    const s = scriptOf(built.html);
    const carry = 'if(d.library&&d.library.counts&&!L.counts)L.counts=d.library.counts;d.library=L;';
    expect(s.includes(carry)).toBe(sw.counts);
    expect(s.includes("kc=q('#th-counts')")).toBe(sw.counts);
    expect(built.html.includes('id="th-counts"')).toBe(sw.counts);
    const ask = ".then(function(L){" + (sw.early ? 'if(!d)return;' : '') + (sw.counts ? carry : 'd.library=L;');
    expect(s).toContain(ask);
  });
});
