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
const BANNED = /\b(test|tests|exam|assess\w*|wrong|wcpm|rank|percentile|position|prize|reward|unlock|level|clever|perfect|genius|incredible|egma|comparable|tested|testwala|challenge|trail|today|practice|counted|story time|score)\b|امتحان|ٹیسٹ|غلط|نتائج|نتیجہ|انعام|ذہین|کامل|پڑاؤ|چیلنج|استاد/i;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const count = (html, rx) => (html.match(rx) || []).length;

function load(extra = {}) {
  const win = { ...(extra.win || {}) };
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp, ...(extra.globals || {}) };
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
    storiesShelfOnly: W.WQDOORS.html({ ...B, doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } }, c, 'stories', { stories: [], shelf: true }),
    gamesNoTopic: W.WQDOORS.html({ ...B, doors: { ...B.doors, games: [{ kind: 'quiz', code: 'MATH02', k: 'k3', topic: '', subject: 'Maths', done: false }] } }, c, 'games', { games: [] }),
    practiceVideos: W.WQDOORS.html({ ...B, practice: 1, kid: null, doors: { ...B.doors, videos: { watch: true, practice: true, grade: 3 } } }, c, 'videos', null),
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
    for (const h of [s.gamesMany, s.videosSubjects, s.videosChapters]) {
      expect(count(h, /class="wq-row wq-drow"/g)).toBeGreaterThan(0);
      expect(count(h, /data-tap="say"/g)).toBe(count(h, /class="wq-row wq-drow"/g));
    }
  });

  test('pictures are SVG, never an emoji or a symbol glyph (a symbol glyph is a blank box on Android 9)', () => {
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

describe('page_lang: every quiz link from Home and Games names the child\'s language (an Urdu child never lands on an English lesson door)', () => {
  const OPEN = { kind: 'quiz', code: 'WRD001', k: 'k9', topic: 'Words That Describe Nouns', subject: 'English', done: false, from: 'last' };
  const B = (on) => ({ ...HUB, lang: 'ur', home_v3: 1, list_states: 1, ...(on ? { page_lang: true } : {}), last: { code: 'WRD001', k: 'k9', topic: 'Words That Describe Nouns', state: 'open' },
    doors: { stories: [], games: [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' }, OPEN, { kind: 'quiz', code: 'SCI001', k: 'k2', topic: 'Plants', subject: 'Science', done: true }], videos: null } });
  test('on: the Games rows and the Next tile carry lang=ur', () => {
    const W = load();
    const h = W.WQDOORS.html(B(true), ctxOf('ur'), 'games', { games: [] });
    for (const c of ['MATH01', 'WRD001', 'SCI001']) expect(h).toMatch(new RegExp('href="/q/' + c + '\\?[^"]*lang=ur"'));
    expect(W.WQHOME.nextOf(B(true), ctxOf('ur')).href).toMatch(/^\/q\/[A-Z0-9]+\?.*lang=ur$/);
    expect(W.WQHOME.nextOf({ ...B(true), next: { kind: 'quiz', href: '/q/ABC123?k=x', title: 'T' } }, ctxOf('ur')).href).toBe('/q/ABC123?k=x&lang=ur');
  });
  test('off: the links are today\'s', () => {
    const W = load();
    expect(W.WQDOORS.html(B(false), ctxOf('ur'), 'games', { games: [] })).not.toContain('lang=ur');
    expect(W.WQHOME.nextOf(B(false), ctxOf('ur')).href).not.toContain('lang=');
  });
});

describe('Games: the new quizzes ("Try these next") a child with no teacher quiz can start', () => {
  const RECS = [{ vid: VID, title: 'Life cycle of a hen', subject: 'Science', art: '/wq/art/subject-science.webp' }, { vid: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Parts of a flower', subject: 'Science' }];
  const AGAIN = [{ kind: 'quiz', code: 'SCI001', k: 'k2', topic: 'Plants', subject: 'Science', done: true }];
  test.each([['en', 'Try these next'], ['ur', 'یہ بھی کریں']])('%s: listed above Play again, each opens at the questions; the first takes the primary', (lang, head) => {
    const W = load();
    const B = { ...HUB, lang, home_v3: 1, doors: { stories: [], games: AGAIN, videos: null, recs: RECS } };
    const h = W.WQDOORS.html(B, ctxOf(lang), 'games', { games: [] });
    expect(h).toContain(head);
    expect(count(h, /data-tap="vquiz" data-kind="rec"/g)).toBe(2);
    expect(h).toContain('data-item="' + VID + '"');
    expect(h.indexOf(head)).toBeLessThan(h.indexOf(lang === 'en' ? 'Play again' : 'دوبارہ کھیلیں'));
    expect(count(h, /data-primary/g)).toBe(1);
    expect(h).toMatch(/data-primary[^>]*data-tap="vquiz"/);
    expect(visible(h).match(BANNED)).toBe(null);
  });
  test('a lesson with an Urdu name (title_ur): the Urdu Games door shows it; the English door keeps the title', () => {
    const W = load();
    const recs = [{ ...RECS[0], title_ur: 'مرغی کی زندگی' }, RECS[1]];
    const at = (lang) => W.WQDOORS.html({ ...HUB, lang, home_v3: 1, doors: { stories: [], games: [], videos: null, recs } }, ctxOf(lang), 'games', { games: [] });
    expect(at('ur')).toContain('مرغی کی زندگی');
    expect(at('ur')).toContain('Parts of a flower');
    expect(at('en')).toContain('Life cycle of a hen');
    expect(at('en')).not.toContain('مرغی کی زندگی');
  });
  test('recs alone: never the empty note; while the rows load they are drawn for real', () => {
    const W = load();
    const B = { ...HUB, lang: 'en', home_v3: 1, list_states: 1, doors: { stories: [], games: [], videos: null, recs: RECS } };
    expect(W.WQDOORS.html(B, ctxOf('en'), 'games', { games: [] })).not.toContain('Read a story with Jugnu!');
    expect(W.WQDOORS.html(B, ctxOf('en'), 'games', null)).toContain('Life cycle of a hen');
  });
  test('the boot says number games but the door\'s rows came back without them: the numbers row stays (opens the games page)', () => {
    const W = load();
    const B = { ...HUB, lang: 'en', home_v3: 1, list_states: 1, doors: { stories: [], games: [{ kind: 'numbers' }].concat(AGAIN), videos: null } };
    const h = W.WQDOORS.html(B, ctxOf('en'), 'games', { games: [] });
    expect(h).toContain('Numbers with Jugnu');
    expect(h).toMatch(/data-primary data-tap="row" data-kind="game"[^>]*href="\/c\//);
    // a failed read is still the retry, never a made-up row
    expect(W.WQDOORS.html(B, ctxOf('en'), 'games', { games: [], err: 1 })).not.toContain('Numbers with Jugnu');
  });
  test('no recs on the boot: the Games door is today\'s, byte for byte', () => {
    const W = load();
    const B = { ...HUB, lang: 'en', home_v3: 1, doors: { stories: [], games: AGAIN, videos: null } };
    const h = W.WQDOORS.html(B, ctxOf('en'), 'games', { games: [] });
    expect(h).toBe(W.WQDOORS.html({ ...B, doors: { ...B.doors, recs: [] } }, ctxOf('en'), 'games', { games: [] }));
    expect(h).not.toContain('Try these next');
  });
});

describe('Games: Jugnu\'s passages beside the games (the Stories door shows storybooks only)', () => {
  const READS = { games: [{ kind: 'numbers', stop: 'bigger', name: 'Which is bigger?' }, { kind: 'passage', id: 'en.read.1.k02', title: 'The red kite' }, { kind: 'read', stop: 'read', name: 'Read aloud' }, { kind: 'listen', id: 'en.listen.1.k05', title: 'The rain song' }] };
  test.each([['en', 'Read along', 'Listen'], ['ur', 'جگنو کے ساتھ ساتھ پڑھیں', 'سنیں']])('%s: under the games — read along and listen open the story room by id, read aloud the games page; one primary', (lang, along, listen) => {
    const W = load();
    const B = { ...HUB, lang, home_v3: 1, doors: { stories: [], games: [], videos: null } };
    const h = W.WQDOORS.html(B, ctxOf(lang), 'games', READS);
    expect(h).toContain('room=story&amp;pid=en.read.1.k02"');
    expect(h).toContain('room=story&amp;pid=en.listen.1.k05&amp;ex=listen"');
    expect(h).toMatch(/href="\/c\/[^"]*#read"/);
    const v = visible(h);
    expect(v).toContain(along); expect(v).toContain(listen); expect(v).toContain('The red kite');
    expect(h.indexOf('Which is bigger?')).toBeLessThan(h.indexOf('pid=en.read.1.k02'));
    expect(count(h, /data-primary/g)).toBe(1);
    expect(count(h, /data-tap="say"/g)).toBe(count(h, /class="wq-row wq-drow"/g));
  });
  test('GOLDEN: no passage rows from the server -> the Games door as today', () => {
    const W = load();
    const B = { ...HUB, lang: 'en', home_v3: 1, doors: { stories: [], games: [], videos: null } };
    expect(W.WQDOORS.html(B, ctxOf('en'), 'games', { games: READS.games.slice(0, 1) })).not.toContain('A story with Jugnu');
  });
});

describe('a video\'s Urdu title (the server sends title_ur only with web_quiz_videos_ur_titles on)', () => {
  const CH_UR = { grade: '3', subject: 'Science', chapters: [{ name: 'Chapter 1', videos: [{ vid: VID, title: 'Murghi ki zindagi', title_ur: 'مرغی کی زندگی', secs: 143 }] }] };
  const B = () => ({ ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } });
  test('an Urdu child sees title_ur on the chapter row and the watch screen; an English child the title', () => {
    const W = load();
    const ur = W.WQDOORS.html({ ...B(), lang: 'ur' }, ctxOf('ur'), 'videos', { subject: 'Science', lib: CH_UR });
    expect(ur).toContain('مرغی کی زندگی');
    expect(ur).not.toContain('Murghi ki zindagi');
    const en = W.WQDOORS.html({ ...B(), lang: 'en' }, ctxOf('en'), 'videos', { subject: 'Science', lib: CH_UR });
    expect(en).toContain('Murghi ki zindagi');
    expect(en).not.toContain('مرغی کی زندگی');
    const urCh = W.WQDOORS.html({ ...B(), lang: 'ur' }, ctxOf('ur'), 'videos', { subject: 'Science', lib: { ...CH_UR, chapters: [{ ...CH_UR.chapters[0], name: 'Akhlaqi Kahaniyan', name_ur: 'اخلاقی کہانیاں' }] } });
    expect(urCh).toContain('اخلاقی کہانیاں'); // the chapter heading too (name_ur), never half the screen in Roman letters
    expect(urCh).not.toContain('Akhlaqi Kahaniyan');
    const w = W.WQDOORS.html({ ...B(), lang: 'ur' }, ctxOf('ur'), `watch/${VID}`, { watch: { vid: VID, url: 'https://r2.example.test/v.mp4', title: 'Murghi ki zindagi', title_ur: 'مرغی کی زندگی' }, next: null });
    expect(w).toContain('<p class="wq-vtitle"><bdi>مرغی کی زندگی</bdi></p>');
  });
  test('GOLDEN: no title_ur (the switch off) -> the Urdu screens print the title as today', () => {
    const W = load();
    const noUr = { ...CH_UR, chapters: [{ name: 'Chapter 1', videos: [{ vid: VID, title: 'Murghi ki zindagi', secs: 143 }] }] };
    expect(W.WQDOORS.html({ ...B(), lang: 'ur' }, ctxOf('ur'), 'videos', { subject: 'Science', lib: noUr })).toContain('Murghi ki zindagi');
  });
});

describe('the Stories door is the storybooks\' door (Jugnu\'s passages open from the Games door and the Next tile)', () => {
  test.each(['en', 'ur'])('%s: no passage or listen row and no /c/ link under the door, before and after the fetch; the shelf slot is the content', (lang) => {
    const s = screens(load(), lang);
    for (const name of ['storiesBoot', 'storiesMany', 'storiesOne']) {
      expect([name, s[name]]).not.toEqual([name, expect.stringMatching(/href="\/c\//)]);
      expect([name, count(s[name], /class="wq-row wq-drow"/g)]).toEqual([name, 0]);
    }
    expect(s.storiesMany).toContain('data-stories-shelf="1" data-host="doors"');
    expect(s.storiesBoot).toContain('data-stories-shelf="1" data-host="doors"');
    expect(count(s.storiesMany, /data-primary/g)).toBe(1); // the fallback until the shelf draws its own
  });
  test('the shelf off: the door points at Games (never a dead end, never a passage)', () => {
    const h = screens(load(), 'en').storiesOne; // rows came, the shelf flag is off
    expect(h).toMatch(/data-primary data-tap="door" data-door="games" href="#games"/);
    expect(h).not.toMatch(/href="\/c\//);
  });
  test('the home\'s own door screen (wq-doors.js not loaded yet): no passage row, no /c/ link', () => {
    const W = load();
    const B = { ...HUB, lang: 'en', home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k02', fresh: true, title: 'The red kite' }, { kind: 'listen', id: 'en.listen.1.k05', title: 'The rain song' }, { kind: 'shelf' }], games: [], videos: null } };
    const h = W.WQHOME.door(B, ctxOf('en'), 'stories');
    expect(h).not.toMatch(/href="\/c\//);
    expect(h).toContain('data-stories-shelf="1"');
  });
});

describe('Stories', () => {
  test('many rows from the server: the storybook shelf slot only, under its heading; the passages are not listed', () => {
    const h = screens(load(), 'en').storiesMany;
    expect(h).not.toMatch(/ data-shelf=/); // the Jugnu corner's own tile attribute is never the storybook slot
    expect(h).toContain('data-stories-shelf="1" data-host="doors"'); // the reader's own self-mount leaves a host's slot to the host
    expect(visible(h)).toContain('Storybooks');
    for (const title of ['The red kite', 'A cat and a hat', 'The rain song', 'My school bag']) expect(h).not.toContain(title);
  });
  test('none: the door points at Games (never a dead end)', () => {
    const s = screens(load(), 'en');
    expect(s.storiesNone).toMatch(/data-primary data-tap="door" data-door="games" href="#games"/);
  });
  test('before the fetch: the shelf slot from the boot (its passage row is not drawn)', () => {
    const h = screens(load(), 'en').storiesBoot;
    expect(h).not.toContain('The red kite');
    expect(h).toContain('data-stories-shelf="1"');
  });
  test('only storybooks (no rows of its own): one primary that points at Games until the shelf draws its own', () => {
    const h = screens(load(), 'en').storiesShelfOnly;
    expect(count(h, /data-primary/g)).toBe(1);
    expect(h).toMatch(/<div data-shelf-fallback="1"><div class="wq-dempty">[\s\S]*data-primary data-tap="door" data-door="games"/);
    expect(h.indexOf('data-stories-shelf="1"')).toBeLessThan(h.indexOf('data-shelf-fallback'));
  });
  test('Urdu section heads take the screen\'s right-to-left direction (no dir="auto" on a head that holds a <bdi>)', () => {
    const h = screens(load(), 'ur').storiesMany;
    expect(h).toMatch(/<h3 class="wq-dsec">/);
    expect(h).not.toMatch(/<h3 class="wq-dsec" dir="auto">/);
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
    // the grade picker names the selection («Grade 3», design-qa P2, bd-5gyspy.5): a grade, not a count about the child
    expect(h).toMatch(/data-tap="gpk"[^>]*>Grade 3</);
    expect(visible(h.replace(/<button[^>]*data-tap="gpk"[\s\S]*?<\/button>/, ''))).not.toMatch(/\d/);
  });
  test('one / none', () => {
    const s = screens(load(), 'en');
    expect(count(s.gamesOne, /class="wq-row wq-drow"/g)).toBe(1);
    expect(s.gamesNone).toMatch(/data-door="stories"/);
  });
  test('a teacher\'s quiz with no topic: "Your teacher\'s quiz" / «ٹیچر کا کوئز» (the one word for a teacher), never «استاد»', () => {
    expect(visible(screens(load(), 'en').gamesNoTopic)).toContain("Your teacher's quiz");
    const ur = screens(load(), 'ur').gamesNoTopic;
    expect(visible(ur)).toContain('ٹیچر کا کوئز');
    expect(ur).not.toContain('استاد');
  });
  test('a teacher\'s quiz row says which quiz it is (data-item = its code)', () => {
    const h = screens(load(), 'en').gamesMany;
    expect(h).toMatch(/data-kind="quiz" data-pos="0" data-item="MATH01"/);
    expect(h).toMatch(/data-kind="again" data-pos="0" data-item="SCI001"/);
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

// A small fake DOM for the live paths (no jsdom in this package): elements by selector, listeners, attributes.
function el(extra = {}) {
  return {
    attrs: {}, hidden: false, listeners: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {}, stopPropagation() {} })); },
    querySelector: () => null, ...extra,
  };
}
function fakeRoot(map = {}, taps = []) {
  return { innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: (sel) => map[sel] || null, querySelectorAll: (sel) => (sel === '[data-tap]' ? taps : []) };
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
function live({ win = {}, fetchImpl, byId = {}, hash = '' } = {}) {
  const head = [];
  const observers = [];
  const MutationObserver = function (cb) { this.observe = () => observers.push(cb); };
  const fetch = jest.fn(fetchImpl || (() => new Promise(() => {})));
  const document = {
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => el({ tag }),
    head: { appendChild: (x) => head.push(x) },
  };
  const location = { hash, pathname: `/h/${TOKEN}`, search: `?kid=${KID}` };
  const W = load({ win: { scrollTo() {}, addEventListener() {}, ...win }, globals: { fetch, document, location, MutationObserver, setImmediate } });
  return { W, fetch, head, observers, location };
}
const BOOK_B = { ...HUB, home_v3: 1, stories: { on: true }, doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } };

describe('the storybook shelf: the reader fills the slot, keyed on the boot\'s stories.on', () => {
  test('no rows of its own: shelf(slot, B, {token, lang, primary: true}); the fallback steps aside while the shelf shows a primary, and comes back if it goes', () => {
    const shelf = jest.fn();
    const { W, observers } = live({ win: { WQSTORIES: { shelf } } });
    const sh = el(); const btn = el(); btn.setAttribute('data-primary', ''); const fb = el({ querySelector: (q) => (q === '.wq-go' ? btn : null) });
    W.WQDOORS.mount(fakeRoot({ '[data-stories-shelf]': sh, '[data-shelf-fallback]': fb }), BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    expect(shelf).toHaveBeenCalledWith(sh, BOOK_B, expect.objectContaining({ token: TOKEN, lang: 'en', primary: true }));
    expect(fb.hidden).toBe(false);
    sh.querySelector = (q) => (q === '[data-primary]' ? el() : null);
    observers.forEach((cb) => cb());
    expect(fb.hidden).toBe(true);
    expect(btn.getAttribute('data-primary')).toBeNull();
    sh.hidden = true; // the reader hides its slot when stories are off on the server
    observers.forEach((cb) => cb());
    expect(fb.hidden).toBe(false);
    expect(btn.getAttribute('data-primary')).toBe('');
  });
  test('rows of its own: primary false (the door keeps its one primary)', () => {
    const shelf = jest.fn();
    const { W } = live({ win: { WQSTORIES: { shelf } } });
    const sh = el();
    W.WQDOORS.mount(fakeRoot({ '[data-stories-shelf]': sh }), BOOK_B, { token: TOKEN, lang: 'ur', ev() {} }, 'stories');
    expect(shelf).toHaveBeenCalledWith(sh, BOOK_B, expect.objectContaining({ token: TOKEN, lang: 'ur', primary: false }));
  });
  test('stories.on absent: the reader is never called or loaded', () => {
    const shelf = jest.fn();
    const { W, head } = live({ win: { WQSTORIES: { shelf } } });
    W.WQDOORS.mount(fakeRoot({ '[data-stories-shelf]': el() }), { ...BOOK_B, stories: null }, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    expect(shelf).not.toHaveBeenCalled();
    expect(head.map((x) => x.src || x.href).filter(Boolean)).toEqual([]);
  });
});

describe('the storybook shelf is asked for once per door visit (the rows arriving redraw the door)', () => {
  // a root whose every draw gives a fresh slot, as a real innerHTML does
  function drawingRoot() {
    const parent = { replaceChild: jest.fn() };
    const slots = []; let draws = 0;
    const root = {
      attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
      get innerHTML() { return ''; }, set innerHTML(v) { draws += 1; const x = el({ parentNode: parent }); x.setAttribute('data-host', 'doors'); slots.push(x); },
      querySelector: (sel) => (sel === '[data-stories-shelf]' ? slots[slots.length - 1] || null : null),
      querySelectorAll: () => [],
    };
    // Home drawn over the door: the home's own slot (no data-host), as wq-home.js draws it
    const home = () => { draws += 1; slots.push(el({ parentNode: parent })); };
    return { root, slots, parent, draws: () => draws, home };
  }
  const ROWS = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(STORIES_MANY)), json: () => Promise.resolve(STORIES_MANY) });
  test('the reader already here: one shelf fill; the redraw moves the filled shelf into the new slot (no second GET, no repaint)', async () => {
    const shelf = jest.fn((x) => x.setAttribute('data-filled', '1'));
    const { W } = live({ win: { WQSTORIES: { shelf } }, fetchImpl: ROWS });
    const r = drawingRoot();
    W.WQDOORS.mount(r.root, BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    await flush();
    expect(r.draws()).toBe(2);
    expect(shelf).toHaveBeenCalledTimes(1);
    expect(shelf.mock.calls[0][0]).toBe(r.slots[0]);
    expect(r.parent.replaceChild).toHaveBeenCalledWith(r.slots[0], r.slots[1]);
  });
  test('the reader arrives after the rows redrew the door: it fills the slot on screen, not the one the first draw made', async () => {
    const { W, head } = live({ fetchImpl: ROWS });
    const r = drawingRoot();
    W.WQDOORS.mount(r.root, BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    await flush();
    expect(r.draws()).toBe(2);
    const shelf = jest.fn();
    W.WQSTORIES = { shelf };
    head.filter((x) => /wq-stories\.js/.test(x.src || '')).forEach((x) => x.fire('load'));
    expect(shelf).toHaveBeenCalledTimes(1);
    expect(shelf.mock.calls[0][0]).toBe(r.slots[1]);
  });
  test('Home tapped before the reader answers: the late reader paints nothing on the Home screen; the next Stories visit gets its shelf', async () => {
    const { W, head } = live({ fetchImpl: ROWS });
    const r = drawingRoot();
    W.WQDOORS.mount(r.root, BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    await flush();
    r.home();
    const shelf = jest.fn((x) => x.setAttribute('data-filled', '1'));
    W.WQSTORIES = { shelf };
    head.filter((x) => /wq-stories\.js/.test(x.src || '')).forEach((x) => x.fire('load'));
    expect(shelf).not.toHaveBeenCalled();
    W.WQDOORS.mount(r.root, BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    expect(shelf).toHaveBeenCalledTimes(1);
    expect(shelf.mock.calls[0][0]).toBe(r.slots[r.slots.length - 1]);
  });
  test('a new visit to the door asks again (a book read since may have changed the shelf)', async () => {
    const shelf = jest.fn((x) => x.setAttribute('data-filled', '1'));
    const { W } = live({ win: { WQSTORIES: { shelf } }, fetchImpl: ROWS });
    const r = drawingRoot();
    W.WQDOORS.mount(r.root, BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    await flush();
    W.WQDOORS.mount(r.root, BOOK_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    expect(shelf).toHaveBeenCalledTimes(2);
  });
});

describe('a teacher\'s class preview (no child): the boot\'s rows only, nothing fetched, a row tap shows the one line', () => {
  const PR_B = { ...HUB, practice: 1, kid: null, home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k02', title: 'The red kite' }], games: [{ kind: 'numbers' }], videos: { watch: true, practice: true, grade: 3 } } };
  test.each(['stories', 'games', 'videos', `watch/${VID}`])('%s: no fetch (never /api/wq/door… or the library with an empty kid)', (name) => {
    const { W, fetch } = live();
    W.WQDOORS.mount(fakeRoot(), PR_B, { token: TOKEN, lang: 'en', ev() {} }, name);
    expect(fetch).not.toHaveBeenCalled();
  });
  test('Videos in the preview: the one line + one primary that points at Stories', () => {
    const h = screens(load(), 'en').practiceVideos;
    expect(count(h, /data-primary/g)).toBe(1);
    expect(visible(h)).toContain('Children watch the videos from their own link');
    expect(visible(screens(load(), 'ur').practiceVideos)).toContain('بچے اپنے لنک سے ویڈیوز دیکھیں گے');
    expect(h).toMatch(/data-primary data-tap="door" data-door="stories"/);
  });
  test('a row tap: WQHOME.practiceNote, never a navigation', () => {
    const { W } = live();
    const note = jest.fn(); W.WQHOME.practiceNote = note;
    const go = jest.fn();
    const row = el(); row.setAttribute('data-tap', 'row'); row.setAttribute('href', '/c/x?kid='); row.setAttribute('data-kind', 'passage');
    const root = fakeRoot({}, [row]);
    W.WQDOORS.mount(root, PR_B, { token: TOKEN, lang: 'en', ev() {}, go }, 'stories');
    row.fire('click');
    expect(note).toHaveBeenCalledWith(root, expect.objectContaining({ token: TOKEN }));
    expect(go).not.toHaveBeenCalled();
  });
});

describe('the preview that PLAYS (the boot\'s practice_play, app_settings web_quiz_practice_play): every door opens what a child\'s does', () => {
  const PLAY_B = { ...HUB, practice: 1, practice_play: 1, kid: null, home_v3: 1, stories: { on: 1 }, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k02', title: 'The red kite' }, { kind: 'shelf' }], games: [{ kind: 'numbers' }], videos: { watch: true, practice: true, grade: 3 } } };
  const ok = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  test('Games: the door asks for its rows (the grade\'s games) and draws them', async () => {
    const { W, fetch } = live({ fetchImpl: ok(GAMES_MANY) });
    const root = fakeRoot();
    W.WQDOORS.mount(root, PLAY_B, { token: TOKEN, lang: 'en', ev() {} }, 'games');
    await flush();
    expect(fetch).toHaveBeenCalledWith(`/api/wq/doors/h/${TOKEN}?kid=&d=games&l=en`, expect.anything());
    expect(root.innerHTML).toContain('data-item="missing"');
  });
  test('Stories: the reader fills the shelf (stories.on), never the "children open it" line', () => {
    const shelf = jest.fn();
    const { W } = live({ win: { WQSTORIES: { shelf } } });
    const sh = el();
    W.WQDOORS.mount(fakeRoot({ '[data-stories-shelf]': sh }), PLAY_B, { token: TOKEN, lang: 'en', ev() {} }, 'stories');
    expect(shelf).toHaveBeenCalledWith(sh, PLAY_B, expect.objectContaining({ token: TOKEN, lang: 'en' }));
  });
  test('Videos: the library is asked for, and the screen is the library\'s, not the preview line', async () => {
    const { W, fetch } = live({ fetchImpl: ok(LIB_SUBJECTS) });
    const root = fakeRoot();
    W.WQDOORS.mount(root, PLAY_B, { token: TOKEN, lang: 'en', ev() {} }, 'videos');
    await flush();
    expect(fetch).toHaveBeenCalledWith(`/api/wq/lib/h/${TOKEN}?kid=&l=en`, expect.anything());
    expect(visible(root.innerHTML)).not.toContain('Children watch the videos from their own link');
    expect(visible(W.WQDOORS.html(PLAY_B, ctxOf('en'), 'videos', { lib: LIB_SUBJECTS }))).toContain('Science');
  });
  test('a video: videos/start with the preview token, and the player draws', async () => {
    const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: false } };
    const { W, fetch } = live({ fetchImpl: ok(WATCH) });
    const root = fakeRoot();
    W.WQDOORS.mount(root, PLAY_B, { token: TOKEN, lang: 'en', ev() {} }, `watch/${VID}`);
    await flush();
    expect(fetch).toHaveBeenCalledWith('/api/wq/videos/start', expect.objectContaining({ method: 'POST', body: JSON.stringify({ hub: TOKEN, kid: '', vid: VID }) }));
    expect(root.innerHTML).toContain('<video class="wq-vid"');
  });
  test('a row tap opens it (the games page, the story room): never the preview note', () => {
    const { W } = live();
    const note = jest.fn(); W.WQHOME.practiceNote = note;
    const go = jest.fn();
    const row = el(); row.setAttribute('data-tap', 'row'); row.setAttribute('href', `/c/${TOKEN}?kid=&lang=en#bigger`); row.setAttribute('data-kind', 'game');
    W.WQDOORS.mount(fakeRoot({}, [row]), PLAY_B, { token: TOKEN, lang: 'en', ev() {}, go }, 'games');
    row.fire('click');
    expect(note).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith(`/c/${TOKEN}?kid=&lang=en#bigger`, 'door_game');
  });
});

describe('a watched video ends on the finish card when the boot says card_v3 (one Next tile: the card\'s)', () => {
  const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: false } };
  // videos/start answers the watch; the library (after the card's Next) answers no subjects
  const answer = (url) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(WATCH)), json: () => Promise.resolve(/\/lib\//.test(url) ? { grade: '3', subjects: [] } : WATCH) });
  function watchPage({ card, wqfc, watch = true, extra = {} }) {
    const nextEl = el();
    const t = live({ win: wqfc ? { WQFC: wqfc } : {}, fetchImpl: answer, byId: { 'wqfc-next': nextEl } });
    const holder = { removeChild: jest.fn() };
    const tile = el();
    const after = el({ hidden: true, parentNode: holder, querySelector: (q) => (q === '.wq-vnext' ? tile : null) });
    const vEl = el({ duration: 100, currentTime: 0 }); const play = el(); play.setAttribute('data-primary', '');
    const root = fakeRoot({ '.wq-vid': vEl, '.wq-vplay': play, '.wq-after': after });
    const evs = [];
    t.W.WQDOORS.mount(root, { ...HUB, home_v3: 1, ...(card ? { card_v3: true } : {}), ...extra, doors: { stories: [], games: [], videos: { href: '/lib/x', ...(watch ? { watch: true } : {}) } } }, { token: TOKEN, lang: 'en', ev: (n, p) => evs.push([n, p]) }, `watch/${VID}`);
    return { ...t, root, after, holder, tile, vEl, play, nextEl, evs };
  }
  test('card_v3 + the card there: WQFC.mount(the tile holder, {kind video, deed video_watched, title, next → this page, auth {hub, kid}}); our own tile goes; its Next does what ours did', async () => {
    const mount = jest.fn(() => true);
    const p = watchPage({ card: true, wqfc: { mount } });
    await flush();
    p.vEl.fire('ended');
    expect(mount).toHaveBeenCalledWith(p.after, expect.objectContaining({
      kind: 'video', deed: 'video_watched', lang: 'en', title: 'Life cycle of a hen',
      next: { kind: 'video', title: 'More videos', sub: '', href: `/h/${TOKEN}?kid=${KID}#videos` }, auth: { hub: TOKEN, kid: KID },
    }));
    expect(p.holder.removeChild).toHaveBeenCalledWith(p.after);
    expect(p.evs.filter(([n]) => n === 'next_shown')).toEqual([]); // the card logs its own tile
    expect(p.play.getAttribute('data-primary')).toBeNull();
    p.nextEl.fire('click');
    expect(p.location.hash).toBe('#videos');
  });
  test('the card and ONE next thing: the card\'s Next tile leads (lead: true), so Share is the soft secondary', async () => {
    const mount = jest.fn(() => true);
    const p = watchPage({ card: true, wqfc: { mount } });
    await flush();
    p.vEl.fire('ended');
    expect(mount.mock.calls[0][1].lead).toBe(true);
  });
  test('a child with no class (the Videos door is watch-only: no teacher\'s quiz yet): the card\'s share says "Share" (plain)', async () => {
    const mount = jest.fn(() => true);
    const p = watchPage({ card: true, wqfc: { mount } });
    await flush();
    p.vEl.fire('ended');
    expect(mount.mock.calls[0][1].plain).toBe(true);   // HUB's videos door is { watch: true } in this suite
  });
  test('the corrected Urdu share words (the hub\'s ur_share): the card is told (urs); anything but true: not', async () => {
    for (const [extra, urs] of [[{ ur_share: true }, true], [{ ur_share: 'true' }, undefined], [{}, undefined]]) {
      const mount = jest.fn(() => true);
      const p = watchPage({ card: true, wqfc: { mount }, extra });
      await flush();
      p.vEl.fire('ended');
      expect(mount.mock.calls[0][1].urs).toBe(urs);
    }
  });
  test('a class child (a teacher\'s quiz played: the Videos door is not watch-only): the class words (plain false)', async () => {
    const mount = jest.fn(() => true);
    const p = watchPage({ card: true, wqfc: { mount }, watch: false });
    await flush();
    p.vEl.fire('ended');
    expect(mount.mock.calls[0][1].plain).toBe(false);
  });
  test('GOLDEN: no card_v3 -> today\'s end (our tile shown and primary, next_shown logged), the card never asked', async () => {
    const mount = jest.fn(() => true);
    const p = watchPage({ card: false, wqfc: { mount } });
    await flush();
    p.vEl.fire('ended');
    expect(mount).not.toHaveBeenCalled();
    expect(p.after.hidden).toBe(false);
    expect(p.tile.getAttribute('data-primary')).toBe('');
    expect(p.evs.filter(([n]) => n === 'next_shown')).toEqual([['next_shown', { ctx: 'after_video', kind: 'video', pos: 0, source: 'fallback' }]]);
  });
  test('card_v3 but the card\'s script missing or refusing: today\'s end', async () => {
    const p = watchPage({ card: true, wqfc: { mount: () => false } });
    await flush();
    p.vEl.fire('ended');
    expect(p.after.hidden).toBe(false);
  });
  test('the card\'s script is asked for once while the video plays, at hub.js\'s ?v=, only with card_v3', async () => {
    const on = watchPage({ card: true });
    await flush();
    expect(on.head.map((x) => x.src)).toEqual(['/wq/wq-finish-card.js?v=abc123']);
    const off = watchPage({ card: false });
    await flush();
    expect(off.head).toEqual([]);
  });
});

describe('after a watched video: a ranked Next from the server (watch.next) when it sends one, else today\'s fixed rule', () => {
  const VID2 = '0b9c5d1e-7f6a-4b3c-9d2e-1a0f9e8d7c6b';
  function watchWith(next, { card = true } = {}) {
    const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: true, ...(next ? { next } : {}) } };
    const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(WATCH)), json: () => Promise.resolve(WATCH) });
    const nextEl = el();
    const mount = jest.fn(() => true);
    const t = live({ win: { WQFC: { mount } }, fetchImpl: answer, byId: { 'wqfc-next': nextEl } });
    const after = el({ hidden: true, parentNode: { removeChild() {} }, querySelector: () => el() });
    const vEl = el({ duration: 100, currentTime: 0 });
    const root = fakeRoot({ '.wq-vid': vEl, '.wq-vplay': el(), '.wq-after': after });
    const go = jest.fn();
    const evs = [];
    t.W.WQDOORS.mount(root, { ...HUB, home_v3: 1, ...(card ? { card_v3: true } : {}), doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'ur', ev: (n, p) => evs.push([n, p]), go }, `watch/${VID}`);
    return { ...t, root, vEl, nextEl, mount, go, evs };
  }
  const posts = (fetch) => fetch.mock.calls.filter(([u]) => /videos\/start/.test(u)).map(([, o]) => JSON.parse(o.body));
  test('a story the server ranked first: the tile is its words (the page\'s language), the card\'s Next opens its hash, next_shown says server', async () => {
    const p = watchWith({ kind: 'story', title: 'Read a story', title_ur: 'کہانی پڑھیں', href: '#stories' });
    await flush();
    p.vEl.fire('ended');
    expect(p.mount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ next: { kind: 'story', title: 'کہانی پڑھیں', sub: '', href: `/h/${TOKEN}?kid=${KID}#stories` } }));
    p.nextEl.fire('click');
    expect(p.location.hash).toBe('#stories');
    expect(posts(p.fetch)).toEqual([{ hub: TOKEN, kid: KID, vid: VID }]); // nothing minted
  });
  test('#after/<vid>: the quiz after the video, minted on the tap (POST after:1), never at render', async () => {
    const p = watchWith({ kind: 'quiz', title: 'Play the quiz', title_ur: 'کوئز کھیلیں', href: '#after/' + VID });
    await flush();
    p.vEl.fire('ended');
    expect(posts(p.fetch)).toEqual([{ hub: TOKEN, kid: KID, vid: VID }]);
    p.nextEl.fire('click');
    await flush();
    expect(posts(p.fetch)[1]).toEqual({ hub: TOKEN, kid: KID, vid: VID, after: 1 });
  });
  test('#watch/<vid>: the next lesson starts here; a /path opens that page', async () => {
    const p = watchWith({ kind: 'video', title: 'Watch next', title_ur: 'اگلی ویڈیو دیکھیں', href: '#watch/' + VID2 });
    await flush();
    p.vEl.fire('ended');
    p.nextEl.fire('click');
    await flush();
    expect(posts(p.fetch)[1]).toEqual({ hub: TOKEN, kid: KID, vid: VID2 });
    const q = watchWith({ kind: 'game', title: 'Which is bigger?', title_ur: 'کون سا عدد بڑا ہے؟', href: '/c/tok#bigger' });
    await flush();
    q.vEl.fire('ended');
    q.nextEl.fire('click');
    expect(q.go).toHaveBeenCalledWith('/c/tok#bigger', 'after_video');
  });
  test('no card: our own tile; next_shown carries source ranked for a ranked Next, fallback without one', async () => {
    const p = watchWith({ kind: 'story', title: 'Read a story', title_ur: 'کہانی پڑھیں', href: '#stories' }, { card: false });
    await flush();
    p.vEl.fire('ended');
    expect(p.evs.filter(([n]) => n === 'next_shown')).toEqual([['next_shown', { ctx: 'after_video', kind: 'story', pos: 0, source: 'ranked' }]]);
    const q = watchWith(null, { card: false });
    await flush();
    q.vEl.fire('ended');
    expect(q.evs.filter(([n]) => n === 'next_shown')).toEqual([['next_shown', { ctx: 'after_video', kind: 'quiz', pos: 0, source: 'fallback' }]]);
  });
  test('a ranked Next joins the server\'s offer: next_shown and next_tap carry its offer, source, rank_src, arm, score_v and id (the relay\'s own words)', async () => {
    const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: true,
      next: { kind: 'story', title: 'Read a story', href: '#stories', offer: 'abcdefghij', source: 'pinned', rank_src: 'ctrl', arm: 'b', score_v: 'v1', id: 'en.read.1.k02', bogus: '<x>' } } };
    const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(WATCH)), json: () => Promise.resolve(WATCH) });
    const t = live({ fetchImpl: answer });
    const tap = el(); tap.setAttribute('data-tap', 'after'); tap.closest = () => tap;
    const after = el({ hidden: true, parentNode: { removeChild() {} }, querySelector: () => el() });
    const vEl = el({ duration: 100, currentTime: 0 });
    const root = fakeRoot({ '.wq-vid': vEl, '.wq-vplay': el(), '.wq-after': after }, [tap]);
    const evs = [];
    t.W.WQDOORS.mount(root, { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev: (n, p) => evs.push([n, p]), go: jest.fn() }, `watch/${VID}`);
    await flush();
    vEl.fire('ended');
    const join = { offer: 'abcdefghij', source: 'pinned', rank_src: 'ctrl', arm: 'b', score_v: 'v1', id: 'en.read.1.k02' };
    expect(evs.find(([n]) => n === 'next_shown')[1]).toEqual({ ctx: 'after_video', kind: 'story', pos: 0, ...join });
    tap.fire('click', { preventDefault() {}, stopPropagation() {}, target: tap });
    const tapE = evs.find(([n]) => n === 'next_tap')[1];
    expect(tapE).toEqual({ ctx: 'after_video', kind: 'story', pos: 0, ...join, ms_to_tap: tapE.ms_to_tap });
    expect(Number.isInteger(tapE.ms_to_tap) && tapE.ms_to_tap >= 0).toBe(true);
  });
  test('the control arm\'s tile (the server marks it source fallback) logs source fallback beside rank_src ctrl, never ranked', async () => {
    const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: true,
      next: { kind: 'story', title: 'Read a story', href: '#stories', offer: 'abcdefghij', source: 'fallback', rank_src: 'ctrl', arm: 'ctrl' } } };
    const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(WATCH)), json: () => Promise.resolve(WATCH) });
    const t = live({ fetchImpl: answer });
    const tap = el(); tap.setAttribute('data-tap', 'after'); tap.closest = () => tap;
    const after = el({ hidden: true, parentNode: { removeChild() {} }, querySelector: () => el() });
    const vEl = el({ duration: 100, currentTime: 0 });
    const root = fakeRoot({ '.wq-vid': vEl, '.wq-vplay': el(), '.wq-after': after }, [tap]);
    const evs = [];
    t.W.WQDOORS.mount(root, { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev: (n, p) => evs.push([n, p]), go: jest.fn() }, `watch/${VID}`);
    await flush();
    vEl.fire('ended');
    const join = { offer: 'abcdefghij', source: 'fallback', rank_src: 'ctrl', arm: 'ctrl' };
    expect(evs.find(([n]) => n === 'next_shown')[1]).toEqual({ ctx: 'after_video', kind: 'story', pos: 0, ...join });
    tap.fire('click', { preventDefault() {}, stopPropagation() {}, target: tap });
    const tapE = evs.find(([n]) => n === 'next_tap')[1];
    expect(tapE).toEqual({ ctx: 'after_video', kind: 'story', pos: 0, ...join, ms_to_tap: tapE.ms_to_tap });
    expect(Number.isInteger(tapE.ms_to_tap) && tapE.ms_to_tap >= 0).toBe(true);
  });
  test('a second video started from the first one\'s Next tile: a tap before its own Next tile shows carries no ms_to_tap (never the first video\'s), and after it ends the tap is timed again', async () => {
    const answers = {
      [VID]: { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: true,
        next: { kind: 'video', title: 'Watch next', href: '#watch/' + VID2, source: 'ranked' } } },
      [VID2]: { watch: { vid: VID2, url: 'https://r2.example.test/v2_web.mp4?sig', title: 'Parts of a flower', lang: 'en', after: true,
        next: { kind: 'story', title: 'Read a story', href: '#stories', source: 'ranked' } } },
    };
    const answer = (u, o) => { const j = answers[JSON.parse(o.body).vid]; return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(j)), json: () => Promise.resolve(j) }); };
    const t = live({ fetchImpl: answer });
    // Each draw gives fresh elements, as the page's innerHTML does (no listener carried over from the screen before).
    let cur;
    const fresh = () => {
      const tap = el(); tap.setAttribute('data-tap', 'after'); tap.closest = () => tap;
      cur = { tap, vEl: el({ duration: 100, currentTime: 0 }), play: el(), after: el({ hidden: true, parentNode: { removeChild() {} }, querySelector: () => el() }) };
    };
    fresh();
    const root = {
      attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
      get innerHTML() { return ''; }, set innerHTML(v) { fresh(); },
      querySelector: (sel) => ({ '.wq-vid': cur.vEl, '.wq-vplay': cur.play, '.wq-after': cur.after }[sel] || null),
      querySelectorAll: (sel) => (sel === '[data-tap]' ? [cur.tap] : []),
    };
    const evs = [];
    const click = () => cur.tap.fire('click', { preventDefault() {}, stopPropagation() {}, target: cur.tap });
    const taps = () => evs.filter(([n]) => n === 'next_tap').map(([, p]) => p);
    t.W.WQDOORS.mount(root, { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev: (n, p) => evs.push([n, p]), go: jest.fn() }, `watch/${VID}`);
    await flush();
    cur.vEl.fire('ended'); // video 1's Next tile shows
    expect(evs.filter(([n]) => n === 'next_shown').length).toBe(1);
    click(); // video 1's tile: the next lesson starts here
    expect(Number.isInteger(taps()[0].ms_to_tap)).toBe(true);
    await flush();
    expect(posts(t.fetch).map((b) => b.vid)).toEqual([VID, VID2]);
    click(); // video 2's tile, before video 2 ends: its tile was never shown, so no time to tap
    expect(taps().length).toBe(2);
    expect(taps()[1]).toEqual({ ctx: 'after_video', kind: 'story', pos: 0, source: 'ranked' });
    expect('ms_to_tap' in taps()[1]).toBe(false);
    cur.vEl.fire('ended'); // video 2's own Next tile shows
    expect(evs.filter(([n]) => n === 'next_shown').length).toBe(2);
    click();
    expect(taps().length).toBe(3);
    expect(Number.isInteger(taps()[2].ms_to_tap) && taps()[2].ms_to_tap >= 0).toBe(true);
  });
  test('a malformed next (no title, an outside href, javascript:) is ignored: today\'s rule', async () => {
    for (const bad of [{ href: '#stories' }, { title: 'x', href: 'https://evil.example/' }, { title: 'x', href: 'javascript:alert(1)' }, { title: 'x', href: '//evil.example/p' }, 'nope']) {
      const p = watchWith(bad);
      await flush();
      p.vEl.fire('ended');
      expect(p.mount.mock.calls[0][1].next.kind).toBe('quiz'); // watch.after: the fixed rule's quiz
    }
  });
});

