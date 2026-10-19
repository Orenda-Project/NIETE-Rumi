/**
 * Two fixes under the one-button look (html.wq-1b, app_settings web_quiz_one_button):
 *  - the Urdu Home greeting reads as one right-to-left line, «السلام علیکم، <name>!», one inline run with the child's
 *    name isolated in <bdi> so a Latin name never drags the comma across it;
 *  - the quiz's second-try label ("Second try · with Jugnu") leaves the crowded top bar and sits on its own row under
 *    it as a chip, so it never wraps at 360 px.
 * Without the look both are today's markup. Invented children only.
 */
const F = require('./web-quiz-video-shelf.fixture');
const H = require('./wq-page-harness');

const LOOK = { document: { documentElement: { classList: { contains: (c) => c === 'wq-1b' } } } };
const hello = (h) => (/<span class="wq-hhi">([\s\S]*?)<span class="wq-dots"/.exec(h) || [])[1];
const boot = (lang, first) => ({ ...F.boot(lang, { href: '/lib/x' }), kids: [{ chip: F.KID, first, animal: 'owl', grade: '3' }], kid: F.KID, home_v3: 1, head: { dots: 2 } });

describe('the Urdu Home greeting with the look', () => {
  test.each(['Zara', 'Noor Testwala', 'زارا'])('«السلام علیکم، <bdi>%s</bdi>!»: the greeting first, the name isolated', (first) => {
    const W = F.load({ globals: LOOK });
    const hi = hello(W.WQHOME.html(boot('ur', first), { token: F.TOKEN, lang: 'ur' }));
    expect(hi).toBe('<span>السلام\u00a0علیکم، <bdi>' + first + '</bdi>!</span>');
  });
  test('a name with markup in it is escaped inside the <bdi>', () => {
    const W = F.load({ globals: LOOK });
    expect(hello(W.WQHOME.html(boot('ur', 'A<b>'), { token: F.TOKEN, lang: 'ur' }))).toBe('<span>السلام\u00a0علیکم، <bdi>A&lt;b&gt;</bdi>!</span>');
  });
  test('without the look, and in English: today\'s words', () => {
    expect(hello(F.load().WQHOME.html(boot('ur', 'Zara'), { token: F.TOKEN, lang: 'ur' }))).toBe('\u2068Zara\u2069، السلام علیکم!');
    const W2 = F.load({ globals: LOOK });
    expect(hello(W2.WQHOME.html(boot('en', 'Zara'), { token: F.TOKEN, lang: 'en' }))).not.toContain('<bdi>');
  });
});

const Q = { qid: 'q1', i: 1, text: 'Which part of a plant drinks water?', options: [{ slot: 'A', text: 'Leaf' }, { slot: 'B', text: 'Root' }], correct_slot: 'B', why: 'Roots drink up water.' };
const barOf = (h) => (/<div class="wq-bar">([\s\S]*?)<\/div>/.exec(h) || [])[1] || '';

describe('the second-try label', () => {
  test.each([['en', 'Second try'], ['ur', 'دوسری کوشش']])('%s with the look: a chip on its own row under the bar, not in it', (lang, word) => {
    const p = H.page({ lang, questions: [Q, { ...Q, qid: 'q2', i: 2 }], htmlClass: ['wq-1b'] });
    p.wq.question(0, true);
    const h = p.html();
    expect(barOf(h)).not.toContain(word);
    const row = /<\/div><div class="wq-dotrow wq-2nd"><span class="wq-chip">([^<]*)<\/span><\/div>/.exec(h);
    expect(row && row[1]).toContain(word);
  });
  test('without the look: today\'s bar, the label inside it', () => {
    const p = H.page({ lang: 'en', questions: [Q, { ...Q, qid: 'q2', i: 2 }] });
    p.wq.question(0, true);
    expect(barOf(p.html())).toContain('<span class="wq-grow wq-qof">Second try');
    expect(p.html()).not.toContain('wq-2nd');
  });
  test('the stylesheet keeps the chip on one line under the look', () => {
    expect(H.CSS).toContain('html.wq-1b .wq-2nd .wq-chip{white-space:nowrap}');
  });
});

describe('the Urdu header has room for «السلام علیکم، Zara!» on one line at 360 px', () => {
  test('the adventure look closes the Urdu header\'s gaps to 8 px (12 px elsewhere)', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'wq', 'wq-adventure.css'), 'utf8');
    expect(css).toContain('html.wq-adv .wq-hhead{gap:var(--sp-3)}');
    expect(css).toContain('html.wq-adv[lang=ur] .wq-hhead{gap:var(--sp-2)}');
    expect(css.indexOf('html.wq-adv[lang=ur] .wq-hhead{gap')).toBeGreaterThan(css.indexOf('html.wq-adv .wq-hhead{gap'));
  });
});
