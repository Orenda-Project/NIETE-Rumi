/**
 * The class table with the look (boot adv + <html class="wq-adv">) and class_doors:
 *  - the "First names only. Ties share a place." note has its own row above the rows, never near the sticky button;
 *  - Play is the one primary (sticky), Share the class table goes soft; a child with a result keeps Share as the primary;
 *  - the league header is "League table" with the class list as a small line under it (2 even lines, never a break
 *    inside the list).
 * Without the look the screen is today's. Invented children only.
 */
const { page, flush } = require('./wq-page-harness');

const ADV = { htmlClass: ['wq-adv'] };
const CLS = { label: 'Classes 2, 3, 4, 5', teacher: 'Ms Testwala', chips: [] };
const BOARD = { rows: [{ place: 1, first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5 }], you: null, finishers_n: 1, class_avg_pct: 60, class_doors: true };
const CHILD = { first: 'Zara Testwala', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5, stars: 3, nth: 6 }, score: { correct: 3, total: 5, pct: 60 } };
const primaries = (h) => (h.match(/\sdata-primary[\s>=]/g) || []).length;

const boardPage = async (o = {}) => {
  const adv = o.adv !== false;
  const store = o.result ? { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT, vdone: true } } : {};
  const p = page({ lang: o.lang || 'en', cls: CLS, view: 'class', lib: true, store, bootExtra: { nav: { home: true }, ...(adv ? { adv: true } : {}) }, ...(adv ? ADV : {}), api: { '/board/TEST': BOARD } });
  p.sess.set('wq_hub_at', '/h/abc');
  await flush(); await flush();
  if (o.result) { p.wq.board(); await flush(); await flush(); }
  return p;
};

describe('the class table with the look', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: the names note has its own row above the rows, under the topic line, far from every button`, async () => {
      const p = await boardPage({ lang });
      const h = p.html();
      expect(p.moment()).toBe('M11');
      const note = h.indexOf('<p class="wq-small wq-tnote">');
      expect(note).toBeGreaterThan(h.indexOf('<p class="wq-sub">'));
      expect(note).toBeLessThan(h.indexOf('<table class="wq-table"'));
      expect(note).toBeLessThan(h.indexOf('<button class="wq-btn'));
    });
    test(`${lang}: Play is the one primary and sticky; Share is soft, after Play`, async () => {
      const p = await boardPage({ lang });
      const h = p.html();
      expect(primaries(h)).toBe(1);
      expect(h).toContain('<button class="wq-btn wq-go wq-stick" id="wq-play" data-primary>');
      expect(h).toContain('<button class="wq-btn wq-soft" id="wq-share-t">');
      expect(h.indexOf('id="wq-play"')).toBeLessThan(h.indexOf('id="wq-share-t"'));
    });
    test(`${lang}: the header is "League table" with the class list on its own small line`, async () => {
      const p = await boardPage({ lang });
      const t = /<h2 dir="auto">(.*?)<\/h2>/.exec(p.html())[1];
      expect(t).toBe('<span class="wq-lgt">' + p.wq.T.leagueW + '</span><small class="wq-lgc" dir="auto">' + (lang === 'ur' ? '<span class="wq-lat" lang="en">Classes 2, 3, 4, 5</span>' : 'Classes 2, 3, 4, 5') + '</small>');
    });
  }
  test('a child with a result: Share stays the primary (no Play here), the note still above it', async () => {
    const p = await boardPage({ result: true });
    const h = p.html();
    expect(primaries(h)).toBe(1);
    expect(h).toContain('<button class="wq-btn wq-go wq-stick" id="wq-share-t" data-primary>');
    expect(h).toContain('<p class="wq-small wq-tnote">');
    expect(h.indexOf('wq-tnote')).toBeLessThan(h.indexOf('wq-cmp'));
  });
  test('without the look: today (the note right above Share, Share the primary, Play navy, the plain label)', async () => {
    const p = await boardPage({ adv: false });
    const h = p.html();
    expect(h).toContain('<p class="wq-small">First names only. Ties share a place.</p><button class="wq-btn wq-go" id="wq-share-t" data-primary>');
    expect(h).toContain('<button class="wq-btn wq-navy" id="wq-play">');
    expect(h).not.toContain('wq-tnote');
    expect(h).toContain('<h2>Classes 2, 3, 4, 5 league table</h2>');
    expect(h).not.toContain('wq-lgt');
  });
});
