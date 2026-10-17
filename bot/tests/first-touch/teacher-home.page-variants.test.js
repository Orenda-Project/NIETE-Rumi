'use strict';
/**
 * Every page the teacher home's switches can ask for (paged × named × early) is built from today's script by text
 * swaps, at require time. The page module must load with the story counts line in the script, each of the eight pages
 * must build, and the early-pick page must keep both the counts carry on a grade change and its "no home yet" guard.
 * (A swap that no longer matches throws at require, and the routes that require the page are then never mounted.)
 */
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const COMBOS = [];
[false, true].forEach((paged) => [false, true].forEach((named) => [false, true].forEach((early) => COMBOS.push({ paged, named, early }))));
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

  test('the eight pages are eight different scripts', () => {
    expect(Page).not.toBeNull();
    const all = new Set(COMBOS.map((sw) => scriptOf(Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw }).html)));
    expect(all.size).toBe(8);
  });

  test.each(COMBOS)('%j: a grade change keeps the home\'s counts; early waits for the home first', (sw) => {
    expect(Page).not.toBeNull();
    const s = scriptOf(Page.buildShell({ token: 't', lang: 'en', switchTo: null, asked: null, ...sw }).html);
    expect(s).toContain('if(d.library&&d.library.counts&&!L.counts)L.counts=d.library.counts;d.library=L;');
    const guarded = s.includes('.then(function(L){if(!d)return;if(d.library&&d.library.counts');
    expect(guarded).toBe(sw.early);
  });
});
