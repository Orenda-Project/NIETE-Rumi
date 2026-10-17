'use strict';
/**
 * /quiz → ONE reply (quiz_one_door), through the REAL openQuizMenu, role resolver, ledger and token signer; only the
 * edges are faked (supabase as a table double, Redis as a Map, the WhatsApp sends, the role menu's sender).
 *
 * Switch OFF: every persona row × typed/menu/home sends exactly what the base sends — the recorded sends are compared
 * byte for byte with tests/first-touch/__goldens__/one-door-off.json, which was RECORDED ON THE BASE (origin/sandbox
 * ad10e50fc) by running this same file there with ONE_DOOR_RECORD=1.
 * Switch ON: every non-child handset gets exactly ONE cta_url to <base>/quiz/go/<token> (no menu, no Flow, no list,
 * no "No lessons yet", no 3-button home); the token carries no phone; a child keeps today's hub reply.
 */
const { fixturePhone, maskFixturePhones } = require('../quiz/web-quiz/fixture-phone');
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-secret-not-a-secret';
process.env.TRANSCRIPT_QUIZ_FLOW_ID = 'flow-1';
delete process.env.QUIZ_MENU_HANDSET_ROUTING;
delete process.env.QUIZ_MENU_LESSON_ROWS;
delete process.env.WQ_TOMB_SALT;
delete process.env.WEB_QUIZ_KID_KEY;

const fs = require('fs');
const path = require('path');
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockSent.push({ kind: 'text', to, text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { mockSent.push({ kind: 'buttons', to, p }); return true; }),
  sendInteractiveMessage: jest.fn(async (to, p) => { mockSent.push({ kind: 'list', to, p }); return true; }),
  sendFlow: jest.fn(async (to, f) => { mockSent.push({ kind: 'flow', to, f: { ...f, flowToken: f.flowToken ? '<flow token>' : f.flowToken } }); return true; }),
  sendCtaUrl: jest.fn(async (to, p) => { mockSent.push({ kind: 'cta', to, p }); return true; }),
  sendTemplate: jest.fn(async () => true),
}));
const mockMenu = jest.fn(async (from, userId, sessionId, lang, user) => { mockSent.push({ kind: 'role_menu', to: from, role: user && user.role }); return true; });
jest.mock('../../shared/services/menu.service', () => ({ sendMenu: (...a) => mockMenu(...a) }));
jest.mock('../../shared/services/quiz/video-quiz.service', () => ({ getActiveState: jest.fn(async () => null) }));
const mockChildOpen = jest.fn(async (phone) => { mockSent.push({ kind: 'child_hub', to: phone }); return true; });
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: (...a) => mockChildOpen(...a) }));

const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const { openQuizMenu } = require('../../shared/services/quiz/quiz-menu-entry.service');
const TeacherHome = require('../../shared/services/quiz/teacher-quiz-home.service');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const Ledger = require('../../shared/services/quiz/message-ledger');
let OneDoorFlags = null;
try { OneDoorFlags = require('../../shared/services/first-touch/one-door.flags'); } catch (_) { /* the base: no such module */ }
let GoToken = null;
try { GoToken = require('../../shared/services/first-touch/go.token'); } catch (_) { /* the base */ }

const GOLDEN = path.join(__dirname, '__goldens__', 'one-door-off.json');
const RECORD = process.env.ONE_DOOR_RECORD === '1';
const onDescribeOff = RECORD ? describe.skip : describe;

