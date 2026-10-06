/**
 * The end of a VIDEO quiz (item 18a): the same scorecard, said to be a video quiz, with "Watch more"
 * first, then the two shares; and, when the bot names it, the next video of this chapter on the card.
 * Runs the whole shipped page in the harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const store = (result = RESULT) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true } });
const VIDEO = { url: 'https://r2.test/v.mp4', poster: 'https://r2.test/p.jpg' };
const buttons = (html) => (html.match(/id="wq-(share|chal|class|more)"/g) || []).map((x) => x.slice(7, -1));

describe('a video quiz ends on the scorecard, said to be one', () => {
  test('EN: a "Video quiz" chip, and Watch more comes before the shares', () => {
    const p = page({ lang: 'en', store: store(), video: VIDEO });
    expect(p.moment()).toBe('M10');
    expect(p.html()).toContain('<span class="wq-vchip">Video quiz</span>');
    expect(buttons(p.html())).toEqual(['more', 'share', 'chal', 'class']);
  });

  test('UR: the chip in Urdu', () => {
    const p = page({ lang: 'ur', store: store(), video: VIDEO });
    expect(p.html()).toContain('<span class="wq-vchip">ویڈیو کوئز</span>');
  });

  test('a quiz with no video keeps its card exactly as before', () => {
    const p = page({ lang: 'en', store: store() });
    expect(p.html()).not.toContain('wq-vchip');
    expect(buttons(p.html())).toEqual(['share', 'chal', 'class', 'more']);
  });
});

describe('"Next in this chapter" on the card', () => {
  const NEXT = { vid: 'v-2', title: 'Plants need light', chapter: 'Plants', poster: 'https://r2.test/p2.jpg', secs: 120 };

  test('shown between the score and the shares when the bot names one', () => {
    const p = page({ lang: 'en', store: store({ ...RESULT, next: NEXT }), video: VIDEO });
    const h = p.html();
    expect(h).toContain('id="wq-next-v"');
    expect(h).toContain('Next in this chapter');
    expect(h).toContain('Plants need light');
    expect(h).toContain('src="https://r2.test/p2.jpg"');
    expect(h.indexOf('wq-next-v')).toBeLessThan(h.indexOf('id="wq-share"'));
    expect(h.indexOf('wq-big')).toBeLessThan(h.indexOf('wq-next-v'));
  });

  test('tapping it opens that video\'s quiz: its own code when given, else the code the bot mints', async () => {
    const a = page({ lang: 'en', store: store({ ...RESULT, next: { ...NEXT, code: 'NXT123' } }), video: VIDEO });
    a.els['#wq-next-v'].fire('click');
    expect(a.hist.assigned).toEqual(['/q/NXT123']);

    const b = page({ lang: 'en', store: store({ ...RESULT, next: NEXT }), video: VIDEO, api: { 'videos/start': { code: 'MINT77' } } });
    b.els['#wq-next-v'].fire('click');
    await flush(); await flush();
    const call = b.fetches.find((f) => f.url.indexOf('videos/start') >= 0);
    expect(JSON.parse(call.init.body)).toMatchObject({ code: 'TEST', st: 's1', vid: 'v-2' });
    expect(b.hist.assigned).toEqual(['/q/MINT77']);
  });

  test('no slot when the bot names none', () => {
    const p = page({ lang: 'en', store: store(), video: VIDEO });
    expect(p.html()).not.toContain('wq-next-v');
  });
});
