'use strict';
/**
 * The teacher home's bot router (/api/internal/th) end to end over the in-memory Supabase: the switch-off goldens (four
 * states), the shell that reads nothing, the home for a teacher with no lesson plans (the library first, its class
 * message already built and ending with the return line), the class card after a send nobody played, the sends, "Quiz
 * this" through the existing job, the poll, the confirm rows and the events. Only the network boundary and the
 * heaviest list (/quiz's own loadLessonPage) are stood in for; every module of the home runs for real.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
// The walk-through persona module by its real name (it may not be on this branch yet: a virtual stand-in).
const mockWalk = { forHome: undefined };
jest.mock('../../shared/services/first-touch/walk-persona', () => mockWalk, { virtual: true });
// The one door's landing link and its module lookup: stand-ins, inert unless a test fills them.
const mockDoor = { mintLanding: undefined };
const mockModules = { load: undefined };
jest.mock('../../shared/services/first-touch/one-door.service', () => mockDoor);
jest.mock('../../shared/services/first-touch/optional-modules', () => mockModules);
// The stories page's router and service: stand-ins, empty unless a test fills them.
const mockStoryRoutes = { servePage: undefined };
const mockStorySvc = { flagOn: undefined };
jest.mock('../../shared/routes/story-teacher-internal.routes', () => mockStoryRoutes);
jest.mock('../../shared/services/quiz/story-teacher.service', () => mockStorySvc);

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { str, fill } = require('../../shared/services/first-touch/teacher-home.strings');
const { seedMaker, TEACHER, qid } = require('./maker-fixture');

const OTHER = 'a0000000-0000-4000-8000-0000000000f2';
const OWN_QUIZ = 'c0000000-0000-4000-8000-0000000000a1';
const OWN_CODE = 'f0000000-0000-4000-8000-0000000000a1';
const SESSION = 'e0000000-0000-4000-8000-0000000000c1';
const RETURN_LINE = fill('cm.return', 'en', { link: 'https://wa.me/15550001111?text=quiz' });
const tokenFor = (o = {}) => HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go', ...o });

let srv;
let fake;
let deps;
async function boot(d = null) {
  const app = express();
  app.use('/api/internal/th', createRouter(d));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H(), redirect: 'manual' });
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const nonSwitchReads = () => fake.calls.filter((c) => c.table !== 'app_settings');

function seed({ on = true, value = true, extra = {}, settings = [] } = {}) {
  fake = seedMaker(supabase, { on: true, extra });
  fake.db.app_settings = [...fake.db.app_settings, ...(on ? [{ key: 'quiz_teacher_home', value }] : []), ...settings];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
}
/** /quiz's own list, stood in for (its providers read a dozen tables); lessonItems + quizState stay real. */
function listWith({ sessions = [], quizzes = [], lessons = [] } = {}) {
  return { ...List, loadLessonPage: jest.fn(async () => ({ sessions, quizzes, counts: {}, lessons })) };
}

beforeEach(() => { jest.clearAllMocks(); deps = { List: listWith() }; });
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

describe('switch OFF', () => {
  const STATES = [
    ['absent', { on: false }], ['false', { value: false }], ['"yes"', { value: 'yes' }], ['1', { value: 1 }], ['{}', { value: {} }],
  ];
  test.each(STATES)('%s → every route 404 {off:true}; nothing but the switch is read', async (_, s) => {
    seed(s);
    await boot(deps);
    const t = tokenFor();
    const answers = await Promise.all([
      get(`/quiz/teacher/${t}`), get('/quiz/teacher/garbage'), get(`/quiz/teacher/${t}/stories`), get(`/api/th/home?t=${t}`), get(`/api/th/library?t=${t}&g=3`),
      get(`/api/th/quiz/${OWN_QUIZ}?t=${t}`), post('/api/th/send', { t, kind: 'video', id: qid(2) }),
      post('/api/th/quiz/make', { t, kind: 'coaching', id: SESSION }), post('/api/th/confirm', { t, looseId: OWN_QUIZ, candidateId: OTHER, decision: 'same' }),
      post('/api/th/step', { t, step: 'more' }),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ off: true });
    }
    expect(nonSwitchReads()).toEqual([]);
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('a settings read that throws → OFF on every route of this router', async () => {
    seed();
    supabase.from = () => { throw new Error('app_settings down'); };
    await boot(deps);
    const t = tokenFor();
    const answers = await Promise.all([
      get(`/quiz/teacher/${t}`), get(`/quiz/teacher/${t}/stories`), get(`/quiz/teacher/${t}/send?c=${OWN_CODE}`), get(`/api/th/home?t=${t}`),
      get(`/api/th/library?t=${t}&g=3`), get(`/api/th/quiz/${OWN_QUIZ}?t=${t}`), post('/api/th/send', { t, kind: 'video', id: qid(2) }),
      post('/api/th/quiz/make', { t, kind: 'coaching', id: SESSION }), post('/api/th/confirm', { t, looseId: OWN_QUIZ, candidateId: OTHER, decision: 'same' }),
      post('/api/th/step', { t, step: 'more' }),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ off: true });
    }
    expect(logEvent).not.toHaveBeenCalled();
    // the switch's own failure path ran (not a cached reading)
    expect(require('../../shared/utils/logger').logToFile).toHaveBeenCalledWith(expect.stringContaining('teacher home: settings lookup failed'), expect.anything());
  });
});

