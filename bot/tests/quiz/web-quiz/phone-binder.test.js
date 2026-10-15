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
    isAvailable: () => true,
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

function seed({ on = true, students = [], codes = [], bindings = [], ledger } = {}) {
  const db = {
    app_settings: Object.entries(on ? ON : { web_quiz_hub: true }).map(([key, value]) => ({ key, value })),
    students, child_bind_codes: codes, child_phone_bindings: bindings,
    quiz_sessions: [], class_enrollments: [], student_lists: [],
  };
  if (ledger !== false) db.message_ledger = [];
  fake = makeFake(db, { uniques: { child_bind_codes: ['code'] } });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  IdFlags._resetCache();
  HubFlags._resetCache();
}
const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const inserts = (table) => fake.calls.filter((c) => c.table === table && c.op === 'insert');
const reads = (table) => fake.calls.filter((c) => c.table === table);
const sends = () => WhatsApp.sendMessage.mock.calls.length + WhatsApp.sendCtaUrl.mock.calls.length;
const say = async (body, user = { ...UNKNOWN_USER }) => {
  await Ingress.attach(user, PHONE);
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
    expect(events('web_quiz.msg_sent')).toEqual([{ trigger: 'bind_reply', initiated: 'user', to: 'family', usd: 0.015, w: 's' }]);
  });

  test('already bound → renewed, not refused; the same one reply', async () => {
    seed({ students: [student(0)], codes: [code('JUGNU-AB2CD', KIDS[0])], bindings: [binding(KIDS[0])] });
    await say('JUGNU-AB2CD');
    expect(inserts('child_phone_bindings')).toHaveLength(0);
    expect(events('web_quiz.bind_bound')).toEqual([{ via: 'save', kids_n: 1, renewed: true, rebind: false, w: 's' }]);
    expect(sends()).toBe(1);
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
  });

  test.each(['بند', 'سٹاپ', 'اسٹاپ', 'STOP'])('%s is a STOP; a sentence with stop in it is not', async (word) => {
    const Bind = require('../../../shared/services/quiz/web-quiz-bind.service');
    expect(Bind.isStop(word)).toBe(true);
    expect(Bind.isStop(`please ${word} now`)).toBe(false);
    expect(Bind.isStop('ختم')).toBe(false);
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
