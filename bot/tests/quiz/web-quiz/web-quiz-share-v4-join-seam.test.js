'use strict';
/**
 * A shared card lands the new child on its item (web_quiz_share_v4): the friend's words carry the item's ref, the bot
 * keeps it for the phone, and the home link the join (or a known child's hub reply) answers with opens it, once.
 * Real join service, ingress, student quiz, card server and share-open; the faked boundaries as the join seam's.
 * (The setup below is the join seam's own.) A child joins on their own (web-quiz-student-join.js, switch quiz_student_join): one join = one students row in the
 * /q/ forced_new shape + child_identity(tapped) + ONE child_phone_bindings row via 'guest' + the door's child key,
 * with the door cache forgotten; the next /quiz from that phone is known with no question; STOP still erases it.
 * The switch OFF writes nothing and answers {off:true}. Real join service, binder, repos, door keys and ingress;
 * Supabase, Redis, the WhatsApp send and the loggers are the faked boundaries.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../../shared/services/student-ingress');
const StudentIdentity = require('../../../shared/services/quiz/student-identity.service');
const Binder = require('../../../shared/services/quiz/web-quiz-bind.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const GoNonce = require('../../../shared/services/first-touch/go-nonce');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(722);
const BOOK = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const BOOK2 = '3b9c1e2a-0000-4000-8000-000000000002';
const VID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
const Card = require('../../../shared/services/quiz/web-quiz-card-image');
const OneDoor = require('../../../shared/services/first-touch/one-door.service');
const { isQuizMenuRequest } = require('../../../shared/services/quiz/quiz-menu-request');
const Open = require('../../../shared/services/quiz/web-quiz-share-open');
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_DEVICE = 'BBBBBBBBBBBBBBBBBBBBBB';
const UNKNOWN_USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
const TEACHER_USER = { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' };
const KIDS = ['f0000000-0000-4000-8000-000000000101', 'f0000000-0000-4000-8000-000000000102',
  'f0000000-0000-4000-8000-000000000103', 'f0000000-0000-4000-8000-000000000104'];
const iso = (ms) => new Date(ms).toISOString();
const chatKid = (i, name) => ({ id: KIDS[i], student_name: name, phone: PHONE, list_id: null, is_active: true, status: 'active',
  self_reported_class: '3', created_at: iso(Date.now() - (10 - i) * 60000) });
const binding = (kid, extra = {}) => ({ id: `b-${kid.slice(-3)}`, canonical_id: kid, phone_norm: PHONE, phone_tomb: 'tomb', via: 'save',
  bound_at: iso(Date.now() - 86400000), expires_at: '2099-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, ...extra });

let fake;
function seed({ share = true, shareValue, join = true, joinValue = true, students = [], bindings = [], user = UNKNOWN_USER, lists = [], early, books = [{ id: BOOK, status: 'ready' }] } = {}) {
  const settings = { quiz_one_door: true, web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, web_quiz_card_v3: true, ...(share ? { web_quiz_share_v4: shareValue === undefined ? true : shareValue } : {}) };
  if (join) settings.quiz_student_join = joinValue;
  if (early !== undefined) settings.quiz_join_early_tap = early;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [user], students, child_phone_bindings: bindings, child_identity: [], user_feature_first_use: [],
    quiz_sessions: [], class_enrollments: [], student_lists: lists, class_teachers: [], quizzes: [], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
    story_books: books,
  });
  supabase.from = (t) => {
    // the columns' database defaults (is_active true, status 'active') on rows the code inserted without them
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    // feature-intro's upsert on UNIQUE (user_id, feature): an insert when absent is all these tests need
    b.upsert = (row) => b.insert(row);
    return b;
  };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  Join._resetCache();
  require('../../../shared/services/quiz/web-quiz-card-image')._reset();
}
const writes = (table) => fake.calls.filter((c) => c.table === table && ['insert', 'update', 'delete'].includes(c.op));
const inserts = (table) => fake.calls.filter((c) => c.table === table && c.op === 'insert');
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
async function landing(user = UNKNOWN_USER) {
  const n = await GoNonce.mint({ phoneNorm: PHONE, userId: user.id });
  const url = await Join.joinUrl({ n, lang: 'ur' });
  return { n, url, t: url ? url.slice(Join.JOIN_PATH.length) : Join.signJoin({ n, lang: 'ur' }) };
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redis.__keys.clear();
  seed();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });


// the kept-item lookups (one per home link that looks): with the switch off there must be none at all
const openLookups = () => redis.get.mock.calls.filter(([k]) => /^wq:share:open:/.test(String(k))).length;
describe('switch off: a join and a hub reply ask nothing more than today', () => {
  for (const [name, opts] of [['absent', { share: false }], ['false', { shareValue: false }], ['the string "true"', { shareValue: 'true' }], ['1', { shareValue: 1 }]]) {
    test(`share_v4 ${name}: the join answers with no kept-item lookup`, async () => {
      seed(opts);
      const { t } = await landing();
      redis.get.mockClear();
      const out = await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
      expect(out.next).toMatch(/^\/h\//);
      expect(out.next).not.toContain('#');
      expect(openLookups()).toBe(0);
    });
    test(`share_v4 ${name}: a known child's hub reply makes no kept-item lookup`, async () => {
      seed(opts);
      const { t } = await landing();
      await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
      WhatsApp.sendCtaUrl.mockClear();
      redis.get.mockClear();
      const user = { ...UNKNOWN_USER, persona: 'student' };
      await Ingress.classify({ user, phone: PHONE });
      expect(await Ingress.route({ messageType: 'text', messageBody: 'quiz please', from: PHONE, user })).toBe(true);
      expect(WhatsApp.sendCtaUrl.mock.calls.map(([, o]) => o.url)[0]).toMatch(/\/h\/[^#]+$/);
      expect(openLookups()).toBe(0);
    });
  }
});

describe('a friend taps a shared storybook card, joins, and lands ON the book', () => {
  test('the words with the ref → the join\'s home link ends #story/<book>; the next home link is plain', async () => {
    expect(await Open.note(PHONE, 'quiz please jb3b9c1e2a')).toBe(true);
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
    expect(out.next).toMatch(new RegExp(`^/h/[A-Za-z0-9_.-]+\\?from=join&kid=[0-9a-f]{16}&lang=ur#story/${BOOK}$`));
    // once: the item was taken
    expect(await Open.hashFor(PHONE)).toBe('');
  });
  test('a known child (already joined) sends the words with the ref: the hub reply opens the book', async () => {
    const { t } = await landing();
    await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
    WhatsApp.sendCtaUrl.mockClear();
    const user = { ...UNKNOWN_USER, persona: 'student' };
    await Ingress.classify({ user, phone: PHONE });
    expect(await Ingress.route({ messageType: 'text', messageBody: 'quiz please jb3b9c1e2a', from: PHONE, user })).toBe(true);
    const urls = WhatsApp.sendCtaUrl.mock.calls.map(([, o]) => o.url);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(new RegExp(`/h/[^#]+#story/${BOOK}$`));
  });
  test('switch off: the same words and join give today\'s link, and nothing is kept', async () => {
    seed({ share: false });
    expect(await Open.note(PHONE, 'quiz please jb3b9c1e2a')).toBe(false);
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
    expect(out.next).toMatch(/^\/h\/[A-Za-z0-9_.-]+\?from=join&kid=[0-9a-f]{16}&lang=ur$/);
    expect([...redis.__keys.keys()].some((k) => /^wq:share:open:/.test(k))).toBe(false);
  });
  test.each([['no ref', 'quiz please'], ['a short ref', 'quiz please jb3b9c1e2'], ['a ref that is not hex', 'quiz please jbzzzzzzzz'], ['two refs', 'quiz jb3b9c1e2a jva1b2c3d4']])(
    'switch on, %s: today\'s path — the menu as today, no setting read, nothing kept, the hub link plain', async (_, words) => {
      const Card = require('../../../shared/services/quiz/web-quiz-card-image');
      const { t } = await landing();
      await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
      WhatsApp.sendCtaUrl.mockClear();
      const shareOn = jest.spyOn(Card, 'shareOn');
      const user = { ...UNKNOWN_USER, persona: 'student' };
      await Ingress.classify({ user, phone: PHONE });
      const routed = await Ingress.route({ messageType: 'text', messageBody: words, from: PHONE, user });
      expect(shareOn).not.toHaveBeenCalled();
      expect([...redis.__keys.keys()].some((k) => /^wq:share:open:/.test(k))).toBe(false);
      for (const [, o] of WhatsApp.sendCtaUrl.mock.calls) expect(o.url).not.toContain('#');
      // the same words with the switch off route the same way
      seed({ share: false });
      expect(await Ingress.route({ messageType: 'text', messageBody: words, from: PHONE, user })).toBe(routed);
    });
});

// The twelve door branches, replayed in process: EN/UR × book/video/Games door × a new phone (the join) / a known child
// (the hub reply), then the teacher answer and the two-books ref.
const REFS = { book: ['jb3b9c1e2a', `#story/${BOOK}`], video: ['jva1b2c3d4', `#watch/${VID}`], games: ['jg00000000', '#games'] };
const WORDS = { en: 'quiz please', ur: 'کوئز دکھائیں' };
describe('the twelve door branches', () => {
  beforeEach(() => { require('../../../shared/services/quiz/web-quiz-bank').bank = jest.fn(async () => ({ rows: [{ id: VID }] })); });
  for (const lang of ['en', 'ur']) {
    for (const [what, [ref, hash]] of Object.entries(REFS)) {
      test(`${lang} · ${what} · a new phone: the ref words are the menu, the item is kept, the join's home opens it once`, async () => {
        const words = `${WORDS[lang]} ${ref}`;
        expect(await Open.refMenu(words)).toBe(true);
        expect(await Open.note(PHONE, words)).toBe(true);
        const { t } = await landing();
        const out = await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
        expect(out.next.endsWith(hash)).toBe(true);
        expect(out.next).toMatch(/^\/h\//);
        expect(await Open.hashFor(PHONE)).toBe('');
      });
      test(`${lang} · ${what} · a known child: the hub reply to the ref words opens it`, async () => {
        const { t } = await landing();
        await Join.join({ t, grade: 3, name: 'Sara Testwala', device: DEVICE });
        WhatsApp.sendCtaUrl.mockClear();
        const user = { ...UNKNOWN_USER, persona: 'student' };
        await Ingress.classify({ user, phone: PHONE });
        expect(await Ingress.route({ messageType: 'text', messageBody: `${WORDS[lang]} ${ref}`, from: PHONE, user })).toBe(true);
        const urls = WhatsApp.sendCtaUrl.mock.calls.map(([, o]) => o.url);
        expect(urls).toHaveLength(1);
        expect(urls[0].endsWith(hash)).toBe(true);
      });
    }
  }
  test('the first message on a phone the bot has never seen: the one door answers (no home), and the item is kept', async () => {
    const sent = await OneDoor.reply({ user: UNKNOWN_USER, from: PHONE, door: 'text', body: 'quiz please jb3b9c1e2a' });
    expect(typeof sent).toBe('string');
    for (const [, o] of WhatsApp.sendCtaUrl.mock.calls) expect(String(o.url)).not.toMatch(/\/h\//);
    expect([...redis.__keys.keys()].some((k) => /^wq:share:open:/.test(k))).toBe(true);
  });
  test('the teacher answer: a teacher\'s link never carries the item (only a child home link takes it)', async () => {
    await Open.note(PHONE, 'quiz please jb3b9c1e2a');
    expect(await Open.withOpen(PHONE, 'https://portal.example.test/th/tok123')).toBe('https://portal.example.test/th/tok123');
    expect(await Open.withOpen(PHONE, '/go/abc')).toBe('/go/abc');
    // still kept for this phone's child home only (24 h), never shown elsewhere
    expect([...redis.__keys.keys()].some((k) => /^wq:share:open:/.test(k))).toBe(true);
  });
  test('two ready books with the same first 8 hex: no pick, nothing kept, no throw', async () => {
    seed({ books: [{ id: BOOK, status: 'ready' }, { id: BOOK2, status: 'ready' }] });
    expect(await Card.byRef('jb3b9c1e2a')).toBeNull();
    expect(await Open.note(PHONE, 'quiz please jb3b9c1e2a')).toBe(false);
    expect([...redis.__keys.keys()].some((k) => /^wq:share:open:/.test(k))).toBe(false);
  });
  test('the classifier off the share: today\'s words exactly — a ref-bearing message is not the menu without {ref: true}', () => {
    for (const w of ['quiz please jb3b9c1e2a', 'کوئز دکھائیں jva1b2c3d4', 'quiz jg00000000']) {
      expect(isQuizMenuRequest(w)).toBe(false);
      expect(isQuizMenuRequest(w, { ref: true })).toBe(true);
    }
    for (const w of ['quiz', 'quiz please', 'کوئز دکھائیں', '/quiz']) expect(isQuizMenuRequest(w)).toBe(true);
  });
  test('switch off: the ref words are not the menu (today\'s chat answer), and nothing is read for them', async () => {
    seed({ share: false });
    expect(await Open.refMenu('quiz please jb3b9c1e2a')).toBe(false);
  });
});


// The card's language carries through the join (web_quiz_share_v4): the friend's words are the card's own
// ("quiz please …" on an English card, «کوئز دکھائیں …» on an Urdu one), so they decide the reply's words, the landing
// link's language and the join's — never the new phone's stored language.
describe('the card\'s language through the join', () => {
  const GoToken = require('../../../shared/services/first-touch/go.token');
  const goLang = () => {
    const url = String((WhatsApp.sendCtaUrl.mock.calls[0] || [])[1] && WhatsApp.sendCtaUrl.mock.calls[0][1].url);
    const t = url.split('/quiz/go/')[1];
    const p = t ? GoToken.verifyGo(t) : null;
    return p && p.ok ? p.ok.lang : null;
  };
  const BORN_UR = { ...UNKNOWN_USER, preferred_language: 'ur' };
  test('an English card on a phone stored as Urdu: the reply is not Urdu-only, and the landing link is English', async () => {
    seed({ user: BORN_UR });
    await OneDoor.reply({ user: BORN_UR, from: PHONE, door: 'text', body: 'quiz please jb3b9c1e2a' });
    expect(WhatsApp.sendCtaUrl).toHaveBeenCalledTimes(1);
    const o = WhatsApp.sendCtaUrl.mock.calls[0][1];
    expect(o.body).toMatch(/[A-Za-z]{3,}/);
    expect(goLang()).toBe('bi');
  });
  test('an Urdu card on a phone stored as English: Urdu', async () => {
    await OneDoor.reply({ user: UNKNOWN_USER, from: PHONE, door: 'text', body: 'کوئز دکھائیں jb3b9c1e2a' });
    expect(goLang()).toBe('ur');
  });
  test('the landing link\'s language is the join\'s: English in, an English join token out', async () => {
    const Targets = require('../../../shared/services/first-touch/go.targets');
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: BORN_UR.id });
    const out = await Targets.join({ n, lang: 'bi' });
    const url = String(out && (out.url || out));
    const j = T.verify(url.slice(url.indexOf(Join.JOIN_PATH) + Join.JOIN_PATH.length), 'j');
    expect(j && j.l).toBe('en');
  });
  test('switch off: today\'s order (the phone\'s stored Urdu wins), and the words are not read for a language', async () => {
    seed({ user: BORN_UR, shareValue: false });
    await OneDoor.reply({ user: BORN_UR, from: PHONE, door: 'text', body: 'quiz please jb3b9c1e2a' });
    expect(goLang()).toBe('ur');
  });
  test('words without a ref: today\'s order, whatever the switch', async () => {
    seed({ user: BORN_UR });
    await OneDoor.reply({ user: BORN_UR, from: PHONE, door: 'text', body: 'quiz please' });
    expect(goLang()).toBe('ur');
  });
});
