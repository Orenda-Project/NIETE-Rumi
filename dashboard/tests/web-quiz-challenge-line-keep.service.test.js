/**
 * A number keeps its word on one line (app_settings web_quiz_challenge_line_keep, the answer's `challenge_line_keep`; default off):
 * the challenge line on a friend's door and the challenge share text join each number to the word after it with a
 * no-break space, so a balanced wrap never ends a line on «۴» with «ستارے» on the next ("4/7" and "stars" alike).
 * Off (no `challenge_line_keep`, or any value but true): today's page and words, byte for byte. wq.js runs whole in the harness's vm.
 */
const { page } = require('./wq-page-harness');

const NB = ' ';
const INVITE = 'i.CHAL12.mnopqrstuvwx';
const CH = { first: 'Amal', correct: 4, total: 7 };
const v2 = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } };
const ON = { challenge_line_keep: true };

describe.each([['wq.js landing', {}], ['identity v2 landing', { ident: true, cls: v2 }]])('%s', (_n, extra) => {
  test('on, English: "4/7 stars" stays together', () => {
    const h = page({ lang: 'en', art: { invite: INVITE }, challenge: CH, bootExtra: ON, ...extra }).html();
    expect(h).toContain('4/7' + NB + 'stars');
    expect(h).not.toContain('4/7 stars');
  });
  test('on, Urdu: «۴ ستارے» and «۷ میں» stay together', () => {
    const h = page({ lang: 'ur', art: { invite: INVITE }, challenge: CH, bootExtra: ON, ...extra }).html();
    expect(h).toContain('۴' + NB + 'ستارے');
    expect(h).toContain('۷' + NB + 'میں');
    expect(h).not.toContain('۴ ستارے');
  });
  test.each([['en'], ['ur']])('on with the fold (%s): the same joined line', (lang) => {
    const h = page({ lang, art: { invite: INVITE }, challenge: CH, bootExtra: { ...ON, challenge_fold: true }, ...extra }).html();
    expect(h).toContain(lang === 'en' ? '4/7' + NB + 'stars' : '۴' + NB + 'ستارے');
  });
  test.each([[{}], [{ challenge_line_keep: false }], [{ challenge_line_keep: 'true' }], [{ challenge_line_keep: 1 }]])('off (%j): today\'s page, byte for byte', (bootExtra) => {
    for (const lang of ['en', 'ur']) {
      const base = page({ lang, art: { invite: INVITE }, challenge: CH, ...extra }).html();
      const off = page({ lang, art: { invite: INVITE }, challenge: CH, bootExtra, ...extra }).html();
      expect(off).toBe(base);
    }
  });
});

describe('the challenge share text', () => {
  test('on, English: the number keeps its word', () => {
    const T = page({ lang: 'en', bootExtra: ON }).wq.T;
    expect(T.chalLine('Amal', 4, 7, 'Plants')).toContain('4/7' + NB + 'stars');
    expect(T.challenged('Amal', 4, 7)).toBe('Amal got 4/7' + NB + 'stars. Can you beat it?');
  });
  test.each([[{}], [{ ui: { ur2: true } }]])('on, Urdu %j: every number keeps its word, the rest is today\'s', (more) => {
    const on = page({ lang: 'ur', bootExtra: { ...ON, ...more } }).wq.T;
    const off = page({ lang: 'ur', bootExtra: more }).wq.T;
    const a = on.chalLine('نور ٹیسٹوالا', 4, 7, 'پودے');
    expect(a).not.toMatch(/[0-9۰-۹]⁩? (?=\S)/);
    expect(a.replace(/ /g, ' ')).toBe(off.chalLine('نور ٹیسٹوالا', 4, 7, 'پودے'));
    expect(on.chalPlayed('نور ٹیسٹوالا', 'پودے')).toBe(off.chalPlayed('نور ٹیسٹوالا', 'پودے'));
  });
  test('off: today\'s words', () => {
    const T = page({ lang: 'en' }).wq.T;
    expect(T.challenged('Amal', 4, 7)).toBe('Amal got 4/7 stars. Can you beat it?');
  });
});