describe('#watch/<lesson id> on page load: the home hands it to the door screens, which start the video', () => {
  test('the home mounts the watch screen and asks videos/start for that lesson', async () => {
    const { W, fetch } = live({ hash: `#watch/${VID}` });
    W.WQHOME.mount(fakeRoot(), { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev() {} });
    expect(fetch).toHaveBeenCalledWith('/api/wq/videos/start', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ hub: TOKEN, kid: KID, vid: VID });
  });

  test('a hash change to #watch/<lesson id> after the home is up starts that lesson too (the "Watch next" tile\'s way)', async () => {
    const on = {};
    const { W, fetch, location } = live({ win: { addEventListener: (type, fn) => { on[type] = fn; } } });
    W.WQHOME.mount(fakeRoot(), { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev() {} });
    expect(fetch).not.toHaveBeenCalledWith('/api/wq/videos/start', expect.anything());
    expect(typeof on.hashchange).toBe('function');
    location.hash = `#watch/${VID}`;
    on.hashchange();
    expect(fetch).toHaveBeenCalledWith('/api/wq/videos/start', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls.find((c) => c[0] === '/api/wq/videos/start')[1].body)).toEqual({ hub: TOKEN, kid: KID, vid: VID });
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

// ---- the screenshot pass: look-and-feel defects, checked on the shipped CSS and markup -------------------
const DOORS_CSS = fs.readFileSync(path.join(WQ, 'wq-doors.css'), 'utf8');
const HOME_CSS = fs.readFileSync(path.join(WQ, 'wq-home.css'), 'utf8');
const ALL_CSS = DOORS_CSS + '\n' + HOME_CSS;
const rulesFor = (css, selRx) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => selRx.test(m[1])).map((m) => m[2]).join(';');

describe('the screenshot pass: door screens', () => {
  test('Urdu video title sits at the start (right) edge: text-align start, no hard left/right, no forced ltr', () => {
    const decl = rulesFor(ALL_CSS, /\.wq-vtitle\s*$/);
    expect(decl).toMatch(/text-align:\s*start/);
    expect(decl).not.toMatch(/text-align:\s*(left|right)/);
    const w = screens(load(), 'ur').watch;
    expect(w).toMatch(/<p class="wq-vtitle">/);
    expect(w).not.toMatch(/<p class="wq-vtitle"[^>]*dir="(ltr|auto)"/);
  });
  test('Urdu screen title: starts at the right edge by a logical property; Home stays on the left', () => {
    const decl = rulesFor(ALL_CSS, /\.wq-droom\[dir=rtl\] \.wq-dtop h2/);
    expect(decl).toMatch(/text-align:\s*start/);
    expect(ALL_CSS).not.toMatch(/\.wq-dtop h2\{[^}]*text-align:\s*(left|right)/);
    expect(rulesFor(ALL_CSS, /\.wq-dtop\s*$/)).toMatch(/direction:\s*ltr/);
  });
  test('the one primary row has its own look (brand border) and each screen has exactly one primary', () => {
    expect(rulesFor(DOORS_CSS, /\.wq-drow\[data-primary\]/)).toMatch(/border-color:\s*var\(--brand\)/);
    for (const lang of ['en', 'ur']) for (const [name, h] of Object.entries(screens(load(), lang))) expect([name, count(h, /data-primary/g)]).toEqual([name, 1]);
    const s = screens(load(), 'en');
    for (const h of [s.gamesMany, s.videosSubjects, s.videosChapters]) expect(h).toMatch(/class="wq-row wq-drow" data-primary/);
  });
  test('the door frame keeps clear of the fixed bottom bar (bar height + safe area)', () => {
    const decl = rulesFor(ALL_CSS, /\.wq-droom\s*$/) + ';' + rulesFor(ALL_CSS, /\.wq-home\s*$/);
    expect(decl).toMatch(/padding-bottom:\s*calc\(\s*9[0-9]px\s*\+\s*env\(safe-area-inset-bottom/);
  });
  test('a number and its unit never split: the lesson minutes ride in a nowrap span', () => {
    for (const [lang, rx] of [['en', /<span class="wq-nmin">2 min<\/span>/], ['ur', /<span class="wq-nmin">۲ منٹ<\/span>/]]) {
      expect(screens(load(), lang).videosChapters).toMatch(rx);
    }
    expect(rulesFor(ALL_CSS, /\.wq-nmin/)).toMatch(/white-space:\s*nowrap/);
  });
});

describe('a child with a class: a video row opens the lesson page marked as coming from the Videos door', () => {
  test('videos/start answers a class code: the lesson link carries via=videos after its key', async () => {
    const CODE = { code: 'ABC123', k: 'kk' };
    const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(CODE)), json: () => Promise.resolve(CODE) });
    const t = live({ fetchImpl: answer });
    const go = jest.fn();
    t.W.WQDOORS.mount(fakeRoot({ '.wq-vid': null }), { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev() {}, go }, `watch/${VID}`);
    await flush();
    expect(go).toHaveBeenCalledWith('/q/ABC123?k=kk&via=videos', 'door_video');
  });
  test('a code without a key still carries the mark', async () => {
    const CODE = { code: 'ABC123' };
    const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(CODE)), json: () => Promise.resolve(CODE) });
    const t = live({ fetchImpl: answer });
    const go = jest.fn();
    t.W.WQDOORS.mount(fakeRoot({ '.wq-vid': null }), { ...HUB, home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev() {}, go }, `watch/${VID}`);
    await flush();
    expect(go).toHaveBeenCalledWith('/q/ABC123?via=videos', 'door_video');
  });
});

