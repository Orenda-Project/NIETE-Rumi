'use strict';
/**
 * Every tap on the teacher home is at least 48 px tall (the page's own rule for its buttons and rows). A text link
 * (`.th-link`: "See report" under a lesson row, "See all", "More") is a tap like any other, so no rule of the page's
 * stylesheet may set a `.th-link` below 48 px, inside a row or out of it. Read from the shell the bot serves, in both
 * languages and with every page part on, so a rule that only applies to one of them is caught too.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const Page = require('../../shared/services/first-touch/teacher-home.page');

// the stylesheet's rules as [selector list, declarations]; comments dropped first so a comment never matches
function rules(html) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}
const px = (decl, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([0-9.]+)px`).exec(decl);
  return m ? Number(m[1]) : null;
};

describe('the teacher home: a text link is a 48 px tap', () => {
  test.each([['en'], ['ur']])('%s: no rule sets a .th-link below 48 px tall (rows included)', (lang) => {
    const { html } = Page.buildShell({ token: 'a.b', lang, paged: true, counts: true, forward: true, reports: true });
    const linkRules = rules(html).filter(([sel]) => sel.split(',').some((s) => /\.th-link\b/.test(s)));
    expect(linkRules.length).toBeGreaterThan(0);
    const short = linkRules.filter(([, d]) => px(d, 'min-height') !== null && px(d, 'min-height') < 48).map(([s, d]) => `${s}{${d}}`);
    expect(short).toEqual([]);
    // the base rule itself still says 48
    expect(linkRules.some(([sel, d]) => sel === '.th-link' && px(d, 'min-height') === 48)).toBe(true);
  });
});