describe('the shell', () => {
  test('paints with NO database read beyond the switch; Urdu page is rtl with the subset font', async () => {
    seed();
    await boot(deps);
    const t = tokenFor({ lang: 'ur' });
    const res = await get(`/quiz/teacher/${t}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(nonSwitchReads()).toEqual([]);
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    expect(html).toContain('wq-nastaliq-5.woff2');
    expect(html).toContain('data-screen="teacher_home"');
    expect(html).toContain('data-screen="teacher_send"');
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
    expect((markup.match(/ data-primary[ >]/g) || []).length).toBe(1); // the sheet's send; the home's is filled after paint
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'sha256-/);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(html).not.toContain(TEACHER.name);
  });

  test('expired → the stale page (200); forged → the stale page (404)', async () => {
    seed();
    await boot(deps);
    const old = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' }, { now: Date.now() - 25 * 3600 * 1000 });
    const a = await get(`/quiz/teacher/${old}`);
    expect(a.status).toBe(200);
    expect(await a.text()).toContain('This link has expired');
    const b = await get(`/quiz/teacher/${tokenFor().slice(0, -3)}abc`);
    expect(b.status).toBe(404);
  });

  test('every stale or error page here carries ONE tap back to the chat (wa.me/<bot>?text=quiz), in the page language', async () => {
    seed();
    await boot(deps);
    const old = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'ur', via: 'go' }, { now: Date.now() - 25 * 3600 * 1000 });
    const stale = await (await get(`/quiz/teacher/${old}`)).text();
    const forged = await (await get(`/quiz/teacher/${tokenFor().slice(0, -3)}abc?lang=en`)).text();
    const tap = (l) => `<a class="mk-go" href="https://wa.me/15550001111?text=quiz">${str('th.open.wa', l)}</a>`;
    expect(stale).toContain(tap('ur'));
    expect(forged).toContain(tap('en'));
    [stale, forged].forEach((h) => expect(h.match(/<a /g)).toHaveLength(1));
    expect(str('th.open.wa', 'en')).toBe('Open WhatsApp');
    expect(str('th.open.wa', 'ur')).toBe('واٹس\u00a0ایپ کھولیں'); // the signed form: a no-break space inside the brand name
  });

  test('the maker\'s own message pages are byte-identical to the quiz-maker page\'s (no tap unless one is asked for)', () => {
    const { buildMessagePage } = require('../../shared/services/first-touch/maker.page');
    // sha256(html + "\n" + csp)[:16] of the quiz-maker page's own buildMessagePage, before the tap existed
    const GOLDEN = { 'en|mk.stale': '997e694b47a09e53', 'en|mk.error': 'b1a3b14c8bcaae93', 'ur|mk.stale': 'fb02622a845a9a1f', 'ur|mk.error': 'e5fdde6e0fa4763f' };
    Object.entries(GOLDEN).forEach(([k, want]) => {
      const [lang, id] = k.split('|');
      const b = buildMessagePage({ lang, id });
      expect(require('crypto').createHash('sha256').update(`${b.html}\n${b.csp}`).digest('hex').slice(0, 16)).toBe(want);
      expect(b.html).not.toContain('<a ');
    });
  });
});

describe('the home: a teacher with no lesson plans', () => {
  test('the library opens first: the top card is a ready video quiz with its class message built, ending with the return line', async () => {
    seed();
    await boot(deps);
    const t = tokenFor();
    const res = await get(`/api/th/home?t=${t}&g=4`);
    expect(res.status).toBe(200);
    const home = await res.json();
    expect(home.first).toBe('Amina');
    expect(home.primary.kind).toBe('video');
    expect(home.primary.id).toBe(qid(2));
    expect(home.primary.send.wa.startsWith('https://wa.me/?text=')).toBe(true);
    const message = decodeURIComponent(home.primary.send.wa.slice('https://wa.me/?text='.length));
    expect(message).toBe(home.primary.send.message);
    expect(message.endsWith(`\n\n${RETURN_LINE}`)).toBe(true);
    expect(home.timeline).toEqual([]);
    expect(home.library.grade).toBe(4);
    expect(home.library.stories).toEqual([]);
    expect(fake.db.quiz_share_codes).toHaveLength(1); // minted at render, through mintCode
    const again = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(again.primary.send.message).toBe(home.primary.send.message);
    expect(fake.db.quiz_share_codes).toHaveLength(1); // the held code is reused
    const open = logEvent.mock.calls.filter(([n]) => n === 'teacher_home_open');
    expect(open[0][1]).toMatchObject({ w: 's', has_lp: false, has_coaching: false, primary_kind: 'library', tk: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(JSON.stringify(open)).not.toContain(TEACHER.id);
  });

  test('the maker link and the foot ride the maker switch', async () => {
    seed();
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.maker).toMatch(/^\/m\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    seed({ settings: [] });
    fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'quiz_maker_page');
    IdFlags._resetCache();
    const off = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(off.maker).toBeNull();
    expect(off.cards).toEqual([]);
  });

  test('another grade from the chips: the library card and its pick', async () => {
    seed();
    await boot(deps);
    const lib = await (await get(`/api/th/library?t=${tokenFor()}&g=5`)).json();
    expect(lib.grade).toBe(5);
    expect(lib.video).toEqual({ id: qid(11), title: 'Magnets' });
    expect(lib.pick).toMatchObject({ kind: 'video', id: qid(11), send: { message: expect.stringContaining(RETURN_LINE) } });
  });
});

describe('the home after a send nobody played', () => {
  function seedSent({ owner = TEACHER.id, at = new Date().toISOString() } = {}) {
    seed({
      extra: {
        coaching_sessions: [],
        quiz_sessions: [],
      },
    });
    fake.db.quizzes.push({
      id: OWN_QUIZ, teacher_id: owner, quiz_source: 'transcript', status: 'sent', topic: 'Photosynthesis', subject: 'Science',
      coaching_session_id: SESSION, created_at: at,
      meta: { student_message: 'Class, play this quiz: https://portal.example/q/ABCDEF', share_code_id: OWN_CODE, share_code: 'ABCDEF' },
    });
    fake.db.quiz_share_codes.push({ id: OWN_CODE, code: 'ABCDEF', quiz_id: OWN_QUIZ, teacher_user_id: owner, active: true, expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: at, invited_by_student_id: null });
    const quiz = fake.db.quizzes.find((q) => q.id === OWN_QUIZ);
    deps = { List: listWith({ sessions: [{ id: SESSION, created_at: at, transcript_text: 'x'.repeat(5000), analysis_data: { topic: 'Photosynthesis' } }], quizzes: [quiz] }) };
  }

  test('the top card is the class line with "Send again" carrying the stored class message + the return line', async () => {
    seedSent();
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}`)).json();
    expect(home.primary).toMatchObject({ kind: 'class', title: 'Photosynthesis', played: 0 });
    expect(home.primary.send.message).toBe(`Class, play this quiz: https://portal.example/q/ABCDEF\n\n${RETURN_LINE}`);
    expect(home.timeline[0]).toMatchObject({ kind: 'coach', verb: 'again', id: OWN_QUIZ, sendKind: 'again', played: 0 });
  });

  test('a row offers "Send again" only when the send would work: a quiz whose code has ended or has no stored message keeps its report, not the button', async () => {
    seedSent();
    fake.db.quiz_share_codes.find((c) => c.id === OWN_CODE).expires_at = new Date(Date.now() - 60000).toISOString();
    await boot(deps);
    const t = tokenFor();
    const ended = await (await get(`/api/th/home?t=${t}`)).json();
    expect(ended.timeline[0]).toMatchObject({ id: null, verb: null, sendKind: null });
    expect(ended.primary.kind).not.toBe('class'); // no "No one has played — Send again" for a send that cannot be sent again
    fake.db.quiz_share_codes.find((c) => c.id === OWN_CODE).expires_at = new Date(Date.now() + 86400000).toISOString();
    delete fake.db.quizzes.find((q) => q.id === OWN_QUIZ).meta.student_message;
    const nomessage = await (await get(`/api/th/home?t=${t}`)).json();
    expect(nomessage.timeline[0]).toMatchObject({ verb: null, sendKind: null });
    // every "Send again" the home offers is one the send answers
    fake.db.quizzes.find((q) => q.id === OWN_QUIZ).meta.student_message = 'Class, play this quiz: https://portal.example/q/ABCDEF';
    const live = await (await get(`/api/th/home?t=${t}`)).json();
    expect(live.timeline[0]).toMatchObject({ verb: 'again', id: OWN_QUIZ, sendKind: 'again' });
    expect((await post('/api/th/send', { t, kind: 'again', id: OWN_QUIZ })).status).toBe(200);
  });

  test('"Send again" is refused for a quiz that is not this teacher\'s', async () => {
    seedSent({ owner: OTHER });
    await boot(deps);
    const res = await post('/api/th/send', { t: tokenFor(), kind: 'again', id: OWN_QUIZ });
    expect(res.status).toBe(404);
  });

  test('"Send again" for their own quiz → the message and its wa.me link', async () => {
    seedSent();
    await boot(deps);
    const res = await post('/api/th/send', { t: tokenFor(), kind: 'again', id: OWN_QUIZ });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.wa).toBe(`https://wa.me/?text=${encodeURIComponent(out.message)}`);
  });
});

