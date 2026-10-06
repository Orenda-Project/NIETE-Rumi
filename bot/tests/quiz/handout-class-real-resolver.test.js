'use strict';
/**
 * The hand-out's class, end to end through the REAL resolver
 * (web-quiz-identity.resolveQuizClass): only the network boundary is faked —
 * supabase (a small table store), redis, whatsapp.service, the logs.
 *
 * The branch-by-branch behaviour lives in handout-class-binding.test.js; this
 * file proves the two modules agree on the shapes that cross between them
 * (state, class.id, label) for the three cases a teacher actually hits.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const share = require('../../shared/services/quiz/video-quiz-share.service');
const HandoutClass = require('../../shared/services/quiz/handout-class.service');

const PHONE = '923000000222';
const TEACHER = '00000000-0000-4000-8000-0000000000a1';
const QUIZ = '00000000-0000-4000-8000-0000000000b1';
const K4A = '00000000-0000-4000-8000-0000000004aa';
const K4B = '00000000-0000-4000-8000-0000000004bb';
const K3B = '00000000-0000-4000-8000-0000000003bb';
const CTX = { quizId: QUIZ, videoId: null, userId: TEACHER, language: 'en' };

let db;
function fakeFrom(table) {
  const q = { op: 'select', payload: null, eq: {}, in: {} };
  const rowsOf = () => {
    let rows = (db.tables[table] || []).filter((r) => Object.entries(q.eq).every(([k, v]) => r[k] === v));
    Object.entries(q.in).forEach(([k, vs]) => { rows = rows.filter((r) => vs.includes(r[k])); });
    return rows;
  };
  const run = async (single) => {
    if (q.op === 'insert') {
      db.inserts.push({ table, payload: q.payload });
      return { data: { id: `11111111-1111-4111-8111-${String(db.inserts.length).padStart(12, '0')}`, code: q.payload.code }, error: null };
    }
    if (q.op === 'update') {
      db.updates.push({ table, payload: q.payload, eq: q.eq });
      return { data: null, error: null };
    }
    const rows = rowsOf();
    return { data: single ? (rows[0] || null) : rows, error: null };
  };
  const api = {
    select() { return api; },
    insert(p) { q.op = 'insert'; q.payload = p; return api; },
    update(p) { q.op = 'update'; q.payload = p; return api; },
    eq(c, v) { q.eq[c] = v; return api; },
    is(c, v) { q.eq[c] = v; return api; },
    in(c, v) { q.in[c] = v; return api; },
    maybeSingle: () => run(true),
    single: () => run(true),
    then(res, rej) { return run(false).then(res, rej); },
  };
  return api;
}

let store;
beforeEach(() => {
  jest.clearAllMocks();
  db = {
    inserts: [], updates: [],
    tables: {
      users: [{ id: TEACHER, name: 'Teacher Testwala' }],
      quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '4', list_id: null, quiz_source: 'transcript', teacher_id: TEACHER }],
      class_teachers: [],
      classes: [
        { id: K4A, grade_code: 'grade_4', section: 'A', shift_code: null, is_active: true },
        { id: K4B, grade_code: 'grade_4', section: 'B', shift_code: null, is_active: true },
        { id: K3B, grade_code: 'grade_3', section: 'B', shift_code: null, is_active: true },
      ],
      student_lists: [],
      quiz_share_codes: [],
      app_settings: [],
    },
  };
  supabase.from.mockImplementation(fakeFrom);
  store = new Map();
  redis.get.mockImplementation(async (k) => (store.has(k) ? store.get(k) : null));
  redis.set.mockImplementation(async (k, v) => { store.set(k, v); return true; });
  redis.delete.mockImplementation(async (k) => { store.delete(k); return true; });
  redis.setNX.mockImplementation(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; });
  HandoutClass._resetForTests();
});

const teaches = (...ids) => {
  db.tables.class_teachers = ids.map((class_id) => ({ teacher_user_id: TEACHER, class_id, is_active: true }));
};
const codes = () => db.inserts.filter((i) => i.table === 'quiz_share_codes').map((i) => i.payload);

test('one class in the quiz grade: bound silently, no question', async () => {
  teaches(K4A);
  await share.deliverClassLink(CTX, PHONE);
  expect(codes()).toHaveLength(1);
  expect(codes()[0].class_id).toBe(K4A);
  expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
});

test('two sections of the quiz grade: the hand-out goes out unbound, then "4-A / 4-B / All / not sure", and the tap binds it', async () => {
  teaches(K4A, K4B, K3B);
  await share.deliverClassLink(CTX, PHONE);
  expect(codes()).toHaveLength(1);
  expect(codes()[0].class_id).toBeUndefined();
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
  const [, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
  expect(body.buttons.map((b) => b.title)).toEqual(['4-A', '4-B', 'All / not sure']);

  expect(await HandoutClass.handleTap(body.buttons[1].id, PHONE)).toBe(true);
  const bind = db.updates.find((u) => u.table === 'quiz_share_codes');
  expect(bind.payload).toEqual({ class_id: K4B });
  expect(codes()).toHaveLength(1);
});

test('the only class is outside the quiz grade: asked about it rather than bound to it', async () => {
  teaches(K3B);
  await share.deliverClassLink(CTX, PHONE);
  const [, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
  expect(body.buttons.map((b) => b.title)).toEqual(['3-B', 'All / not sure']);
  expect(codes()[0].class_id).toBeUndefined();
});

test('a coaching quiz with no grade takes its one class grade at mint', async () => {
  teaches(K4A);
  db.tables.quizzes[0].grade = null;
  await share.deliverClassLink(CTX, PHONE);
  expect(codes()[0].class_id).toBe(K4A);
  const fill = db.updates.find((u) => u.table === 'quizzes');
  expect(fill.payload).toEqual({ grade: '4' });
});
