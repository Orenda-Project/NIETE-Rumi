/**
 * The v3 home's three door screens (wq-doors.js, web_quiz_home_v3) run in a vm beside the shipped wq-home.js: each door
 * renders from 0 / 1 / many rows with Home top-left, exactly one data-primary, a speaker on every row and the bottom
 * bar; a listen row opens the LISTEN (never "on its way"); no banned word on any screen in either language; Urdu is
 * lang=ur dir=rtl with Urdu digits and no U+00B7; the watch screen plays first and offers the quiz after; nothing counts
 * the child. Switch off: the hub page never names wq-doors (golden). Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderHubPage } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HUB = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
};
const BANNED = /\b(test|tests|exam|assess\w*|wrong|wcpm|rank|percentile|position|prize|reward|unlock|level|clever|perfect|genius|incredible|egma|comparable|tested|testwala|challenge|trail|today|practice|counted|story time|score)\b|امتحان|ٹیسٹ|غلط|نتائج|نتیجہ|انعام|ذہین|کامل|پڑاؤ|چیلنج/i;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const count = (html, rx) => (html.match(rx) || []).length;

function load() {
  const win = {};
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), sandbox);
  return win;
}
const ctxOf = (lang) => ({ token: TOKEN, lang });

const STORIES_MANY = {
  stories: [
    { kind: 'passage', id: 'en.read.1.k02', title: 'The red kite', pos: 0, week: true, fresh: true },
    { kind: 'passage', id: 'en.read.1.k03', title: 'A cat and a hat', pos: 1, fresh: true, say: 'https://r2.example.test/say.ogg' },
    { kind: 'listen', id: 'en.listen.1.k05', title: 'The rain song', pos: 2, fresh: true },
    { kind: 'passage', id: 'en.read.1.k01', title: 'My school bag', pos: 3, done: true },
  ],
  shelf: true,
};
const GAMES_MANY = { games: [{ kind: 'numbers', stop: 'missing', warm: true }, { kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }] };
const BOOT_GAMES = [
  { kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' },
  { kind: 'numbers' },
  { kind: 'quiz', code: 'SCI001', k: 'k2', topic: 'Plants', subject: 'Science', done: true },
];
const LIB_SUBJECTS = { grade: '3', subjects: [{ key: 'Science', n: 12, art: '/wq/art/subject-science.webp' }, { key: 'Maths', n: 9, art: '/wq/art/subject-maths.webp' }] };
const LIB_CHAPTERS = { grade: '3', subject: 'Science', art: '/wq/art/subject-science.webp', chapters: [{ name: 'Chapter 1', videos: [{ vid: VID, title: 'Life cycle of a hen', secs: 143, done: true }, { vid: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Parts of a flower', secs: 200 }] }] };

function screens(W, lang) {
  const B = { ...HUB, lang, home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k02', fresh: true, title: 'The red kite' }, { kind: 'shelf' }], games: BOOT_GAMES, videos: { href: '/lib/x', watch: true } } };
  const c = ctxOf(lang);
  return {
    storiesBoot: W.WQDOORS.html(B, c, 'stories', null),
    storiesMany: W.WQDOORS.html(B, c, 'stories', STORIES_MANY),
    storiesOne: W.WQDOORS.html(B, c, 'stories', { stories: STORIES_MANY.stories.slice(0, 1), shelf: false }),
    storiesNone: W.WQDOORS.html({ ...B, doors: { stories: [], games: [], videos: null } }, c, 'stories', { stories: [], shelf: false }),
    gamesMany: W.WQDOORS.html(B, c, 'games', GAMES_MANY),
    gamesOne: W.WQDOORS.html({ ...B, doors: { ...B.doors, games: [] } }, c, 'games', { games: [GAMES_MANY.games[1]] }),
    gamesNone: W.WQDOORS.html({ ...B, doors: { ...B.doors, games: [] } }, c, 'games', { games: [] }),
    videosWait: W.WQDOORS.html(B, c, 'videos', null),
    videosSubjects: W.WQDOORS.html(B, c, 'videos', { lib: LIB_SUBJECTS }),
    videosNone: W.WQDOORS.html(B, c, 'videos', { lib: { grade: '3', subjects: [] } }),
    videosErr: W.WQDOORS.html(B, c, 'videos', { lib: { err: true } }),
    videosChapters: W.WQDOORS.html(B, c, 'videos', { subject: 'Science', lib: LIB_CHAPTERS }),
    watch: W.WQDOORS.html(B, c, `watch/${VID}`, { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', after: true }, next: { kind: 'quiz', title: 'Play the quiz', sub: 'Life cycle of a hen', href: '#' } }),
    watchWait: W.WQDOORS.html(B, c, `watch/${VID}`, null),
  };
}

describe('every door screen, both languages', () => {
  test.each(['en', 'ur'])('%s: Home top-left, exactly one primary, the bottom bar, no banned word', (lang) => {
    const W = load();
    for (const [name, h] of Object.entries(screens(W, lang))) {
      expect([name, count(h, /data-primary/g)]).toEqual([name, 1]);
      expect([name, count(h, /data-home/g)]).toEqual([name, 1]);
      expect(h.indexOf('data-home')).toBeLessThan(h.indexOf('<h2'));
      expect([name, count(h, /class="wq-door[ "]/g)]).toEqual([name, 3]);
      expect([name, visible(h).match(BANNED)]).toEqual([name, null]);
      expect(h).toMatch(/data-screen="(stories|games|videos|watch)"/);
    }
  });

  test('a speaker on every row (a clip when the server has one, else the words)', () => {
    const s = screens(load(), 'en');
    for (const h of [s.storiesMany, s.gamesMany, s.videosSubjects, s.videosChapters]) {
      expect(count(h, /class="wq-row wq-drow"/g)).toBeGreaterThan(0);
      expect(count(h, /data-tap="say"/g)).toBe(count(h, /class="wq-row wq-drow"/g));
    }
    expect(s.storiesMany).toContain('data-url="https://r2.example.test/say.ogg"');
  });

  test('pictures are SVG, never an emoji or a symbol glyph (RULING #C5.2: tofu on Android 9)', () => {
    for (const h of Object.values(screens(load(), 'ur'))) expect(visible(h)).not.toMatch(/[\u2190-\u2BFF\u{1F000}-\u{1FAFF}]/u);
  });
  test('Urdu: lang=ur dir=rtl, Urdu digits, no U+00B7, no Western digit in a minutes line', () => {
    const s = screens(load(), 'ur');
    for (const h of Object.values(s)) {
      expect(h).toMatch(/<section [^>]*lang="ur" dir="rtl"/);
      expect(visible(h)).not.toContain('·');
    }
    expect(s.videosChapters).toContain('۲ منٹ');
    expect(visible(s.videosChapters)).not.toMatch(/\b\d+ منٹ/);
  });
});

describe('Stories', () => {
  test('many: this week\'s story is the primary; reads, the storybook shelf slot, listens; met ones marked done', () => {
    const h = screens(load(), 'en').storiesMany;
    const primary = h.slice(h.indexOf('data-primary') - 200, h.indexOf('data-primary') + 300);
    expect(primary).toContain('en.read.1.k02');
    expect(h.indexOf('The red kite')).toBeLessThan(h.indexOf('A cat and a hat'));
    expect(h.indexOf('A cat and a hat')).toBeLessThan(h.indexOf('data-shelf'));
    expect(h.indexOf('data-shelf')).toBeLessThan(h.indexOf('The rain song'));
    expect(h).toMatch(/class="wq-dli done"[\s\S]*My school bag/);
    expect(h).toMatch(/data-pos="2"/);
  });
  test('serve-able: a listen row opens the LISTEN (ex=listen), a read row the read; never the "more stories" dead end', () => {
    const h = screens(load(), 'en').storiesMany;
    expect(h).toContain('room=story&amp;pid=en.listen.1.k05&amp;ex=listen');
    expect(h).toMatch(/pid=en\.read\.1\.k03"/);
    expect(h).not.toMatch(/room=story"/);
  });
  test('one / none: one row is the primary; none points at Games (never a dead end)', () => {
    const s = screens(load(), 'en');
    expect(count(s.storiesOne, /class="wq-row wq-drow"/g)).toBe(1);
    expect(s.storiesNone).toMatch(/data-primary data-tap="door" data-door="games" href="#games"/);
  });
  test('before the fetch: the boot\'s own rows (this week\'s story) and the shelf slot', () => {
    const h = screens(load(), 'en').storiesBoot;
    expect(h).toContain('The red kite');
    expect(h).toContain('data-shelf');
  });
});

describe('Games', () => {
  test('many: the teacher\'s open quiz first (primary), the number games by id, then "Play again" with its done state', () => {
    const h = screens(load(), 'en').gamesMany;
    expect(h.indexOf('Fractions')).toBeLessThan(h.indexOf('Number warm-up'));
    expect(h.indexOf('Number warm-up')).toBeLessThan(h.indexOf('Which is bigger?'));
    expect(h.indexOf('Which is bigger?')).toBeLessThan(h.indexOf('Plants'));
    expect(h).toMatch(/data-primary[^>]*href="\/q\/MATH01\?k=kk"/);
    expect(h).toContain(`/c/${TOKEN}?kid=${KID}#missing`);
    expect(h).toContain(`/c/${TOKEN}?kid=${KID}#bigger`);
    expect(h).toMatch(/class="wq-dli done"[\s\S]*href="\/q\/SCI001\?again=1&amp;k=k2"/);
    expect(visible(h)).toMatch(/Play again/);
  });
  test('no counts about the child: no score, no n/10, no digits in the rows', () => {
    const h = screens(load(), 'en').gamesMany;
    expect(visible(h)).not.toMatch(/\d/);
  });
  test('one / none', () => {
    const s = screens(load(), 'en');
    expect(count(s.gamesOne, /class="wq-row wq-drow"/g)).toBe(1);
    expect(s.gamesNone).toMatch(/data-door="stories"/);
  });
});

describe('Videos', () => {
  test('subjects with their small pictures (lazy), then a subject\'s lessons with minutes and done ticks', () => {
    const s = screens(load(), 'en');
    expect(s.videosSubjects).toMatch(/<img class="wq-rart" src="\/wq\/art\/subject-science\.webp"[^>]*loading="lazy"/);
    expect(visible(s.videosSubjects)).not.toMatch(/\d/); // no "12 videos" counts
    expect(s.videosChapters).toContain('Life cycle of a hen');
    expect(s.videosChapters).toContain('3 min');
    expect(s.videosChapters).toMatch(/data-tap="vid"[^>]*data-item="aaaaaaa1/);
    expect(s.videosChapters).not.toMatch(/poster|\.jpg/); // rows wear the subject picture, never a full poster
  });
  test('none / error: never a dead end', () => {
    const s = screens(load(), 'en');
    expect(s.videosNone).toMatch(/data-door="stories"/);
    expect(s.videosErr).toMatch(/data-primary data-tap="retry"/);
  });
});

describe('the watch screen (a child with no class)', () => {
  test('the video first (play is the primary), the quiz after hidden until watched', () => {
    const h = screens(load(), 'en').watch;
    expect(h).toMatch(/<video class="wq-vid" playsinline controls preload="none"/);
    expect(h).toMatch(/class="wq-vplay" type="button" data-primary/);
    expect(h).toMatch(/<div class="wq-after" hidden><a class="wq-next wq-vnext" data-tap="after" data-kind="quiz"/);
    expect(h).toContain('Play the quiz');
  });
});

describe('GOLDEN: switch off -> no door script anywhere', () => {
  test('the hub page without home_v3 never names wq-doors', () => {
    const html = renderHubPage({ payload: HUB, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    expect(html).not.toContain('wq-doors');
    expect(html).toBe(fs.readFileSync(path.join(__dirname, 'web-quiz-book-hub-golden.html'), 'utf8'));
  });
  test('hub.js does not load the door screens itself (only the v3 home, after it paints)', () => {
    expect(fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8')).not.toContain('wq-doors');
    expect(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8')).toMatch(/loadOnce\('wq-doors'/);
  });
});