describe('"Quiz this" through the existing job, and the poll', () => {
  test('a lesson plan: the provider\'s own start, in the page language, never the chat\'s language question', async () => {
    seed();
    const start = jest.fn(async () => ({ outcome: 'queued', quizId: OWN_QUIZ }));
    deps.Providers = { parseLessonKey: (k) => (k === 'lsn_lp_v8_abc' ? { provider: { start }, lessonRef: 'abc' } : null) };
    fake.db.users[0].phone_number = 'fixture-phone';
    await boot(deps);
    const res = await post('/api/th/quiz/make', { t: tokenFor({ lang: 'ur' }), kind: 'lesson', id: 'lsn_lp_v8_abc' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quizId: OWN_QUIZ });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ id: TEACHER.id }), 'abc', { phone: 'fixture-phone', quizLanguage: 'ur', via: 'home' });
  });

  test('a recorded lesson whose quiz was already sent is never re-made', async () => {
    seed();
    fake.db.users[0].phone_number = 'fixture-phone';
    fake.db.quizzes.push({ id: OWN_QUIZ, teacher_id: TEACHER.id, coaching_session_id: SESSION, status: 'sent', quiz_source: 'transcript', meta: {} });
    deps.Transcript = { startTranscriptLesson: jest.fn() };
    await boot(deps);
    const res = await post('/api/th/quiz/make', { t: tokenFor(), kind: 'coaching', id: SESSION });
    expect(await res.json()).toEqual({ quizId: OWN_QUIZ });
    expect(deps.Transcript.startTranscriptLesson).not.toHaveBeenCalled();
  });

  test('a recorded lesson with no quiz → startTranscriptLesson; the poll answers making, then ready with the message', async () => {
    seed();
    fake.db.users[0].phone_number = 'fixture-phone';
    deps.Transcript = {
      startTranscriptLesson: jest.fn(async () => {
        fake.db.quizzes.push({ id: OWN_QUIZ, teacher_id: TEACHER.id, coaching_session_id: SESSION, status: 'generating', quiz_source: 'transcript', topic: 'Plants', meta: {} });
        return { outcome: 'queued', quizId: OWN_QUIZ };
      }),
    };
    await boot(deps);
    const t = tokenFor();
    expect(await (await post('/api/th/quiz/make', { t, kind: 'coaching', id: SESSION })).json()).toEqual({ quizId: OWN_QUIZ });
    expect(deps.Transcript.startTranscriptLesson).toHaveBeenCalledWith(expect.objectContaining({ id: TEACHER.id }), SESSION, { phone: 'fixture-phone', quizLanguage: 'en', via: 'home' });
    expect(await (await get(`/api/th/quiz/${OWN_QUIZ}?t=${t}`)).json()).toEqual({ state: 'making', title: 'Plants' });
    const q = fake.db.quizzes.find((x) => x.id === OWN_QUIZ);
    Object.assign(q, { status: 'sent', meta: { student_message: 'Play: https://portal.example/q/PLANTS', share_code_id: OWN_CODE } });
    fake.db.quiz_share_codes.push({ id: OWN_CODE, quiz_id: OWN_QUIZ, teacher_user_id: TEACHER.id, active: true, expires_at: null });
    const ready = await (await get(`/api/th/quiz/${OWN_QUIZ}?t=${t}`)).json();
    expect(ready).toMatchObject({ state: 'ready', message: `Play: https://portal.example/q/PLANTS\n\n${RETURN_LINE}` });
    expect(ready.wa).toBe(`https://wa.me/?text=${encodeURIComponent(ready.message)}`);
  });

  test('another teacher\'s quiz is not pollable', async () => {
    seed();
    fake.db.quizzes.push({ id: OWN_QUIZ, teacher_id: OTHER, status: 'generating', meta: {} });
    await boot(deps);
    expect((await get(`/api/th/quiz/${OWN_QUIZ}?t=${tokenFor()}`)).status).toBe(404);
  });
});