const ROW = { registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, preferred_language: 'en' };
// The seven persona rows (+ every role with no quiz of its own: coach, school leader, supervisor, AEO, head). Names are test names ("Testwala").
const PERSONAS = {
  unknown: { user: { id: 'u-unknown', role: null, ...ROW }, phone: fixturePhone(1) },
  child_known: { user: { id: 'u-child', role: null, ...ROW, persona: 'student', personaLanguage: 'en' }, phone: fixturePhone(2) },
  child_bound: { user: { id: 'u-bound', role: null, ...ROW, persona: 'student', personaLanguage: 'ur' }, phone: fixturePhone(3) },
  teacher_lessons: { user: { id: 'u-teach', role: 'teacher', ...ROW, registration_completed: true, name: 'Asma Testwala' }, phone: fixturePhone(4) },
  teacher_none: { user: { id: 'u-none', role: 'teacher', ...ROW, registration_completed: true, name: 'Bilal Testwala' }, phone: fixturePhone(5) },
  coach: { user: { id: 'u-coach', role: 'coach', ...ROW, name: 'Coach Testwala' }, phone: fixturePhone(6) },
  teacher_parent: { user: { id: 'u-tparent', role: 'teacher', ...ROW, school_id: 'sch-1' }, phone: fixturePhone(7) },
  principal: { user: { id: 'u-principal', role: 'principal', ...ROW }, phone: fixturePhone(8) },
  school_leader: { user: { id: 'u-leader', role: 'school_leader', ...ROW, name: 'Lead Testwala' }, phone: fixturePhone(9) },
  supervisor: { user: { id: 'u-super', role: 'supervisor', ...ROW, name: 'Super Testwala' }, phone: fixturePhone(10) },
  aeo: { user: { id: 'u-aeo', role: 'aeo', ...ROW, name: 'Aeo Testwala' }, phone: fixturePhone(11) },
  head: { user: { id: 'u-head', role: 'head', ...ROW, name: 'Head Testwala' }, phone: fixturePhone(12) },
  pilot_named_coach: { user: { id: 'u-pilot', role: 'coach', ...ROW, name: 'Pilot Testwala' }, phone: fixturePhone(13) },
  // a parent known only from a class roster (the child's parent_phone), no users identity: today = an unknown phone
  roster_parent: { user: { id: 'u-family', role: null, ...ROW }, phone: fixturePhone(14) },
};

// The switch's OFF states: absent, false, garbage, and a read that throws — every one is today, byte for byte.
const OFF_STATES = Object.freeze({ absent: undefined, false: 'false', yes: 'yes', one: 1, object: { on: true }, throws: 'THROW' });

function world({ oneDoor = false, ownCap = null, cap = null, offState = 'absent', doorUncapped } = {}) {
  const settings = [{ key: 'teacher_report_teachers', value: JSON.stringify(['u-pilot']) }];
  if (oneDoor) settings.push({ key: 'quiz_one_door', value: 'true' });
  else if (OFF_STATES[offState] !== undefined && OFF_STATES[offState] !== 'THROW') settings.push({ key: 'quiz_one_door', value: OFF_STATES[offState] });
  if (ownCap != null) settings.push({ key: 'web_quiz_own_reply_cap_per_phone', value: String(ownCap) });
  if (cap != null) settings.push({ key: 'web_quiz_reply_cap_per_phone', value: String(cap) });
  if (doorUncapped !== undefined) settings.push({ key: 'web_quiz_door_uncapped', value: doorUncapped });
  mockDb = fakeDb({
    app_settings: settings,
    users: Object.values(PERSONAS).map((p) => ({ ...p.user })),
    lesson_plans: [{ id: 'lp-1', user_id: 'u-teach', topic: 'Fractions', subject: 'Maths', grade: '4', gamma_url: 'https://x', created_at: '2026-10-01T08:00:00Z' }],
    coaching_sessions: [{
      id: 'cs-1', user_id: 'u-teach', observation_type: null, status: 'completed', created_at: '2026-10-01T09:00:00Z',
      transcript_text: 'x'.repeat(5000), analysis_data: { topic: 'Fractions', subject: 'Maths' },
    }],
    quizzes: [], quiz_sessions: [], quiz_share_codes: [],
    student_lists: [{ id: 'l-1', user_id: 't-roster', is_active: true, created_at: new Date().toISOString() }],
    students: [{ id: 'r-1', student_name: 'Ali Testwala', list_id: 'l-1', parent_phone: PERSONAS.roster_parent.phone, is_active: true, status: 'active' }],
    user_feature_first_use: [], child_phone_bindings: [], transcript_quiz_offers: [],
  });
  mockDb.tables.users.push({ id: 't-roster', role: 'teacher', ...ROW, school_id: 'sch-1' });
  if (offState === 'throws') {
    // the switch's own read fails (throws inside the read): the door reads OFF
    const from = mockDb.from.bind(mockDb);
    mockDb.from = (table) => {
      const b = from(table);
      if (table !== 'app_settings') return b;
      const inner = b.in;
      b.in = (c, v) => { if (Array.isArray(v) && v.includes('quiz_one_door')) throw new Error('app_settings read failed'); return inner(c, v); };
      return b;
    };
  }
  if (OneDoorFlags) OneDoorFlags._resetCache();
  Gate._resetCache && Gate._resetCache();
  Ledger._resetCap();
  redis.__keys.clear();
}

