/**
 * "Which teacher did you observe?" — when the teacher is not on the list, the coach types the name.
 *
 * Sandbox E2E, 15 Oct (round 6, record first): the list showed nine teachers ordered by need and the
 * teacher just observed was not among them. Every /observe2 coach on production has more than nine
 * people in their schools (derived roster: median 122, max 218). "Someone else" only said "You can type
 * the name when you send the report", so a held /observe2 visit stayed teacherless: no plan list, no
 * name in the brief, not findable by teacher until the report.
 *
 * Now "Someone else" asks for the name; the next text is matched against the coach's own schools.
 * One clear match binds exactly as a list tap does; several give a list of the matches; none says so,
 * keeps today's fallback, and allows one more try. The wait for the name lives in its own short Redis
 * key, never the observe state, and a slash command is never swallowed.
 *
 * Real: observe-who, the roster derivation (patch-resolver), the /observe2 store and link. Mocked at
 * the boundary: the database (in-memory), Redis, WhatsApp.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockDb;
const mockRedis = new Map();
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const read = (k) => {
    if (!mockRedis.has(k)) return null;
    const v = mockRedis.get(k);
    try { return JSON.parse(v); } catch (_) { return v; }
  };
  return {
    get: jest.fn((k) => Promise.resolve(read(k))),
    setexWithCeiling: jest.fn((k, ttl, v) => { mockRedis.set(k, typeof v === 'string' ? v : JSON.stringify(v)); mockRedis.set(`ttl:${k}`, ttl); return Promise.resolve(true); }),
    delete: jest.fn((k) => { mockRedis.delete(k); return Promise.resolve(true); }),
  };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveWho = require('../../bot/shared/services/observe/observe-who.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en', phone_number: '920000000001' };
const FROM = COACH.phone_number;
const S = observeStrings('en');
const TYPED_KEY = 'observe:who-typed:coach-1';

// Twelve people in the coach's one school (made up). The teacher observed, Rukhsana Kausar, is 11th.
const NAMES = ['Amna Bibi', 'Bushra Naz', 'Farah Deeba', 'Sana Javed', 'Hina Gul', 'Nadia Khan', 'Saima Riaz',
  'Uzma Noor', 'Iram Shah', 'Sana Iqbal', 'Rukhsana Kausar', 'Zainab Ali'];
const person = (name, i) => ({
  id: `t-${i}`, phone_number: `9200000002${String(i).padStart(2, '0')}`, name, role: 'teacher', school_id: 'school-1',
  training_bands: null, grades_taught: null,
});

function seed({ heldForm = true } = {}) {
  mockDb = createFakeSupabase({
    leader_schools: [{ leader_user_id: 'coach-1', school_ext_id: 'niete:9001', school_id: 'school-1' }],
    schools: [{ id: 'school-1', name: 'Test School', emis: '9001' }],
    users: [COACH, ...NAMES.map(person)],
    coaching_sessions: [{ id: 'sess-1', observer_user_id: 'coach-1', user_id: 'coach-1', observation_type: 'leader_observation', status: 'observe2_ready', debrief_status: 'pending', created_at: new Date().toISOString() }],
    observation_field_forms: heldForm
      ? [{ id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: null, coaching_session_id: 'sess-1', visit_context: { recorded_first: true }, answers: {}, photos: [], evidence_review: {}, created_at: new Date().toISOString() }]
      : [],
    observation_schedules: [],
  });
}

const tapOther = () => ObserveWho.handleObservedTeacherPick(COACH, FROM, 'observe_who_sess-1_other');
const type = (text, opts) => ObserveWho.handleTypedTeacherName(COACH, FROM, text, opts);
const said = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
const lists = () => WhatsAppService.sendInteractiveMessage.mock.calls.map((c) => c[1]);
const session = () => mockDb.__tables.coaching_sessions[0];
const form = () => mockDb.__tables.observation_field_forms[0];
const schedules = () => mockDb.__tables.observation_schedules;

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.clear();
  seed();
});

describe('"Someone else" asks for the name', () => {
  test('the tap asks the coach to type the teacher\'s name, and waits for it in its own short key', async () => {
    expect(await tapOther()).toBe(true);
    expect(said()).toEqual([S.who_type_name]);
    expect(said()).not.toContain(S.who_other_ack);
    expect(mockRedis.has(TYPED_KEY)).toBe(true);
    expect(mockRedis.get(`ttl:${TYPED_KEY}`)).toBeLessThanOrEqual(900);
    expect([...mockRedis.keys()].some((k) => k.startsWith('observe:state:'))).toBe(false);
  });

  test('nothing is waited for until "Someone else" is tapped: a text is not taken as a name', async () => {
    expect(await type('Rukhsana Kausar')).toBe(false);
    expect(schedules()).toHaveLength(0);
  });
});

describe('the typed name, matched against the coach\'s own schools', () => {
  test('one clear match binds it as a list tap does: the schedule row, the held form\'s teacher, the owner', async () => {
    await tapOther();
    expect(await type('Rukhsana Kausar')).toBe(true);
    expect(schedules()).toHaveLength(1);
    expect(schedules()[0]).toMatchObject({ leader_user_id: 'coach-1', session_id: 'sess-1', teacher_name: 'Rukhsana Kausar', status: 'done', school_name: 'Test School' });
    expect(form().teacher_user_id).toBe('t-10');
    expect(session().user_id).toBe('t-10');
    expect(said()).toContain(S.who_ack.replace('{name}', 'Rukhsana Kausar'));
    expect(mockRedis.has(TYPED_KEY)).toBe(false);
  });

  test('case, spacing, a title and a common spelling variant still find the teacher', async () => {
    await tapOther();
    expect(await type('  ms.   rukhsanah   KOUSAR ')).toBe(true);
    expect(form().teacher_user_id).toBe('t-10');
  });

  test('several matches: a list of them (with "Someone else"), and a tap binds the one picked', async () => {
    await tapOther();
    expect(await type('sana')).toBe(true);
    expect(schedules()).toHaveLength(0);
    const list = lists()[0];
    const rows = list.action.sections[0].rows;
    // The roster's own order (the derivation sorts by name).
    expect(rows.map((r) => r.title)).toEqual(['Sana Iqbal', 'Sana Javed', S.who_other]);
    expect(rows[1].id).toBe('observe_who_sess-1_m1');
    for (const r of rows) {
      expect([...r.title].length).toBeLessThanOrEqual(24);
      expect([...r.description].length).toBeLessThanOrEqual(72);
    }
    expect(await ObserveWho.handleObservedTeacherPick(COACH, FROM, rows[1].id)).toBe(true);
    expect(form().teacher_user_id).toBe('t-3');
    expect(schedules()[0].teacher_name).toBe('Sana Javed');
  });

  test('more than nine matches: the first nine, plus "Someone else" to type more of the name', async () => {
    mockDb.__tables.users.push(...Array.from({ length: 10 }, (_, i) => person(`Sana Extra${i}`, 20 + i)));
    await tapOther();
    await type('sana');
    const rows = lists()[0].action.sections[0].rows;
    expect(rows).toHaveLength(10);
    expect(rows[9].title).toBe(S.who_other);
  });

  test('no match: the coach is told, and may try once more; then today\'s fallback, and the wait ends', async () => {
    await tapOther();
    expect(await type('Qudsia Perveen')).toBe(true);
    expect(said()).toContain(S.who_name_none_retry.replace('{name}', 'Qudsia Perveen'));
    expect(mockRedis.has(TYPED_KEY)).toBe(true);
    expect(await type('Qudsia P')).toBe(true);
    expect(said()).toContain(S.who_name_none_final.replace('{name}', 'Qudsia P'));
    expect(mockRedis.has(TYPED_KEY)).toBe(false);
    expect(await type('Qudsia')).toBe(false);
    expect(schedules()).toHaveLength(0);
  });

  test('a recording with no /observe2 form (classic /observe) gets the schedule row, as a tap gives it', async () => {
    seed({ heldForm: false });
    await tapOther();
    expect(await type('Rukhsana Kausar')).toBe(true);
    expect(schedules()).toHaveLength(1);
    expect(session().user_id).toBe('coach-1');
  });

  test('matching reads the roster only: never the teachers\' coaching analyses', async () => {
    await tapOther();
    await type('Rukhsana Kausar');
    const fat = mockDb.__calls.find((c) => c.table === 'coaching_sessions' && c.action === 'select' && /analysis_data/.test(String(c.columns)));
    expect(fat).toBeUndefined();
  });
});

describe('what is never taken as a name', () => {
  test.each(['/menu', '/observe2'])('a slash command (%s) is not swallowed, and the wait ends', async (cmd) => {
    await tapOther();
    expect(await type(cmd)).toBe(false);
    expect(mockRedis.has(TYPED_KEY)).toBe(false);
  });

  test('a question or a long message is not a name: it goes on to chat, and the wait ends', async () => {
    await tapOther();
    expect(await type('how do I send the report to the teacher once the debrief is done?')).toBe(false);
    expect(mockRedis.has(TYPED_KEY)).toBe(false);
  });

  test('a later "type the teacher\'s name and number" in the send flow wins over an older "Someone else"', async () => {
    await tapOther();
    const later = new Date(Date.now() + 60000).toISOString();
    expect(await type('Rukhsana Kausar', { otherPromptAt: later })).toBe(false);
    expect(schedules()).toHaveLength(0);
  });
});

describe('copy', () => {
  test.each(['en', 'ur', 'sw'])('the new lines exist in %s', (lang) => {
    const L = observeStrings(lang);
    for (const k of ['who_type_name', 'who_name_matches_body', 'who_name_none_retry', 'who_name_none_final']) {
      expect(typeof L[k]).toBe('string');
      expect([...L[k]].length).toBeLessThanOrEqual(1024);
    }
    expect(L.who_name_none_retry).toContain('{name}');
    expect(L.who_name_none_final).toContain('{name}');
  });

  test('Urdu addresses the coach without gendered verb forms and isolates the typed name', () => {
    const U = observeStrings('ur');
    const text = ['who_type_name', 'who_name_matches_body', 'who_name_none_retry', 'who_name_none_final'].map((k) => U[k]).join(' ');
    expect(text).not.toMatch(/رہی ہیں|رہے ہیں|سکتی ہیں|سکتے ہیں|کرتی ہیں|کرتے ہیں/);
    expect(U.who_name_none_retry).toContain('⁨{name}⁩');
  });
});