describe('the confirm rows and the events', () => {
  test('"Same child" calls the queue\'s own decide; "Not sure" writes nothing', async () => {
    seed();
    deps.Queue = { candidatesFor: async () => [], decide: jest.fn(async () => ({ ok: true })) };
    await boot(deps);
    const t = tokenFor();
    expect((await post('/api/th/confirm', { t, looseId: OWN_QUIZ, candidateId: SESSION, decision: 'same' })).status).toBe(204);
    expect(deps.Queue.decide).toHaveBeenCalledWith({ teacherUserId: TEACHER.id, looseId: OWN_QUIZ, candidateId: SESSION, decision: 'same' });
    expect((await post('/api/th/confirm', { t, looseId: OWN_QUIZ, candidateId: SESSION, decision: 'unsure' })).status).toBe(204);
    expect(deps.Queue.decide).toHaveBeenCalledTimes(1);
  });

  test('the confirm rows render on the home (first names only)', async () => {
    seed();
    deps.Queue = { candidatesFor: async () => [{ loose_id: OWN_QUIZ, candidate_id: SESSION, first: 'Sara Testwala', candidate_first: 'Sara' }] };
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.confirm).toEqual([{ looseId: OWN_QUIZ, candidateId: SESSION, first: 'Sara', candidateFirst: 'Sara' }]);
  });

  test('the send tap logs teacher_send with ids only', async () => {
    seed();
    await boot(deps);
    expect((await post('/api/th/step', { t: tokenFor(), step: 'share_tap', kind: 'video', id: qid(2), origin: 'library' })).status).toBe(204);
    expect(logEvent).toHaveBeenCalledWith('teacher_send', expect.objectContaining({ w: 's', kind: 'video', origin: 'library', again: false, id: qid(2) }));
  });

  test('a kid key shorter than 32 bytes: the home open carries no tk and is never a first open', async () => {
    const key = process.env.WEB_QUIZ_KID_KEY;
    try {
      seed();
      await boot(deps);
      require('../../shared/services/cache/railway-redis.service').__keys.clear();
      process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(31);
      await get(`/api/th/home?t=${tokenFor()}&g=4`);
      const open = logEvent.mock.calls.filter(([n]) => n === 'teacher_home_open').map(([, f]) => f);
      expect(open).toEqual([expect.objectContaining({ tk: null, first: false })]);
    } finally { process.env.WEB_QUIZ_KID_KEY = key; }
  });

  test('a kid key shorter than 32 bytes is no key (as for the child side): tk is null; 32 bytes keys it', async () => {
    const key = process.env.WEB_QUIZ_KID_KEY;
    try {
      seed();
      await boot(deps);
      process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(31);
      expect((await post('/api/th/step', { t: tokenFor(), step: 'share_tap', kind: 'video', id: qid(2), origin: 'library' })).status).toBe(204);
      process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(32);
      expect((await post('/api/th/step', { t: tokenFor(), step: 'share_tap', kind: 'video', id: qid(2), origin: 'library' })).status).toBe(204);
      const sends = logEvent.mock.calls.filter(([n]) => n === 'teacher_send').map(([, f]) => f.tk);
      expect(sends).toEqual([null, expect.stringMatching(/^[0-9a-f]{16}$/)]);
    } finally { process.env.WEB_QUIZ_KID_KEY = key; }
  });

  test('teacher_send carries prompted (opened from a bot message) and the keyed class of the code (EVENTS_V3)', async () => {
    seed();
    const CLASS = 'd0000000-0000-4000-8000-0000000000c9';
    const CODE = 'f0000000-0000-4000-8000-0000000000c9';
    fake.db.quiz_share_codes.push({ id: CODE, code: 'KLMNOP', quiz_id: qid(2), teacher_user_id: TEACHER.id, class_id: CLASS, active: true, created_at: new Date().toISOString(), invited_by_student_id: null });
    fake.db.quiz_share_codes.push({ id: OWN_CODE, code: 'QRSTUV', quiz_id: qid(2), teacher_user_id: OTHER, class_id: CLASS, active: true, created_at: new Date().toISOString(), invited_by_student_id: null });
    await boot(deps);
    const Kid = require('../../shared/services/quiz/web-quiz-kid');
    const sendOf = () => logEvent.mock.calls.filter((c) => c[0] === 'teacher_send').pop()[1];
    await post('/api/th/step', { t: tokenFor({ via: 'report' }), step: 'share_tap', kind: 'video', id: qid(2), c: CODE, origin: 'library' });
    expect(sendOf()).toMatchObject({ prompted: true, cls_k: Kid.clsOf(CLASS) });
    expect(Kid.clsOf(CLASS)).toEqual(expect.any(String));
    await post('/api/th/step', { t: tokenFor({ via: 'go' }), step: 'share_tap', kind: 'video', id: qid(2), c: CODE, origin: 'library' });
    expect(sendOf()).toMatchObject({ prompted: false, cls_k: Kid.clsOf(CLASS) });
    // another teacher's code, or no code: no class key (never a guess)
    await post('/api/th/step', { t: tokenFor({ via: 'menu' }), step: 'share_tap', kind: 'video', id: qid(2), c: OWN_CODE, origin: 'library' });
    expect(sendOf()).toMatchObject({ prompted: false, cls_k: null });
    await post('/api/th/step', { t: tokenFor(), step: 'share_tap', kind: 'again', id: qid(2), origin: 'again' });
    expect(sendOf()).toMatchObject({ prompted: false, cls_k: null });
    expect(JSON.stringify(sendOf())).not.toContain(CLASS);
  });

  test('"Not a teacher? Change" is not offered until the one door\'s landing exists; there is no role write here', async () => {
    seed();
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.change).toBeNull();
    const before = fake.calls.length;
    const res = await post('/api/th/role', { t: tokenFor(), side: 'child' });
    expect(res.status).toBe(404);
    expect(fake.calls.slice(before).filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('the strings the page uses all resolve in both languages', () => {
    ['th.send', 'th.again', 'th.zero', 'th.confirm.q', 'th.copy', 'cm.return'].forEach((id) => {
      expect(str(id, 'en')).toBeTruthy();
      expect(str(id, 'ur')).toBeTruthy();
    });
  });
});

describe('the stories shelf and the other seams', () => {
  test('stories for the grade: the top card is the first book, every tile links to the stories page\'s own sheet', async () => {
    seed();
    deps.Stories = {
      flagOn: async () => true,
      shelf: jest.fn(async () => ({ books: [{ id: 'b1', title: 'The Thirsty Crow', featured: true }, { id: 'b2', title: 'Rain' }] })),
    };
    await boot(deps);
    const t = tokenFor();
    const home = await (await get(`/api/th/home?t=${t}&g=3`)).json();
    const base = `/quiz/teacher/${encodeURIComponent(t)}/stories`;
    expect(deps.Stories.shelf).toHaveBeenCalledWith({ uid: TEACHER.id, grade: 3, lang: 'en' });
    expect(home.primary).toMatchObject({ kind: 'story', id: 'b1', href: `${base}?book=b1` });
    expect(home.library.stories.map((b) => b.href)).toEqual([`${base}?book=b1`, `${base}?book=b2`]);
    expect(home.library.all).toBe(base);
  });

  test('a stories module whose switch is off → no tiles, the video card is the library pick', async () => {
    seed();
    deps.Stories = { flagOn: async () => false, shelf: jest.fn() };
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(deps.Stories.shelf).not.toHaveBeenCalled();
    expect(home.library.stories).toEqual([]);
    expect(home.primary.kind).toBe('video');
  });

  test('the stories page route answers off until the stories router is there (the edge then falls through)', async () => {
    seed();
    await boot(deps);
    const res = await get(`/quiz/teacher/${tokenFor()}/stories`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ off: true });
  });

  test('the stories page with its own switch off answers {off:true} too (the edge falls through); on → its page', async () => {
    seed();
    await boot(deps);
    mockStoryRoutes.servePage = jest.fn((req, res) => res.status(200).type('html').send(`<p>stories ${req.query.book || ''}</p>`));
    try {
      mockStorySvc.flagOn = async () => false;
      let res = await get(`/quiz/teacher/${tokenFor()}/stories?book=b1`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ off: true });
      mockStorySvc.flagOn = async () => { throw new Error('down'); };
      res = await get(`/quiz/teacher/${tokenFor()}/stories`);
      expect(await res.json()).toEqual({ off: true });
      expect(mockStoryRoutes.servePage).not.toHaveBeenCalled();
      mockStorySvc.flagOn = async () => true;
      res = await get(`/quiz/teacher/${tokenFor()}/stories?book=b1`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<p>stories b1</p>');
    } finally { mockStoryRoutes.servePage = undefined; mockStorySvc.flagOn = undefined; }
  });

  test('the home\'s card taps are logged on this router, with screen home', async () => {
    seed();
    await boot(deps);
    expect((await post('/api/th/step', { t: tokenFor(), step: 'card_coach' })).status).toBe(204);
    expect(logEvent).toHaveBeenCalledWith('teacher_home.step', expect.objectContaining({ step: 'card_coach', screen: 'home' }));
    expect((await post('/api/th/step', { t: tokenFor(), step: 'anything_else' })).status).toBe(400);
  });
});