async function ask(name, trigger) {
  const p = PERSONAS[name];
  const user = { ...p.user };
  if (trigger === 'home') return TeacherHome.handleHomeButton('tqh_make', p.phone, user);
  return openQuizMenu({ user, from: p.phone, language: 'en', trigger, body: trigger === 'text' ? '/quiz' : '' });
}

beforeEach(() => { mockSent.length = 0; jest.clearAllMocks(); });

// A send without its signed token (the token is time-stamped; its shape is asserted separately).
// (phones masked to their letters form: the repo holds no phone-shaped digit string — tests/setup/phone-shaped-fixtures)
const stable = (sends) => maskFixturePhones(JSON.parse(JSON.stringify(sends).replace(/\/quiz\/go\/[A-Za-z0-9_.-]+/g, '/quiz/go/<t>')));

describe('switch OFF (absent) — every persona × typed/menu/home is byte-identical to the base', () => {
  const recorded = {};
  afterAll(() => {
    if (RECORD) { fs.mkdirSync(path.dirname(GOLDEN), { recursive: true }); fs.writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`); }
  });
  for (const name of Object.keys(PERSONAS)) {
    for (const trigger of ['text', 'menu', 'home']) {
      test(`${name} × ${trigger}`, async () => {
        world();
        await ask(name, trigger);
        const got = stable(mockSent);
        recorded[`${name}|${trigger}`] = got;
        if (!RECORD) expect(got).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))[`${name}|${trigger}`]);
      });
    }
  }
});

onDescribeOff('switch OFF in every state (false, garbage, a read that throws) — the same bytes as absent', () => {
  for (const state of Object.keys(OFF_STATES).filter((k) => k !== 'absent')) {
    for (const name of ['unknown', 'coach', 'teacher_lessons', 'roster_parent', 'child_known']) {
      test(`${state}: ${name} × text`, async () => {
        world({ offState: state });
        await ask(name, 'text');
        expect(stable(mockSent)).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))[`${name}|text`]);
      });
    }
  }
});

const onDescribe = RECORD ? describe.skip : describe;

onDescribe('switch ON — ONE cta_url for every handset that is not a child', () => {
  const NON_CHILD = ['unknown', 'teacher_lessons', 'teacher_none', 'coach', 'teacher_parent', 'principal', 'school_leader', 'supervisor', 'aeo', 'head', 'pilot_named_coach'];
  for (const name of NON_CHILD) {
    for (const trigger of ['text', 'menu', 'home']) {
      test(`${name} × ${trigger} → exactly one cta_url to /quiz/go/<token>; no menu, Flow, list or home buttons`, async () => {
        world({ oneDoor: true });
        const route = await ask(name, trigger);
        if (trigger !== 'home') expect(route).toBe('one_door');
        expect(mockSent).toHaveLength(1);
        expect(mockSent[0].kind).toBe('cta');
        expect(mockSent[0].p.url).toMatch(/^https:\/\/portal\.example\/quiz\/go\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
        expect(mockSent[0].p.url).not.toContain(PERSONAS[name].phone);
        expect([...mockSent[0].p.buttonText].length).toBeLessThanOrEqual(20);
        expect(mockMenu).not.toHaveBeenCalled();
      });
    }
  }

  test('the token: kind go, the side the server decided, an opaque nonce, never the phone or a name', async () => {
    world({ oneDoor: true });
    await ask('coach', 'text');
    const t = mockSent[0].p.url.split('/quiz/go/')[1];
    const v = GoToken.verifyGo(t);
    expect(v.ok).toMatchObject({ k: 'go', uid: 'u-coach', side: 'teacher', lang: 'bi', src: 'typed' });
    expect(v.ok.n).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(v.ok)).not.toContain(PERSONAS.coach.phone);
    expect(JSON.stringify(v.ok)).not.toContain('Testwala');
  });

  test('a coach gets the teacher home link (od.teacher), never the role menu', async () => {
    world({ oneDoor: true });
    await ask('coach', 'text');
    expect(mockSent[0].p.body).toContain('Your quiz home');
    expect(mockSent[0].p.body).toContain('آپ کا کوئز ہوم');
    expect(mockSent[0].p.buttonText).toBe('Open · کھولیں');
  });

  test('an unknown phone gets od.unknown (Urdu when it wrote in Urdu), counted as one_door_reply', async () => {
    world({ oneDoor: true });
    const p = PERSONAS.unknown;
    await openQuizMenu({ user: { ...p.user }, from: p.phone, language: 'en', trigger: 'text', body: 'کوئز' });
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].p.body).toBe('جگنو کا کوئز: ٹیچر اپنی کلاس کو کوئز اور کہانیاں بھیجیں؛ بچے کھیلیں اور پڑھیں۔ کھولنے کے لیے ٹیپ کریں۔ جگنو ایک بات پوچھے گا، پھر آپ کو یاد رکھے گا۔');
    expect(mockSent[0].p.buttonText).toBe('کھولیں');
    expect(logEvent).toHaveBeenCalledWith('onboard.quiz_door', expect.objectContaining({ door: 'text', verdict: 'unknown', reply: 'one_door', lang: 'ur' }));
  });

  test('a parent known only from a class roster → ONE cta_url to /quiz/go/<token> with the child words ("Is it <First>?" on the page)', async () => {
    world({ oneDoor: true });
    await ask('roster_parent', 'text');
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].kind).toBe('cta');
    expect(mockSent[0].p.url).toMatch(/\/quiz\/go\//);
    expect(mockSent[0].p.body).toBe('Your stories, videos and quizzes are here.');
    expect(mockSent[0].p.body).not.toContain('Ali');
  });

  test.each(['child_known', 'child_bound'])('%s keeps today\'s ONE hub reply (StudentQuiz.open), unchanged', async (name) => {
    world({ oneDoor: true });
    const route = await ask(name, 'text');
    expect(route).toBe('child_quizzes');
    expect(mockChildOpen).toHaveBeenCalledTimes(1);
    expect(mockSent).toEqual([{ kind: 'child_hub', to: PERSONAS[name].phone }]);
  });

  test('a refused cta_url → ONE plain text (od.fallback.unknown), no buttons', async () => {
    world({ oneDoor: true });
    require('../../shared/services/whatsapp.service').sendCtaUrl.mockResolvedValueOnce(false);
    await ask('unknown', 'text');
    expect(mockSent.map((m) => m.kind)).toEqual(['text']);
    expect(mockSent[0].text).toContain("Jugnu's quiz opens from a link.");
  });
});

onDescribe('the cap: the one reply is counted on reply_to_own_message, 20 a phone a PKT day', () => {
  test('RED on the base: the 9th /quiz with the shared pool (8) exhausted still gets the ONE cta_url', async () => {
    world({ oneDoor: true });
    const p = PERSONAS.unknown;
    // eight replies the bot already counted today on the shared pool (child Home replies, bind replies …)
    for (let i = 0; i < 8; i += 1) expect(await Ledger.record({ trigger: 'home_reply', phone: p.phone, reason: 'home' })).toBe(true);
    expect(await Ledger.record({ trigger: 'home_reply', phone: p.phone, reason: 'home' })).toBe(false);   // the pool is spent
    await ask('unknown', 'text');
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].kind).toBe('cta');
  });

  test('the 21st /quiz in a PKT day is capped: nothing on WhatsApp, web_quiz.reply_capped{counter}', async () => {
    world({ oneDoor: true });
    for (let i = 0; i < 20; i += 1) await ask('unknown', 'text');
    expect(mockSent).toHaveLength(20);
    await ask('unknown', 'text');
    expect(mockSent).toHaveLength(20);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.reply_capped', expect.objectContaining({ trigger: 'one_door_reply', counter: 'reply_to_own_message' }));
    expect(logEvent).toHaveBeenCalledWith('onboard.quiz_door', expect.objectContaining({ reply: 'capped' }));
  });

  test('the ceiling is the VALUE key web_quiz_own_reply_cap_per_phone', async () => {
    world({ oneDoor: true, ownCap: 2 });
    for (let i = 0; i < 3; i += 1) await ask('coach', 'text');
    expect(mockSent).toHaveLength(2);
  });

  test('switch OFF: an ownReply is capped on the shared pool exactly as today', async () => {
    world({ cap: 2 });
    const phone = PERSONAS.unknown.phone;
    expect(await Ledger.record({ trigger: 'home_reply', phone, reason: 'home', ownReply: true })).toBe(true);
    expect(await Ledger.record({ trigger: 'home_reply', phone, reason: 'home', ownReply: true })).toBe(true);
    expect(await Ledger.record({ trigger: 'home_reply', phone, reason: 'home', ownReply: true })).toBe(false);
  });

  test('the ledger knows the two new triggers; an unknown trigger is still refused', async () => {
    world();
    expect(Ledger.TRIGGERS).toEqual(expect.arrayContaining(['one_door_reply', 'maker_reply']));
    expect(await Ledger.record({ trigger: 'promo_reply', phone: fixturePhone(99) })).toBe(false);
    expect(await Ledger.record({ trigger: 'maker_reply', phone: fixturePhone(99), recipient: 'teacher' })).toBe(true);
  });
});

onDescribe('a /quiz always gets its reply: web_quiz_door_uncapped (JSON true only; absent / unreadable → capped as today)', () => {
  const DOOR_OFF = Object.freeze({ absent: undefined, false: false, string_true: 'true', yes: 'yes', one: 1, object: { on: true } });
  // the ledger's table fallback (no message_ledger_add on the double), so the day's row can be read back
  const ledgerRow = (trigger, recipient = 'family') => (mockDb.tables.message_ledger || []).find((r) => r.trigger === trigger && r.recipient === recipient) || null;
  const withLedger = () => { mockDb.tables.message_ledger = []; mockDb.rpc = async () => ({ error: { code: '42883', message: 'no function' } }); };
  const capped = (trigger) => logEvent.mock.calls.filter(([name, p]) => name === 'web_quiz.reply_capped' && p.trigger === trigger);

  test('RED on the base: 22 /quiz in one PKT day from one phone → 22 replies; the 21st and 22nd are the one cta_url, not silence', async () => {
    world({ oneDoor: true, doorUncapped: true });
    withLedger();
    for (let i = 0; i < 22; i += 1) await ask('unknown', 'text');
    expect(mockSent).toHaveLength(22);
    expect(mockSent.every((m) => m.kind === 'cta')).toBe(true);
    expect(capped('one_door_reply')).toHaveLength(0);
    expect(logEvent).not.toHaveBeenCalledWith('onboard.quiz_door', expect.objectContaining({ reply: 'capped' }));
    // still counted, so the number stays visible: one_door_reply/family = 22, nothing capped
    expect(ledgerRow('one_door_reply')).toEqual(expect.objectContaining({ count: 22 }));
    expect(Number(ledgerRow('one_door_reply').capped) || 0).toBe(0);
  });

  test('switch ON: a known child\'s /quiz (the Home reply) is never capped either', async () => {
    world({ oneDoor: true, doorUncapped: true });
    const phone = PERSONAS.child_known.phone;
    for (let i = 0; i < 21; i += 1) expect(await Ledger.record({ trigger: 'home_reply', phone, reason: 'home', ownReply: true })).toBe(true);
    expect(capped('home_reply')).toHaveLength(0);
  });

  test('switch ON: every OTHER reply to the person\'s own message is still capped at 20 (golden)', async () => {
    world({ oneDoor: true, doorUncapped: true });
    const phone = PERSONAS.unknown.phone;
    const got = [];
    for (let i = 0; i < 21; i += 1) got.push(await Ledger.record({ trigger: 'bind_reply', phone, reason: 'bind', ownReply: true }));
    expect(got.filter(Boolean)).toHaveLength(20);
    expect(got[20]).toBe(false);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.reply_capped', expect.objectContaining({ trigger: 'bind_reply', counter: 'reply_to_own_message' }));
  });

  test('switch ON: the /quiz replies do not spend the other own replies\' 20', async () => {
    world({ oneDoor: true, doorUncapped: true });
    for (let i = 0; i < 25; i += 1) await ask('unknown', 'text');
    const phone = PERSONAS.unknown.phone;
    for (let i = 0; i < 20; i += 1) expect(await Ledger.record({ trigger: 'bind_reply', phone, reason: 'bind', ownReply: true })).toBe(true);
    expect(await Ledger.record({ trigger: 'bind_reply', phone, reason: 'bind', ownReply: true })).toBe(false);
  });

  test('switch ON, quiz_one_door OFF: the shared pool caps exactly as today (the switch acts only on the own counter)', async () => {
    world({ cap: 2, doorUncapped: true });
    const phone = PERSONAS.unknown.phone;
    const got = [];
    for (let i = 0; i < 3; i += 1) got.push(await Ledger.record({ trigger: 'home_reply', phone, reason: 'home', ownReply: true }));
    expect(got).toEqual([true, true, false]);
  });

  test.each(Object.keys(DOOR_OFF))('switch %s → the 21st /quiz is capped, byte for byte as today (golden)', async (state) => {
    world({ oneDoor: true });
    for (let i = 0; i < 22; i += 1) await ask('unknown', 'text');
    const today = stable(mockSent);
    const todayEvents = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.reply_capped' || n === 'onboard.quiz_door');
    mockSent.length = 0; jest.clearAllMocks();
    world({ oneDoor: true, doorUncapped: DOOR_OFF[state] });
    for (let i = 0; i < 22; i += 1) await ask('unknown', 'text');
    expect(mockSent).toHaveLength(20);
    expect(stable(mockSent)).toEqual(today);
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.reply_capped' || n === 'onboard.quiz_door')).toEqual(todayEvents);
    expect(capped('one_door_reply')).toHaveLength(2);
  });

  test('a settings read that throws (the key rides the door\'s ONE read) → the door reads OFF, byte for byte as today (golden)', async () => {
    world({ oneDoor: true, offState: 'throws' });
    for (let i = 0; i < 22; i += 1) await ask('unknown', 'text');
    const today = stable(mockSent);
    const todayEvents = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.reply_capped' || n === 'onboard.quiz_door');
    mockSent.length = 0; jest.clearAllMocks();
    world({ oneDoor: true, offState: 'throws', doorUncapped: true });
    for (let i = 0; i < 22; i += 1) await ask('unknown', 'text');
    expect(stable(mockSent)).toEqual(today);
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.reply_capped' || n === 'onboard.quiz_door')).toEqual(todayEvents);
    expect(mockSent.some((m) => m.kind === 'cta')).toBe(false);
  });
});
