'use strict';
/**
 * Identity v2 on the session endpoint (app_settings web_quiz_identity = 'v2'):
 * the child types the name they are called by, the server matches inside the
 * ONE class the hand-out is for, and answers with exactly one of —
 *   which_class (the hand-out's class is not known and the child has not chosen),
 *   ask_more    (two children of the class share the name: a question about the
 *                child's OWN data — full name, father's name, list number),
 *   is_this_you (exactly ONE child — never two cards),
 *   not_found   (nobody near the name: "is that how your name is written?").
 * A child the class does not know becomes a provisional child of that hand-out.
 * An invited friend never meets the roster. With the setting absent, today's
 * path runs untouched (web-quiz-roster / who-played suites, unchanged).
 * Supabase, SQS, Redis and WhatsApp are the faked boundaries; the matcher, the
 * class resolver, the roster read and the session write run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Roster = require('../../../shared/services/quiz/web-quiz-roster');

const { kid } = F;
let fake;
function seed(opts) {
  fake = makeFake(F.db(opts));
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache();
  Roster._resetCache();
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  seed();
});
afterAll(() => { process.env = SAVED; });

/** Every 409 is_this_you seen in this file, so the one-candidate rule is asserted on all of them. */
const cards = [];
async function answer(body) {
  try {
    const out = await WQ.startSession({ code: 'AB12CD', ...body });
    return { status: 200, body: out };
  } catch (e) {
    if (!(e instanceof WQ.WqError)) throw e;
    if (e.body.error === 'is_this_you') cards.push(e.body);
    return { status: e.status, body: e.body };
  }
}
const chipOf = (id) => T.chipId(F.SC, id);
const logged = () => JSON.stringify(logEvent.mock.calls);
const ev = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

afterAll(() => {
  // Never two candidates: every "Are you …?" this suite produced carried exactly one card.
  expect(cards.length).toBeGreaterThan(5);
  cards.forEach((b) => expect(b.candidates).toHaveLength(1));
});

describe('E2 boot: the page learns how to ask, never who is in the class', () => {
  test('a hand-out bound to 4-A: known class, roster on, no chips, no names', async () => {
    const out = await WQ.getQuiz('AB12CD');
    expect(out.cls.identity).toEqual({ mode: 'v2', class: { state: 'known', label: '4-A', ask: null }, roster: true, invited: false });
    expect(out.cls.chips).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/Testwala|Ayesha|Bilal/);
  });

  test('an unbound hand-out of a teacher with 4-A and 4-B: the two labels, each with an opaque key', async () => {
    seed({ codeClass: null });
    const { identity } = (await WQ.getQuiz('AB12CD')).cls;
    expect(identity.class.state).toBe('ambiguous');
    expect(identity.class.ask.map((c) => c.label)).toEqual(['4-A', '4-B']);
    identity.class.ask.forEach((c) => expect(c.key).not.toMatch(new RegExp(`${F.CLS_A}|${F.CLS_B}`)));
  });

  test('an invited friend: no roster, invited', async () => {
    const out = await WQ.getQuiz('FR13ND');
    expect(out.cls.identity).toMatchObject({ mode: 'v2', roster: false, invited: true });
    expect(out.cls.chips).toEqual([]);
  });

  test('setting absent: no identity block (today\'s boot)', async () => {
    seed({ flag: null });
    expect((await WQ.getQuiz('AB12CD')).cls.identity).toBeUndefined();
  });
});