// app_settings web_quiz_video_clean_start (the boot's `video_clean`, default off): one play button at 0:00 on the Videos
// tab's player. With it on the player has no controls of its own until the first play, then it has them (pause, seek,
// fullscreen); off, today's player with its controls from the start.
describe('the watch screen\'s clean start (web_quiz_video_clean_start)', () => {
  const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: false } };
  const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(WATCH)), json: () => Promise.resolve(WATCH) });
  const markup = (lang, extra) => load().WQDOORS.html({ ...HUB, lang, home_v3: 1, ...extra, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, ctxOf(lang), `watch/${VID}`, { watch: { vid: VID, url: 'https://r2.example.test/v.mp4', title: 'Life cycle of a hen', title_ur: 'مرغی کی زندگی' }, next: null });
  async function played(extra) {
    const t = live({ fetchImpl: answer });
    const vEl = el({ duration: 100, currentTime: 0 }); const play = el(); play.setAttribute('data-primary', '');
    const after = el({ hidden: true, parentNode: { removeChild() {} } });
    t.W.WQDOORS.mount(fakeRoot({ '.wq-vid': vEl, '.wq-vplay': play, '.wq-after': after }), { ...HUB, home_v3: 1, ...extra, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev() {} }, `watch/${VID}`);
    await flush();
    const before = vEl.getAttribute('controls');
    vEl.fire('play');
    return { before, after: vEl.getAttribute('controls'), play };
  }
  test.each(['en', 'ur'])('on, %s: no native controls before the first play, only the big ▶', (lang) => {
    const h = markup(lang, { video_clean: true });
    expect(h).toMatch(/<video class="wq-vid" playsinline preload="none"/);
    expect(h).not.toMatch(/<video[^>]* controls[ >]/); // the attribute itself (controlslist stays)
    expect(h).toMatch(/class="wq-vplay" type="button" data-primary/);
  });
  test('on: the first play gives the player its controls (pause, seek, fullscreen)', async () => {
    const p = await played({ video_clean: true });
    expect(p.after).toBe('');
    expect(p.play.hidden).toBe(true);
  });
  test.each(['en', 'ur'])('off (absent, false, the string "true"), %s: today\'s player with its controls from the start', (lang) => {
    for (const v of [undefined, false, 'true']) expect([v, markup(lang, v === undefined ? {} : { video_clean: v })]).toEqual([v, expect.stringMatching(/<video class="wq-vid" playsinline controls preload="none"/)]);
  });
  test('off: a play changes nothing about the controls', async () => {
    const p = await played({});
    expect(p.after).toBeNull();
  });
});

