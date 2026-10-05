/**
 * Web quiz page: "Watch another video" (M15). After the result, the card or "today", the child
 * sees a short list of video-bank lessons of the class's grade, picks one, and lands straight in
 * that lesson's video and then its quiz, as the same child, with no name to pick. Runs the whole
 * shipped page in the harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = (extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT }, ...extra });
const LIST = {
  grade: '3', subject: 'Science',
  videos: [
    { vid: 'v-1', title: 'Life Cycle of a <Hen>', chapter: 'Animals', subject: 'Science', grade: '3', secs: 143, mb: 3.2 },
    { vid: 'v-2', title: 'Parts of a Flower', chapter: 'Plants', subject: 'Science', grade: '3', secs: 433, mb: 10.5, poster: 'https://r2.example/p2.jpg', done: true },
  ],
};
const store = (p, k) => { const v = p.ctx.localStorage.getItem(k); return v == null ? null : JSON.parse(v); };

describe('the way in', () => {
  test('the scorecard offers "Watch another video"', () => {
    const p = page({ lang: 'en', store: finished() });
    expect(p.moment()).toBe('M10');
    expect(p.html()).toContain('id="wq-more"');
    expect(p.html()).toContain('Watch another video');
  });

  test('"today" offers it too, in Urdu as well', () => {
    const p = page({ lang: 'ur', store: finished() });
    p.wq.today();
    expect(p.html()).toContain('id="wq-more"');
    expect(p.html()).toContain('ایک اور ویڈیو دیکھیں');
  });

  test('a quiz with no grade does not offer it (the bank is by grade)', () => {
    const p = page({ lang: 'en', store: finished(), grade: null });
    expect(p.html()).not.toContain('id="wq-more"');
  });
});

describe('the list (M15)', () => {
  test('asks for this child\'s lessons and shows title, minutes, size, a poster or a subject tile, and a done mark', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': LIST } });
    p.els['#wq-more'].fire('click');
    await flush();
    expect(p.fetches.some((f) => f.url === '/api/wq/videos/TEST?st=s1')).toBe(true);
    expect(p.moment()).toBe('M15');
    const h = p.html();
    expect(h).toContain('Life Cycle of a &lt;Hen&gt;');
    expect(h).toContain('2 min');
    expect(h).toContain('<bdi dir="ltr">3.2 MB</bdi>');
    expect(h).toContain('src="https://r2.example/p2.jpg"');
    expect(h).toMatch(/class="wq-vtile[^"]*"[^>]*>🔬/);
    expect(h).toContain('Done');
    expect(h).toMatch(/data-vid="v-1"/);
  });

  test('no lessons: says so, with a way back', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': { videos: [] } } });
    p.els['#wq-more'].fire('click');
    await flush();
    expect(p.moment()).toBe('M15');
    expect(p.html()).toContain('No more videos for your class yet.');
    expect(p.html()).toContain('id="wq-back"');
  });

  test('Back on the list returns to the card', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': LIST } });
    p.tap();
    p.els['#wq-more'].fire('click');
    await flush();
    p.back();
    expect(p.moment()).toBe('M10');
  });
});

describe('picking a lesson', () => {
  test('gets the lesson\'s code, keeps who is playing on this phone (never in the link), and opens it in the same view', async () => {
    const p = page({ lang: 'en', store: finished(), api: { '/videos/TEST': LIST, '/videos/start': { code: 'NEWC01' } } });
    p.els['#wq-more'].fire('click');
    await flush();
    p.els['[data-vid="v-1"]'].fire('click');
    await flush();
    const start = p.fetches.find((f) => f.url === '/api/wq/videos/start');
    expect(JSON.parse(start.init.body)).toEqual({ code: 'TEST', st: 's1', vid: 'v-1' });
    expect(p.hist.assigned).toEqual(['/q/NEWC01']);
    expect(store(p, 'wq_from')).toMatchObject({ code: 'NEWC01', st: 's1' });
  });
});

describe('arriving on the lesson\'s quiz', () => {
  test('starts straight away as the same child: the earlier session\'s token, no landing, no name', async () => {
    const p = page({
      lang: 'en',
      store: { wq_from: { code: 'TEST', st: 's1', at: Date.now() } },
      api: { '/session': { st: 's2', device_ref: 'd1', child: { chip: 'c2', first: 'Zara', animal: 'owl' } } },
    });
    await flush();
    const s = p.fetches.find((f) => f.url === '/api/wq/session');
    expect(JSON.parse(s.init.body)).toMatchObject({ code: 'TEST', from_st: 's1' });
    expect(p.moment()).toBe('M6');
    expect(store(p, 'wq_from')).toBeNull();
  });

  test('a stale hand-over (or one for another code) is ignored: the normal landing', async () => {
    const old = page({ lang: 'en', store: { wq_from: { code: 'TEST', st: 's1', at: Date.now() - 60 * 60 * 1000 } } });
    expect(old.moment()).toBe('M3');
    const other = page({ lang: 'en', store: { wq_from: { code: 'OTHER1', st: 's1', at: Date.now() } } });
    expect(other.moment()).toBe('M3');
  });

  test('a hand-over the bot refuses falls back to the landing (never a blank page)', async () => {
    const p = page({ lang: 'en', store: { wq_from: { code: 'TEST', st: 's1', at: Date.now() } }, api: { '/session': { __status: 401, error: 'bad_token' } } });
    await flush();
    expect(p.moment()).toBe('M3');
  });
});