describe('the top card for a teacher with a fresh lesson, and story sends', () => {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const lesson = (n, topic) => ({ source: 'lp_v8', lessonRef: `ref${n}`, date: day(n), topic, subject: 'Science', grade: '4' });

  test('an un-quizzed lesson plan of the last 7 days is the top card: "Quiz from your last lesson" + Quiz this', async () => {
    seed();
    deps.List = listWith({ lessons: [lesson(2, 'Plants'), lesson(20, 'Old topic')] });
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.primary).toMatchObject({ kind: 'lesson', make: 'lesson', title: 'Plants', id: 'lsn_lp_v8_ref2' });
    expect(home.library.video).toEqual({ id: qid(2), title: 'Fractions' }); // the library card second
    expect(logEvent.mock.calls.find(([n]) => n === 'teacher_home_open')[1]).toMatchObject({ primary_kind: 'lp_quiz', has_lp: true });
  });

  test('a lesson older than 7 days does not take the top card (the library pick does)', async () => {
    seed();
    deps.List = listWith({ lessons: [lesson(9, 'Old topic')] });
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.primary.kind).toBe('video');
    expect(logEvent.mock.calls.find(([n]) => n === 'teacher_home_open')[1]).toMatchObject({ primary_kind: 'library' });
  });

  test('a story send (the teacher\'s own quizzes row) is a timeline row with Send again and its report', async () => {
    seed();
    const at = day(1);
    fake.db.quizzes.push({ id: OWN_QUIZ, teacher_id: TEACHER.id, quiz_source: 'story', status: 'sent', topic: 'The Thirsty Crow', created_at: at,
      meta: { student_message: 'Read with Jugnu: https://portal.example/q/STORY1', share_code_id: OWN_CODE } });
    fake.db.quiz_share_codes.push({ id: OWN_CODE, code: 'STORY1', quiz_id: OWN_QUIZ, teacher_user_id: TEACHER.id, active: true, expires_at: null, created_at: at, invited_by_student_id: null });
    fake.db.quiz_sessions = [];
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.timeline[0]).toMatchObject({ kind: 'story', title: 'The Thirsty Crow', verb: 'again', id: OWN_QUIZ, sendKind: 'again', played: 0 });
    expect(home.primary).toMatchObject({ kind: 'class', title: 'The Thirsty Crow', played: 0 });
    expect(home.primary.send.message).toContain('https://portal.example/q/STORY1');
  });

  test('a listed test phone walking as "a teacher with no lessons" sees the library first; a module without forHome → today', async () => {
    seed();
    fake.db.users[0].phone_number = 'fixture-phone';
    deps.List = listWith({ lessons: [lesson(1, 'Plants')] });
    mockWalk.forHome = jest.fn(async (phone, lists) => (phone === 'fixture-phone' ? { ...lists, lessons: [], played: new Map(), shares: [] } : lists));
    await boot(deps);
    const walk = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(mockWalk.forHome).toHaveBeenCalledTimes(1);
    expect(walk.timeline).toEqual([]);
    expect(walk.primary.kind).toBe('video');
    expect(logEvent).toHaveBeenCalledWith('teacher_home_open', expect.objectContaining({ primary_kind: 'library' }));
    mockWalk.forHome = undefined;
    srv.close(); await boot(deps);
    const real = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(real.primary.kind).toBe('lesson');
  });
});