describe('E3 name first, inside the hand-out\'s one class', () => {
  test('a unique name → ONE "Are you Ayesha?" card: first name and animal, no surname, no class line', async () => {
    const r = await answer({ new: { name: 'ayesha' }, via: 'name' });
    expect(r).toEqual({ status: 409, body: { error: 'is_this_you', candidates: [{ chip: chipOf(kid(1)), first: 'Ayesha', animal: T.animalFor(kid(1)) }] } });
  });

  test('"Yes, it\'s me": the child plays as the roster child, class label on the session, nobody created', async () => {
    const n = fake.db.students.length;
    const r = await answer({ chip: chipOf(kid(1)), via: 'name' });
    expect(r.status).toBe(200);
    expect(r.body.child).toEqual({ chip: chipOf(kid(1)), first: 'Ayesha', animal: T.animalFor(kid(1)) });
    const s = fake.db.quiz_sessions.find((x) => x.student_id === kid(1));
    expect(s).toMatchObject({ student_class: '4-A', share_code_id: F.SC });
    expect(fake.db.students).toHaveLength(n);
    expect(ev('web_quiz.identity_resolved')).toEqual([{ shareCodeId: F.SC, sessionId: s.id, via: 'name', classBound: 'code', provisional: false }]);
  });

  test('two Alis: ask the full name (never show the two), then ONE card', async () => {
    expect(await answer({ new: { name: 'Ali' } })).toEqual({ status: 409, body: { error: 'ask_more', need: 'full_name', first: 'Ali', cls: '4-A' } });
    const r = await answer({ new: { name: 'Ali', full_name: 'Ali Hamza' } });
    expect(r.body).toMatchObject({ error: 'is_this_you', candidates: [{ chip: chipOf(kid(3)), first: 'Ali' }] });
  });

  test('two Sanas, same full name: father → "I don\'t know" → list number → ONE card', async () => {
    expect((await answer({ new: { name: 'Sana' } })).body).toMatchObject({ error: 'ask_more', need: 'father' });
    expect((await answer({ new: { name: 'Sana', father: null } })).body).toMatchObject({ error: 'ask_more', need: 'number' });
    const r = await answer({ new: { name: 'Sana', father: null, number: '5' } });
    expect(r.body).toMatchObject({ error: 'is_this_you', candidates: [{ chip: chipOf(kid(5)) }] });
  });

  test('two Hinas and the child does not know the number → not_found (the child may still play, provisional)', async () => {
    expect((await answer({ new: { name: 'Hina' } })).body).toMatchObject({ error: 'ask_more', need: 'number' });
    expect(await answer({ new: { name: 'Hina', number: null } })).toEqual({ status: 409, body: { error: 'not_found', typed: 'Hina', cls: '4-A' } });
  });

  test('Bilal pasted twice is ONE child: one card, the canonical (older) row', async () => {
    const r = await answer({ new: { name: 'Bilal' } });
    expect(r.body).toEqual({ error: 'is_this_you', candidates: [{ chip: chipOf(kid(8)), first: 'Bilal', animal: T.animalFor(kid(8)) }] });
  });

  test('a child of ANOTHER class (Zara of 4-B) is never offered on a 4-A hand-out; a merged row is never offered', async () => {
    expect((await answer({ new: { name: 'Zara' } })).body).toMatchObject({ error: 'not_found', typed: 'Zara' });
    expect((await answer({ new: { name: 'Nadia' } })).body).toMatchObject({ error: 'not_found' });
    expect((await answer({ chip: chipOf(kid(10)) })).status).toBe(404);
  });

  test('"Yes, that\'s my name": a provisional child of the hand-out (typed name, the class label), session on it', async () => {
    const r = await answer({ new: { name: 'Zara Testwala', force: true }, via: 'new' });
    expect(r.status).toBe(200);
    const made = fake.db.students[fake.db.students.length - 1];
    expect(made).toMatchObject({ student_name: 'Zara Testwala', self_reported_class: '4-A', enrolled_by_user_id: F.TEACHER, list_id: null });
    expect(fake.db.quiz_sessions.find((s) => s.student_id === made.id)).toMatchObject({ student_class: '4-A' });
    expect(ev('web_quiz.identity_resolved')[0]).toMatchObject({ via: 'new', classBound: 'code', provisional: true });
  });

  test('a bad list number or an empty name is a 400', async () => {
    expect(await answer({ new: { name: 'Sana', father: null, number: 'abcd' } })).toMatchObject({ status: 400, body: { why: 'number' } });
    expect(await answer({ new: { name: '   ' } })).toMatchObject({ status: 400, body: { why: 'name' } });
  });
});

