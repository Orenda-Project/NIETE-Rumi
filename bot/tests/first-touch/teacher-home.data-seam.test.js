'use strict';
/**
 * The teacher home's "children on this phone" link through the REAL phone-bindings repo: childrenLink reads this
 * phone's children with childrenForPhone (chat children from the students table; bound children too when the
 * phone-bind switch is on) and hands their ids to the hub link.
 * Only the network is faked (supabase, Redis, WhatsApp, the loggers); the repo is never mocked.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Roster = require('../../shared/services/quiz/web-quiz-identity-roster');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const { childrenLink } = require('../../shared/services/first-touch/teacher-home.data');
const { seedDb, SISTER_ON, iso } = require('./door-fixture');
const { TEACHER, fixturePhone } = require('./maker-fixture');

const SAVED = { ...process.env };
const PHONE = fixturePhone(941);
const EMPTY_PHONE = fixturePhone(942);
const LINK = 'https://portal.example.test/h/x';
const kid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A chat child the way quizStudentsFor reads it: phone = the normalised phone, no list, active. */
const chatChild = (n, name, phone = PHONE, createdAt = '2026-09-01') => ({
  id: kid(n), student_name: name, self_reported_class: '4', phone, list_id: null, is_active: true,
  created_at: iso(createdAt), status: 'active', merged_into: null,
});

const teacherOn = (phone) => ({ ...TEACHER, phone_number: phone });
const hub = () => ({ hubLink: jest.fn(async () => LINK) });

function seed({ more = [], ...opts } = {}) {
  const fake = seedDb(supabase, {
    students: [
      chatChild(1, 'Bilal Testwala', PHONE, '2026-09-01'),
      chatChild(2, 'Sana Testwala', PHONE, '2026-09-05'),
      { ...chatChild(3, 'Zara Testwala', PHONE), list_id: 'list-1' },        // on a class list → not a chat child
      { ...chatChild(4, 'Omar Testwala', PHONE), is_active: false },          // inactive → absent
      chatChild(5, 'Hina Testwala', fixturePhone(943)),                       // another phone → absent
      ...more,
    ],
    ...opts,
  });
  fake.db.class_enrollments = [];
  fake.db.student_lists = [];
  return fake;
}

beforeEach(() => {
  process.env = { ...SAVED, WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret' };
  jest.clearAllMocks();
  IdFlags._resetCache();
  HubFlags._resetCache();
  Roster._resetCache();
});
afterAll(() => { process.env = SAVED; });

test('a teacher whose phone has chat children: the hub link for those children, newest first, from the teacher home', async () => {
  seed();
  const Hub = hub();
  await expect(childrenLink(teacherOn(PHONE), { Hub })).resolves.toBe(LINK);
  expect(Hub.hubLink).toHaveBeenCalledTimes(1);
  expect(Hub.hubLink).toHaveBeenCalledWith([kid(2), kid(1)], 'teacher_home');
});

test('a phone with no children: no link, and the hub is never asked', async () => {
  seed();
  const Hub = hub();
  await expect(childrenLink(teacherOn(EMPTY_PHONE), { Hub })).resolves.toBeNull();
  expect(Hub.hubLink).not.toHaveBeenCalled();
});

test('a user without a phone number: no link, and the hub is never asked', async () => {
  seed();
  const Hub = hub();
  await expect(childrenLink({ ...TEACHER }, { Hub })).resolves.toBeNull();
  await expect(childrenLink(null, { Hub })).resolves.toBeNull();
  expect(Hub.hubLink).not.toHaveBeenCalled();
});

test('with the phone-bind switch on, a child bound to the phone comes first, then the chat children', async () => {
  const now = Date.now();
  seed({
    settings: SISTER_ON,
    bindings: [
      {
        id: 'bind-1', canonical_id: kid(6), phone_norm: BindRepo.normalisePhone(PHONE), phone_tomb: BindRepo.tombOf(PHONE),
        via: 'save', confirmed_at: iso(now - 86400000), bound_at: iso(now - 86400000), last_played_at: null,
        expires_at: iso(now + 30 * 86400000), revoked_at: null, revoked_by: null, rebind_of: null, code_id: null,
      },
      {
        id: 'bind-2', canonical_id: kid(7), phone_norm: null, phone_tomb: BindRepo.tombOf(PHONE),        // erased → absent
        via: 'save', confirmed_at: iso(now - 86400000), bound_at: iso(now - 86400000), last_played_at: null,
        expires_at: iso(now + 30 * 86400000), revoked_at: iso(now - 3600000), revoked_by: 'page_undo', rebind_of: null, code_id: null,
      },
    ],
    // the bound children's own rows: on a class list under another phone, so neither is a chat child of this phone
    more: [
      { ...chatChild(6, 'Ayesha Testwala', fixturePhone(944)), list_id: 'list-2' },
      { ...chatChild(7, 'Danish Testwala', fixturePhone(945)), list_id: 'list-2' },
    ],
  });

  expect((await IdFlags.flags()).phoneBind).toBe(true);
  const Hub = hub();
  await expect(childrenLink(teacherOn(PHONE), { Hub })).resolves.toBe(LINK);
  expect(Hub.hubLink).toHaveBeenCalledTimes(1);
  expect(Hub.hubLink).toHaveBeenCalledWith([kid(6), kid(2), kid(1)], 'teacher_home');
});