describe('the store and the lists when something fails', () => {
  const R = () => require('../../shared/services/cache/railway-redis.service');
  test('a prepared mark the store refuses: the minted code is retired and never claimed; the next open mints a fresh one', async () => {
    seed();
    await boot(deps);
    const t = tokenFor();
    R().set.mockImplementationOnce(async () => false).mockImplementationOnce(async () => false); // refused, and refused again
    const first = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(first.primary && first.primary.send).toBeFalsy();
    expect(fake.db.quiz_share_codes).toHaveLength(1);
    expect(fake.db.quiz_share_codes[0].active).toBe(false);
    const next = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(next.primary.kind).toBe('video');
    expect(next.primary.send.c).not.toBe(fake.db.quiz_share_codes[0].id);
    expect(fake.db.quiz_share_codes.filter((c) => c.active !== false)).toHaveLength(1);
  });

  test('a store that is not there: no code is minted to show a message (nothing could mark it prepared)', async () => {
    seed();
    await boot(deps);
    const was = R().isAvailable;
    R().isAvailable = () => false;
    try {
      const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
      expect(home.primary && home.primary.send).toBeFalsy();
      expect(fake.db.quiz_share_codes).toHaveLength(0);
    } finally { R().isAvailable = was; }
  });

  test('the first open is never claimed on a store that could not say (setNX answers true when it fails)', async () => {
    seed();
    await boot(deps);
    const t = tokenFor();
    R().__keys.clear();
    R().setNX.mockImplementationOnce(async () => true); // what the real client answers when the store is down
    await get(`/api/th/home?t=${t}&g=4`);
    await get(`/api/th/home?t=${t}&g=4`);
    await get(`/api/th/home?t=${t}&g=4`);
    const firsts = logEvent.mock.calls.filter(([n]) => n === 'teacher_home_open').map(([, f]) => f.first);
    expect(firsts).toEqual([false, true, false]);
  });

  test('codes that are not the teacher\'s own sends (a watch child, a class child\'s lesson code) are never a send on the home', async () => {
    seed();
    const at = new Date().toISOString();
    const until = new Date(Date.now() + 86400000).toISOString();
    const WATCH = 'f0000000-0000-4000-8000-0000000000b1';
    const LESSON = 'f0000000-0000-4000-8000-0000000000b2';
    fake.db.quiz_share_codes.push(
      { id: WATCH, code: 'WATCH1', quiz_id: qid(2), teacher_user_id: TEACHER.id, active: true, expires_at: until, created_at: at, invited_by_student_id: null, parent_share_code_id: 'f0000000-0000-4000-8000-0000000000r0' },
      { id: LESSON, code: 'LESSN1', quiz_id: qid(2), teacher_user_id: TEACHER.id, active: true, expires_at: until, created_at: at, invited_by_student_id: null, parent_share_code_id: 'f0000000-0000-4000-8000-0000000000c0' },
    );
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    // not "No one has played — Send again" for a code the teacher never sent, and no timeline row for either
    expect(home.primary.kind).not.toBe('class');
    expect(home.timeline.filter((r) => r.id === WATCH || r.id === LESSON)).toEqual([]);
  });

  test('the home tells the page the bot\'s number (digits only) for its own error page', async () => {
    seed();
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.bot).toBe(['1555', '000', '1111'].join(''));
  });

  test('the number the page is given is the one the return line links (one source), whatever spacing the setting has', async () => {
    const was = process.env.WHATSAPP_BOT_NUMBER;
    process.env.WHATSAPP_BOT_NUMBER = `+${['1', '555', '000', '1111'].join(' ')}`;
    try {
      seed();
      await boot(deps);
      const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
      const link = require('../../shared/services/first-touch/teacher-home.copy').chatLink();
      expect(home.bot).toBe(['1555', '000', '1111'].join(''));
      expect(link).toBe(`https://wa.me/${home.bot}?text=quiz`);
    } finally { process.env.WHATSAPP_BOT_NUMBER = was; }
  });
});

