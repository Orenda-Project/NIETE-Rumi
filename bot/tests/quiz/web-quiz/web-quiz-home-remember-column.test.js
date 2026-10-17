'use strict';
/**
 * The phone a child joined on, kept on the binding row itself (app_settings `web_quiz_remember_column`, JSON `true`
 * only, default OFF; rides `web_quiz_home_v3`). The join writes the device's hash (sha256(device)[:32], the same
 * hash the cache key uses) on the binding it made; the first home's line and the grown-ups corner's "Forget this
 * phone" read the row first and the cache second, so a cache flush or a cache outage no longer loses the row.
 * Switch OFF (absent, false, the string 'true'): nothing written to or read from the column — today's cache path.
 * Real join service, binder, repos and hub-home field; Supabase, Redis and the loggers are the faked boundaries.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  const r = {
    __keys: keys,
    __up: true,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
  };
  r.isAvailable = () => r.__up;
  return r;
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const HomeFlags = require('../../../shared/services/quiz/web-quiz-home-flags');
const OneDoorFlags = require('../../../shared/services/first-touch/one-door.flags');
const GoNonce = require('../../../shared/services/first-touch/go-nonce');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const Bindings = require('../../../shared/services/quiz/child-phone-bindings.repo');
const T = require('../../../shared/services/quiz/web-quiz-token');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(733);
const DEVICE = 'CCCCCCCCCCCCCCCCCCCCCC';
const OTHER_DEVICE = 'DDDDDDDDDDDDDDDDDDDDDD';
const HASH = crypto.createHash('sha256').update(DEVICE).digest('hex').slice(0, 32);
const USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };

let fake;
let touched; // every column name / payload key the code sent to child_phone_bindings
function seed({ column = true, home = true, shown = 'absent' } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, quiz_student_join: true, quiz_one_door: true, web_quiz_home_v3: home };
  if (column !== 'absent') settings.web_quiz_remember_column = column;
  if (shown !== 'absent') settings.web_quiz_remember_shown_row = shown;
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [USER], students: [], child_phone_bindings: [], child_identity: [], user_feature_first_use: [],
    quiz_sessions: [], class_enrollments: [], student_lists: [], class_teachers: [], quizzes: [], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  });
  touched = [];
  supabase.from = (t) => {
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    b.upsert = (row) => b.insert(row);
    if (t === 'child_phone_bindings') {
      const wrap = (name, pick) => { const f = b[name]; b[name] = (...a) => { touched.push(pick(a)); return f.apply(b, a); }; };
      wrap('select', (a) => String(a[0] || ''));
      wrap('eq', (a) => String(a[0]));
      wrap('is', (a) => String(a[0]));
      wrap('update', (a) => Object.keys(a[0] || {}).join(','));
      wrap('insert', (a) => Object.keys(a[0] || {}).join(','));
    }
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
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const Remember = () => require('../../../shared/services/quiz/web-quiz-home-remember');
const HubHome = () => require('../../../shared/services/quiz/web-quiz-hub-home');
const chip = (id) => T.chipId('h', id);
const flushCache = () => redis.__keys.clear();
const rowOf = (kidId) => fake.db.child_phone_bindings.find((b) => b.canonical_id === kidId);
const OUT = { lang: 'en', kids: [], book_on: false };

async function joinNew(name = 'Sara Testwala', device = DEVICE) {
  const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
  const t = Join.signJoin({ n, lang: 'en' });
  const out = await Join.join({ t, grade: 3, name, device });
  const kid = fake.db.students.find((s) => s.student_name === name);
  // the database's own `bound_at DEFAULT now()` (the fake applies no defaults)
  fake.db.child_phone_bindings.forEach((b) => { if (!b.bound_at) b.bound_at = new Date().toISOString(); });
  return { out, kidId: kid && String(kid.id) };
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test', INTERNAL_API_KEY: 'unit-internal-key' };
  jest.clearAllMocks();
  redis.__keys.clear();
  redis.__up = true;
  seed();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('switch ON: the join writes the device hash on the binding it made', () => {
  test('the row carries sha256(device)[:32] — the same hash as the cache key; never the raw device', async () => {
    const { kidId } = await joinNew();
    expect(rowOf(kidId).device_hash).toBe(HASH);
    expect(Remember()._keyOf(DEVICE)).toBe(`wq:home:rem:${HASH}`);
    expect(JSON.stringify(fake.db.child_phone_bindings)).not.toContain(DEVICE);
    expect(sends()).toBe(0);
  });

  test('the "Is it you?" sheet\'s fresh binding gets it too', async () => {
    const KID = 'f0000000-0000-4000-8000-000000000301';
    fake.db.students.push({ id: KID, student_name: 'Ali Testwala', phone: PHONE, list_id: null, is_active: true, status: 'active', self_reported_class: '3', created_at: new Date(Date.now() - 60000).toISOString() });
    const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
    const sheet = await Join.autoBind({ n, lang: 'en' });
    await Join.bindPick({ n, chip: sheet.confirm.kids[0].chip, device: DEVICE, lang: 'en' });
    expect(rowOf(KID).device_hash).toBe(HASH);
  });

  test('the cache down at join time: the row still gets the hash (the corner finds it later)', async () => {
    const { kidId } = await joinNew();
    delete rowOf(kidId).device_hash;
    redis.__up = false;
    expect(await Remember().note({ device: DEVICE, bindingId: rowOf(kidId).id, canonicalId: kidId, userId: USER.id })).toBe(true);
    expect(rowOf(kidId).device_hash).toBe(HASH);
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(true);
  });
});

describe('switch ON: the row is read first, the cache second', () => {
  test('a cache flush: the corner still has "Forget this phone", and one tap erases that link only', async () => {
    const a = await joinNew('Sara Testwala');
    const b = await joinNew('Bilal Testwala');
    flushCache();
    expect(await Remember().owns({ device: DEVICE, chosenId: a.kidId })).toBe(true);
    expect((await HubHome().homeField({ out: OUT, chosenId: a.kidId, history: [], device: DEVICE, src: 'quiz' })).forget_phone).toBe(true);
    // another phone (a forwarded link) never sees the row
    expect(await Remember().owns({ device: OTHER_DEVICE, chosenId: a.kidId })).toBe(false);
    expect(await Remember().forget({ device: OTHER_DEVICE, kid: chip(a.kidId) })).toEqual({ ok: false, error: 'not_bound' });
    expect(await Remember().forget({ device: DEVICE, kid: chip(a.kidId) })).toEqual({ ok: true });
    expect(rowOf(a.kidId).revoked_by).toBe('page_undo');
    expect(rowOf(a.kidId).phone_norm).toBeNull();
    expect(rowOf(b.kidId).revoked_at || null).toBeNull();
    expect(await Remember().owns({ device: DEVICE, chosenId: a.kidId })).toBe(false);
    expect(await Remember().owns({ device: DEVICE, chosenId: b.kidId })).toBe(true);
    expect(await Remember().forget({ device: DEVICE, kid: chip(a.kidId) })).toEqual({ ok: false, error: 'not_bound' });
    expect(sends()).toBe(0);
  });

  test('the cache down: the corner row and its tap still work from the row', async () => {
    const { kidId } = await joinNew();
    redis.__up = false;
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(true);
    expect(await Remember().forget({ device: DEVICE, kid: chip(kidId) })).toEqual({ ok: true });
    expect(rowOf(kidId).revoked_by).toBe('page_undo');
  });

  test('the cache down on the first home: NO line (never twice beats once), the corner row still drawn from the row', async () => {
    const { kidId } = await joinNew();
    redis.__up = false;
    const f = await HubHome().homeField({ out: OUT, chosenId: kidId, history: [], device: DEVICE, src: 'join' });
    expect(f.home_v3).toBe(1);
    expect(f).not.toHaveProperty('remember');
    expect(f.forget_phone).toBe(true);
  });

  test('a link erased elsewhere (STOP) hides the row even with the hash still on it', async () => {
    const { kidId } = await joinNew();
    flushCache();
    await Bindings.eraseOne(rowOf(kidId).id, 'stop');
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(false);
  });

  test.each([
    // each filter held on its own: the other two left as a live row would have them
    ['revoked (its phone still set)', { revoked_at: new Date(Date.now() - 60000).toISOString(), revoked_by: 'stop' }],
    ['its phone gone (not revoked)', { phone_norm: null }],
    ['expired', { expires_at: new Date(Date.now() - 60000).toISOString() }],
  ])('the device read never returns a row that is %s, even with the hash still on it', async (_l, patch) => {
    const { kidId } = await joinNew();
    expect((await Bindings.activeForDevice(HASH)).map((b) => b.canonical_id)).toEqual([kidId]);
    Object.assign(rowOf(kidId), patch);
    expect(rowOf(kidId).device_hash).toBe(HASH);
    expect(await Bindings.activeForDevice(HASH)).toEqual([]);
    flushCache();
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(false);
  });

  test('the first home after a cache flush still draws the line ONCE (from the row), and never on a later open', async () => {
    const { kidId } = await joinNew();
    flushCache();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    expect(await Remember().field({ device: OTHER_DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    // the line's Undo then works as today
    const u = await Remember().undo({ device: DEVICE, lang: 'en' });
    expect(u.ok).toBe(true);
    expect(rowOf(kidId).revoked_by).toBe('page_undo');
  });

  test('an old binding (no hash on the row): the row read finds nothing and the cache answers, as today', async () => {
    const { kidId } = await joinNew();
    rowOf(kidId).device_hash = null;
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(true);
    expect(await Remember().forget({ device: DEVICE, kid: chip(kidId) })).toEqual({ ok: true });
    expect(rowOf(kidId).revoked_by).toBe('page_undo');
  });

  test('a row older than the line\'s 30 minutes never draws the line, even on a join redirect', async () => {
    const { kidId } = await joinNew();
    flushCache();
    rowOf(kidId).bound_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
  });
});

describe('switch OFF (absent, false, the string "true"): today\'s cache path, the column never touched', () => {
  test.each([['absent', 'absent'], ['false', false], ['"true"', 'true']])('%s', async (_l, value) => {
    seed({ column: value });
    const { kidId } = await joinNew();
    expect(rowOf(kidId)).not.toHaveProperty('device_hash');
    // today's cache path still answers
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(true);
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    // a cache flush loses the row, exactly as today
    flushCache();
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(false);
    expect(await Remember().forget({ device: DEVICE, kid: chip(kidId) })).toEqual({ ok: false, error: 'not_bound' });
    expect(rowOf(kidId).revoked_at || null).toBeNull();
    expect(touched.join('|')).not.toMatch(/device_hash/);
  });

  test('web_quiz_home_v3 off with the column ON: nothing written, nothing read', async () => {
    seed({ home: false, column: true });
    const { kidId } = await joinNew();
    expect(rowOf(kidId)).not.toHaveProperty('device_hash');
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(false);
    expect(touched.join('|')).not.toMatch(/device_hash/);
  });
});

describe('web_quiz_home_v3 flipped OFF after a join (the line, the corner and the tap all close)', () => {
  test.each([['the column on', true], ['the column absent', 'absent']])('%s', async (_l, column) => {
    seed({ column });
    const { kidId } = await joinNew();
    fake.db.app_settings.find((r) => r.key === 'web_quiz_home_v3').value = false;
    HomeFlags._resetCache();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(false);
    expect(await Remember().forget({ device: DEVICE, kid: chip(kidId) })).toEqual({ ok: false, error: 'not_bound' });
    expect(await Remember().undo({ device: DEVICE })).toEqual({ ok: false, error: 'not_bound' });
    expect(rowOf(kidId).revoked_at || null).toBeNull();
    // flipped back on: the line was never spent, so it still shows once
    fake.db.app_settings.find((r) => r.key === 'web_quiz_home_v3').value = true;
    HomeFlags._resetCache();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
  });
});

describe('the home render reads the binding rows once, and no setting twice', () => {
  const settingsReads = async (column, src) => {
    seed({ column });
    const { kidId } = await joinNew();
    flushCache();
    HomeFlags._resetCache();
    fake.calls.length = 0;
    touched.length = 0;
    const f = await HubHome().homeField({ out: OUT, chosenId: kidId, history: [], device: DEVICE, src });
    return { f, n: fake.calls.filter((c) => c.table === 'app_settings').length, deviceReads: touched.filter((t) => t === 'device_hash').length };
  };
  test('column on: one device read for the line and the corner together; the column key rides the home switches\' read', async () => {
    const on = await settingsReads(true, 'join');
    expect(on.f.remember).toEqual({ s: 20 });
    expect(on.f.forget_phone).toBe(true);
    // one device read (a filter on device_hash) for the line and the corner together
    expect(on.deviceReads).toBe(1);
    const off = await settingsReads('absent', 'join');
    expect(off.f).not.toHaveProperty('remember');
    expect(on.n).toBe(off.n);
  });
});

describe('web_quiz_remember_shown_row: "shown" is kept on the row too, so a cache flush never draws the line twice', () => {
  test('ON: the join URL reopened after a cache flush draws no second line; the row holds when it was shown', async () => {
    seed({ shown: true });
    const { kidId } = await joinNew();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    expect(rowOf(kidId).remember_shown_at).toEqual(expect.any(String));
    flushCache();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'bind' })).toEqual({});
    // the corner is untouched: "Forget this phone" still offered from the row
    expect(await Remember().owns({ device: DEVICE, chosenId: kidId })).toBe(true);
  });

  test('ON: a row already marked shown wins over a cache note that says "not yet" (two tabs, one line)', async () => {
    seed({ shown: true });
    const { kidId } = await joinNew();
    rowOf(kidId).remember_shown_at = new Date(Date.now() - 5000).toISOString();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
  });

  test('ON: the line\'s Undo still works after the row claimed it', async () => {
    seed({ shown: true });
    const { kidId } = await joinNew();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    const u = await Remember().undo({ device: DEVICE, lang: 'en' });
    expect(u.ok).toBe(true);
    expect(rowOf(kidId).revoked_by).toBe('page_undo');
  });

  test('ON: the row write failing keeps today\'s cache rule (the line shows once from the cache)', async () => {
    seed({ shown: true });
    const { kidId } = await joinNew();
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'child_phone_bindings') { const u = b.update; b.update = (row) => (row && 'remember_shown_at' in row ? { eq: () => ({ is: () => ({ is: () => ({ select: async () => ({ data: null, error: { message: 'column missing' } }) }) }) }) } : u.call(b, row)); }
      return b;
    };
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
  });

  test.each([['absent', 'absent'], ['false', false], ['"true"', 'true'], ['\'"true"\'', '"true"'], ['\' TRUE \'', ' TRUE '], ['"yes"', 'yes'], ['1', 1], ['{enabled:true}', { enabled: true }]])('OFF (%s): today\'s path — the row is never marked, and a flush draws it again as before', async (_l, value) => {
    seed({ shown: value });
    const { kidId } = await joinNew();
    touched.length = 0;
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    expect(touched.join(',')).not.toContain('remember_shown_at');
    expect('remember_shown_at' in rowOf(kidId)).toBe(false);
    flushCache();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
  });

  test.each([['absent', 'absent'], ['false', false]])('column %s, shown ON: it acts only with the column on — no query names the column, and a flush draws the line again', async (_l, column) => {
    seed({ column, shown: true });
    const { kidId } = await joinNew();
    touched.length = 0;
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    // the cache lost: the same join URL reopened writes the cache note again, and today's rule draws the line again
    flushCache();
    expect(await Remember().note({ device: DEVICE, bindingId: rowOf(kidId).id, canonicalId: kidId, userId: USER.id })).toBe(true);
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    expect(touched.join(',')).not.toContain('remember_shown_at');
    expect('remember_shown_at' in rowOf(kidId)).toBe(false);
  });

  test('a failed read on the shown key\'s own row: the home, the shelf and the column stay as they are, shown is off, the line comes from the cache', async () => {
    const { throwOn } = require('../../helpers/switch-off-matrix');
    seed({ shown: true });
    fake.db.app_settings.push({ key: 'web_quiz_stories', value: true });
    let reads = 0;
    const faulty = throwOn(supabase.from, 'web_quiz_remember_shown_row');
    supabase.from = (t) => { if (t === 'app_settings') reads += 1; return faulty(t); };
    HomeFlags._resetCache();
    const f = await HomeFlags.flags();
    expect({ home: f.home, stories: f.stories, column: f.column, shown: f.shown }).toEqual({ home: true, stories: true, column: true, shown: false });
    // one extra settings read, on the failure only (the home's own keys, read again alone); then the 30 s cache holds
    expect(reads).toBe(2);
    await HomeFlags.flags();
    expect(reads).toBe(2);
    const { kidId } = await joinNew();
    touched.length = 0;
    const home = await HubHome().homeField({ out: OUT, chosenId: kidId, history: [], device: DEVICE, src: 'join' });
    expect(home.home_v3).toBe(1);
    expect(home.remember).toEqual({ s: 20 });
    expect(touched.join(',')).not.toContain('remember_shown_at');
    // the cache's rule, as with the key off: a reload draws nothing, a flush draws it again
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({});
    flushCache();
    expect(await Remember().field({ device: DEVICE, chosenId: kidId, src: 'join' })).toEqual({ remember: { s: 20 } });
    expect('remember_shown_at' in rowOf(kidId)).toBe(false);
  });

  test('a failed read on the home switch itself still turns every switch off (fails closed, as today)', async () => {
    const { throwOn } = require('../../helpers/switch-off-matrix');
    seed({ shown: true });
    supabase.from = throwOn(supabase.from, 'web_quiz_home_v3');
    HomeFlags._resetCache();
    const f = await HomeFlags.flags();
    expect({ home: f.home, stories: f.stories, column: f.column, shown: f.shown }).toEqual({ home: false, stories: false, column: false, shown: false });
  });

  test('settings reads on the first home (#C72): OFF is the recorded count; ON adds no read; ON stays under the ceiling', async () => {
    const OFF_READS = 3; // recorded on this head (home, hub and identity switches, each one read, cache cold)
    const NAMED_ROWS = 0; // the shown key rides that same read
    const count = async (shown) => {
      seed({ shown });
      const { kidId } = await joinNew();
      flushCache();
      await Remember().note({ device: DEVICE, bindingId: rowOf(kidId).id, canonicalId: kidId, userId: USER.id });
      IdFlags._resetCache(); HubFlags._resetCache(); HomeFlags._resetCache();
      if (typeof OneDoorFlags._resetCache === 'function') OneDoorFlags._resetCache();
      fake.calls.length = 0;
      const f = await HubHome().homeField({ out: OUT, chosenId: kidId, history: [], device: DEVICE, src: 'join' });
      expect(f.remember).toEqual({ s: 20 });
      return fake.calls.filter((c) => c.table === 'app_settings').length;
    };
    const off = await count('absent');
    const on = await count(true);
    expect(off).toBe(OFF_READS);
    expect(on).toBeLessThanOrEqual(off + NAMED_ROWS);
    expect(on).toBeLessThanOrEqual(OFF_READS);
  });

  test('ON: a binding whose link is gone is never claimed (no write, the claim says no)', async () => {
    seed({ shown: true });
    const { kidId } = await joinNew();
    rowOf(kidId).revoked_at = new Date(Date.now() - 1000).toISOString();
    expect(await Bindings.markShown(rowOf(kidId).id)).toBe(false);
    expect('remember_shown_at' in rowOf(kidId)).toBe(false);
  });

  test('the key rides the home switches\' one settings read (no extra read)', async () => {
    seed({ shown: true });
    HomeFlags._resetCache();
    fake.calls.length = 0;
    const f = await HomeFlags.flags();
    expect(f.shown).toBe(true);
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toHaveLength(1);
  });
});

describe('the shown-mark migration', () => {
  const dir = path.join(__dirname, '../../../database/migrations');
  test('additive and idempotent: one nullable column; the rollback drops only it; the schema mirror has it', () => {
    const up = fs.readFileSync(path.join(dir, 'child_phone_bindings_remember_shown.sql'), 'utf8');
    const down = fs.readFileSync(path.join(dir, 'child_phone_bindings_remember_shown_rollback.sql'), 'utf8');
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS remember_shown_at timestamptz;/);
    expect(up).not.toMatch(/DROP\s|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|NOT NULL/i);
    expect(down).toMatch(/DROP COLUMN IF EXISTS remember_shown_at;/);
    expect(down.replace(/^--.*$/gm, '')).not.toMatch(/device_hash|DROP TABLE/i);
    const mirror = fs.readFileSync(path.join(__dirname, '../../../../infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    expect(mirror).toMatch(/remember_shown_at\s+timestamptz/);
  });
});

describe('the migration', () => {
  const dir = path.join(__dirname, '../../../database/migrations');
  const up = () => fs.readFileSync(path.join(dir, 'child_phone_bindings_device.sql'), 'utf8');
  const down = () => fs.readFileSync(path.join(dir, 'child_phone_bindings_device_rollback.sql'), 'utf8');
  test('additive and idempotent: one nullable column, its index, and an erase that clears it', () => {
    const sql = up();
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS device_hash text/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS cpb_device/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)|\bDELETE\b|\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
    // a revoked row never keeps the device (as it never keeps the phone)
    expect(sql).toMatch(/revoked_at IS NOT NULL[\s\S]*device_hash\s*:=\s*NULL/);
  });
  test('the rollback drops exactly what it added', () => {
    const sql = down();
    expect(sql).toMatch(/DROP COLUMN IF EXISTS device_hash/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/);
  });
  test('the schema mirror has the column', () => {
    const mirror = fs.readFileSync(path.join(__dirname, '../../../../infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    expect(mirror).toMatch(/device_hash\s+text/);
  });
});
