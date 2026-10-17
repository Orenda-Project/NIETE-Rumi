'use strict';
/**
 * The first home after a child joins on their own (web_quiz_home_v3): ONE line "Jugnu will remember you on this phone"
 * with ONE Undo, on the first open of the home that the join (or the "Is it you?" sheet) opened, on the phone that
 * joined; never on a later open, never on another phone, never for a phone that was kept already. Undo (the existing
 * POST /bind/undo, body {from:'join'}) erases THAT binding only, forgets the door's cached verdict, says bind_undo
 * {via:'page'}, keeps the child's row, and answers the "who are you?" page. Switch OFF: nothing kept, nothing drawn.
 * Real join service, binder, repos and hub-home field; Supabase, Redis and the loggers are the faked boundaries.
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
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const HomeFlags = require('../../../shared/services/quiz/web-quiz-home-flags');
const OneDoorFlags = require('../../../shared/services/first-touch/one-door.flags');
const StudentIdentity = require('../../../shared/services/quiz/student-identity.service');
const GoNonce = require('../../../shared/services/first-touch/go-nonce');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const Bindings = require('../../../shared/services/quiz/child-phone-bindings.repo');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(731);
const DEVICE = 'CCCCCCCCCCCCCCCCCCCCCC';
const OTHER_DEVICE = 'DDDDDDDDDDDDDDDDDDDDDD';
const USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };

let fake;
function seed({ home = true, homeValue = true, oneDoor = true, bindings = [], students = [] } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, quiz_student_join: true, quiz_one_door: oneDoor };
  if (home) settings.web_quiz_home_v3 = homeValue;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [USER], students, child_phone_bindings: bindings, child_identity: [], user_feature_first_use: [],
    quiz_sessions: [], class_enrollments: [], student_lists: [], class_teachers: [], quizzes: [], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  });
  supabase.from = (t) => {
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    b.upsert = (row) => b.insert(row);
    return b;
  };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  HomeFlags._resetCache();
  if (typeof OneDoorFlags._resetCache === 'function') OneDoorFlags._resetCache();
  Join._resetCache();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const Remember = () => require('../../../shared/services/quiz/web-quiz-home-remember');

async function joinNew(name = 'Sara', device = DEVICE) {
  const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
  const t = Join.signJoin({ n, lang: 'ur' });
  const out = await Join.join({ t, grade: 3, name, device });
  const kid = fake.db.students.find((s) => s.student_name === name);
  return { out, kidId: kid && String(kid.id) };
}

// The bot's internal router, the one route this change touches (the page's POST /api/wq/bind/undo arrives here).
async function postUndo(body, device = DEVICE) {
  const a = express();
  a.use(express.json());
  a.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/wq/bind/undo`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'unit-internal-key', ...(device ? { 'x-wq-device': device } : {}) }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test', INTERNAL_API_KEY: 'unit-internal-key' };
  jest.clearAllMocks();
  redis.__keys.clear();
  seed();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('the first open after a self-join', () => {
  test('the home that the join opened draws the line ONCE on the joining phone; a second open never', async () => {
    const { out, kidId } = await joinNew();
    expect(out.next).toMatch(/[?&]from=join/);
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    // a second open of the same home (a reload, the Back button, the next /quiz): no line
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'quiz' })).toEqual({});
    expect(events('web_quiz.home_remember')).toEqual([expect.objectContaining({ shown: true })]);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(PHONE);
    expect(sends()).toBe(0);
  });

  test('never on another phone, never for another child, never on a class-link or /quiz open', async () => {
    const { kidId } = await joinNew();
    expect(await Remember().field({ device: OTHER_DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    expect(await Remember().field({ device: DEVICE, chosenId: 'f0000000-0000-4000-8000-0000000009ff', src: 'join' })).toEqual({});
    for (const src of ['class_link', 'link', 'quiz', 'card', undefined]) {
      expect(await Remember().field({ device: DEVICE, chosenId: kidId, src })).toEqual({});
    }
    // still there for the right open (nothing above spent it)
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
  });

  test('a child whose phone was kept already (the "Is this you?" again path renews): no line', async () => {
    const { kidId } = await joinNew();
    redis.__keys.clear();
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
    const t = Join.signJoin({ n, lang: 'ur' });
    const ask = await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE });
    expect(ask.ask).toBe('is_this_you');
    await Join.join({ t, grade: 3, name: 'Sara', device: DEVICE, same: ask.kids[0].chip });
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
  });

  test('the "Is it you?" sheet\'s fresh binding (home from=bind) draws it once too; a child already kept never', async () => {
    const KID = 'f0000000-0000-4000-8000-000000000201';
    seed({ students: [{ id: KID, student_name: 'Ali Testwala', phone: PHONE, list_id: null, is_active: true, status: 'active', self_reported_class: '3', created_at: new Date(Date.now() - 60000).toISOString() }] });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
    const sheet = await Join.autoBind({ n, lang: 'en' });
    const picked = await Join.bindPick({ n, chip: sheet.confirm.kids[0].chip, device: DEVICE, lang: 'en' });
    expect(picked.next).toMatch(/[?&]from=bind/);
    expect(await Remember().field({ device: DEVICE, chosenId: KID, src: 'bind' })).toEqual({ remember: { s: 20 } });
    expect(await Remember().field({ device: DEVICE, chosenId: KID, src: 'bind' })).toEqual({});
    [...redis.__keys.keys()].filter((k) => /^wq:home:rem:/.test(k)).forEach((k) => redis.__keys.delete(k));
    // picked again: already kept on this phone → home from=quiz, nothing kept for a line
    const again = await Join.bindPick({ n, chip: sheet.confirm.kids[0].chip, device: DEVICE, lang: 'en' });
    expect(again.next).toMatch(/[?&]from=quiz/);
    expect([...redis.__keys.keys()].filter((k) => /^wq:home:rem:/.test(k))).toHaveLength(0);
  });

  test('the hub-home field carries `remember` beside the home keys only on that first open', async () => {
    const { kidId } = await joinNew();
    const HubHome = require('../../../shared/services/quiz/web-quiz-hub-home');
    const out = { lang: 'ur', kids: [], book_on: false };
    const first = await HubHome.homeField({ out, chosenId: kidId, history: [], device: DEVICE, src: 'join' });
    expect(first.home_v3).toBe(1);
    expect(first.remember).toEqual({ s: 20 });
    const again = await HubHome.homeField({ out, chosenId: kidId, history: [], device: DEVICE, src: 'join' });
    expect(again.home_v3).toBe(1);
    expect(again).not.toHaveProperty('remember');
  });
});

describe('Undo: the existing POST /bind/undo with {from:"join"}', () => {
  test('erases THIS binding only, forgets the door verdict, keeps the child row, answers the "who are you?" page; 0 messages', async () => {
    const other = { id: 'b-other', canonical_id: 'f0000000-0000-4000-8000-0000000000ee', phone_norm: PHONE, phone_tomb: 't', via: 'save',
      bound_at: '2026-10-16T10:00:00Z', expires_at: '2099-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null };
    fake.db.child_phone_bindings.push(other);
    const forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
    const { kidId } = await joinNew();
    await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' });
    forget.mockClear();
    const res = await postUndo({ from: 'join', lang: 'ur' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.next).toMatch(/^https:\/\/portal\.example\.test\/quiz\/go\/[A-Za-z0-9._~-]+$/);
    const mine = fake.db.child_phone_bindings.find((b) => b.canonical_id === kidId);
    expect(mine.revoked_by).toBe('page_undo');
    expect(mine.phone_norm).toBeNull();
    // the real repo no longer counts it as this child's live link
    expect((await Bindings.activeForChild(kidId)).map((b) => b.id)).not.toContain(mine.id);
    expect(fake.db.child_phone_bindings.find((b) => b.id === 'b-other').revoked_at).toBeNull();
    // the child stays: the row is there, active, never deleted
    expect(fake.db.students.find((s) => String(s.id) === kidId).is_active).not.toBe(false);
    expect(fake.calls.filter((c) => c.table === 'students' && c.op === 'delete')).toHaveLength(0);
    expect(forget).toHaveBeenCalledWith(PHONE, PHONE);
    expect(events('web_quiz.bind_undo')).toEqual([expect.objectContaining({ via: 'page', n: 1 })]);
    expect(sends()).toBe(0);
    // single use: a second Undo finds nothing
    const again = await postUndo({ from: 'join' });
    expect(again.body).toEqual({ ok: false, error: 'not_bound' });
  });

  test('another phone (a forwarded home link) cannot undo; nothing before the line was shown', async () => {
    const { kidId } = await joinNew();
    expect(await Remember().undo({ device: DEVICE })).toEqual({ ok: false, error: 'not_bound' });
    await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' });
    expect(await Remember().undo({ device: OTHER_DEVICE })).toEqual({ ok: false, error: 'not_bound' });
    expect(await Remember().undo({})).toEqual({ ok: false, error: 'not_bound' });
    expect(fake.db.child_phone_bindings.find((b) => b.canonical_id === kidId).revoked_at || null).toBeNull();
  });

  test('with the one-door page off the Undo still erases; no next (the page then just drops the line)', async () => {
    seed({ oneDoor: false });
    const { kidId } = await joinNew();
    await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' });
    const out = await Remember().undo({ device: DEVICE, lang: 'en' });
    expect(out).toEqual({ ok: true, next: null });
    expect(fake.db.child_phone_bindings.find((b) => b.canonical_id === kidId).revoked_by).toBe('page_undo');
  });

  test('a code (today\'s keep-my-place Undo) still goes to the code path, unchanged', async () => {
    const res = await postUndo({ code: 'JUGNU-ABCDE' });
    expect(res.body).toEqual({ ok: false, error: 'not_bound' });
    expect(events('web_quiz.home_remember')).toHaveLength(0);
  });
});

describe('the switch off (web_quiz_home_v3 absent, the string "true", false)', () => {
  test.each([['absent', { home: false }], ['"true"', { homeValue: 'true' }], ['false', { homeValue: false }]])('%s → the join keeps nothing, no line, Undo answers not_bound', async (_l, opts) => {
    seed(opts);
    const { out, kidId } = await joinNew();
    expect(out.next).toMatch(/[?&]from=join/);
    expect([...redis.__keys.keys()].filter((k) => /^wq:home:rem:/.test(k))).toHaveLength(0);
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    expect(await Remember().undo({ device: DEVICE })).toEqual({ ok: false, error: 'not_bound' });
    expect(fake.db.child_phone_bindings.find((b) => b.canonical_id === kidId).revoked_at || null).toBeNull();
    expect(events('web_quiz.home_remember')).toHaveLength(0);
  });
});