// web_quiz_video_clean_start on #watch: with no native controls before the first play, the whole video box (the poster)
// starts the video on a tap, like the lesson page's cover; once it plays the player's own controls take the taps. Off,
// the box has no tap of its own (the player's controls are there from the start).
describe('the watch screen\'s clean start: the whole poster is the play tap', () => {
  const WATCH = { watch: { vid: VID, url: 'https://r2.example.test/v1_web.mp4?sig', title: 'Life cycle of a hen', lang: 'en', after: false } };
  const answer = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(WATCH)), json: () => Promise.resolve(WATCH) });
  async function box(extra) {
    const t = live({ fetchImpl: answer });
    const vEl = el({ duration: 100, currentTime: 0, paused: true });
    vEl.play = jest.fn(() => { vEl.paused = false; vEl.fire('play'); return Promise.resolve(); });
    const play = el(); const vbox = el();
    const after = el({ hidden: true, parentNode: { removeChild() {} } });
    t.W.WQDOORS.mount(fakeRoot({ '.wq-vid': vEl, '.wq-vplay': play, '.wq-after': after, '.wq-vbox': vbox }), { ...HUB, home_v3: 1, ...extra, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true } } }, { token: TOKEN, lang: 'en', ev() {} }, `watch/${VID}`);
    await flush();
    return { vEl, vbox, play };
  }
  const tap = (x, target) => x.fire('click', { target: target || x, preventDefault() {}, stopPropagation() {} });
  test('on: a tap anywhere on the poster plays the video, once; the player then has its controls', async () => {
    const p = await box({ video_clean: true });
    tap(p.vbox);
    expect(p.vEl.play).toHaveBeenCalledTimes(1);
    expect(p.vEl.getAttribute('controls')).toBe('');
    p.vEl.paused = true; // paused from the player's own controls: the box never takes that tap again
    tap(p.vbox);
    expect(p.vEl.play).toHaveBeenCalledTimes(1);
  });
  test('on: a tap on the big ▶ plays once (the box does not play it a second time)', async () => {
    const p = await box({ video_clean: true });
    tap(p.play);
    tap(p.vbox, p.play); // the same tap reaching the box
    expect(p.vEl.play).toHaveBeenCalledTimes(1);
  });
  test('off: the box has no tap of its own', async () => {
    const p = await box({});
    tap(p.vbox);
    expect(p.vEl.play).not.toHaveBeenCalled();
    expect(p.vbox.listeners.click || []).toEqual([]);
  });
});
