/**
 * Web quiz page, a storybook the teacher sent (boot `story`, app_settings web_quiz_stories_teacher): wq-story-link.js
 * (loaded by the edge only for a story) names a story on the landing and, after the class join, opens the child's hub
 * on the book through the hub door. wq.js carries two one-line seams; without a story it is today's page. Runs the
 * shipped files in a vm; the network (api) and navigation are the faked boundaries.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'public', 'wq');
const LINK = fs.readFileSync(path.join(DIR, 'wq-story-link.js'), 'utf8');
const SRC = fs.readFileSync(path.join(DIR, 'wq.js'), 'utf8');
const E_START = SRC.indexOf("  /* ---------------- M4 who's playing");
const E_END = SRC.indexOf('  /* ---------------- M5 video');
const BOOK = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const flush = () => new Promise((r) => setImmediate(r));

function linkModule() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(LINK, ctx);
  return ctx.window.WQSTORYLINK;
}

function page({ B = {}, lang = 'en', replies = [], withLink = true } = {}) {
  const calls = [];
  const out = { went: null, shown: [], toasts: [] };
  const T = { oops: 'oops', offline: 'offline', meta: () => '3 questions', play: 'Play', playAs: (n) => `Play as ${n}` };
  const ctx = {
    window: withLink ? { WQSTORYLINK: linkModule() } : {}, location: { assign: (u) => { out.went = u; } },
    B, LANG: lang, CLS: { chips: [] }, CLASS_LABEL: 'your class', Q: {}, QS: [], params: {}, CODE: 'AB12CD', S: { answers: {}, queue: [] }, T,
    ROOT: { querySelectorAll: () => [] }, esc: (s) => String(s), ani: () => '', bar: () => '', jug: () => '', wireBar: () => {}, render: () => {},
    on: () => {}, $: () => null, kids: () => [], rememberKid: () => {}, save: () => {}, sget: () => null, sset: () => {},
    ev: () => {}, flushEv: () => {}, flushQueue: () => Promise.resolve(), toast: (m) => out.toasts.push(m), landing: () => out.shown.push('landing'),
    video: () => out.shown.push('video'), nextQuestion: () => out.shown.push('question'), withLang: (h) => `${h}&lang=${lang}`,
    api: (m, route, body) => { calls.push({ route, body }); return Promise.resolve(replies.shift()); },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(E_START, E_END)}\nthis.startSession = startSession;`, ctx);
  return { ctx, calls, out };
}
const joined = { status: 200, ok: true, body: { st: 'st1', device_ref: 'd', counted: true, child: { chip: 'c1', first: 'Zara' }, resume: { answered: [] } } };
const join = async (p) => { p.ctx.startSession({ chip: 'c1', via: 'remembered' }, { chip: 'c1', first: 'Zara' }); for (let i = 0; i < 4; i += 1) await flush(); };

test('wq.js carries exactly the two one-line seams, inside the blocks this test cuts', () => {
  expect(SRC.match(/WQSTORYLINK/g)).toHaveLength(4);
  expect(SRC).toContain("if (B.story && window.WQSTORYLINK) T = window.WQSTORYLINK.copy(T, LANG);");
  expect(E_START).toBeGreaterThan(0);
  expect(E_END).toBeGreaterThan(E_START);
});

test('a story send: the join opens the hub door with story:1, then the book on its first page', async () => {
  const p = page({ B: { story: { id: BOOK, from_teacher: true, code: 'AB12CD' } }, replies: [joined, { status: 200, ok: true, body: { href: '/h/abc.def' } }] });
  await join(p);
  expect(p.calls[1]).toEqual({ route: 'hubdoor', body: { st: 'st1', story: 1 } });
  expect(p.out.went).toBe(`/h/abc.def?from=link&lang=en#story/${BOOK}`);
  expect(p.out.shown).not.toContain('question');
});

test('the landing names a story, never "questions" (EN + UR)', () => {
  const M = linkModule();
  const T = { meta: () => '3 questions', play: 'Play', oops: 'oops' };
  expect(M.copy(T, 'en').meta(0)).toBe('A story to listen to and read');
  expect(M.copy(T, 'en').play).toBe('Open the story');
  expect(M.copy(T, 'ur').play).toBe('کہانی کھولیں');
  expect(M.copy(T, 'en').oops).toBe('oops');
  expect(T.play).toBe('Play');
});

test('Jugnu greets a story as a story, never "the quiz" (EN + UR); the welcome-back line is the page\'s own', () => {
  const M = linkModule();
  const T = { hello: "Assalam o Alaikum! Let's play the quiz together.", helloN: (n) => `Welcome back, ${n}!`, play: 'Play' };
  expect(M.copy(T, 'en').hello).toBe("Assalam o Alaikum! Let's read a story together.");
  expect(M.copy(T, 'ur').hello).toBe('السلام علیکم! آئیں، کہانی پڑھیں۔');
  ['en', 'ur'].forEach((l) => expect(M.copy(T, l).hello).not.toMatch(/quiz|کوئز/i));
  expect(M.copy(T, 'en').helloN('Zoya')).toBe('Welcome back, Zoya!');
});

test('the door refused: a kind word and the landing again, never a dead end', async () => {
  const p = page({ B: { story: { id: BOOK } }, replies: [joined, { status: 404, ok: false, body: { error: 'no_door' } }] });
  await join(p);
  expect(p.out.went).toBeNull();
  expect(p.out.toasts).toEqual(['oops']);
  expect(p.out.shown).toContain('landing');
});

test('the teacher\'s own preview of the link stays on the page with one line, never the door', async () => {
  const p = page({ B: { story: { id: BOOK }, preview: true }, replies: [joined] });
  await join(p);
  expect(p.calls).toHaveLength(1);
  expect(p.out.toasts).toEqual(['This link opens the story for your class.']);
  expect(p.out.went).toBeNull();
});

test('no story in the boot: today\'s path to the questions (golden), even with the file present', async () => {
  const p = page({ replies: [joined] });
  await join(p);
  expect(p.out.shown).toEqual(['question']);
  expect(p.calls).toHaveLength(1);
});

test('the edge loads wq-story-link.js only for a story page (golden: a quiz page\'s scripts are as before)', () => {
  const { renderQuizPage } = require('../routes/web-quiz.routes');
  const QUIZ = { quiz: { id: 'q', code: 'AB12CD', topic: 'T', lang: 'en', dir: 'ltr', n: 1, questions: [{}] }, cls: { chips: [] }, live: {} };
  const quiz = renderQuizPage({ payload: QUIZ, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
  expect(quiz).not.toContain('wq-story-link');
  const story = renderQuizPage({ payload: { ...QUIZ, story: { id: BOOK } }, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
  expect(story).toMatch(/<script src="\/wq\/wq-story-link\.js\?v=[0-9a-f]{10}" defer><\/script>\n<script src="\/wq\/wq\.js\?v=v1" defer>/);
});
