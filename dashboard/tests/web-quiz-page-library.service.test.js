/**
 * Web quiz page: the video library (wq-lib.js) behind "Watch another video". Subjects with a grade
 * strip, then chapters; painted from a list prefetched while the child looks at the result; a lesson
 * the class already has a code for opens straight away. Runs the shipped wq-lib.js + wq.js in the
 * harness's vm; the bot API is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = (extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT }, ...extra });
const V = (n) => `aaaaaa${String(n).padStart(2, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const L1 = {
  grade: '3', mine: 'Science',
  grades: [{ g: 'KG', n: 4, art: '/wq/art/grade-kg-1.svg' }, { g: '3', n: 6, art: '/wq/art/grade-3-1.svg' }],
  subjects: [{ key: 'Maths', n: 2, art: '/wq/art/subject-maths-1.svg' }, { key: 'Science', n: 3, art: '/wq/art/subject-science-1.svg' }],
};
const L2 = {
  grade: '3', subject: 'Science', art: '/wq/art/subject-science-1.svg',
  chapters: [
    { name: 'Animals', videos: [{ vid: V(3), title: 'Life Cycle of a <Hen>', code: 'VID003', secs: 143, mb: 3.2 }] },
    { name: 'Plants', videos: [
      { vid: V(2), title: 'Leaves', done: true, poster: 'https://r2.example/p2.jpg?X-Amz-Signature=x' },
      { vid: V(1), title: 'Parts of a Flower', code: 'VID001', poster: 'https://r2.example/p1.jpg?X-Amz-Signature=y', secs: 433, mb: 10.5 },
    ] },
  ],
};
const KG = { grade: 'KG', grades: L1.grades, subjects: [{ key: 'English', n: 4, art: '/wq/art/subject-english-1.svg' }] };
const api = (extra = {}) => ({
  '/lib/TEST?st=s1&g=KG': KG,
  '/lib/TEST?st=s1&s=Science': L2,
  '/lib/TEST?st=s1': L1,
  '/videos/TEST': { grade: '3', videos: [{ vid: 'old-1', title: 'Old list item', subject: 'Science' }] },
  '/videos/start': { code: 'NEWC01' },
  ...extra,
});
const store = (p, k) => { const v = p.ctx.localStorage.getItem(k); return v == null ? null : JSON.parse(v); };
const libFetches = (p) => p.fetches.filter((f) => f.url.indexOf('/api/wq/lib/') === 0).map((f) => f.url);
const events = (p) => {
  p.fireWin('pagehide');
  return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
};

describe('prefetch while the child looks at the result', () => {
  test('the scorecard fetches the subjects, then the quiz\'s own subject\'s chapters, in idle time', async () => {
    const p = page({ lang: 'en', store: finished(), lib: true, api: api() });
    await flush(); await flush();
    expect(libFetches(p)).toEqual(['/api/wq/lib/TEST?st=s1', '/api/wq/lib/TEST?st=s1&s=Science']);
    expect([...p.sess.keys()].some((k) => /^wql:TEST:[a-z0-9]+::Science$/.test(k))).toBe(true);
  });
});

describe('the chapters (L2)', () => {
  async function opened(opts = {}) {
    const p = page({ lang: 'en', store: finished(), lib: true, api: api(), ...opts });
    await flush(); await flush();
    const before = p.fetches.length;
    p.els['#wq-more'].fire('click');
    return { p, before };
  }

  test('paints at once from the prefetched list: chapters, posters with a size and lazy loading, Done, minutes and MB', async () => {
    const { p } = await opened();
    expect(p.moment()).toBe('M15-ch');                 // synchronous: no round trip before paint
    const h = p.html();
    expect(h).toContain('Science · Grade 3');
    expect(h).toContain('Life Cycle of a &lt;Hen&gt;');
    expect(h).toMatch(/<h3 class="wql-ch" dir="auto">Plants<\/h3><div class="wql-strip">/);
    expect(h).toMatch(/<h3 class="wql-ch" dir="auto">Animals<\/h3><div class="wql-one">/);
    expect(h).toMatch(/<img src="https:\/\/r2\.example\/p1\.jpg\?X-Amz-Signature=y" alt="" loading="lazy" width="160" height="90" onerror=/);
    expect(h).toContain('background-image:url(/wq/art/subject-science-1.svg)');
    expect(h).toContain('Done ✓');
    expect(h).toContain('2 min · <bdi dir="ltr">3.2 MB</bdi>');
  });

  test('the first 2 lessons with a class code are prefetched as documents', async () => {
    const { p } = await opened();
    expect(p.head.map((l) => [l.rel, l.href])).toEqual([['prefetch', '/q/VID003'], ['prefetch', '/q/VID001']]);
  });

  test('a lesson the class already has a code for opens straight away (no videos/start), as the same child', async () => {
    const { p } = await opened();
    p.els[`[data-v="${V(1)}"]`].fire('click');
    await flush();
    expect(p.fetches.some((f) => f.url === '/api/wq/videos/start')).toBe(false);
    expect(p.hist.assigned).toEqual(['/q/VID001']);
    expect(store(p, 'wq_from')).toMatchObject({ code: 'VID001', st: 's1' });
    expect(typeof store(p, 'wq_from').t).toBe('number');
  });

  test('a class\'s first play of a lesson still mints its code (POST videos/start, as today)', async () => {
    const { p } = await opened();
    p.els[`[data-v="${V(2)}"]`].fire('click');
    await flush();
    const start = p.fetches.find((f) => f.url === '/api/wq/videos/start');
    expect(JSON.parse(start.init.body)).toEqual({ code: 'TEST', st: 's1', vid: V(2) });
    expect(p.hist.assigned).toEqual(['/q/NEWC01']);
  });

  test('Download: a link to the bot\'s attachment route with the size; the list timing is reported', async () => {
    const { p } = await opened();
    const h = p.html();
    expect(h).toContain(`<a class="wql-dl" data-dl="${V(1)}" href="/api/wq/videos/dl/TEST?st=s1&amp;vid=${V(1)}" download><span>⬇ Download</span></a>`);
    p.els[`[data-dl="${V(1)}"]`].fire('click');
    const evs = events(p);
    expect(evs.find((e) => e.n === 'more_timing')).toMatchObject({ src: 'mem' });
    expect(typeof evs.find((e) => e.n === 'more_timing').list_ms).toBe('number');
    expect(evs.find((e) => e.n === 'video_download')).toMatchObject({ vid: V(1) });
    expect(evs.find((e) => e.n === 'lib_view' && e.s === 'Science')).toBeTruthy();
  });

  test('in WhatsApp\'s browser a tap on Download also offers "Open in Chrome"', async () => {
    const { p } = await opened({ ua: 'Mozilla/5.0 (Linux; Android 13; wv) WhatsApp/2.24' });
    expect(p.html()).toContain('<p class="wql-dlhelp" id="wql-dlhelp" hidden>');
    const help = { hidden: true };
    const a = { setAttribute(k, v) { this[k] = v; } };
    p.ctx.document.getElementById = ((orig) => (id) => (id === 'wql-dlhelp' ? help : id === 'wql-chrome' ? a : orig(id)))(p.ctx.document.getElementById);
    p.els[`[data-dl="${V(1)}"]`].fire('click');
    expect(help.hidden).toBe(false);
    expect(a.href).toBe(`intent://example.test/api/wq/videos/dl/TEST?st=s1&vid=${V(1)}#Intent;scheme=https;package=com.android.chrome;end`);
  });

  test('Back goes to the subjects, Back again to the card', async () => {
    const { p } = await opened();
    p.tap();
    p.back();
    expect(p.moment()).toBe('M15');
    expect(p.html()).toContain('Pick a subject');
    p.tap();
    p.back();
    expect(p.moment()).toBe('M10');
  });
});

describe('the subjects (L1)', () => {
  test('two-column art tiles with counts, the grade strip with the child\'s grade on; another grade one tap away', async () => {
    const p = page({ lang: 'en', store: finished(), lib: true, api: api() });
    await flush(); await flush();
    p.els['#wq-more'].fire('click');
    p.els['#wql-up'].fire('click');
    expect(p.moment()).toBe('M15');
    const h = p.html();
    expect(h).toMatch(/<button class="wql-sub" data-s="Maths"><img src="\/wq\/art\/subject-maths-1\.svg" alt="" width="160" height="120"><b>Maths<\/b><small>2 videos<\/small><\/button>/);
    expect(h).toMatch(/<button class="wql-g wql-on" data-g="3" aria-pressed="true"><img src="\/wq\/art\/grade-3-1\.svg" alt="" width="36" height="36"><span>Grade 3<\/span>/);
    p.els['[data-g="KG"]'].fire('click');
    await flush();
    expect(libFetches(p)).toContain('/api/wq/lib/TEST?st=s1&g=KG');
    expect(p.html()).toContain('data-s="English"');
    expect(p.html()).toMatch(/class="wql-g wql-on" data-g="KG"/);
  });

  test('Urdu: subject and grade names, counts, Download in Urdu', async () => {
    const p = page({ lang: 'ur', store: finished(), lib: true, api: api() });
    await flush(); await flush();
    p.els['#wq-more'].fire('click');
    expect(p.html()).toContain('سائنس · جماعت <bdi dir="ltr">3</bdi>');
    expect(p.html()).toContain('<span>⬇ ڈاؤن لوڈ</span>');
    expect(p.html()).toContain('مکمل ✓');
    p.els['#wql-up'].fire('click');
    expect(p.html()).toContain('ریاضی');
    expect(p.html()).toContain('<bdi dir="ltr">2</bdi> ویڈیوز');
  });
});

describe('library off', () => {
  test('the bot says library_off: today\'s 8-item list, unchanged', async () => {
    const p = page({ lang: 'en', store: finished(), lib: true, api: { '/lib/TEST': { __status: 404, error: 'library_off' }, '/videos/TEST': api()['/videos/TEST'] } });
    await flush(); await flush();
    p.els['#wq-more'].fire('click');
    await flush();
    expect(p.moment()).toBe('M15');
    expect(p.html()).toContain('<ul class="wq-vlist">');
    expect(p.html()).toContain('Old list item');
    expect(p.fetches.some((f) => f.url === '/api/wq/videos/TEST?st=s1')).toBe(true);
    expect(p.html()).not.toContain('wql-');
  });
});

describe('the lesson page', () => {
  test('the video screen offers Download with the size when the bot named the video', async () => {
    const p = page({ lang: 'en', lib: true, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } },
      video: { url: 'https://r2.example/v.mp4', bytes: 12400000, vid: V(1) }, api: api() });
    p.wq.video();
    expect(p.html()).toContain(`href="/api/wq/videos/dl/TEST?st=s1&amp;vid=${V(1)}" download><span>⬇ Download (<bdi dir="ltr">12.4 MB</bdi>)</span></a>`);
  });
  test('no video id (library off): no Download button', async () => {
    const p = page({ lang: 'en', lib: true, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } },
      video: { url: 'https://r2.example/v.mp4', bytes: 12400000 }, api: api() });
    p.wq.video();
    expect(p.html()).not.toContain('Download');
  });
});

describe('review fixes', () => {
  test('the cached lists belong to one child: a new session token fetches its own, never the last child\'s ticks', async () => {
    const p = page({ lang: 'en', store: finished(), lib: true, api: api({ '/lib/TEST?st=s2&s=Science': { ...L2, chapters: [] }, '/lib/TEST?st=s2': L1 }) });
    await flush(); await flush();
    const keys = [...p.sess.keys()];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => !k.endsWith('TEST::') && !k.endsWith('TEST::Science'))).toBe(true);
    p.wq.S.st = 's2';
    p.els['#wq-more'].fire('click');
    await flush(); await flush();
    expect(libFetches(p)).toContain('/api/wq/lib/TEST?st=s2');
    expect(p.html()).not.toContain('Done ✓');
  });

  test('Data saver or 2G: no prefetch at all; 3G: the list is prefetched but no lesson pages', async () => {
    const saver = page({ lang: 'en', store: finished(), lib: true, api: api(), connection: { saveData: true } });
    await flush(); await flush();
    expect(libFetches(saver)).toEqual([]);
    const slow = page({ lang: 'en', store: finished(), lib: true, api: api(), connection: { effectiveType: '2g' } });
    await flush(); await flush();
    expect(libFetches(slow)).toEqual([]);
    const g3 = page({ lang: 'en', store: finished(), lib: true, api: api(), connection: { effectiveType: '3g' } });
    await flush(); await flush();
    expect(libFetches(g3)).toEqual(['/api/wq/lib/TEST?st=s1', '/api/wq/lib/TEST?st=s1&s=Science']);
    g3.els['#wq-more'].fire('click');
    expect(g3.head).toEqual([]);
  });

  test('lesson pages are prefetched once, however often the chapters repaint', async () => {
    const p = page({ lang: 'en', store: finished(), lib: true, api: api() });
    await flush(); await flush();
    p.els['#wq-more'].fire('click');
    p.els['#wql-up'].fire('click');
    p.els['[data-s="Science"]'].fire('click');
    await flush();
    expect(p.head.map((l) => l.href)).toEqual(['/q/VID003', '/q/VID001']);
  });

  test('Urdu: counts, minutes and grade numbers are isolated left-to-right', async () => {
    const p = page({ lang: 'ur', store: finished(), lib: true, api: api() });
    await flush(); await flush();
    p.els['#wq-more'].fire('click');
    expect(p.html()).toContain('سائنس · جماعت <bdi dir="ltr">3</bdi>');
    expect(p.html()).toContain('<bdi dir="ltr">2</bdi> منٹ');
    p.els['#wql-up'].fire('click');
    expect(p.html()).toContain('<bdi dir="ltr">2</bdi> ویڈیوز');
  });

  test('a late answer never paints over the screen the child moved to (Back mid-fetch; two quick grade taps)', async () => {
    const later = {};
    const defer = (name, value) => () => new Promise((res) => { later[name] = () => res(value); });
    const G4 = { ...KG, grade: '4', subjects: [{ key: 'Maths', n: 9, art: '/wq/art/subject-maths-1.webp' }] };
    const p = page({ lang: 'en', store: finished(), lib: true, connection: { saveData: true }, api: {
      '/lib/TEST?st=s1&g=KG': defer('kg', KG), '/lib/TEST?st=s1&g=4': defer('g4', G4),
      '/lib/TEST?st=s1&s=Science': defer('l2', L2), '/lib/TEST?st=s1': { ...L1, grades: L1.grades.concat([{ g: '4', n: 9, art: '/wq/art/grade-4-1.webp' }]) } } });
    p.tap();
    p.els['#wq-more'].fire('click');
    await flush(); await flush();
    expect(p.moment()).toBe('M15-wait');             // the chapters are on their way
    p.back();
    expect(p.moment()).toBe('M10');
    later.l2(); await flush(); await flush();
    expect(p.moment()).toBe('M10');                  // the late chapters did not paint over the card

    p.els['#wq-more'].fire('click');
    await flush(); await flush();
    p.els['#wql-up'].fire('click');                  // subjects (cached L1)
    await flush();
    p.els['[data-g="KG"]'].fire('click');
    p.els['[data-g="4"]'].fire('click');
    later.g4(); await flush(); await flush();
    later.kg(); await flush(); await flush();
    expect(p.html()).toContain('data-s="Maths"');     // grade 4's subjects, not KG's
    expect(p.html()).not.toContain('data-s="English"');
  });
});
