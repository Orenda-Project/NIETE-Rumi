'use strict';
/**
 * The role resolver (ROLE.md §2): pure decideRole per persona row of ROUTING_MAP §A, and resolveRole's one read in the
 * contract's order — identity/activity → binding → chat-joined row → our remembered page answer (door.keys) → unknown.
 * Never "a users row exists": a bare row (getOrCreateUser's) with nothing on it is unknown. A failed identity read is
 * unknown (the page asks), never a guess.
 */
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
const mockActivity = jest.fn(async () => false);
jest.mock('../../shared/services/student-ingress', () => ({
  identity: jest.requireActual('../../shared/services/student-ingress').identity,
  activity: (...a) => mockActivity(...a),
}));
const mockFlags = { phoneBind: true };
jest.mock('../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn(async () => mockFlags) }));
const mockBound = jest.fn(async () => []);
jest.mock('../../shared/services/quiz/child-phone-bindings.repo', () => ({
  activeForPhone: (...a) => mockBound(...a), normalisePhone: (p) => String(p).replace(/\D/g, ''),
}));
const mockRoster = jest.fn(async () => []);
jest.mock('../../shared/services/student-mode.service', () => ({ quizStudentsForPhone: (...a) => mockRoster(...a) }));
const mockKeys = jest.fn(async () => ({}));
jest.mock('../../shared/services/first-touch/door.keys', () => ({
  readDoorKeys: (...a) => mockKeys(...a), KEY_TTL_DAYS: 90,
  KEYS: { TEACHER: 'quiz_door_teacher', CHILD: 'quiz_door_child', ASKED: 'quiz_door_asked', TOUR: 'quiz_tour' },
}));

const Role = require('../../shared/services/first-touch/role.service');

const PHONE = fixturePhone(123);
// a users row as getOrCreateUser returns it for a phone that has never written before (every identity column read)
const BARE = { id: 'u-1', registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, role: null };
const ago = (d) => new Date(Date.now() - d * 86400000);

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.phoneBind = true;
  mockActivity.mockResolvedValue(false);
  mockBound.mockResolvedValue([]);
  mockRoster.mockResolvedValue([]);
  mockKeys.mockResolvedValue({});
});

