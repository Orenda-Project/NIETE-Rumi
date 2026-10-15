'use strict';
/**
 * The Jugnu tab's "Saved on WhatsApp ✓ · Undo": the tick and the Undo come from the identity binding store
 * (child-phone-bindings.repo, a later module, mocked virtually to the shape it exports: activeForChild,
 * eraseOne). Undo is a no-JS POST /unbind → eraseOne(bindingId, 'teacher') → 303 back to the tab, and only
 * for a binding of a child on THIS teacher's list. Routes run for real over the real data module and page;
 * faked: Supabase (in-memory), the loggers, the two identity services.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-join-queue', () => ({
  candidatesFor: jest.fn(async () => []), decide: jest.fn(async () => ({ ok: true })), linkClassCodes: jest.fn(async () => ({ linked: 0 })),
}), { virtual: true });
const BINDINGS = { ['b0000000-0000-4000-8000-000000000002']: [{ id: 'e0000000-0000-4000-8000-000000000001', canonical_id: 'b0000000-0000-4000-8000-000000000002' }] };
jest.mock('../../../shared/services/quiz/child-phone-bindings.repo', () => ({
  activeForChild: jest.fn(async (id) => BINDINGS[id] || []),
  eraseOne: jest.fn(async (id) => [{ id, canonical_id: 'b0000000-0000-4000-8000-000000000002', phone_norm: '+920000000001' }]),
}), { virtual: true });
// EVENTS §1: kid = the per-child hash; the event key module, not on this base yet (mocked virtually to its export).
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({ kid: jest.fn((id) => `k_${String(id).slice(-4)}`) }), { virtual: true });

const express = require('express');
const { makeFake } = require('./fake-supabase');

const NOW = Date.parse('2026-10-15T09:30:00Z'); // Thursday; PKT week starts Mon 12 Oct 00:00 PKT = 11 Oct 19:00Z
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const OTHER_CLASS = 'c1a55000-0000-4000-8000-000000000002';
const id = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const LOOSE = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const at = (iso) => new Date(Date.parse(iso)).toISOString();

// 8 invented children; two are Zara (fathers' first names differ).
const KIDS = [
  [1, 'Zara Testwala', 'Khalid Testwala'], [2, 'Bilal Testwala', null], [3, 'Ayesha Testwala', null], [4, 'Zara Testwala', 'Imran Testwala'],
  [5, 'Hamza Testwala', null], [6, 'Noor Testwala', null], [7, 'Usman Testwala', null], [8, 'Sana Testwala', null],
];
const FIRST = ['Zara', 'Bilal', 'Ayesha', 'Hamza', 'Noor', 'Usman', 'Sana', 'Khalid', 'Imran'];
const PHONE = '+92300FIXTURE1';

const run = (kid, o) => ({ id: `r-${kid}-${Math.random().toString(36).slice(2, 8)}`, student_id: id(kid), canonical_id: id(kid), mode: 'check', record: true,
  period_id: '2026-10', class_id: CLASS, wcpm: null, meta: {}, created_at: at('2026-10-13T06:00:00Z'), scored_at: at('2026-10-13T06:01:00Z'), ...o });

let DB;
function seed({ settings = 'on', classLinks = true, passages = true } = {}) {
  const on = [{ key: 'web_quiz_teacher_jugnu', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'true' }, { key: 'web_quiz_challenge', value: 'true' }];
  DB = {
    app_settings: settings === 'on' ? on : settings,
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'report_sent', list_id: null, created_at: at('2026-10-14T03:00:00Z'), meta: { share_code_id: SC } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, active: true, expires_at: null, language: 'en', created_at: at('2026-10-14T03:00:00Z') }],
    quiz_sessions: [], quiz_questions: [], quiz_answers: [],
    student_lists: [{ id: LIST, class_name: 'Grade 3', section: 'B', user_id: TEACHER, is_active: true, class_id: CLASS }],
    students: [
      ...KIDS.map(([n, name, father]) => ({ id: id(n), list_id: LIST, roll_number: n, student_name: name, father_name: father, student_name_urdu: null, is_active: true, merged_into: null })),
      { id: id(9), list_id: LIST, roll_number: 9, student_name: 'Left Testwala', father_name: null, is_active: true, merged_into: null },
      { id: LOOSE(3), list_id: null, student_name: 'Sana Testwala', father_name: null, is_active: false, merged_into: id(8) },
    ],
    class_enrollments: [
      ...KIDS.map(([n]) => ({ class_id: CLASS, student_id: id(n), is_active: true })),
      { class_id: CLASS, student_id: id(9), is_active: false }, // left the class: not on the tab, not in the 8
    ],
    web_quiz_challenge_runs: [
      // Ayesha: a read through a share code with NO class on the row — still started (join on enrolment, not on runs.class_id)
      run(3, { exercise: 'read', status: 'scored', wcpm: 40, class_id: null }),
      // Bilal: warm-up done; bigger only served, listen abandoned — those show nothing
      run(2, { exercise: 'missing', status: 'scored' }),
      run(2, { exercise: 'bigger', status: 'served', scored_at: null }),
      run(2, { exercise: 'listen', status: 'abandoned', scored_at: null }),
      // Hamza: a read that stopped on line 1 (scored, 0 words) — done, and "Stopped early"; class_id of another class
      run(5, { exercise: 'read', status: 'scored', wcpm: 0, class_id: OTHER_CLASS }),
      // Noor: a record row only served — started, nothing done
      run(6, { exercise: 'read', status: 'served', scored_at: null }),
      // Usman: the no-microphone path
      run(7, { exercise: 'read', status: 'failed', meta: { reason: 'no_mic' } }),
      // Zara (Khalid): practice only — not started
      run(1, { exercise: 'read', status: 'scored', mode: 'practice', record: false, wcpm: 30 }),
      // Zara (Imran): last month only — not started this month
      run(4, { exercise: 'read', status: 'scored', period_id: '2026-09', wcpm: 22, created_at: at('2026-09-20T06:00:00Z'), scored_at: at('2026-09-20T06:01:00Z') }),
      // not on this class at all
      { id: 'r-x', student_id: id(99), canonical_id: id(99), exercise: 'read', status: 'scored', mode: 'check', record: true, period_id: '2026-10', class_id: CLASS, meta: {}, created_at: at('2026-10-13T06:00:00Z') },
    ],
    child_rungs: [
      { canonical_id: id(3), ladder: 'reading', rung: 2, rule_v: 'badges-v1', period_id: '2026-09', set_at: at('2026-09-30T00:00:00Z') },
      { canonical_id: id(3), ladder: 'reading', rung: 3, rule_v: 'badges-v1', period_id: '2026-10', set_at: at('2026-10-13T00:00:00Z') },
      { canonical_id: id(3), ladder: 'numbers', rung: 1, rule_v: 'badges-v1', period_id: '2026-10', set_at: at('2026-10-13T00:00:00Z') },
    ],
    child_phone_bindings: [
      { id: 'pb1', canonical_id: id(2), phone_norm: PHONE, phone_tomb: 'aa', via: 'save', revoked_at: null },
      { id: 'pb2', canonical_id: id(7), phone_norm: null, phone_tomb: 'bb', via: 'save', revoked_at: at('2026-10-10T00:00:00Z'), revoked_by: 'page_undo' },
    ],
    merge_log: [
      { id: 1, loose_id: LOOSE(3), candidate_id: id(8), teacher_id: TEACHER, decision: 'same', source: 'queue', decided_at: at('2026-10-14T00:00:00Z') },
    ],
  };
  if (classLinks) DB.class_links = [{ code: 'K7QX2M9P', class_id: CLASS, teacher_id: TEACHER, term_code: '2026-27b', expires_at: at('2027-03-31T18:59:59Z'), revoked_at: null }];
  if (passages) {
    DB.challenge_passages = [
      { passage_id: 'en.read.1.sparrow', lang: 'en', status: 'reviewed', title_en: 'The Kind Sparrow', title_ur: 'مہربان چڑیا', released_at: at('2026-10-11T19:00:00Z') },
      { passage_id: 'en.read.1.future', lang: 'en', status: 'reviewed', title_en: 'Secret Future', title_ur: 'خفیہ', released_at: at('2026-10-18T19:00:00Z') },
    ];
  }
  const fake = makeFake(DB);
  // Tables a base without the earlier trains lacks: reading one is an error, as PostgREST answers.
  const from = (t) => (DB[t] === undefined ? missingTable(t) : fake.from(t));
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}
function missingTable(t) {
  const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: null, error: { code: '42P01', message: `relation "${t}" does not exist` } }) : () => b) });
  return b;
}

let server;
let base;
let Token;
let Queue;
let Repo;
let Identity;
let Events;
let Page;
async function boot(opts) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed(opts);
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
  Repo = require('../../../shared/services/quiz/child-phone-bindings.repo');
  Identity = require('../../../shared/services/quiz/student-identity.service');
  jest.spyOn(Identity, 'forgetDoorVerdict').mockResolvedValue(undefined);
  Events = require('../../../shared/utils/structured-logger');
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}
beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] }); });
afterEach(async () => { jest.useRealTimers(); if (server) await new Promise((r) => server.close(r)); server = null; });

const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const html = async (p) => { const r = await get(p); expect(r.status).toBe(200); return r.text(); };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const tok = () => Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
const text = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').replace(/ ([?.!,])/g, '$1');
// The queue's HTML without its form plumbing (ids in hidden inputs, the token in the action): what a reader could see.
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const visible = (h) => h.replace(/action="[^"]*"/g, '').replace(UUID_G, 'ID');
const rowsOf = (h) => [...h.matchAll(/<li class="jk"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const forwardText = async (q = '') => {
  const r = await get(`/fwd/${tok()}?class=${LIST}${q}`);
  expect(r.status).toBe(302);
  const loc = r.headers.get('location');
  expect(loc.startsWith('https://wa.me/?text=')).toBe(true);
  return decodeURIComponent(loc.slice('https://wa.me/?text='.length));
};
// Queue strings are not in the copy deck yet: tests supply them under the keys the page reads.
const QUEUE_EN = { tQHead: 'Is {name} the same as {name2}?', tQSame: 'Same child', tQDiff: 'Different', tQUnsure: 'Not sure', tQUndo: 'Undo', tQLink: "Link this class's quiz codes to the class list" };
const withQueueKeys = () => { Page = require('../../../shared/templates/teacher-jugnu.page'); Object.assign(Page.T.en, QUEUE_EN); };

const BIND = 'e0000000-0000-4000-8000-000000000001';
const OTHER_BIND = 'e0000000-0000-4000-8000-0000000000ff';

const undoEvents = () => Events.logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.bind_undo');

describe('after an erase: the door forgets the phone, and bind_undo is counted', () => {
  test('forgetDoorVerdict gets the erased row\'s phone_norm; bind_undo carries exactly {via, n, audio_n, w, kid}, never a phone', async () => {
    await boot();
    await post(`/unbind/${tok()}`, { binding: BIND, class: LIST });
    expect(Identity.forgetDoorVerdict).toHaveBeenCalledTimes(1);
    expect(Identity.forgetDoorVerdict).toHaveBeenCalledWith('+920000000001');
    expect(undoEvents()).toEqual([['web_quiz.bind_undo', { via: 'teacher', n: 1, audio_n: 0, w: 's', kid: 'k_0002' }]]);
    expect(JSON.stringify(Events.logEvent.mock.calls)).not.toContain('920000000001');
  });

  test('nothing erased (empty answer): no forget, no event', async () => {
    await boot();
    Repo.eraseOne.mockResolvedValueOnce([]);
    const r = await post(`/unbind/${tok()}`, { binding: BIND, class: LIST });
    expect(r.headers.get('location')).toMatch(/[?&]e=1/);
    expect(Identity.forgetDoorVerdict).not.toHaveBeenCalled();
    expect(undoEvents()).toEqual([]);
  });

  test('a binding not on this teacher\'s list: no erase, no forget, no event', async () => {
    await boot();
    await post(`/unbind/${tok()}`, { binding: OTHER_BIND, class: LIST });
    expect(Repo.eraseOne).not.toHaveBeenCalled();
    expect(Identity.forgetDoorVerdict).not.toHaveBeenCalled();
    expect(undoEvents()).toEqual([]);
  });
});

describe('Saved on WhatsApp ✓ · Undo', () => {
  test('the tick comes from activeForChild; the bound child shows Undo, a form carrying the binding and the list only', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    const bilal = rowsOf(h).find((r) => r.includes('>Bilal<'));
    expect(text(bilal)).toContain('Saved on WhatsApp ✓');
    expect(text(bilal)).toContain('Undo');
    expect(bilal).toMatch(/<form[^>]+action="\/r\/[^"]+\/unbind"/);
    expect(bilal).toContain(`name="binding" value="${BIND}"`);
    expect(bilal).not.toContain('FIXTURE');
    const usman = rowsOf(h).find((r) => r.includes('>Usman<'));
    expect(usman).not.toMatch(/unbind|Saved on WhatsApp/);
    expect(Repo.activeForChild).toHaveBeenCalled();
  });

  test('Undo calls eraseOne(bindingId, \'teacher\') and 303s back to the tab', async () => {
    await boot();
    const r = await post(`/unbind/${tok()}`, { binding: BIND, class: LIST });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/r/${encodeURIComponent(tok())}?tab=jugnu&class=${LIST}`);
    expect(Repo.eraseOne).toHaveBeenCalledTimes(1);
    expect(Repo.eraseOne.mock.calls[0]).toEqual([BIND, 'teacher']);
  });

  test('a binding that is not of a child on this teacher\'s list is refused: nothing erased, e=1', async () => {
    await boot();
    const r = await post(`/unbind/${tok()}`, { binding: OTHER_BIND, class: LIST });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/[?&]e=1/);
    const bad = await post(`/unbind/${tok()}`, { binding: 'x;drop', class: LIST });
    expect(bad.headers.get('location')).toMatch(/[?&]e=1/);
    expect(Repo.eraseOne).not.toHaveBeenCalled();
  });

  test('another teacher\'s token cannot erase this class\'s binding', async () => {
    await boot();
    const stranger = Token.signTeacherReport({ teacherId: '99999999-9999-4999-8999-999999999999' });
    const r = await post(`/unbind/${stranger}`, { binding: BIND, class: LIST });
    expect(r.headers.get('location')).toMatch(/[?&]e=1/);
    expect(Repo.eraseOne).not.toHaveBeenCalled();
  });

  test('switch off: /unbind is 404 and nothing is erased', async () => {
    await boot({ settings: [] });
    expect((await post(`/unbind/${tok()}`, { binding: BIND, class: LIST })).status).toBe(404);
    expect(Repo.eraseOne).not.toHaveBeenCalled();
  });
});
