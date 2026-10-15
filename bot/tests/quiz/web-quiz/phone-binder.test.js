'use strict';
/**
 * The phone binder: a JUGNU- code saves a child's place on a family phone, STOP erases it, the door reads the
 * binding, /quiz opens the same set, the send ledger counts the one reply, and the hub token logs a dropped id.
 * Real door (student-ingress), real binder, real stores; Supabase (in-memory tables that apply filters),
 * Redis (a Map) and the WhatsApp send are the faked boundaries.
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
    // the raw client some readers use (quiz-session getActiveState): JSON strings in the same Map
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false),
  sendReaction: jest.fn(async () => true),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redisService = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const { resolveUx, UX_STRINGS } = require('../../../shared/config/ux-strings');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../../shared/services/student-ingress');
const StudentQuiz = require('../../../shared/services/quiz/student-quiz.service');
const T = require('../../../shared/services/quiz/web-quiz-token');

const PHONE = '920000000611';
const KIDS = ['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003',
  'f0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000006'];
const NAMES = ['Ayesha Testwala', 'Bilal Testwala', 'Chanda Testwala', 'Danish Testwala', 'Erum Testwala', 'Faraz Testwala'];
const UNKNOWN_USER = { id: 'u-family', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };
const TEACHER_USER = { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' };
const ON = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true };
const FIXED_NOW = Date.UTC(2026, 9, 15, 10, 0, 0);

let fake;
const iso = (ms) => new Date(ms).toISOString();
const student = (i, extra = {}) => ({ id: KIDS[i], student_name: NAMES[i], phone: null, list_id: 'list-1', is_active: true,
  status: 'active', self_reported_class: '3', created_at: iso(Date.now() - (10 - i) * 60000), ...extra });
const chatKid = (i) => student(i, { phone: PHONE, list_id: null });
const code = (c, kid, extra = {}) => ({ code: c, canonical_id: kid, minted_at: iso(Date.now() - 60000),
  expires_at: iso(Date.now() + 59 * 60000), used_at: null, outcome: null, ...extra });
const binding = (kid, phone = PHONE, extra = {}) => ({ id: `b-${kid.slice(-2)}-${phone.slice(-3)}`, canonical_id: kid, phone_norm: phone,
  phone_tomb: 'tomb', via: 'save', bound_at: iso(Date.now() - 86400000), expires_at: '2027-03-31T18:59:59.000Z',
  revoked_at: null, revoked_by: null, ...extra });

function seed({ on = true, students = [], codes = [], bindings = [], ledger, classTeachers = [] } = {}) {
  const db = {
    app_settings: Object.entries(on ? ON : { web_quiz_hub: true }).map(([key, value]) => ({ key, value })),
    students, child_bind_codes: codes, child_phone_bindings: bindings,
    quiz_sessions: [], class_enrollments: [], student_lists: [], class_teachers: classTeachers,
  };
  if (ledger !== false) db.message_ledger = [];
  fake = makeFake(db, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  // the ledger's rpc (message_ledger_add) is absent unless a test scripts it: 42883 → the select-then-write path
  fake.rpcResult = { data: null, error: { code: '42883', message: 'function message_ledger_add does not exist' } };
  IdFlags._resetCache();
  HubFlags._resetCache();
  const Ledger = require('../../../shared/services/quiz/message-ledger');
  if (typeof Ledger._resetCap === 'function') Ledger._resetCap();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const inserts = (table) => fake.calls.filter((c) => c.table === table && c.op === 'insert');
const reads = (table) => fake.calls.filter((c) => c.table === table);
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const say = async (body, user = { ...UNKNOWN_USER }) => {
  await Ingress.attach(user, PHONE, { body });
  return Ingress.route({ messageType: 'text', messageBody: body, from: PHONE, user });
};

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redisService.__keys.clear();
  seed();
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('bind, then the door', () => {
  test('bind → /quiz within 10 minutes → phone_bound_page_child (the cached unknown is dropped by the binder)', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    const first = await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    expect(first).toMatchObject({ mode: 'unknown', reason: 'no_student_row' });
    expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(true);

    expect(await say('Keep my place JUGNU-AB2CD')).toBe(true);
    expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(false);
    expect(events('student_ingress.cache_forget')).toEqual([{ why: 'bind', n: 1, w: 's' }]);
    expect(fake.db.child_phone_bindings).toHaveLength(1);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ canonical_id: KIDS[0], phone_norm: PHONE, via: 'save' });
    expect(fake.db.child_bind_codes[0]).toMatchObject({ outcome: 'bound' });

    const second = await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    expect(second).toMatchObject({ persona: 'student', mode: 'student', reason: 'phone_bound_page_child', ids: [KIDS[0]] });
  });

  test('the ONE reply: the saved line with the first name and the page button; bind_bound; ledger bind_reply', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    await say('JUGNU-AB2CD');
    expect(sends()).toBe(1);
    const [to, args] = WhatsApp.sendCtaUrl.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(args.body).toBe(resolveUx('jugnuBindSaved', { language: 'en', params: { name: 'Ayesha' } }));
    expect(args.body).not.toMatch(/Testwala/);
    expect(args.buttonText).toBe('Open my page');
    const token = args.url.split('/h/')[1];
    expect(T.verify(token, 'h').ids).toEqual([KIDS[0]]);
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 1, renewed: false, rebind: false, w: 's' }]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', initiated: 'user', recipient: 'family', count: 1, usd: 0.015, class_id: null })]);
    expect(events('web_quiz.msg_sent')).toEqual([{ trigger: 'bind_reply', initiated: 'user', recipient: 'family', usd: 0.015, cls: null, reason: 'bind', w: 's' }]);
  });

  test('already bound → renewed, not refused; the same one reply', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])], bindings: [binding(KIDS[0])] });
    await say('JUGNU-AB2CD');
    expect(inserts('child_phone_bindings')).toHaveLength(0);
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 1, renewed: true, rebind: false, w: 's' }]);
    expect(sends()).toBe(1);
  });

  test('re-bind prefers the newest erased row of the SAME child on this tombstone over a newer row of another child', async () => {
    const tomb = require('../../../shared/services/quiz/child-phone-bindings.repo').tombOf(PHONE);
    const erased = (kid, id, agoMs, by) => binding(kid, PHONE, { id, phone_norm: null, phone_tomb: tomb, revoked_at: iso(Date.now() - agoMs), revoked_by: by });
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])],
      bindings: [erased(KIDS[0], 'same-old', 7200000, 'page_undo'), erased(KIDS[0], 'same-new', 3600000, 'expiry'), erased(KIDS[1], 'other-newest', 60000, 'stop')] });
    await say('JUGNU-AB2CD');
    expect(fake.db.child_phone_bindings.find((b) => b.phone_norm === PHONE).rebind_of).toBe('same-new');
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 1, renewed: false, rebind: true, rebind_prior: 'expiry', w: 's' }]);
  });

  test('no erased row of the same child → the newest erased row of any child on the phone', async () => {
    const tomb = require('../../../shared/services/quiz/child-phone-bindings.repo').tombOf(PHONE);
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])],
      bindings: [binding(KIDS[1], PHONE, { id: 'other-1', phone_norm: null, phone_tomb: tomb, revoked_at: iso(Date.now() - 60000), revoked_by: 'teacher' })] });
    await say('JUGNU-AB2CD');
    expect(fake.db.child_phone_bindings.find((b) => b.phone_norm === PHONE).rebind_of).toBe('other-1');
    expect(events('web_quiz.bind_bound')[0]).toMatchObject({ rebind: true, rebind_prior: 'teacher' });
  });

  test.each([
    ['no_salt', () => { delete process.env.WQ_TOMB_SALT; }],
    ['db_error', () => { const from = supabase.from; supabase.from = (t) => { const b = from(t); if (t === 'child_phone_bindings') { b.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'down' } }) }) }); } return b; }; }],
  ])('a binding that cannot be written (%s) → code unspent, bind_write_failed at error level, nothing sent', async (reason, breakIt) => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    breakIt();
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(fake.db.child_bind_codes[0]).toMatchObject({ used_at: null, outcome: null });
    expect(events('web_quiz.bind_write_failed')).toEqual([{ reason, w: 's' }]);
    expect(require('../../../shared/utils/logger').logToFile).toHaveBeenCalledWith(expect.stringContaining('binding not written'), expect.anything(), 'error');
    expect(sends()).toBe(0);
    expect(events('web_quiz.bind_bound')).toEqual([]);
  });

  test('the phone\'s tombstone matches → a re-bind with rebind_of and rebind_prior', async () => {
    const tomb = require('../../../shared/services/quiz/child-phone-bindings.repo').tombOf(PHONE);
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])],
      bindings: [binding(KIDS[0], PHONE, { id: 'old-1', phone_norm: null, phone_tomb: tomb, revoked_at: iso(Date.now() - 3600000), revoked_by: 'stop' })] });
    await say('JUGNU-AB2CD');
    const fresh = fake.db.child_phone_bindings.find((b) => b.phone_norm === PHONE);
    expect(fresh.rebind_of).toBe('old-1');
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 1, renewed: false, rebind: true, rebind_prior: 'stop', w: 's' }]);
  });
});

describe('the seven refusals, one by one (no binding row, the code spent where it exists)', () => {
  const noRow = () => expect(fake.db.child_phone_bindings.filter((b) => b.phone_norm === PHONE && !b.id.startsWith('b-'))).toHaveLength(0);

  test('teacher_phone: a teacher by identity never binds; ONE teacher refusal line; ledger teacher_refusal', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    expect(await say('JUGNU-AB2CD', { ...TEACHER_USER })).toBe(true);
    expect(fake.db.child_phone_bindings).toHaveLength(0);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'teacher_phone', w: 's' }]);
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindTeacherRefused.en]]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'teacher_refusal', recipient: 'teacher', count: 1 })]);
    expect(fake.db.child_bind_codes[0].outcome).toBe('teacher_phone');
  });

  test('code_unknown: never minted → refused, silent (no bot copy)', async () => {
    seed({ students: [student(0)] });
    expect(await say('JUGNU-ZZ2ZZ')).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_unknown', w: 's' }]);
    expect(sends()).toBe(0);
    noRow();
  });

  test('code_used: spent → refused, silent', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { used_at: iso(Date.now() - 1000), outcome: 'bound' })] });
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_used', w: 's' }]);
    expect(sends()).toBe(0);
    noRow();
  });

  test('code_expired: older than 1 hour → refused, spent, silent', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0], { expires_at: iso(Date.now() - 1000) })] });
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'code_expired', w: 's' }]);
    expect(fake.db.child_bind_codes[0].outcome).toBe('code_expired');
    expect(sends()).toBe(0);
    noRow();
  });

  test('child_unknown: the code\'s child is inactive → refused, spent, silent', async () => {
    seed({ students: [student(0, { is_active: false })], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'child_unknown', w: 's' }]);
    expect(fake.db.child_bind_codes[0].outcome).toBe('child_unknown');
    expect(sends()).toBe(0);
    noRow();
  });

  test('max_phones: the child is on 3 other phones → refused, spent, silent', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])],
      bindings: ['920000000701', '920000000702', '920000000703'].map((p) => binding(KIDS[0], p)) });
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'max_phones', w: 's' }]);
    expect(fake.db.child_bind_codes[0].outcome).toBe('max_phones');
    expect(sends()).toBe(0);
    expect(inserts('child_phone_bindings')).toHaveLength(0);
  });

  test('max_kids: a fifth child → refused, no insert, ONE full line, ledger bind_reply', async () => {
    seed({ students: [0, 1, 2, 3].map(chatKid).concat(student(4)), codes: [code('JUGNU-AB2CD', KIDS[4])] });
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'max_kids', kids_n: 4, w: 's' }]);
    expect(inserts('child_phone_bindings')).toHaveLength(0);
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindFullRefused.en]]);
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', count: 1 })]);
  });

  test('a child already in the full set is renewed/bound, not refused', async () => {
    seed({ students: [0, 1, 2, 3].map(chatKid), codes: [code('JUGNU-AB2CD', KIDS[2])] });
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([]);
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 4, renewed: false, rebind: false, w: 's' }]);
  });
});

describe('STOP', () => {
  test('a bound child\'s STOP erases every binding on the phone and replies once', async () => {
    seed({ students: [student(0), student(1)], bindings: [binding(KIDS[0]), binding(KIDS[1]), binding(KIDS[2], '920000000799')] });
    expect(await say('  Stop ')).toBe(true);
    const mine = fake.db.child_phone_bindings.filter((b) => b.id.endsWith('-611'));
    expect(mine.every((b) => b.phone_norm === null && b.revoked_by === 'stop' && b.revoked_at)).toBe(true);
    expect(fake.db.child_phone_bindings.find((b) => b.id.endsWith('-799')).phone_norm).toBe('920000000799');
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindStopped.en]]);
    expect(events('web_quiz.bind_undo')).toEqual([{ via: 'stop', n: 1, audio_n: 0, w: 's' }, { via: 'stop', n: 1, audio_n: 0, w: 's' }]);
    expect(events('web_quiz.audio_purge_requested')).toEqual([{ n: 2, reason: 'stop', w: 's' }]);
    expect(events('student_ingress.cache_forget')).toEqual([{ why: 'stop', n: 1, w: 's' }]);
    expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(false);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', count: 1 })]);
    expect(events('web_quiz.msg_sent')).toEqual([expect.objectContaining({ trigger: 'bind_reply', reason: 'stop', w: 's' })]);
  });

  test.each(['بند', 'سٹاپ', 'اسٹاپ', 'STOP'])('%s is a STOP; a sentence with stop in it is not', async (word) => {
    const Bind = require('../../../shared/services/quiz/web-quiz-bind.service');
    expect(Bind.isStop(word)).toBe(true);
    expect(Bind.isStop(`please ${word} now`)).toBe(false);
    expect(Bind.isStop('ختم')).toBe(false);
  });

  test('a chat child with an adaptive quiz in flight types "stop" → bindings untouched, route false (the quiz handler ends the quiz)', async () => {
    seed({ students: [chatKid(0)], bindings: [binding(KIDS[1])] });
    redisService.__keys.set(`quiz:student:${PHONE}:active`, { quizId: 'q-1', currentQuestion: 2 });
    expect(await say('stop')).toBe(false);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: PHONE, revoked_at: null });
    expect(sends()).toBe(0);
    expect(events('web_quiz.bind_undo')).toEqual([]);
  });

  test('the same chat child with no quiz in flight types "stop" → erased, ONE stopped line', async () => {
    seed({ students: [chatKid(0)], bindings: [binding(KIDS[1])] });
    expect(await say('stop')).toBe(true);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: null, revoked_by: 'stop' });
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindStopped.en]]);
  });

  test('a phone with only an erased (tombstoned) row and a chat quiz in flight types "stop" → route false, nothing sent', async () => {
    const tomb = require('../../../shared/services/quiz/child-phone-bindings.repo').tombOf(PHONE);
    seed({ students: [], bindings: [binding(KIDS[0], PHONE, { phone_norm: null, phone_tomb: tomb, revoked_at: iso(Date.now() - 60000), revoked_by: 'page_undo' })] });
    redisService.__keys.set(`quiz:student:${PHONE}:active`, { quizId: 'q-1', currentQuestion: 1 });
    expect(await say('stop')).toBe(false);
    expect(sends()).toBe(0);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('a chat child with nothing saved: STOP → ONE "nothing was saved" line', async () => {
    seed({ students: [chatKid(0)] });
    expect(await say('stop')).toBe(true);
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindStopNothing.en]]);
  });

  test('STOP from a teacher phone with no bindings → untouched (route returns false, nothing sent, nothing written)', async () => {
    seed({ students: [] });
    expect(await say('stop', { ...TEACHER_USER })).toBe(false);
    expect(sends()).toBe(0);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('STOP from a teacher phone that holds a binding row → erased, ONE stopped line', async () => {
    seed({ students: [], bindings: [binding(KIDS[0])] });
    expect(await say('stop', { ...TEACHER_USER })).toBe(true);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: null, revoked_by: 'stop' });
    expect(WhatsApp.sendMessage.mock.calls).toEqual([[PHONE, UX_STRINGS.jugnuBindStopped.en]]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', recipient: 'teacher' })]);
  });

  test('a teacher claim on a child phone erases its bindings (teacher_claim) and forgets the verdict', async () => {
    seed({ students: [chatKid(0)], bindings: [binding(KIDS[1])] });
    const user = { ...UNKNOWN_USER };
    expect(await say('/register', user)).toBe(false);
    expect(fake.db.child_phone_bindings[0]).toMatchObject({ phone_norm: null, revoked_by: 'teacher_claim' });
    expect(events('student_ingress.cache_forget')).toEqual([{ why: 'teacher_claim', n: 1, w: 's' }]);
  });
});

describe('a class teacher\'s own phone is a teacher\'s (class_teachers, counted only with the switch on)', () => {
  const ct = (extra = {}) => ({ id: 'ct-1', class_id: 'c-1', teacher_user_id: UNKNOWN_USER.id, is_active: true, ...extra });

  test('chat sittings on the phone AND an active class_teachers row → teacher/activity; a JUGNU- code → teacher_phone', async () => {
    seed({ students: [chatKid(0)], codes: [code('JUGNU-AB2CD', KIDS[1])], classTeachers: [ct()] });
    expect(await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE })).toEqual({ persona: null, mode: 'teacher', reason: 'activity', language: null, studentClass: null });
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'teacher_phone', w: 's' }]);
    expect(fake.db.child_phone_bindings).toHaveLength(0);
  });

  test('a bound phone whose user is an active class teacher → teacher/activity, never phone_bound_page_child', async () => {
    seed({ students: [], bindings: [binding(KIDS[0])], classTeachers: [ct()] });
    expect(await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE })).toMatchObject({ mode: 'teacher', reason: 'activity' });
  });

  test('an inactive class_teachers row does not count', async () => {
    seed({ students: [chatKid(0)], classTeachers: [ct({ is_active: false })] });
    expect(await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE })).toMatchObject({ mode: 'student', reason: 'no_identity_quiz_joined' });
  });

  test('golden: switch off → today\'s child verdict, and class_teachers is never read', async () => {
    seed({ on: false, students: [chatKid(0)], classTeachers: [ct()] });
    expect(await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE })).toEqual({ persona: 'student', mode: 'student', reason: 'no_identity_quiz_joined', language: null, studentClass: '3' });
    expect(reads('class_teachers')).toHaveLength(0);
  });
});

describe('one set at the door and at /quiz open', () => {
  test('1 bound roster child + 4 chat children: the binder counts 5, open sends the same set (4 kept, 1 dropped, kids 5)', async () => {
    seed({ students: [student(0), ...[1, 2, 3, 4].map(chatKid), student(5)], bindings: [binding(KIDS[0])], codes: [code('JUGNU-AB2CD', KIDS[5])] });
    const Repo = require('../../../shared/services/quiz/child-phone-bindings.repo');
    const set = (await Repo.childrenForPhone(PHONE)).map((k) => k.id);
    expect(set).toHaveLength(5);
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'max_kids', kids_n: 5, w: 's' }]);

    jest.clearAllMocks();
    await StudentQuiz.open(PHONE, { language: 'en' });
    const token = WhatsApp.sendCtaUrl.mock.calls[0][1].url.split('/h/')[1];
    expect(T.verify(token, 'h').ids).toEqual(set.slice(0, 4));
    expect(events('web_quiz.token_ids_dropped')).toEqual([{ n: 1, kept: 4, caller: 'hub_link', w: 's' }]);
    expect(events('student_quiz.opened')).toEqual([{ how: 'hub', kids: 5 }]);
  });
});

describe('the /quiz Home reply is on the ledger and under the cap (phone bind on)', () => {
  const Ledger = () => require('../../../shared/services/quiz/message-ledger');
  const Repo = () => require('../../../shared/services/quiz/child-phone-bindings.repo');

  test('a known child\'s /quiz → ONE hub reply, recorded as home_reply{reason:home} with the phone BEFORE the send', async () => {
    seed({ students: [chatKid(0)] });
    expect(await StudentQuiz.open(PHONE, { language: 'en' })).toBe(true);
    expect(WhatsApp.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'home_reply', recipient: 'family', count: 1 })]);
    expect(events('web_quiz.msg_sent')).toEqual([expect.objectContaining({ trigger: 'home_reply', reason: 'home', w: 's' })]);
    const day = Ledger().pktDay(new Date());
    expect([...redisService.__keys.keys()].filter((k) => String(k).startsWith('wq:reply_cap:'))).toEqual([`wq:reply_cap:${day}:${Repo().ukeyOf(PHONE)}`]);
  });

  test('a phone at its daily cap: /quiz is handled, nothing is sent, reply_capped{home_reply}', async () => {
    seed({ students: [chatKid(0)] });
    redisService.__keys.set(`wq:reply_cap:${Ledger().pktDay(new Date())}:${Repo().ukeyOf(PHONE)}`, 8);
    expect(await StudentQuiz.open(PHONE, { language: 'en' })).toBe(true);
    expect(WhatsApp.sendCtaUrl).not.toHaveBeenCalled();
    expect(fake.db.message_ledger).toEqual([]);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'home_reply', w: 's' }]);
  });

  test('switch off → no ledger row, no cap key: the reply is exactly today\'s', async () => {
    seed({ on: false, students: [chatKid(0)] });
    await StudentQuiz.open(PHONE, { language: 'en' });
    expect(WhatsApp.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(fake.db.message_ledger).toEqual([]);
    expect([...redisService.__keys.keys()].filter((k) => String(k).startsWith('wq:reply_cap:'))).toEqual([]);
  });

  test('WQ_TOMB_SALT unset → phoneBind reads false: a JUGNU- code is not taken, nothing is sent, nothing written', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    delete process.env.WQ_TOMB_SALT;
    require('../../../shared/services/quiz/web-quiz-identity-flags')._resetCache();
    expect((await require('../../../shared/services/quiz/web-quiz-identity-flags').flags()).phoneBind).toBe(false);
    expect(await say('JUGNU-AB2CD')).toBe(false);
    expect(sends()).toBe(0);
    expect(inserts('child_phone_bindings')).toHaveLength(0);
  });
});

describe('the token slice and the ledger', () => {
  test('token_ids_dropped{n:1} at 5 ids; the slice is unchanged', () => {
    const t = T.signHub(KIDS.slice(0, 5));
    expect(T.verify(t, 'h').ids).toEqual(KIDS.slice(0, 4));
    expect(events('web_quiz.token_ids_dropped')).toEqual([{ n: 1, kept: 4, caller: 'hub_link', w: 's' }]);
    T.signHub(KIDS, 'binder');
    expect(events('web_quiz.token_ids_dropped')[1]).toEqual({ n: 2, kept: 4, caller: 'binder', w: 's' });
  });

  test('two records the same PKT day → one row, count 2, usd 0.03', async () => {
    const Ledger = require('../../../shared/services/quiz/message-ledger');
    expect(await Ledger.record({ trigger: 'bind_reply' })).toBe(true);
    expect(await Ledger.record({ trigger: 'bind_reply' })).toBe(true);
    expect(fake.db.message_ledger).toHaveLength(1);
    expect(fake.db.message_ledger[0]).toMatchObject({ trigger: 'bind_reply', count: 2, usd: 0.03, class_id: null, initiated: 'user', recipient: 'family' });
    expect(events('web_quiz.msg_sent')).toHaveLength(2);
  });

  test('with message_ledger_add present: ONE rpc, no select/update/insert on the table; msg_sent carries recipient and cls', async () => {
    const Ledger = require('../../../shared/services/quiz/message-ledger');
    fake.rpcResult = { data: 3, error: null };
    const now = new Date('2026-10-15T20:30:00Z');                   // 01:30 PKT on 16 Oct
    expect(await Ledger.record({ trigger: 'home_reply', count: 2, now })).toBe(true);
    expect(fake.rpcs).toEqual([{ name: 'message_ledger_add', args: { p_day: '2026-10-16', p_trigger: 'home_reply', p_class_id: null, p_initiated: 'user', p_recipient: 'family', p_n: 2, p_usd_each: 0.015 } }]);
    expect(fake.calls.filter((c) => c.table === 'message_ledger')).toEqual([]);
    expect(events('web_quiz.msg_sent')).toEqual([{ trigger: 'home_reply', initiated: 'user', recipient: 'family', usd: 0.03, cls: null, w: 's' }]);
  });

  test('usdEach: passed to the rpc as p_usd_each and used by the fallback (usd = usdEach × count)', async () => {
    const Ledger = require('../../../shared/services/quiz/message-ledger');
    expect(await Ledger.record({ trigger: 'bind_reply', usdEach: 0.012 })).toBe(true);
    expect(fake.rpcs[0].args).toMatchObject({ p_usd_each: 0.012, p_n: 1 });
    expect(fake.db.message_ledger[0]).toMatchObject({ count: 1, usd: 0.012 });
    expect(events('web_quiz.msg_sent')[0]).toMatchObject({ usd: 0.012 });
    fake.rpcResult = { data: 1, error: null };
    await Ledger.record({ trigger: 'home_reply' });
    expect(fake.rpcs[1].args).toMatchObject({ p_usd_each: 0.015 });
  });

  test('42883 (function missing) → today\'s select-then-write path', async () => {
    const Ledger = require('../../../shared/services/quiz/message-ledger');
    expect(await Ledger.record({ trigger: 'bind_reply' })).toBe(true);
    expect(fake.rpcs.map((r) => r.name)).toEqual(['message_ledger_add']);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', count: 1 })]);
  });

  test('a client without rpc → today\'s path; any other rpc error → false, nothing written twice', async () => {
    const Ledger = require('../../../shared/services/quiz/message-ledger');
    supabase.rpc = undefined;
    expect(await Ledger.record({ trigger: 'bind_reply' })).toBe(true);
    expect(fake.db.message_ledger).toHaveLength(1);
    supabase.rpc = fake.rpc;
    fake.rpcResult = { data: null, error: { code: '57014', message: 'timeout' } };
    expect(await Ledger.record({ trigger: 'bind_reply' })).toBe(false);
    expect(fake.db.message_ledger[0].count).toBe(1);
  });

  test('an unknown trigger, or bot → family, is never recorded; a missing table returns false', async () => {
    const Ledger = require('../../../shared/services/quiz/message-ledger');
    expect(await Ledger.record({ trigger: 'nope' })).toBe(false);
    expect(await Ledger.record({ trigger: 'home_reply', initiated: 'bot', recipient: 'family' })).toBe(false);
    supabase.from = () => ({ select() { return this; }, eq() { return this; }, is() { return this; }, limit: async () => ({ data: null, error: { code: '42P01', message: 'missing' } }) });
    expect(await Ledger.record({ trigger: 'bind_reply' })).toBe(false);
    expect(events('web_quiz.msg_sent')).toHaveLength(0);
  });

  test('ukeyOf = hex(HMAC(WEB_QUIZ_KID_KEY, "ukey|"+phone_norm))[0:16]; null without the key', () => {
    const Bind = require('../../../shared/services/quiz/web-quiz-bind.service');
    const want = require('crypto').createHmac('sha256', 'unit-kid-key-not-a-secret').update(`ukey|${PHONE}`).digest('hex').slice(0, 16);
    expect(Bind.ukeyOf(`+${PHONE}`)).toBe(want);
    delete process.env.WEB_QUIZ_KID_KEY;
    expect(Bind.ukeyOf(PHONE)).toBeNull();
  });

  test('ukey rides on an unknown phone\'s decision only, with correlationId nulled', async () => {
    seed({ students: [] });
    await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    const [d] = events('student_ingress.decided');
    expect(d).toMatchObject({ reason: 'no_student_row', correlationId: null });
    expect(d.ukey).toMatch(/^[0-9a-f]{16}$/);
  });

  test('every bot.bind button is ≤ 20 code points; every key has en and ur', () => {
    ['jugnuBindSaved', 'jugnuBindOpenBtn', 'jugnuBindTeacherRefused', 'jugnuBindFullRefused', 'jugnuBindStopped', 'jugnuBindStopNothing']
      .forEach((k) => { expect(UX_STRINGS[k].en).toBeTruthy(); expect(UX_STRINGS[k].ur).toBeTruthy(); });
    ['en', 'ur'].forEach((l) => expect([...resolveUx('jugnuBindOpenBtn', { language: l })].length).toBeLessThanOrEqual(20));
  });
});

describe('goldens: switch off → the original path (snapshots taken from the code before this change)', () => {
  test('unknown phone → the no_student_row verdict, deep-equal; no binding read; the decision event as today', async () => {
    seed({ on: false, students: [] });
    const v = await Ingress.classify({ user: UNKNOWN_USER, phone: PHONE });
    expect(v).toEqual({ persona: null, mode: 'unknown', reason: 'no_student_row', language: null, studentClass: null });
    expect(reads('child_phone_bindings')).toHaveLength(0);
    expect(events('student_ingress.decided')).toEqual([{ mode: 'unknown', reason: 'no_student_row', userId: 'u-family' }]);
  });

  test('a teacher phone (identity) with a binding row → still teacher/identity, switch off and on', async () => {
    for (const on of [false, true]) {
      redisService.__keys.clear();
      seed({ on, bindings: [binding(KIDS[0])] });
      expect(await Ingress.classify({ user: TEACHER_USER, phone: PHONE })).toEqual({ persona: null, mode: 'teacher', reason: 'identity', language: null, studentClass: null });
    }
  });

  test('a chat child\'s /quiz → the same cta_url args', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    seed({ on: false, students: [chatKid(0), chatKid(1)] });
    await StudentQuiz.open(PHONE, { language: 'en' });
    expect(WhatsApp.sendCtaUrl.mock.calls).toMatchSnapshot();
    expect(events('student_quiz.opened')).toMatchSnapshot();
  });

  test('signHub with ≤ 4 ids → the same token', () => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    expect([T.signHub(KIDS.slice(0, 1)), T.signHub(KIDS.slice(0, 4)), T.signHub([KIDS[0], KIDS[0], KIDS[1]])]).toMatchSnapshot();
    expect(events('web_quiz.token_ids_dropped')).toEqual([]);
  });

  test('switch off: a JUGNU- message and STOP from a teacher are not taken (route false, nothing sent)', async () => {
    seed({ on: false, students: [], codes: [code('JUGNU-AB2CD', KIDS[0])], bindings: [binding(KIDS[0])] });
    expect(await say('JUGNU-AB2CD', { ...TEACHER_USER })).toBe(false);
    expect(await say('stop', { ...TEACHER_USER })).toBe(false);
    expect(sends()).toBe(0);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
});

describe('the STOP reply says the phone link only (STOP deletes no reading, so no reply may claim one)', () => {
  const PHONE_ONLY = {
    en: 'Done. Jugnu has removed this phone number from the children\'s names it was saved with. Send /quiz any time to start again.',
    ur: 'ہو گیا۔ جگنو نے یہ فون نمبر بچوں کے ناموں سے ہٹا دیا ہے۔ دوبارہ شروع کرنے کے لیے کسی بھی وقت ⁦/quiz⁩ بھیجیں۔',
  };

  test.each(['en', 'ur'])('the STOP reply (%s) contains none of deleted / readings / ریکارڈنگ / مٹا', async (lang) => {
    seed({ students: [], bindings: [binding(KIDS[0])] });
    expect(await say('stop', { ...TEACHER_USER, preferred_language: lang })).toBe(true);
    const [[, text]] = WhatsApp.sendMessage.mock.calls;
    expect(text).toBe(resolveUx('jugnuBindStopped', { language: lang }));
    ['deleted', 'readings', 'ریکارڈنگ', 'مٹا'].forEach((w) => expect(text).not.toContain(w));
  });

  test('the STOP line is the phone-only line, word for word, isolates included', () => {
    expect(UX_STRINGS.jugnuBindStopped.en).toBe(PHONE_ONLY.en);
    expect(UX_STRINGS.jugnuBindStopped.ur).toBe(PHONE_ONLY.ur);
  });
});

describe('the reply cap: 8 replies per phone per PKT day, counted when the bot decides to send', () => {
  const Ledger = () => require('../../../shared/services/quiz/message-ledger');
  const Bind = () => require('../../../shared/services/quiz/web-quiz-bind.service');
  const Repo = () => require('../../../shared/services/quiz/child-phone-bindings.repo');
  const capKeys = () => [...redisService.__keys.keys()].filter((k) => String(k).startsWith('wq:reply_cap:'));
  const setCap = (value) => fake.db.app_settings.push({ key: 'web_quiz_reply_cap_per_phone', value });
  const logged = (text) => require('../../../shared/utils/logger').logToFile.mock.calls.filter(([m]) => String(m).includes(text));
  const stops = async (n) => { for (let i = 0; i < n; i += 1) expect(await say('stop')).toBe(true); };

  test('8 replies on one phone in one PKT day are sent and counted; the 9th is not sent, not counted; reply_capped once', async () => {
    seed({ students: [chatKid(0)] });
    await stops(9);
    expect(WhatsApp.sendMessage).toHaveBeenCalledTimes(8);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', count: 8 })]);
    expect(events('web_quiz.msg_sent')).toHaveLength(8);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'bind_reply', w: 's' }]);
  });

  test('the Redis key holds the keyed hash, never the phone; the first count sets a 48-hour TTL', async () => {
    seed({ students: [chatKid(0)] });
    await stops(2);
    const keys = capKeys();
    expect(keys).toEqual([`wq:reply_cap:${Ledger().pktDay(new Date())}:${Bind().ukeyOf(PHONE)}`]);
    for (let i = 0; i + 5 <= PHONE.length; i += 1) expect(keys[0]).not.toContain(PHONE.slice(i, i + 5));
    expect(redisService.expire.mock.calls).toEqual([[keys[0], 172800]]);
    expect(events('web_quiz.reply_capped')).toEqual([]);
  });

  test('no kid key → the tombstone hash keys the count; neither → no cap, "reply cap unkeyed" logged once', async () => {
    seed({ students: [chatKid(0)] });
    delete process.env.WEB_QUIZ_KID_KEY;
    await stops(1);
    expect(capKeys()).toEqual([`wq:reply_cap:${Ledger().pktDay(new Date())}:${Repo().tombOf(PHONE)}`]);
    redisService.__keys.clear();
    delete process.env.WQ_TOMB_SALT;
    await stops(10);
    expect(capKeys()).toEqual([]);
    expect(WhatsApp.sendMessage).toHaveBeenCalledTimes(11);
    expect(logged('reply cap unkeyed')).toHaveLength(1);
    expect(events('web_quiz.reply_capped')).toEqual([]);
  });

  test('app_settings web_quiz_reply_cap_per_phone = 3 → the 4th reply is capped', async () => {
    seed({ students: [chatKid(0)] });
    setCap(3);
    await stops(4);
    expect(WhatsApp.sendMessage).toHaveBeenCalledTimes(3);
    expect(fake.db.message_ledger[0].count).toBe(3);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'bind_reply', w: 's' }]);
  });

  test.each([['3', 3], ['"2"', 2], ['x', 8], [null, 8], [2.5, 8], [0, 1], [-2, 1]])('cap value %p → %i replies, then false', async (value, cap) => {
    seed();
    setCap(value);
    const out = [];
    for (let i = 0; i <= cap; i += 1) out.push(await Ledger().record({ trigger: 'bind_reply', phone: PHONE }));
    expect(out).toEqual([...Array(cap).fill(true), false]);
  });

  test('Redis incr fails (null) → fail open: every reply sent and counted, logged once', async () => {
    seed({ students: [chatKid(0)] });
    const real = redisService.incr.getMockImplementation();
    redisService.incr.mockImplementation(async () => null);
    try {
      await stops(10);
    } finally {
      redisService.incr.mockImplementation(real);
    }
    expect(WhatsApp.sendMessage).toHaveBeenCalledTimes(10);
    expect(fake.db.message_ledger[0].count).toBe(10);
    expect(events('web_quiz.reply_capped')).toEqual([]);
    expect(logged('reply cap: redis')).toHaveLength(1);
  });

  test('no phone → no cap: the ledger\'s other callers are unchanged', async () => {
    seed();
    setCap(1);
    for (let i = 0; i < 3; i += 1) expect(await Ledger().record({ trigger: 'home_reply' })).toBe(true);
    expect(redisService.incr).not.toHaveBeenCalled();
    expect(fake.db.message_ledger[0].count).toBe(3);
  });

  test('the count comes before the send; a send that fails after a counted record is still counted', async () => {
    seed({ students: [chatKid(0)] });
    WhatsApp.sendMessage.mockImplementationOnce(async () => false);
    expect(await say('stop')).toBe(true);
    expect(redisService.incr.mock.invocationCallOrder[0]).toBeLessThan(WhatsApp.sendMessage.mock.invocationCallOrder[0]);
    expect(fake.db.message_ledger).toEqual([expect.objectContaining({ trigger: 'bind_reply', count: 1 })]);
  });

  test('with a phone, a ledger that cannot write never silences an uncapped reply', async () => {
    seed({ students: [chatKid(0)] });
    fake.rpcResult = { data: null, error: { code: '57014', message: 'timeout' } };
    expect(await say('stop')).toBe(true);
    expect(WhatsApp.sendMessage).toHaveBeenCalledTimes(1);
    expect(events('web_quiz.msg_sent')).toEqual([]);
    expect(events('web_quiz.ledger_write_failed')).toEqual([{ trigger: 'bind_reply', w: 's' }]);
    // logged once per process: a second failure adds no second event
    redisService.__keys.delete(Ingress.CACHE_KEY(PHONE));
    expect(await say('stop')).toBe(true);
    expect(events('web_quiz.ledger_write_failed')).toHaveLength(1);
  });

  test('msg_sent names the reason of the reply: renew, stop_nothing, max_kids, teacher_phone; a plain record() carries none', async () => {
    const reasons = () => events('web_quiz.msg_sent').map((e) => e.reason);
    seed({ students: [chatKid(0)] });
    await say('stop');                                                           // nothing saved → stop_nothing
    expect(reasons()).toEqual(['stop_nothing']);
    jest.clearAllMocks(); redisService.__keys.clear();   // a fresh door verdict for each step
    seed({ students: [student(0)], bindings: [binding(KIDS[0])], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    await say('JUGNU-AB2CD');                                                    // already bound → renew
    expect(reasons()).toEqual(['renew']);
    jest.clearAllMocks(); redisService.__keys.clear();   // a fresh door verdict for each step
    seed({ students: [0, 1, 2, 3].map(chatKid).concat(student(4)), codes: [code('JUGNU-AB2CD', KIDS[4])] });
    await say('JUGNU-AB2CD');                                                    // fifth child → max_kids
    expect(reasons()).toEqual(['max_kids']);
    jest.clearAllMocks(); redisService.__keys.clear();   // a fresh door verdict for each step
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    await say('JUGNU-AB2CD', { ...TEACHER_USER });                                // a teacher by identity → teacher_phone
    expect(reasons()).toEqual(['teacher_phone']);
    jest.clearAllMocks(); redisService.__keys.clear();   // a fresh door verdict for each step
    seed({});
    expect(await Ledger().record({ trigger: 'home_reply' })).toBe(true);
    expect(events('web_quiz.msg_sent')[0]).not.toHaveProperty('reason');
  });

  test('a JUGNU- code on a phone at its cap: the place is saved, no reply is sent, reply_capped{bind_reply}', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    setCap(1);
    expect(await Ledger().record({ trigger: 'home_reply', phone: PHONE })).toBe(true);
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(fake.db.child_phone_bindings).toEqual([expect.objectContaining({ canonical_id: KIDS[0], phone_norm: PHONE })]);
    expect(sends()).toBe(0);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'bind_reply', w: 's' }]);
  });

  test('a teacher phone at its cap: refused, no line sent, reply_capped{teacher_refusal}', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])] });
    setCap(1);
    await Ledger().record({ trigger: 'home_reply', phone: PHONE });
    expect(await say('JUGNU-AB2CD', { ...TEACHER_USER })).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'teacher_phone', w: 's' }]);
    expect(sends()).toBe(0);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'teacher_refusal', w: 's' }]);
  });

  test('a fifth-child code on a phone at its cap: refused, no full line sent', async () => {
    seed({ students: [0, 1, 2, 3].map(chatKid).concat(student(4)), codes: [code('JUGNU-AB2CD', KIDS[4])] });
    setCap(1);
    await Ledger().record({ trigger: 'home_reply', phone: PHONE });
    expect(await say('JUGNU-AB2CD')).toBe(true);
    expect(events('web_quiz.bind_refused')).toEqual([{ reason: 'max_kids', kids_n: 4, w: 's' }]);
    expect(sends()).toBe(0);
    expect(events('web_quiz.reply_capped')).toEqual([{ trigger: 'bind_reply', w: 's' }]);
  });
});

describe('no ukey on a decision whose request carries a binding event', () => {
  const ukey = () => require('crypto').createHmac('sha256', 'unit-kid-key-not-a-secret').update(`ukey|${PHONE}`).digest('hex').slice(0, 16);

  test.each(['JUGNU-ABCDE', 'Keep my place JUGNU-ABCDE'])('unknown phone + %p → decided carries no ukey and no correlationId', async (body) => {
    seed({ students: [] });
    await Ingress.attach({ ...UNKNOWN_USER }, PHONE, { body });
    expect(events('student_ingress.decided')).toEqual([{ mode: 'unknown', reason: 'no_student_row', userId: 'u-family' }]);
  });

  test.each(['STOP', ' بند '])('unknown phone + %p → decided carries no ukey and no correlationId', async (body) => {
    seed({ students: [] });
    await Ingress.attach({ ...UNKNOWN_USER }, PHONE, { body });
    expect(events('student_ingress.decided')).toEqual([{ mode: 'unknown', reason: 'no_student_row', userId: 'u-family' }]);
  });

  test('unknown phone + /quiz → ukey present, correlationId null (unchanged)', async () => {
    seed({ students: [] });
    await Ingress.attach({ ...UNKNOWN_USER }, PHONE, { body: '/quiz' });
    expect(events('student_ingress.decided')).toEqual([{ mode: 'unknown', reason: 'no_student_row', userId: 'u-family', ukey: ukey(), correlationId: null }]);
  });

  test('golden: attach(user, phone) with no body → the decision event and the verdict exactly as before', async () => {
    seed({ students: [] });
    const user = await Ingress.attach({ ...UNKNOWN_USER }, PHONE);
    expect(events('student_ingress.decided')).toEqual([{ mode: 'unknown', reason: 'no_student_row', userId: 'u-family', ukey: ukey(), correlationId: null }]);
    expect(user).toMatchObject({ persona: null, personaLanguage: null, personaClass: null, personaReason: 'no_student_row' });
  });

  test('a code body changes only the event: the same verdict, and it is cached', async () => {
    seed({ students: [] });
    const user = await Ingress.attach({ ...UNKNOWN_USER }, PHONE, { body: 'JUGNU-ABCDE' });
    expect(user).toMatchObject({ persona: null, personaReason: 'no_student_row' });
    expect(redisService.__keys.get(Ingress.CACHE_KEY(PHONE))).toEqual({ persona: null, mode: 'unknown', reason: 'no_student_row', language: null, studentClass: null });
  });
});

describe('the binder\'s page link names its builder', () => {
  test('a drop from the saved reply\'s link logs caller "bind"', async () => {
    seed({ students: [0, 1, 2, 3, 4].map(chatKid), codes: [code('JUGNU-AB2CD', KIDS[2])] });
    await say('JUGNU-AB2CD');
    expect(events('web_quiz.bind_bound')[0]).toMatchObject({ kids_n: 5 });
    expect(events('web_quiz.token_ids_dropped')).toEqual([{ n: 1, kept: 4, caller: 'bind', w: 's' }]);
  });
});
