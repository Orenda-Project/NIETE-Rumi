'use strict';
/**
 * "Is this you?" through the registration Flow endpoint (plan N3, sections 2, 5.4 and 6).
 *
 * A v6 form sends form_rev "6" from Pick your school, IS_THIS_YOU and TEACHING. After Pick your school the endpoint asks
 * about ONE other live account with her name at that school (when it is unused or silent); the answer is stored and
 * acted on at Finish, in the request that completes her sign-up:
 *   Yes on an unused import, on a Meta-verified request: her number moves onto that account, her new empty account is
 *   retired, and the rest of the sign-up writes to the claimed account (identity "claimed").
 *   Any other Yes, and every Not sure: nothing moves, one review row (identity "review").
 *   No: nothing (identity "none").
 * v5.1 forms (no form_rev) and a switch that is off behave exactly as today.
 *
 * Beyond the plan, pinned here: a move that stops after her new account was retired puts that account back, so she
 * is never left with no account on her number; and a repeated Finish after the claim writes to the claimed account,
 * never to the retired one.
 *
 * Only the edges are doubled: the database (an in-memory table fake that records every write), Redis, WhatsApp, the
 * language cache and the file logger. The structured event logger is real.
 */
const { recordingDb } = require('../identity/helpers/recording-db');

const mockRedisStore = new Map();
const mockLocks = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (key) => {
    if (!mockRedisStore.has(key)) return null;
    const raw = mockRedisStore.get(key);
    try { return JSON.parse(raw); } catch { return raw; }
  }),
  set: jest.fn(async (key, value) => {
    mockRedisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  }),
  isAvailable: () => true,
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
  acquireLock: jest.fn(async (key, id) => { if (mockLocks.has(key)) return false; mockLocks.set(key, id); return true; }),
  releaseLock: jest.fn(async (key, id) => { if (mockLocks.get(key) === id) mockLocks.delete(key); return true; }),
}));
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (name) => mockDb.client.from(name), rpc: async () => ({ data: null, error: null }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/language-cache', () => ({ setUserLanguage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.example.com' }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({ ok: true })),
  sendCtaUrl: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/student-ingress-cache', () => ({ forget: jest.fn(async () => {}) }));

const ep = require('../../bot/shared/routes/registration-endpoint');
const SchoolSearch = require('../../bot/shared/services/schools/school-search.service');
const ItU = require('../../bot/shared/services/identity/is-this-you');

const fx = (n) => `92000${String(n).padStart(7, '0')}`;            // synthetic, never a real mobile
const HER = 'b0000000-0000-4000-8000-000000000001';
const REC = 'b0000000-0000-4000-8000-000000000002';
const SCHOOL = { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'IMSG(I-X) G-9/1', region: 'Urban-II', emis: '424', is_probable_test: false };
const TOKEN = `${HER}:registration:1763600000000`;
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const her = (o = {}) => ({
  id: HER, phone_number: fx(1), name: 'Ayesha Siddiqa', role: 'teacher', school_id: null, organization: null,
  registration_completed: false, created_at: ago(60 * 1000), first_message_at: ago(58 * 1000), is_test_user: false,
  deleted_at: null, deleted_by: null, preferred_language: null, language_locked: false, grades_taught: null, subjects_taught: null, ...o,
});
const record = (o = {}) => ({
  id: REC, phone_number: fx(247), name: 'AYESHA SIDDIQA', role: 'teacher', school_id: SCHOOL.id, organization: 'niete',
  registration_completed: false, first_message_at: null, last_message_at: null, portal_last_login: null, is_test_user: false,
  deleted_at: null, ...o,
});
function world({ users = [her(), record()], flag = true, ...tables } = {}) {
  mockDb = recordingDb({
    users, schools: [SCHOOL], app_settings: [{ key: 'registration_is_this_you_enabled', value: flag }],
    chat_sessions: [], lesson_plans: [], training_certificates: [], training_assessment_attempts: [],
    teacher_training_progress: [], coaching_sessions: [], observation_schedules: [], leader_roster_audit: [], ...tables,
  });
  return mockDb;
}
const row = (id) => mockDb.tables.users.find((r) => r.id === id);
const audits = (action) => mockDb.tables.leader_roster_audit.filter((r) => !action || r.action === action);
const usersWritesTo = (id) => mockDb.writes.filter((w) => w.table === 'users' && w.op === 'update'
  && w.where.some(([k, c, v]) => k === 'eq' && c === 'id' && v === id));

