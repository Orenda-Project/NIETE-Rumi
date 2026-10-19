'use strict';
/**
 * A finished lesson's picture plays the lesson again (app_settings web_quiz_rewatch_done, default off): the hub JSON says
 * `rewatch_done: true` only when the stored value is the JSON boolean true, and the Videos door (wq-doors.js) then opens
 * a finished lesson's page as a fresh go (again=1: the video first, then "Play again"), never the old finish card.
 * The key rides the hub's ONE batched app_settings read (web-quiz-hub-flags.js KEYS): ON adds no settings read.
 * Off (absent, false, the string 'true', garbage): the hub JSON is today's, key for key.
 * Supabase, Redis and WhatsApp are the boundaries and are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const redis = require('../../../shared/services/cache/railway-redis.service');

const { fixturePhone } = require('./fixture-phone');
const PHONE = fixturePhone(1);
const PORTAL = 'https://portal.example.test';
const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const OTHER = '44444444-4444-4444-8444-000000000009';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const V = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-0000000000${String(n).padStart(2, '0')}`;
const VQ = (n) => `bbbbbbbb-bbbb-4bbb-8bbb-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const future = new Date(Date.now() + 10 * 86400000).toISOString();

let fake;
let db;

function code(id, c, quizId, extra = {}) {
  return { id, code: c, quiz_id: quizId, active: true, expires_at: future, topic: `Topic ${c}`, language: 'en',
    teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(48), ...extra };
}
function sess(id, sc, quizId, status, c, t, at, extra = {}) {
  return { id, share_code_id: sc, quiz_id: quizId, student_id: KID, status, correct_answers: c, total_questions_answered: t,
    mastery_percentage: t ? Math.round((100 * c) / t) : 0, completed_at: status === 'completed' ? at : null, created_at: at, student_class: '3', ...extra };
}
function video(n, subject, chapter, title) {
  return { id: V(n), grade: '3', subject, clean_chapter: chapter, clean_title: title, migration_status: 'done', superseded_by: null, r2_url: null };
}

function seed(over = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }],
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: PHONE, created_at: ago(500) },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, phone: PHONE, created_at: ago(400) },
      { id: OTHER, student_name: 'Other Testwala', self_reported_class: '3', list_id: LIST, is_active: true, phone: fixturePhone(2), created_at: ago(300) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [
      { id: 'q-maths', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: V(2), quiz_source: 'video', status: 'ready' },
      { id: 'q-eng', topic: 'Nouns', subject: 'english', language: 'en', grade: '3', video_id: null },
      { id: 'q-sci', topic: 'Plants', subject: 'science', language: 'en', grade: '3', video_id: null },
      { id: 'q-new', topic: 'Shapes', subject: 'maths', language: 'en', grade: '3', video_id: null },
      { id: 'q-g5', topic: 'Decimals', subject: 'maths', language: 'en', grade: '5', video_id: null },
      ...[1, 3, 4, 5, 6, 7, 8].map((n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `V${n}`, subject: 'x', grade: '3' })),
    ],
    quiz_share_codes: [
      code('sc-maths', 'MATH01', 'q-maths', { created_at: ago(30) }),
      code('sc-eng', 'ENGL01', 'q-eng', { created_at: ago(60) }),
      code('sc-sci', 'SCIE01', 'q-sci', { created_at: ago(90), active: false }),
      code('sc-new', 'NEWQ01', 'q-new', { created_at: ago(5) }),
      code('sc-g5', 'GRD501', 'q-g5', { created_at: ago(2) }),
      code('sc-old', 'OLDQ01', 'q-new', { created_at: ago(24 * 9) }),
    ],
    quiz_sessions: [
      sess('s1', 'sc-maths', 'q-maths', 'completed', 4, 10, ago(30)),
      sess('s2', 'sc-maths', 'q-maths', 'completed', 8, 10, ago(20)),
      sess('s3', 'sc-eng', 'q-eng', 'completed', 6, 8, ago(50)),
      sess('s4', 'sc-sci', 'q-sci', 'completed', 5, 5, ago(80)),
    ],
    student_videos: [
      video(1, 'Maths', 'Addition', 'Adding tens'),
      video(2, 'Maths', 'Fractions', 'Halves'),
      video(3, 'Maths', 'Fractions', 'Quarters'),
      video(4, 'Maths', 'Measurement', 'Length'),
      video(5, 'English', 'Nouns', 'Naming words'),
      video(6, 'English', 'Verbs', 'Doing words'),
      video(7, 'Science', 'Plants', 'Leaves'),
      video(8, 'Maths', 'Fractions', 'Thirds'),
    ],
    ...over,
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = PORTAL;
  delete process.env.WEB_QUIZ_BASE_URL;
  delete process.env.STUDENT_QUIZ_FLOW_ID;
  Hub._resetCache();
  redis._store.clear();
  redis._up = true;
  seed();
});


const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };

// Reads per table, counted at the boundary.
function counting() {
  const n = {};
  const from = supabase.from;
  supabase.from = (t) => { n[t] = (n[t] || 0) + 1; return from(t); };
  return n;
}
const stable = (o) => JSON.parse(JSON.stringify(o));

const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const KEY = 'web_quiz_rewatch_done';

describe('web_quiz_rewatch_done on the hub JSON', () => {
  const again = () => { Hub._resetCache(); Flags._resetCache(); redis._store.clear(); };
  beforeEach(() => Flags._resetCache());

  test('switch on (JSON true): `rewatch_done: true`, and otherwise the switch-off payload key for key', async () => {
    const off = stable(await Hub.hub(T.signHub([KID]), A));
    again();
    db.app_settings.push({ key: KEY, value: true });
    const on = stable(await Hub.hub(T.signHub([KID]), A));
    expect(off).not.toHaveProperty('rewatch_done');
    expect(on.rewatch_done).toBe(true);
    delete on.rewatch_done;
    expect(on).toEqual(off);
  });

  test('switch off (absent, false, the string "true", "false", 1, null, an object): no `rewatch_done` key at all', async () => {
    for (const value of [undefined, false, 'true', 'false', 1, null, { enabled: true }]) {
      again();
      seed({ app_settings: [{ key: 'web_quiz_hub', value: 'true' }, ...(value === undefined ? [] : [{ key: KEY, value }])] });
      const out = stable(await Hub.hub(T.signHub([KID]), A));
      expect([value, 'rewatch_done' in out]).toEqual([value, false]);
    }
  });

  test('with the hub\'s reads started together (web_quiz_hub_fanout on): `rewatch_done: true` too, and off no key', async () => {
    db.app_settings.push({ key: 'web_quiz_hub_fanout', value: true });
    Flags.prime(db.app_settings);
    expect(stable(await Hub.hub(T.signHub([KID]), A))).not.toHaveProperty('rewatch_done');
    again();
    db.app_settings.push({ key: KEY, value: true });
    Flags.prime(db.app_settings);
    expect(Flags.fanoutNow()).toBe(true);
    expect((await Hub.hub(T.signHub([KID]), A)).rewatch_done).toBe(true);
  });

  test('the key rides the hub\'s one batched settings read: the same app_settings reads ON as OFF; KEYS names it', async () => {
    let n = counting();
    await Hub.hub(T.signHub([KID]), A);
    const offReads = n.app_settings || 0;
    again();
    db.app_settings.push({ key: KEY, value: true });
    n = counting();
    expect((await Hub.hub(T.signHub([KID]), A)).rewatch_done).toBe(true);
    expect(n.app_settings || 0).toBe(offReads);
    expect(Flags.KEYS).toContain(KEY);
  });
});