describe('the optional modules by their registry names (when the registry is on the branch)', () => {
  afterEach(() => { mockModules.load = undefined; });
  test('the cards, the walk-through lists, the "Change" landing and the practice link come from load(<name>), not a typed path', async () => {
    seed();
    Object.assign(fake.db.users[0], { phone_number: 'fixture-phone', role: 'coach' });
    deps.List = listWith({ lessons: [{ source: 'lp_v8', lessonRef: 'ref1', date: new Date(Date.now() - 86400000).toISOString(), topic: 'Plants', subject: 'Science', grade: '4' }] });
    const named = {
      cardsPage: { cardsFor: () => [{ card: 'lp', title: 'Lesson plans', href: '/x' }] },
      testPersona: { forHome: async (phone, lists) => ({ ...lists, lessons: [], played: new Map(), shares: [] }) },
      oneDoor: { mintLanding: async () => 'https://portal.example/quiz/go/GO.NAMED' },
      studentJoin: { practiceJoinUrl: () => 'https://portal.example/quiz/join/PRACTICE' },
    };
    mockModules.load = (name) => named[name] || null;
    await boot(deps);
    const home = await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json();
    expect(home.cards).toEqual([{ card: 'lp', title: 'Lesson plans', href: '/x' }]);
    expect(home.timeline).toEqual([]);
    expect(home.change).toBe('/quiz/go/GO.NAMED');
    expect(home.tryStudent).toBe('https://portal.example/quiz/join/PRACTICE');
  });
});

describe('the walk-through row on the foot (sandbox test phones only)', () => {
  const ROW = '<section data-screen="walk"><p class="note">Walk</p><button type="button" class="no" data-tap="walk_fresh" data-persona="fresh">New</button></section>';
  afterEach(() => { mockDoor.mintLanding = undefined; mockModules.load = undefined; });

  test('a listed phone: the row and the go token of the "Change" link; an unlisted teacher\'s home is byte-identical to no module at all', async () => {
    seed();
    fake.db.users[0].phone_number = 'fixture-phone';
    mockDoor.mintLanding = jest.fn(async () => 'https://portal.example/quiz/go/GO.TOKEN_abc');
    await boot(deps);
    const t = tokenFor();
    const without = await (await get(`/api/th/home?t=${t}&g=4`)).text();
    const row = jest.fn(async ({ token }) => (token === 'GO.TOKEN_abc' ? '' : ROW));
    mockModules.load = (name) => (name === 'testPersona' ? { row } : null);
    const unlisted = await (await get(`/api/th/home?t=${t}&g=4`)).text();
    expect(row).toHaveBeenCalledWith({ lang: 'en', token: 'GO.TOKEN_abc' });
    expect(unlisted.replace(/"first":(true|false)/, '')).toBe(without.replace(/"first":(true|false)/, ''));
    expect(JSON.parse(unlisted).change).toBe('/quiz/go/GO.TOKEN_abc');
    expect(mockDoor.mintLanding).toHaveBeenCalledWith(expect.objectContaining({ side: 'unknown', src: 'change' }));
    row.mockImplementation(async () => ROW);
    const listed = await (await get(`/api/th/home?t=${tokenFor({ lang: 'ur' })}&g=4`)).json();
    expect(listed.walk).toEqual({ html: ROW, t: 'GO.TOKEN_abc' });
    expect(row).toHaveBeenLastCalledWith({ lang: 'ur', token: 'GO.TOKEN_abc' });
  });

  test('no "Change" link, a module that throws, or a row of another shape → no walk key', async () => {
    seed();
    fake.db.users[0].phone_number = 'fixture-phone';
    await boot(deps);
    mockModules.load = () => ({ row: async () => ROW });
    expect((await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json()).walk).toBeUndefined();
    mockDoor.mintLanding = jest.fn(async () => 'https://portal.example/quiz/go/GO.TOKEN_abc');
    mockModules.load = () => { throw new Error('broken'); };
    expect((await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json()).walk).toBeUndefined();
    mockModules.load = () => ({ row: async () => '<script>x</script>' });
    expect((await (await get(`/api/th/home?t=${tokenFor()}&g=4`)).json()).walk).toBeUndefined();
  });

});