const pick = (formRev = '6') => ep.handleRegistrationDataExchange(HER, 'SCHOOL_PICK',
  { school_id: SCHOOL.id, ...(formRev ? { form_rev: formRev } : {}) }, TOKEN);
const answer = (a) => ep.handleRegistrationDataExchange(HER, 'IS_THIS_YOU', { is_this_you: a, form_rev: '6' }, TOKEN);
const finish = ({ signatureOk = true, formRev = '6' } = {}) => ep.handleRegistrationDataExchange(HER, 'TEACHING',
  { grade: ['grade_3'], subjects: [], ...(formRev ? { form_rev: formRev } : {}) }, TOKEN, { signatureOk });
const identity = (res) => res.data.extension_message_response.params.identity;
const asked = async () => { const r = await pick(); expect(r.screen).toBe('IS_THIS_YOU'); return r; };

beforeEach(() => {
  mockRedisStore.clear();
  mockLocks.clear();
  SchoolSearch._resetCache();
  mockRedisStore.set(`reg_flow:${TOKEN}`, JSON.stringify({ v: 5, full_name: 'Ayesha Siddiqa', language: 'en', role: 'teacher' }));
});
afterEach(() => jest.restoreAllMocks());

describe('Pick your school', () => {
  test('E1: a v5.1 form (no form_rev) next to a match goes to TEACHING with exactly today\'s data', async () => {
    world({ flag: false });
    const today = await pick(null);
    world();
    mockRedisStore.set(`reg_flow:${TOKEN}`, JSON.stringify({ v: 5, full_name: 'Ayesha Siddiqa', language: 'en', role: 'teacher' }));
    SchoolSearch._resetCache();
    const v51 = await pick(null);
    expect(v51).toEqual(today);
    expect(v51.screen).toBe('TEACHING');
  });

  test('E2: switch off on a v6 form: TEACHING, and no question is considered', async () => {
    world({ flag: false });
    const offer = jest.spyOn(ItU, 'offer');
    const res = await pick();
    expect(res.screen).toBe('TEACHING');
    expect(await offer.mock.results[0].value).toEqual({ ask: false, why: 'flag_off' });
  });

  test('E3: switch on, v6, an unused match: IS_THIS_YOU with her typed first name, the school and two digits only', async () => {
    world();
    const res = await asked();
    expect(Object.keys(res.data).sort()).toEqual(['answers', 't_answer_label', 't_body', 't_heading', 't_next']);
    expect(res.data.t_body).toContain('Ayesha');
    expect(res.data.t_body).toContain('IMSG G-9/1');
    expect(res.data.t_body).toContain('47');
    expect(res.data.answers.map((a) => a.id)).toEqual(['yes', 'no', 'not_sure']);
    const all = JSON.stringify(res);
    expect(all).not.toContain(REC);
    expect(all).not.toContain('247');
    expect(all).not.toContain('AYESHA SIDDIQA');
  });

  test('E4: answering Yes goes to TEACHING from her own row and writes nothing to any account', async () => {
    world({ users: [her({ grades_taught: ['grade_1'] }), record({ grades_taught: ['grade_5'] })] });
    await asked();
    const before = mockDb.writes.length;
    const res = await answer('yes');
    expect(res.screen).toBe('TEACHING');
    expect(res.data.init_grades).toEqual(['grade_1']);
    expect(mockDb.writes.slice(before)).toEqual([]);
    expect(audits()).toEqual([]);
  });
});

