/**
 * Web quiz page: the after-quiz screens say what they show. The league row's stars are the score
 * (the card's rule), "today" only says "time to rest" when nothing is left to play, and picking
 * another lesson shows Jugnu waiting at once instead of a still list and then a blank page.
 * Runs the whole shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const VID = (vid, done) => ({ vid, title: 'Lesson ' + vid, subject: 'Science', grade: '3', secs: 120, mb: 3, done });
const onStars = (s) => (s.match(/wq-star wq-on/g) || []).length;
const allStars = (s) => (s.match(/class="wq-star[ "]/g) || []).length;
const rowsOf = (h) => h.match(/<tr[^>]*>.*?<\/tr>/g) || [];

describe('league rows: the stars say the score', () => {
  const BOARD = { finishers_n: 2, class_avg_pct: 50, rows: [
    { place: 1, first: 'Ali', animal: 'cat', correct: 4, total: 5 },
    { place: 2, first: 'Bina', animal: 'owl', correct: 1, total: 5 },
  ] };

  test('each row lights as many stars as its score, out of the quiz total, and no lone ⭐', async () => {
    const p = page({ lang: 'en', store: finished(), board: BOARD });
    p.wq.board();
    await flush();
    const rows = rowsOf(p.html());
    expect(rows.length).toBe(2);
    expect(onStars(rows[0])).toBe(4);
    expect(allStars(rows[0])).toBe(5);
    expect(onStars(rows[1])).toBe(1);
    expect(p.html()).not.toContain('⭐');
  });

  test('the child\'s own row added under the table follows the same rule', async () => {
    const p = page({ lang: 'en', store: finished(), board: { ...BOARD, you: { place: 9, correct: 3, total: 5 } } });
    p.wq.board();
    await flush();
    const mine = rowsOf(p.html()).find((r) => r.indexOf('wq-you') >= 0);
    expect(onStars(mine)).toBe(3);
  });

  test('"My scores" rows too', async () => {
    const p = page({ lang: 'en', store: { ...finished(), wq_kids: [CHILD] }, me: { history: [{ topic: 'Plants', date: '6 Oct', correct: 2, total: 5 }] } });
    p.wq.history();
    await flush();
    expect(p.moment()).toBe('M13');
    expect(onStars(p.html())).toBe(2);
    expect(p.html()).not.toContain('⭐');
  });
});

describe('"today" agrees with what it offers', () => {
  test('a lesson is left to play: it offers the video and does not say "time to rest"', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': { videos: [VID('v1', true), VID('v2', false)] } } });
    p.wq.today();
    await flush();
    expect(p.html()).toContain('id="wq-more"');
    expect(p.html()).not.toContain('Time to rest');
    expect(p.html()).toContain('Want to watch another video?');
  });

  test('nothing left (every lesson done, or none): it rests, and offers no video', async () => {
    for (const videos of [[VID('v1', true)], []]) {
      const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': { videos } } });
      p.wq.today();
      await flush();
      expect(p.html()).toContain('Time to rest. See you tomorrow!');
      expect(p.html()).not.toContain('id="wq-more"');
    }
  });

  test('a quiz with no grade rests and asks for nothing', async () => {
    const p = page({ lang: 'en', store: finished(), grade: null });
    p.wq.today();
    await flush();
    expect(p.html()).toContain('Time to rest');
    expect(p.fetches.some((f) => f.url.indexOf('/videos/') >= 0)).toBe(false);
  });

  test('in Urdu as well', async () => {
    const p = page({ lang: 'ur', store: finished(), api: { '/videos/TEST': { videos: [VID('v2', false)] } } });
    p.wq.today();
    await flush();
    expect(p.html()).toContain('ایک اور ویڈیو دیکھیں؟');
    expect(p.html()).not.toContain('آرام');
  });
});

describe('picking a lesson shows Jugnu waiting at once', () => {
  test('the tap replaces the list with the waiting Jugnu and its line, before the bot answers', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': { videos: [VID('v1', false)] }, '/videos/start': { code: 'NEWC01' } } });
    p.els['#wq-more'].fire('click');
    await flush();
    p.els['[data-vid="v1"]'].fire('click');
    expect(p.moment()).toBe('M15-go');
    expect(p.html()).toContain('data-jpose="thinking"');
    expect(p.html()).toContain('Opening the video…');
    expect(p.html()).toContain('Lesson v1');
    await flush();
    expect(p.hist.assigned).toEqual(['/q/NEWC01']);
  });

  test('if the bot refuses, the child is back on the list (never stuck on the waiting screen)', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': { videos: [VID('v1', false)] }, '/videos/start': { __status: 500 } } });
    p.els['#wq-more'].fire('click');
    await flush();
    p.els['[data-vid="v1"]'].fire('click');
    await flush();
    expect(p.moment()).toBe('M15');
    expect(p.toasts().length).toBeGreaterThan(0);
  });
});