describe('decideRole — pure, the contract order', () => {
  test.each([
    ['registered / coach / head (identity)', { teacher: 'identity' }, { role: 'teacher', side: 'teacher', src: 'identity' }],
    ['owns a quiz / LP / coaching (activity)', { teacher: 'activity' }, { role: 'teacher', side: 'teacher', src: 'activity' }],
    ['teacher-parent: identity wins over a bound child', { teacher: 'identity', bound: ['k1'] }, { role: 'teacher', side: 'teacher', src: 'identity' }],
    ['a failed identity read → the page asks', { failed: true, bound: ['k1'] }, { role: 'unknown', side: 'unknown', src: 'error' }],
    ['bound phone', { bound: ['k1', 'k2'] }, { role: 'child', side: 'child', src: 'bound' }],
    ['chat-joined child', { roster: ['s1'] }, { role: 'child', side: 'child', src: 'roster' }],
    ['binding before roster', { bound: ['k1'], roster: ['s1'] }, { role: 'child', side: 'child', src: 'bound' }],
    ['remembered teacher answer', { door: 'maker' }, { role: 'teacher', side: 'teacher', src: 'key' }],
    ['remembered child answer, no row yet → join', { door: 'family' }, { role: 'child', side: 'join', src: 'key' }],
    ['a row on the phone beats a remembered teacher answer', { roster: ['s1'], door: 'maker' }, { role: 'child', side: 'child', src: 'roster' }],
    ['nothing → unknown', {}, { role: 'unknown', side: 'unknown', src: 'none' }],
    ['onboard\'s chooser/capped states are not answers → unknown', { door: 'capped' }, { role: 'unknown', side: 'unknown', src: 'none' }],
  ])('%s', (_name, facts, want) => {
    expect(Role.decideRole(facts)).toMatchObject(want);
  });

  test('children are capped at 4', () => {
    expect(Role.decideRole({ bound: ['a', 'b', 'c', 'd', 'e'] }).children).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('langOf — the script rule', () => {
  test('Arabic script → ur; preferred ur → ur; Latin, /quiz, the menu → bi', () => {
    expect(Role.langOf({ body: 'کوئز' })).toBe('ur');
    expect(Role.langOf({ body: 'quiz', user: { preferred_language: 'ur' } })).toBe('ur');
    expect(Role.langOf({ body: '/quiz' })).toBe('bi');
    expect(Role.langOf({ body: '' })).toBe('bi');
  });
});

describe('resolveRole — the one read, per persona row', () => {
  const resolve = (user, body = '/quiz') => Role.resolveRole({ user, phone: PHONE, body });

  test('1 unknown phone: a bare users row is NOT a teacher (lead-chief 165240) → unknown, every rung read', async () => {
    const r = await resolve(BARE);
    expect(r).toMatchObject({ role: 'unknown', side: 'unknown', src: 'none', uid: 'u-1', lang: 'bi' });
    expect(mockActivity).toHaveBeenCalledWith('u-1');
    expect(mockBound).toHaveBeenCalledTimes(1);
    expect(mockRoster).toHaveBeenCalledTimes(1);
    expect(mockKeys).toHaveBeenCalledWith('u-1');
  });

  test('2a known chat-joined child → child (roster), ids only', async () => {
    mockRoster.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);
    expect(await resolve(BARE)).toMatchObject({ role: 'child', side: 'child', src: 'roster', children: ['s-1', 's-2'] });
    expect(mockKeys).not.toHaveBeenCalled();
  });

  test('2b bound phone → child (bound) by canonical id; roster and keys never read', async () => {
    mockBound.mockResolvedValue([{ canonical_id: 'c-9' }]);
    expect(await resolve(BARE)).toMatchObject({ role: 'child', side: 'child', src: 'bound', children: ['c-9'] });
    expect(mockRoster).not.toHaveBeenCalled();
    expect(mockKeys).not.toHaveBeenCalled();
  });

  test('2b with web_quiz_phone_bind OFF: bindings are not read', async () => {
    mockFlags.phoneBind = false;
    mockBound.mockResolvedValue([{ canonical_id: 'c-9' }]);
    expect(await resolve(BARE)).toMatchObject({ side: 'unknown' });
    expect(mockBound).not.toHaveBeenCalled();
  });

  test('3 registered teacher (with lessons) → teacher by identity; nothing after rung 1 is read', async () => {
    expect(await resolve({ ...BARE, registration_completed: true, name: 'Asma Testwala' })).toMatchObject({ role: 'teacher', src: 'identity' });
    expect(mockActivity).not.toHaveBeenCalled();
    expect(mockBound).not.toHaveBeenCalled();
  });

  test('4 a teacher with no registration but activity (owns a quiz) → teacher by activity', async () => {
    mockActivity.mockResolvedValue(true);
    expect(await resolve(BARE)).toMatchObject({ role: 'teacher', src: 'activity' });
  });

  test.each(['coach', 'principal'])('5 role %s → teacher (identity)', async (role) => {
    expect(await resolve({ ...BARE, role })).toMatchObject({ role: 'teacher', side: 'teacher', src: 'identity' });
  });

  test('6a teacher-parent: identity first, the bound child never decides', async () => {
    mockBound.mockResolvedValue([{ canonical_id: 'c-9' }]);
    expect(await resolve({ ...BARE, school_id: 'sch-1' })).toMatchObject({ role: 'teacher', src: 'identity' });
  });

  test('rung 4: a remembered teacher answer → teacher (key); a remembered child answer → join (key)', async () => {
    mockKeys.mockResolvedValue({ quiz_door_teacher: { count: 1, usedAt: ago(1) } });
    expect(await resolve(BARE)).toMatchObject({ role: 'teacher', side: 'teacher', src: 'key' });
    mockKeys.mockResolvedValue({ quiz_door_child: { count: 1, usedAt: ago(1) } });
    expect(await resolve(BARE)).toMatchObject({ role: 'child', side: 'join', src: 'key' });
  });

  test('rung 4: newest answer wins; one older than 90 days is absent', async () => {
    mockKeys.mockResolvedValue({ quiz_door_teacher: { count: 1, usedAt: ago(5) }, quiz_door_child: { count: 1, usedAt: ago(1) } });
    expect(await resolve(BARE)).toMatchObject({ side: 'join' });
    mockKeys.mockResolvedValue({ quiz_door_teacher: { count: 1, usedAt: ago(91) } });
    expect(await resolve(BARE)).toMatchObject({ side: 'unknown' });
  });

  test('a teacher-marked phone that later registers → the users row wins', async () => {
    mockKeys.mockResolvedValue({ quiz_door_child: { count: 1, usedAt: ago(1) } });
    expect(await resolve({ ...BARE, registration_state: 'completed' })).toMatchObject({ side: 'teacher', src: 'identity' });
  });

  test('a failed activity read → unknown (src error): never a guess', async () => {
    mockActivity.mockResolvedValue(null);
    expect(await resolve(BARE)).toMatchObject({ role: 'unknown', src: 'error' });
    expect(mockBound).not.toHaveBeenCalled();
  });

  test('a failed binding / key read is read as absent', async () => {
    mockBound.mockRejectedValue(new Error('down'));
    mockKeys.mockRejectedValue(new Error('down'));
    expect(await resolve(BARE)).toMatchObject({ side: 'unknown', src: 'none' });
  });

  test('a row with identity columns missing is read once from users (the landing passes only the id)', async () => {
    const supabase = require('../../shared/config/supabase');
    const chain = { select: jest.fn(() => chain), eq: jest.fn(() => chain), maybeSingle: jest.fn(async () => ({ data: { ...BARE, role: 'coach' }, error: null })) };
    supabase.from.mockReturnValue(chain);
    expect(await Role.resolveRole({ user: { id: 'u-1' }, phone: PHONE })).toMatchObject({ side: 'teacher', src: 'identity' });
    expect(supabase.from).toHaveBeenCalledWith('users');
  });

  test('no user → unknown (error)', async () => {
    expect(await Role.resolveRole({ user: null, phone: PHONE })).toMatchObject({ side: 'unknown', src: 'error' });
  });
});