describe('Finish', () => {
  test('E5: Yes on an unused import, verified request: her number moves onto it and the sign-up ends there', async () => {
    world();
    await asked();
    await answer('yes');
    const done = await finish();
    expect(done.screen).toBe('SUCCESS');
    expect(identity(done)).toBe('claimed');
    expect(row(REC).phone_number).toBe(fx(1));
    expect(row(HER)).toMatchObject({ phone_number: `merged:${HER}`, deleted_by: 'registration_claim', school_id: null });
    expect(row(REC)).toMatchObject({ registration_completed: true, grades_taught: ['grade_3'], name: 'Ayesha Siddiqa' });
    expect(audits().map((r) => [r.action, r.detail.via])).toEqual([['edit_phone', 'registration_claim']]);
    // After her account is retired, the only write to it is clearing its school.
    const toHer = usersWritesTo(HER);
    const retiredAt = toHer.findIndex((w) => w.patch.phone_number === `merged:${HER}`);
    expect(retiredAt).toBeGreaterThanOrEqual(0);
    expect(toHer.slice(retiredAt + 1).map((w) => w.patch)).toEqual([{ school_id: null }]);
  });

  const reviewCases = [
    ['record_active', () => Object.assign(row(REC), { first_message_at: ago(20 * DAY), last_message_at: ago(DAY) }), {}],
    ['record_used', () => mockDb.tables.chat_sessions.push({ id: 'c1', user_id: REC }), {}],
    ['record_admin_role', () => Object.assign(row(REC), { role: 'coach' }), {}],
    ['record_has_history', () => mockDb.tables.training_certificates.push({ id: 't1', user_id: REC }), {}],
    ['account_not_new', () => Object.assign(row(HER), { created_at: ago(30 * DAY) }), {}],
    ['account_has_history', () => mockDb.tables.training_certificates.push({ id: 't2', user_id: HER }), {}],
    ['unverified', () => {}, { signatureOk: false }],
    ['number_change_pending', () => mockDb.tables.leader_roster_audit.push({ id: 'a0', action: 'edit_phone', actor_user_id: 'x',
      created_at: ago(60 * 1000), detail: { via: 'meta_number_change', to_phone: fx(1) } }), {}],
  ];
  test.each(reviewCases)('E6/E7: Yes, but %s: nothing moves, one review row, the sign-up completes on her account',
    async (why, change, opts) => {
      world();
      await asked();
      await answer('yes');
      change();
      const done = await finish(opts);
      expect(identity(done)).toBe('review');
      expect(row(HER)).toMatchObject({ phone_number: fx(1), deleted_at: null, registration_completed: true, grades_taught: ['grade_3'] });
      expect(row(REC).phone_number).toBe(fx(247));
      const esc = audits('edit_phone_escalated');
      expect(esc).toHaveLength(1);
      expect(esc[0].detail).toMatchObject({ via: 'registration_claim', reason: why });
      expect(audits('edit_phone').filter((r) => r.detail.via === 'registration_claim')).toEqual([]);   // none of ours
    });

  test('E7 slow: a Finish that has used its time budget asks for a review instead of moving', async () => {
    world();
    await asked();
    await answer('yes');
    const realNow = Date.now.bind(Date);
    let skew = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    const from = mockDb.client.from;
    mockDb.client.from = (name) => { if (name === 'leader_roster_audit') skew = 5000; return from(name); };
    const done = await finish();
    expect(identity(done)).toBe('review');
    expect(audits('edit_phone_escalated')[0].detail.reason).toBe('slow');
    expect(row(HER).phone_number).toBe(fx(1));
  });

  test('E8: No changes nothing', async () => {
    world();
    await asked();
    await answer('no');
    const done = await finish();
    expect(identity(done)).toBe('none');
    expect(audits()).toEqual([]);
    expect(row(HER)).toMatchObject({ phone_number: fx(1), registration_completed: true });
    expect(usersWritesTo(REC)).toEqual([]);
  });

  test('E9: Not sure asks for a review and moves nothing', async () => {
    world();
    await asked();
    await answer('not_sure');
    const done = await finish();
    expect(identity(done)).toBe('review');
    expect(audits('edit_phone_escalated')[0].detail.reason).toBe('not_sure');
    expect(row(REC).phone_number).toBe(fx(247));
  });

  test('E10: the record is retired between the question and Finish: nothing moves', async () => {
    world();
    await asked();
    await answer('yes');
    Object.assign(row(REC), { deleted_at: ago(1000), phone_number: `merged:${REC}` });
    const done = await finish();
    expect(identity(done)).toBe('none');
    expect(audits()).toEqual([]);
    expect(row(HER)).toMatchObject({ phone_number: fx(1), registration_completed: true });
  });

  test('E11: the switch is turned off between the question and Finish: the sign-up completes as today', async () => {
    world();
    await asked();
    await answer('yes');
    mockDb.tables.app_settings[0].value = false;
    const done = await finish();
    expect(identity(done)).toBe('none');
    expect(audits()).toEqual([]);
    expect(row(HER)).toMatchObject({ phone_number: fx(1), registration_completed: true });
  });

  test('E12: two Finish requests at once: one move, one audit row, both complete on the claimed account', async () => {
    world();
    await asked();
    await answer('yes');
    const [a, b] = await Promise.all([finish(), finish()]);
    expect([identity(a), identity(b)]).toEqual(['claimed', 'claimed']);
    expect(audits('edit_phone')).toHaveLength(1);
    const toHer = usersWritesTo(HER).map((w) => w.patch);
    expect(toHer.filter((p) => 'grades_taught' in p || 'registration_completed' in p)).toEqual([]);
    expect(row(REC)).toMatchObject({ phone_number: fx(1), registration_completed: true });
  });

  test('E12b: a repeated Finish after the claim completed writes to the claimed account, never the retired one', async () => {
    world();
    await asked();
    await answer('yes');
    expect(identity(await finish())).toBe('claimed');
    const writesBefore = usersWritesTo(HER).length;
    const again = await finish();                            // the saved form data is gone by now
    expect(identity(again)).toBe('claimed');
    expect(usersWritesTo(HER).length).toBe(writesBefore);
    expect(audits('edit_phone')).toHaveLength(1);
  });

  test('E13: Yes, then back and No before Finish: nothing moves', async () => {
    world();
    await asked();
    await answer('yes');
    await answer('no');
    const done = await finish();
    expect(identity(done)).toBe('none');
    expect(audits()).toEqual([]);
    expect(row(REC).phone_number).toBe(fx(247));
  });

  test('E14: the number write is refused after her new account was retired: her account is put back, then a review',
    async () => {
      world();
      await asked();
      await answer('yes');
      mockDb.refuse = (table, op, patch, where) => table === 'users' && op === 'update' && patch.phone_number === fx(1)
        && where.some(([, c, v]) => c === 'id' && v === REC);   // the record's number write only, never her put-back
      const done = await finish();
      expect(identity(done)).toBe('review');
      expect(audits('edit_phone')).toEqual([]);
      expect(audits('edit_phone_escalated')[0].detail.reason).toBe('move_failed');
      expect(row(HER)).toMatchObject({ phone_number: fx(1), deleted_at: null, deleted_by: null, registration_completed: true });
      expect(row(REC).phone_number).toBe(fx(247));
    });

  test('E14b: the move throws after her new account was retired: her account is put back too', async () => {
    world();
    await asked();
    await answer('yes');
    mockDb.throwWrite = (table, op, patch, where) => table === 'users' && op === 'update' && patch.phone_number === fx(1)
      && where.some(([, c, v]) => c === 'id' && v === REC);
    const done = await finish();
    expect(done.screen).toBe('SUCCESS');
    expect(row(HER)).toMatchObject({ phone_number: fx(1), deleted_at: null, registration_completed: true });
    expect(row(REC).phone_number).toBe(fx(247));
  });

  test('E15: the database goes down during settle: SUCCESS is still returned and nothing throws', async () => {
    world();
    await asked();
    await answer('yes');
    const realSettle = ItU.settle;
    jest.spyOn(ItU, 'settle').mockImplementation(async (args) => {
      mockDb.down = true;
      try { return await realSettle(args); } finally { mockDb.down = false; }
    });
    const done = await finish();
    expect(done.screen).toBe('SUCCESS');
    expect(identity(done)).toBe('none');
    expect(row(HER)).toMatchObject({ phone_number: fx(1), registration_completed: true });
  });

  test('a v5.1 Finish (no form_rev) never settles and carries no identity param', async () => {
    world();
    const settle = jest.spyOn(ItU, 'settle');
    const done = await finish({ formRev: null });
    expect(settle).not.toHaveBeenCalled();
    expect(done.data.extension_message_response.params).not.toHaveProperty('identity');
  });
});
