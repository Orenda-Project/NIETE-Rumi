'use strict';
/**
 * SPEC §8 golden 4 / DOOR.md §2 — the lockout walk, executed. fixtures/door-walk.json is LOCKOUT.md expanded (6 senders
 * × 3 store states × warm/cold × ours ON/OFF × theirs ON/OFF × 10 messages = 1,440 cells), each naming ONE reply and ONE
 * write. Every cell this change builds runs through the REAL ingress (attach → route) on a fake store seeded for the
 * cell, and the test asserts the one reply (which send, which ids) and the one write (the door rows' diff). The
 * menu-row cells of an unknown phone are todo for the menu-row change; a known phone's menu row never reaches route().
 * Warm = the verdict a "quiz" from this phone cached a moment ago (60 s for ours; the known phones' own verdicts).
 */
process.env.STUDENT_MODE_ENABLED = 'true';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(), tryChildVideoMenu: jest.fn(async () => true) }));

const StudentQuiz = require('../../shared/services/quiz/student-quiz.service');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const Ingress = require('../../shared/services/student-ingress');
const Door = require('../../shared/services/first-touch/door.service');
const Reply = require('../../shared/services/first-touch/door.reply');
const T = require('./_door-turn');
const WALK = require('./fixtures/door-walk.json');
const { UNKNOWN_USER, PHONE, KID, SISTER_ON, OURS_ON, firstUse } = require('./door-fixture');

const SAVED = { ...process.env };
let makerCta;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
});
afterEach(() => { Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const REGISTERED = { ...UNKNOWN_USER, registration_completed: true, name: 'Teacher Testwala' };
const CHILD_ROW = [{ id: 'st-1', student_name: 'Ayesha Testwala', self_reported_class: '4', is_active: true, phone: PHONE, created_at: '2026-09-01T00:00:00Z' }];
const CHILD_SESSION = [{ id: 's1', created_at: '2026-09-10T08:00:00Z', quiz_id: 'q1', student_class: '4', student_id: 'st-1' }];
const binding = () => ({ id: 'b-1', canonical_id: KID, phone_norm: PHONE, phone_tomb: BindRepo.tombOf(PHONE), via: 'save',
  confirmed_at: '2026-04-02T00:00:00.000Z', bound_at: '2026-04-02T00:00:00.000Z', last_played_at: null,
  expires_at: '2099-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null });
const copy = (rows) => rows.map((r) => ({ ...r }));   // every cell its own rows: a claim retires the child's row in place
const SENDERS = {
  'new teacher': () => ({ user: UNKNOWN_USER, db: {} }),
  'family phone': () => ({ user: UNKNOWN_USER, db: {} }),
  'known teacher': () => ({ user: REGISTERED, db: {} }),
  'chat child': () => ({ user: UNKNOWN_USER, db: { students: copy(CHILD_ROW), sessions: copy(CHILD_SESSION) } }),
  'bound child': () => ({ user: UNKNOWN_USER, db: { bindings: [binding()] } }),
  'teacher-parent': () => ({ user: REGISTERED, db: { students: copy(CHILD_ROW), sessions: copy(CHILD_SESSION) } }),
};
const STORE = { none: () => [], teacher: () => [firstUse('quiz_door_teacher')], child: () => [firstUse('quiz_door_child')] };
const MESSAGE = { 'QUIZ- code': 'QUIZ-A7K2PQ' };
const cols = WALK.columns;
const cells = WALK.cells.map((c) => Object.fromEntries(cols.map((k, i) => [k, c[i]])));
const name = (c) => [c.sender, c.store, c.cache, `ours ${c.ours}`, `theirs ${c.theirs}`, c.message].join(' · ');

function observe() {
  const s = T.sent();
  return {
    chooser: s.buttons.filter((b) => b.buttons.some((x) => x.id.startsWith('ft_door_'))).length,
    maker: makerCta.mock.calls.length + s.buttons.filter((b) => b.buttons.some((x) => x.id.startsWith('ft_mk_'))).length,
    family: s.cta.filter((c) => /\/f\//.test(c.url)).length,
    guest: StudentQuiz.open.mock.calls.length,
  };
}
function changed(before) {
  const after = Object.fromEntries((T.state.fake.db.user_feature_first_use || []).map((r) => [r.feature, JSON.stringify(r)]));
  return Object.keys(after).filter((f) => after[f] !== before[f]).sort();
}
const WRITE = { none: [], asked: ['quiz_door_asked'], teacher: ['quiz_door_teacher'], child: ['quiz_door_child'] };

test('the fixture is the whole walk: 1,440 cells, every one naming one reply and one write', () => {
  expect(cells).toHaveLength(6 * 3 * 2 * 2 * 2 * 10);
  for (const c of cells) {
    expect(['chooser', 'maker', 'family', 'guest', 'today']).toContain(c.reply);
    expect(Object.keys(WRITE)).toContain(c.write);
  }
});

const run = cells.filter((c) => c.exec);
const todo = cells.filter((c) => !c.exec && c.todo);

test.each(run.map((c) => [name(c), c]))('%s', async (_, c) => {
  const { user, db } = SENDERS[c.sender]();
  const settings = { ...SISTER_ON, ...(c.theirs === 'on' ? { web_quiz_guest_home: true } : {}), ...(c.ours === 'on' ? OURS_ON : {}) };
  T.seed({ settings, rows: STORE[c.store](), ...db });
  if (c.cache === 'warm') {
    await Ingress.classify({ user: { ...user }, phone: PHONE, body: 'quiz' });
    Door._forgetReads();
    jest.clearAllMocks();
  }
  const before = Object.fromEntries((T.state.fake.db.user_feature_first_use || []).map((r) => [r.feature, JSON.stringify(r)]));
  await T.text(MESSAGE[c.message] || c.message, user);
  const seen = observe();
  const want = { chooser: 0, maker: 0, family: 0, guest: seen.guest };
  if (c.reply === 'guest') { want.guest = 1; } else if (c.reply !== 'today') want[c.reply] = 1;
  expect(seen).toEqual(want);
  expect(changed(before)).toEqual(WRITE[c.write]);
});

describe('the menu-row cells (built by the menu-row change)', () => {
  for (const c of todo) test.todo(`${name(c)} → ${c.todo}`);
});
