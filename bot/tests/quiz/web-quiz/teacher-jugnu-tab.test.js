'use strict';
/**
 * The teacher's Jugnu tab on the report (/r/<token>?tab=jugnu), its "Forward to the class group" line and the
 * teacher-confirm queue — behind app_settings web_quiz_teacher_jugnu (parents web_quiz_challenge_v2, web_quiz_challenge).
 *
 * The routes run for real on an ephemeral port over the real data module, page and token. Faked: Supabase (in-memory,
 * filters applied), the loggers, and the join-queue service (a later module, mocked virtually to the shape it will
 * export). Children are invented "Testwala" fixtures; the page must never show the surname.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-join-queue', () => ({
  candidatesFor: jest.fn(async () => []),
  decide: jest.fn(async () => ({ ok: true })),
  linkClassCodes: jest.fn(async () => ({ linked: 2 })),
}), { virtual: true });

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
let Page;
async function boot(opts) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  seed(opts);
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
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

describe('the forward line', () => {
  test('EN: the title, no digit (ASCII or Urdu), no name from the roster, no count', async () => {
    await boot();
    const t = await forwardText();
    expect(t).toContain('The Kind Sparrow');
    expect(t).not.toMatch(/\d/);
    expect(t).not.toMatch(/[۰-۹٠-٩]/);
    FIRST.forEach((n) => expect(t).not.toContain(n));
    expect(t).not.toMatch(/ of |have started/);
    expect(t).not.toContain('Secret Future');
  });

  test('UR: the Urdu title isolated, no digit of any kind, no name', async () => {
    await boot();
    const t = await forwardText('&lang=ur');
    expect(t).toContain('⁨مہربان چڑیا⁩');
    expect(t).not.toMatch(/[0-9۰-۹٠-٩]/);
    FIRST.forEach((n) => expect(t).not.toContain(n));
  });

  test('no class link this term → no button and the forward route is 404', async () => {
    await boot({ classLinks: false });
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(h).not.toContain('Forward to the class group');
    expect((await get(`/fwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });

  test('no story released this week → no button', async () => {
    await boot({ passages: false });
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(h).not.toContain('Forward to the class group');
    expect((await get(`/fwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });

  test('switch off → the forward route is 404', async () => {
    await boot({ settings: [] });
    expect((await get(`/fwd/${tok()}?class=${LIST}`)).status).toBe(404);
  });
});

describe('the tab', () => {
  test('coverage "N of 8" on the Jugnu tab; a NULL-class run of an enrolled child counts; never on the other tabs or the forward', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    // Ayesha (class_id NULL), Bilal, Hamza (another class_id), Noor (served), Usman — not the practice Zara, not last month's Zara
    expect(text(h)).toContain('5 of 8 have started this month');
    expect(h).toContain('Forward to the class group');
    const quiz = await html(`/page/${tok()}`);
    const cls = await html(`/page/${Token.signTeacherReport({ teacherId: TEACHER })}`);
    [quiz, cls].forEach((p) => expect(text(p)).not.toMatch(/have started this month/));
    expect(await forwardText()).not.toMatch(/started|8/);
  });

  test('the enrolled child with only a class_id-NULL run is started (the coverage counts her alone)', async () => {
    await boot();
    DB.web_quiz_challenge_runs = DB.web_quiz_challenge_runs.filter((r) => r.canonical_id === id(3));
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(text(h)).toContain('1 of 8 have started this month');
  });

  test('one row per active enrolled child, sorted by first name only; homonyms carry the father\'s first name; no surname', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    const names = rowsOf(h).map((r) => text((r.match(/<b class="jn"[^>]*>([\s\S]*?)<\/b>/) || [])[1] || '').trim());
    expect(names).toEqual(['Ayesha', 'Bilal', 'Hamza', 'Noor', 'Sana', 'Usman', 'Zara', 'Zara']);
    const zaras = rowsOf(h).filter((r) => /Zara/.test(r)).map((r) => text(r));
    expect(zaras[0]).toMatch(/Imran|Khalid/);
    expect(zaras.join(' ')).toMatch(/Khalid/);
    expect(zaras.join(' ')).toMatch(/Imran/);
    expect(h).not.toMatch(/Testwala|Left/);
    expect(text(h)).toContain('Sorted by name. No scores, no positions.');
  });

  test('"done" only for a final status: served and abandoned rows render nothing; stopped early and the mic as words', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    const row = (n) => rowsOf(h).find((r) => r.includes(`>${n}<`));
    const done = (r) => [...r.matchAll(/<i class="st (\w+) on"/g)].map((m) => m[1]);
    expect(done(row('Bilal'))).toEqual(['warm']);
    expect(done(row('Noor'))).toEqual([]);
    expect(done(row('Ayesha'))).toEqual(['read']);
    expect(done(row('Hamza'))).toEqual(['read']);
    expect(text(row('Hamza'))).toContain('Stopped early');
    expect(text(row('Ayesha'))).not.toContain('Stopped early');
    expect(done(row('Usman'))).toEqual([]);
    expect(text(row('Usman'))).toContain('Waiting for a microphone');
    expect(text(row('Noor'))).not.toMatch(/Stopped early|Waiting|missed/i);
  });

  test('lamps by rung NAME, the saved ✓ without the phone, practice note, the Jugnu link on the quiz tab', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    const ayesha = text(rowsOf(h).find((r) => r.includes('>Ayesha<')));
    expect(ayesha).toContain('Understanding a short story');
    expect(ayesha).toContain('Finding numbers');
    expect(ayesha).not.toContain('Reading a short story');
    expect(text(rowsOf(h).find((r) => r.includes('>Bilal<')))).toContain('Saved on WhatsApp ✓');
    expect(text(rowsOf(h).find((r) => r.includes('>Usman<')))).not.toContain('Saved on WhatsApp');
    expect(h).not.toContain('FIXTURE');
    expect(text(h)).toContain("Practice: nothing counts on a teacher's phone.");
    const quiz = await html(`/page/${tok()}`);
    expect(quiz).toMatch(/href="\/r\/[^"]+\?tab=jugnu[^"]*"/);
  });

  test('Urdu: the coverage line in Urdu digits, the tab label in Urdu', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}&lang=ur`);
    expect(text(h)).toContain('اس مہینے ۸ میں سے ۵ بچوں نے شروع کیا');
    expect(text(h)).toContain('جگنو: اس مہینے');
  });
});

describe('the teacher-confirm queue', () => {
  const ROWS = [
    { loose_id: LOOSE(1), candidate_id: id(3), first_name: 'Ayesha Testwala', candidate_first_name: 'Ayesha', class_id: CLASS, grade: 3, phone: '+920000000000',
      evidence: { tier: 'probable', name_words_matched: 2, same_grade: true, other_same_name_loose: false } },
    { loose_id: LOOSE(2), candidate_id: id(2), first_name: 'Bilal', candidate_first_name: 'Bilal Testwala', class_id: CLASS, grade: 3,
      evidence: { tier: 'roster_unique_with_loose', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
  ];

  test('without the queue copy keys the section is not rendered (and the service is not asked)', async () => {
    await boot();
    Queue.candidatesFor.mockResolvedValue(ROWS);
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(h).not.toContain('/queue');
    expect(Queue.candidatesFor).not.toHaveBeenCalled();
  });

  test('with the keys: two rows, first names only, grade and class, no phone, no surname; a decided Same shows Undo', async () => {
    await boot();
    withQueueKeys();
    Queue.candidatesFor.mockResolvedValue(ROWS);
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(Queue.candidatesFor).toHaveBeenCalledWith(TEACHER);
    const q = (h.match(/<section class="card" id="jq">([\s\S]*?)<\/section>/) || [])[1] || '';
    expect(text(q)).toContain('Is Ayesha the same as Ayesha?');
    expect(text(q)).toContain('Is Bilal the same as Bilal?');
    expect(text(q)).toContain('Is Sana the same as Sana?'); // the decided pair, from merge_log
    expect(q).toMatch(/Class 3/);
    expect(visible(q)).not.toMatch(/\+?\d{10,}/);
    expect(text(q)).not.toMatch(/\+?\d{10,}/);
    expect(q).not.toMatch(/Testwala|FIXTURE/);
    expect((q.match(/name="decision" value="same"/g) || []).length).toBe(2);
    expect((q.match(/name="decision" value="no"/g) || []).length).toBe(2);
    expect((q.match(/name="decision" value="unsure"/g) || []).length).toBe(2);
    expect((q.match(/name="decision" value="undo"/g) || []).length).toBe(1);
    expect(text(q)).toContain("Link this class's quiz codes to the class list");
  });

  test('a tap calls decide with exactly the teacher, the pair and the decision, then 303 back to the tab', async () => {
    await boot();
    withQueueKeys();
    const r = await post(`/queue/${tok()}`, { loose_id: LOOSE(1), candidate_id: id(3), decision: 'same', class: LIST });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`/r/${encodeURIComponent(tok())}?tab=jugnu&class=${LIST}`);
    expect(Queue.decide).toHaveBeenCalledTimes(1);
    expect(Queue.decide.mock.calls[0][0]).toEqual({ teacherUserId: TEACHER, looseId: LOOSE(1), candidateId: id(3), decision: 'same' });
  });

  test('Undo calls decide with decision undo; Different with no; Not sure writes nothing', async () => {
    await boot();
    withQueueKeys();
    await post(`/queue/${tok()}`, { loose_id: LOOSE(3), candidate_id: id(8), decision: 'undo', class: LIST });
    await post(`/queue/${tok()}`, { loose_id: LOOSE(2), candidate_id: id(2), decision: 'no', class: LIST });
    const unsure = await post(`/queue/${tok()}`, { loose_id: LOOSE(2), candidate_id: id(2), decision: 'unsure', class: LIST });
    expect(unsure.status).toBe(303);
    expect(Queue.decide.mock.calls.map((c) => c[0].decision)).toEqual(['undo', 'no']);
    expect(Queue.decide.mock.calls[0][0]).toEqual({ teacherUserId: TEACHER, looseId: LOOSE(3), candidateId: id(8), decision: 'undo' });
  });

  test('"Link this class\'s quiz codes" calls linkClassCodes for the class of the teacher\'s own list', async () => {
    await boot();
    withQueueKeys();
    const r = await post(`/queue/${tok()}`, { decision: 'link', class: LIST });
    expect(r.status).toBe(303);
    expect(Queue.linkClassCodes).toHaveBeenCalledWith({ teacherUserId: TEACHER, classId: CLASS });
  });

  test('a bad decision or a malformed id writes nothing (e=1); the switch off makes the route 404', async () => {
    await boot();
    withQueueKeys();
    const bad = await post(`/queue/${tok()}`, { loose_id: 'x', candidate_id: id(3), decision: 'same', class: LIST });
    expect(bad.headers.get('location')).toMatch(/[?&]e=1/);
    const odd = await post(`/queue/${tok()}`, { loose_id: LOOSE(1), candidate_id: id(3), decision: 'merge', class: LIST });
    expect(odd.headers.get('location')).toMatch(/[?&]e=1/);
    expect(Queue.decide).not.toHaveBeenCalled();
    await new Promise((r) => server.close(r)); server = null;
    await boot({ settings: [] });
    expect((await post(`/queue/${tok()}`, { loose_id: LOOSE(1), candidate_id: id(3), decision: 'same', class: LIST })).status).toBe(404);
    expect(Queue.decide).not.toHaveBeenCalled();
  });
});

describe('tables from later trains are absent', () => {
  test('no runs v2 columns, no child_rungs, no bindings, no class_links, no passages: the tab renders, those cells empty', async () => {
    await boot({ classLinks: false, passages: false });
    delete DB.child_rungs; delete DB.child_phone_bindings; delete DB.merge_log;
    DB.web_quiz_challenge_runs = undefined;
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    expect(rowsOf(h)).toHaveLength(8);
    expect(text(h)).not.toMatch(/have started this month/);
    expect(h).not.toContain('Saved on WhatsApp');
    expect(h).not.toContain('Forward to the class group');
  });
});

describe('the binding store is absent (not deployed)', () => {
  test('Saved on WhatsApp ✓ still shows from the table, with no Undo control; /unbind writes nothing (e=1)', async () => {
    await boot();
    const h = await html(`/page/${tok()}?tab=jugnu&class=${LIST}`);
    const bilal = rowsOf(h).find((r) => r.includes('>Bilal<'));
    expect(text(bilal)).toContain('Saved on WhatsApp ✓');
    expect(bilal).not.toMatch(/unbind|Undo/);
    const r = await post(`/unbind/${tok()}`, { binding: 'e0000000-0000-4000-8000-000000000001', class: LIST });
    expect(r.headers.get('location')).toMatch(/[?&]e=1/);
  });
});
