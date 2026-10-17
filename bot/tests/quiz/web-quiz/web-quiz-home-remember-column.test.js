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
function seed({ column = true, home = true } = {}) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, quiz_student_join: true, quiz_one_door: true, web_quiz_home_v3: home };
  if (column !== 'absent') settings.web_quiz_remember_column = column;
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
  const ColFlag = (() => { try { return require('../../../shared/services/quiz/web-quiz-remember-column-flag'); } catch (_) { return null; } })();
  if (ColFlag && typeof ColFlag._resetCache === 'function') ColFlag._resetCache();
}
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const Remember = () => require('../../../shared/services/quiz/web-quiz-home-remember');
const HubHome = () => require('../../../shared/services/quiz/web-quiz-hub-home');
const chip = (id) => T.chipId('h', id);
const flushCache = () => redis.__keys.clear();
const rowOf = (kidId) => fake.db.child_phone_bindings.find((b) => b.canonical_id === kidId);
const OUT = { lang: 'en', kids: [], book_on: false };

async function joinNew(name = 'Sara', device = DEVICE) {
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
    const a = await joinNew('Sara');
    const b = await joinNew('Bilal');
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

  test('a link erased elsewhere (STOP) hides the row even with the hash still on it', async () => {
    const { kidId } = await joinNew();
    flushCache();
    await Bindings.eraseOne(rowOf(kidId).id, 'stop');
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