describe('E3 when the hand-out\'s class is not known', () => {
  beforeEach(() => seed({ codeClass: null }));

  test('no class chosen → which_class with the labels; a stale key asks again', async () => {
    const r = await answer({ new: { name: 'Zara' } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('which_class');
    expect(r.body.classes.map((c) => c.label)).toEqual(['4-A', '4-B']);
    expect((await answer({ new: { name: 'Zara' }, list: 'nonsense' })).body.error).toBe('which_class');
  });

  test('the child chose 4-B → matched inside 4-B only, the card carries the class they chose', async () => {
    const { body } = await answer({ new: { name: 'Zara' } });
    const b = body.classes.find((c) => c.label === '4-B').key;
    const r = await answer({ new: { name: 'Zara' }, list: b });
    expect(r.body).toEqual({ error: 'is_this_you', candidates: [{ chip: chipOf(kid(10)), first: 'Zara', animal: T.animalFor(kid(10)), cls: '4-B' }] });
    expect((await answer({ new: { name: 'Ayesha' }, list: b })).body.error).toBe('not_found');
    const ok = await answer({ chip: chipOf(kid(10)), list: b, via: 'name' });
    expect(ok.status).toBe(200);
    expect(fake.db.quiz_sessions.find((s) => s.student_id === kid(10))).toMatchObject({ student_class: '4-B' });
    expect(ev('web_quiz.identity_resolved')[0]).toMatchObject({ classBound: 'child_ask', provisional: false });
  });

  test('"My class is not here" → no roster to match: the child is created directly, no class label', async () => {
    const r = await answer({ new: { name: 'Ayesha' }, list: 'none' });
    expect(r.status).toBe(200);
    const made = fake.db.students[fake.db.students.length - 1];
    expect(made).toMatchObject({ student_name: 'Ayesha', self_reported_class: null, list_id: null });
  });
});

describe('E3 an invited friend never meets the roster', () => {
  test('a typed name that IS on the class list still starts a provisional child on the challenge code', async () => {
    const n = fake.db.students.length;
    const out = await WQ.startSession({ code: 'FR13ND', new: { name: 'Ayesha' } });
    expect(out.child.first).toBe('Ayesha');
    expect(fake.db.students).toHaveLength(n + 1);
    const s = fake.db.quiz_sessions[fake.db.quiz_sessions.length - 1];
    expect(s).toMatchObject({ invited_by_student_id: kid(1), student_class: null });
    expect(s.student_id).not.toBe(kid(1));
  });
});

describe('E3 a child opening their OWN challenge link plays for the class', () => {
  test('the challenger\'s remembered card on their challenge code: a class run (no invited stamp); anyone else stays invited', async () => {
    await WQ.startSession({ code: 'FR13ND', chip: chipOf(kid(1)) }).catch(() => null);
    // the challenger only resolves by chip once they have played a code of this teacher
    fake.db.quiz_sessions.push(F.done('s-own', kid(1), 'Ayesha Testwala', 4, 3));
    const own = await WQ.startSession({ code: 'FR13ND', chip: chipOf(kid(1)) });
    expect(own.child.first).toBe('Ayesha');
    const s = fake.db.quiz_sessions[fake.db.quiz_sessions.length - 1];
    expect(s).toMatchObject({ student_id: kid(1), share_code_id: F.SC, invited_by_student_id: null });
    await WQ.startSession({ code: 'FR13ND', new: { name: 'Faraz' } });
    expect(fake.db.quiz_sessions[fake.db.quiz_sessions.length - 1].invited_by_student_id).toBe(kid(1));
  });
});

describe('E3 a hub link (?k=<chip>) plays straight through only on a phone that knows the child', () => {
  test('a forwarded link (no session of that child on this device) gets the ONE card first, nothing started', async () => {
    const n = fake.db.quiz_sessions.length;
    const r = await answer({ chip: chipOf(kid(1)), via: 'hub', device_ref: 'dev-stranger-000000001' });
    expect(r).toEqual({ status: 409, body: { error: 'is_this_you', candidates: [{ chip: chipOf(kid(1)), first: 'Ayesha', animal: T.animalFor(kid(1)) }] } });
    expect(fake.db.quiz_sessions).toHaveLength(n);
    expect(ev('web_quiz.identity_step')).toEqual([{ shareCodeId: F.SC, step: 'hub_confirm', hits: 1 }]);
  });

  test('the child\'s own phone (a prior session on this device_ref, any of the teacher\'s codes) plays straight through', async () => {
    fake.db.quiz_sessions.push(F.done('s-before', kid(1), 'Ayesha Testwala', 4, 30, { device_ref: 'dev-ayesha-phone-00001' }));
    const r = await answer({ chip: chipOf(kid(1)), via: 'hub', device_ref: 'dev-ayesha-phone-00001' });
    expect(r.status).toBe(200);
  });

  test('"Yes, it\'s me" on that card (confirm) plays; a remembered card (this phone\'s own storage) plays', async () => {
    expect((await answer({ chip: chipOf(kid(1)), via: 'hub', confirm: true })).status).toBe(200);
    expect((await answer({ chip: chipOf(kid(2)), via: 'remembered' })).status).toBe(200);
  });
});

describe('logs: ids and counts only', () => {
  test('every identity step is logged without a name or a typed string', async () => {
    await answer({ new: { name: 'Ali' } });
    await answer({ new: { name: 'Ali', full_name: 'Ali Hamza' } });
    await answer({ new: { name: 'Hina', number: null } });
    await answer({ chip: chipOf(kid(3)), via: 'full_name' });
    expect(ev('web_quiz.identity_step').map((e) => e.step)).toEqual(['full_name', 'confirm', 'name']);
    ev('web_quiz.identity_step').forEach((e) => expect(Object.keys(e).sort()).toEqual(['hits', 'shareCodeId', 'step']));
    expect(logged()).not.toMatch(/Ali|Hamza|Hina|Testwala/);
  });

  test('via is allow-listed', async () => {
    await answer({ chip: chipOf(kid(1)), via: 'Ayesha Testwala' });
    expect(ev('web_quiz.identity_resolved')[0].via).toBe('remembered');
  });
});

describe('setting absent: today\'s path', () => {
  test('a typed name with no roster setting creates the child as today (no 409 from v2)', async () => {
    seed({ flag: null });
    const r = await answer({ new: { name: 'Zara' } });
    expect(r.status).toBe(200);
    expect(ev('web_quiz.identity_step')).toEqual([]);
  });
});