describe('the send of a library code goes through the server', () => {
  test('GET /quiz/teacher/<t>/send?c: 302 → wa.me with the class message, the code marked sent HERE (no beacon needed), teacher_send logged once', async () => {
    seed();
    await boot(deps);
    const t = tokenFor({ via: 'report' });
    const first = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    const c = first.primary.send.c;
    const res = await get(`/quiz/teacher/${t}/send?c=${c}&o=library`);
    expect(res.status).toBe(302);
    const loc = res.headers.get('location');
    expect(loc.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(loc.slice('https://wa.me/?text='.length))).toBe(first.primary.send.message);
    const sends = logEvent.mock.calls.filter(([n]) => n === 'teacher_send');
    expect(sends).toHaveLength(1);
    expect(sends[0][1]).toMatchObject({ kind: 'video', origin: 'library', again: false, prompted: true });
    const after = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(after.primary).toMatchObject({ kind: 'class', played: 0, title: 'Fractions' });
  });

  test('another teacher\'s code: the error page, nothing marked, no event; a beacon for it marks nothing either', async () => {
    seed();
    const at = new Date().toISOString();
    fake.db.quiz_share_codes.push({ id: OWN_CODE, code: 'QRSTUV', quiz_id: qid(2), teacher_user_id: OTHER, active: true, created_at: at, invited_by_student_id: null });
    await boot(deps);
    const Sent = require('../../shared/services/first-touch/teacher-home.sent');
    await Sent.markPrepared(OWN_CODE);
    const res = await get(`/quiz/teacher/${tokenFor()}/send?c=${OWN_CODE}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(str('th.open.wa', 'en'));
    expect(logEvent.mock.calls.filter(([n]) => n === 'teacher_send')).toHaveLength(0);
    await post('/api/th/step', { t: tokenFor(), step: 'share_tap', kind: 'share', id: qid(2), c: OWN_CODE, origin: 'again' });
    expect([...(await Sent.prepared([OWN_CODE]))]).toEqual([OWN_CODE]);
  });

  test('a clear that fails once is retried: marked sent, teacher_send logged once', async () => {
    seed();
    await boot(deps);
    const R = require('../../shared/services/cache/railway-redis.service');
    const Sent = require('../../shared/services/first-touch/teacher-home.sent');
    const t = tokenFor();
    const c = (await (await get(`/api/th/home?t=${t}&g=4`)).json()).primary.send.c;
    R.delete.mockImplementationOnce(async () => false); // the real client answers false when the store is down
    expect((await get(`/quiz/teacher/${t}/send?c=${c}&o=library`)).status).toBe(302);
    expect([...(await Sent.prepared([c]))]).toEqual([]);
    expect(logEvent.mock.calls.filter(([n]) => n === 'teacher_send')).toHaveLength(1);
  });

  test('a clear that fails twice: the send still goes to wa.me, no teacher_send; the beacon for the teacher\'s own code answers 503', async () => {
    seed();
    await boot(deps);
    const R = require('../../shared/services/cache/railway-redis.service');
    const t = tokenFor();
    const c = (await (await get(`/api/th/home?t=${t}&g=4`)).json()).primary.send.c;
    R.delete.mockClear();
    R.delete.mockImplementation(async () => false);
    try {
      const res = await get(`/quiz/teacher/${t}/send?c=${c}&o=library`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location').startsWith('https://wa.me/?text=')).toBe(true);
      expect(R.delete).toHaveBeenCalledTimes(2);
      expect((await post('/api/th/step', { t, step: 'share_tap', kind: 'share', id: qid(2), c, origin: 'library' })).status).toBe(503);
      expect(logEvent.mock.calls.filter(([n]) => n === 'teacher_send')).toHaveLength(0);
    } finally { R.delete.mockImplementation(async (k) => { R.__keys.delete(k); return true; }); }
  });

  test('a clear that throws counts as failed too (then retried)', async () => {
    const R = require('../../shared/services/cache/railway-redis.service');
    const Sent = require('../../shared/services/first-touch/teacher-home.sent');
    R.delete.mockImplementationOnce(async () => { throw new Error('store blip'); });
    expect(await Sent.markSent(OWN_CODE)).toBe(true);
    R.delete.mockImplementationOnce(async () => { throw new Error('store blip'); }).mockImplementationOnce(async () => false);
    expect(await Sent.markSent(OWN_CODE)).toBe(false);
  });

  test('a code is held as prepared for 4 days at most, and at least the class line\'s 72 h window', async () => {
    const R = require('../../shared/services/cache/railway-redis.service');
    const { SEND_WINDOW_MS } = require('../../shared/services/first-touch/teacher-home.model');
    R.set.mockClear();
    await require('../../shared/services/first-touch/teacher-home.sent').markPrepared(OWN_CODE);
    const ttl = R.set.mock.calls[0][2];
    expect(ttl).toBeLessThanOrEqual(4 * 86400);
    expect(ttl * 1000).toBeGreaterThan(SEND_WINDOW_MS);
  });

});

describe('a code minted to show its message is not a send until the tap', () => {
  test('the library pick minted at render does not become "No one has played — Send again" on the next open; after the tap it does', async () => {
    seed();
    await boot(deps);
    const t = tokenFor();
    const first = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(first.primary.kind).toBe('video');
    const again = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(again.primary.kind).toBe('video');
    expect(again.timeline).toEqual([]);
    // the golden: a mere render never shows the "No one has played — Send again" card, in either language
    const urAgain = await (await get(`/api/th/home?t=${t}&g=4&lang=ur`)).json();
    [again, urAgain].forEach((h) => {
      expect(h.primary.kind).not.toBe('class');
      expect(JSON.stringify(h)).not.toContain(str('th.zero', 'en'));
      expect(JSON.stringify(h)).not.toContain(str('th.zero', 'ur'));
      expect(JSON.stringify(h)).not.toContain('"verb":"again"');
    });
    expect((await post('/api/th/step', { t, step: 'share_tap', kind: 'video', id: qid(2), c: first.primary.send.c, origin: 'library' })).status).toBe(204);
    const after = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    expect(after.primary).toMatchObject({ kind: 'class', played: 0, title: 'Fractions' });
    expect(after.timeline[0]).toMatchObject({ kind: 'quiz', verb: 'again', sendKind: 'share', id: first.primary.send.c });
    // one row per send: the class report's sender row for the same library quiz is not a second, "own" row
    expect(after.timeline.filter((r) => r.id === qid(2))).toEqual([]);
  });
});
