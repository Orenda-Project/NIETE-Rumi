'use strict';
/**
 * "A friend joined Jugnu from your card!" (app_settings web_quiz_share_joined, on top of web_quiz_share_v4; default
 * OFF): a shared card's words carry the card's own short id beside the item's ref; when a NEW child joins on the phone
 * that sent those words, the sharer's count goes up — once per card per friend phone, never for a teacher's answer, a
 * child already known on that phone, or the sharer's own family phone. The sharer's home gets the count and whether it
 * moved today, nothing else (no name, no phone, no time finer than the day).
 * Real card server, share-open, join service and hub home field; the faked boundaries as the join seam's.
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
function seed({ joined = true, share = true, join = true, joinValue = true, students = [], bindings = [], user = UNKNOWN_USER, lists = [], early, books = [{ id: BOOK, status: 'ready' }] } = {}) {
  const settings = { quiz_one_door: true, web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, web_quiz_card_v3: true, ...(share ? { web_quiz_share_v4: true } : {}), ...(joined ? { web_quiz_share_joined: true } : {}) };
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



const SHARER = 'f0000000-0000-4000-8000-000000000999';
const sharerRow = { id: SHARER, student_name: 'Noor Testwala', list_id: null, is_active: true, status: 'active' };
async function cardWords() {
  const ct = T.signChallenge({ studentId: SHARER, ex: 'read', runId: 'run-s' });
  const m = await Card.mint({ ct, kind: 'book', deed: 'book_read', lang: 'en', item: { type: 'book', id: BOOK } });
  return { m, words: (await Card.landing(m.token)).ret.words };
}
const friends = () => require('../../../shared/services/quiz/web-quiz-hub-home').friendsField(SHARER);

describe('a friend joins from a shared card: the sharer hears it', () => {
  test('the card\'s words carry its short id; a NEW child joining on that phone counts once, today', async () => {
    seed({ students: [sharerRow] });
    const { words } = await cardWords();
    expect(words).toMatch(/^quiz please jb3b9c1e2a[0-9a-f]{8}$/);
    expect(isQuizMenuRequest(words, { ref: true })).toBe(true);
    expect(await Open.note(PHONE, words)).toBe(true);
    const { t } = await landing();
    const out = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    // the friend still lands on the book
    expect(out.next).toMatch(new RegExp(`#story/${BOOK}$`));
    expect(await friends()).toEqual({ friends_joined: { n: 1, today: true } });
    // the keys never carry a phone or the friend's id
    for (const k of redis.__keys.keys()) { expect(k).not.toContain(PHONE); expect(k).not.toContain(String(PHONE).slice(-7)); }
  });
  test('the same card on the same friend phone counts once (a second child, a second tap)', async () => {
    seed({ students: [sharerRow] });
    const { words } = await cardWords();
    await Open.note(PHONE, words);
    await Join.join({ t: (await landing()).t, grade: 3, name: 'Sara', device: DEVICE });
    await Open.note(PHONE, words);
    await Join.join({ t: (await landing()).t, grade: 2, name: 'Ali', device: DEVICE });
    expect(await friends()).toEqual({ friends_joined: { n: 1, today: true } });
  });
  test('no join (a teacher\'s answer, the role page left): nothing counts', async () => {
    seed({ students: [sharerRow] });
    const { words } = await cardWords();
    await Open.note(PHONE, words);
    expect(await friends()).toEqual({});
  });
  test('a child already on that phone (the "is this you" yes): not a new friend, nothing counts', async () => {
    seed({ students: [sharerRow, chatKid(0, 'Sara Testwala')] });
    const { words } = await cardWords();
    await Open.note(PHONE, words);
    const { t } = await landing();
    const ask = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(ask.ask).toBe('is_this_you');
    await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE, same: ask.kids[0].chip });
    expect(await friends()).toEqual({});
  });
  test('the sharer\'s own family phone (the sharer is on it): a sibling joining is not a new friend', async () => {
    seed({ students: [{ ...sharerRow, phone: PHONE }], bindings: [binding(SHARER)] });
    const { words } = await cardWords();
    await Open.note(PHONE, words);
    const out = await Join.join({ t: (await landing()).t, grade: 2, name: 'Ali', device: DEVICE });
    expect(out.next).toBeTruthy();
    expect(await friends()).toEqual({});
  });
  test('a count from another day is a count, not "today"', async () => {
    seed({ students: [sharerRow] });
    const { words } = await cardWords();
    await Open.note(PHONE, words);
    await Join.join({ t: (await landing()).t, grade: 3, name: 'Sara', device: DEVICE });
    for (const k of [...redis.__keys.keys()]) if (/joined:d:/.test(k)) redis.__keys.set(k, '2026-01-01');
    expect(await friends()).toEqual({ friends_joined: { n: 1, today: false } });
  });
});

describe('the count rides only the sharer\'s own phone', () => {
  const Home = () => require('../../../shared/services/quiz/web-quiz-hub-home');
  const Dev = () => require('../../../shared/services/quiz/web-quiz-hub-device');
  const FR = { friends_joined: { n: 2, today: true } };
  afterEach(() => jest.restoreAllMocks());
  test('a phone that may name the child: the count', async () => {
    const may = jest.spyOn(Dev(), 'deviceMayName').mockResolvedValue(true);
    expect(await Home().friendsFor(FR, SHARER, 'dddddddddddddddddddddd')).toEqual(FR);
    expect(may).toHaveBeenCalledWith([SHARER], 'dddddddddddddddddddddd');
  });
  test('any other phone (a forwarded hub link, no device): no key at all', async () => {
    jest.spyOn(Dev(), 'deviceMayName').mockResolvedValue(false);
    expect(await Home().friendsFor(FR, SHARER, 'eeeeeeeeeeeeeeeeeeeeee')).toEqual({});
    expect(await Home().friendsFor(FR, SHARER, null)).toEqual({});
  });
  test('no count: no device check (no read)', async () => {
    const may = jest.spyOn(Dev(), 'deviceMayName');
    expect(await Home().friendsFor({}, SHARER, 'dddddddddddddddddddddd')).toEqual({});
    expect(may).not.toHaveBeenCalled();
  });
  test('a failed check: no key', async () => {
    jest.spyOn(Dev(), 'deviceMayName').mockRejectedValue(new Error('down'));
    expect(await Home().friendsFor(FR, SHARER, 'dddddddddddddddddddddd')).toEqual({});
  });
});

describe('switch off (web_quiz_share_joined absent): today\'s one share, byte for byte', () => {
  test.each([['absent', undefined], ['the string "true"', 'true']])('%s: the words have no card id, nothing is kept for the sharer, no count, no field', async (_, v) => {
    seed({ joined: false, students: [sharerRow] });
    if (v !== undefined) fake.db.app_settings.push({ key: 'web_quiz_share_joined', value: v });
    const { m, words } = await cardWords();
    expect(words).toBe('quiz please jb3b9c1e2a');
    expect(Object.keys(m).sort()).toEqual(['img', 'item', 'plain', 'ret', 'token', 'url', 'v4']);
    await Open.note(PHONE, words);
    await Join.join({ t: (await landing()).t, grade: 3, name: 'Sara', device: DEVICE });
    expect([...redis.__keys.keys()].filter((k) => /wq:share:(card|joined)/.test(k))).toEqual([]);
    expect(await friends()).toEqual({});
  });
  test('the switch rides the card\'s own settings read: no read of its own', async () => {
    seed({ joined: false });
    const before = fake.calls.filter((c) => c.table === 'app_settings').length;
    await Card.field();
    await Card.joinedOn();
    expect(fake.calls.filter((c) => c.table === 'app_settings').length - before).toBe(1);
  });
});
