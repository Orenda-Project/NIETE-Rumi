'use strict';
/**
 * The role resolver's seam with the REAL child-phone-bindings.repo (only the database is faked): a phone with a live
 * binding resolves `child` (src bound) with the bound child's first name; a revoked binding is not a binding; a phone
 * with none falls through to the next rung. The repo's own query shape (phone_norm, revoked_at null, expires_at in the
 * future) is what runs here, not a stand-in.
 */
process.env.WQ_TOMB_SALT = 'unit-salt-not-a-secret';
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Role = require('../../shared/services/first-touch/role.service');

const PHONE = fixturePhone(201);
const ROW = { registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, role: null };
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

function world(bindings) {
  mockDb = fakeDb({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }, { key: 'web_quiz_phone_bind', value: true }],
    child_phone_bindings: bindings,
    students: [{ id: 'k-1', student_name: 'Sara Testwala', phone: null, list_id: null, is_active: true, status: 'active' }],
    student_lists: [], users: [], user_feature_first_use: [],
    quizzes: [], coaching_sessions: [], lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], class_teachers: [],
  });
  IdFlags._resetCache(); HubFlags._resetCache();
}

test('the real repo reads the phone\'s live binding → child (bound), first name only', async () => {
  world([{ id: 'b-1', canonical_id: 'k-1', phone_norm: BindRepo.normalisePhone(PHONE), revoked_at: null, expires_at: FUTURE, bound_at: '2026-10-01T00:00:00Z', via: 'guest' }]);
  expect(await Role.resolveRole({ user: { id: 'u-1', ...ROW }, phone: PHONE })).toMatchObject({ side: 'child', src: 'bound', children: ['k-1'], kids: [{ id: 'k-1', first: 'Sara' }] });
  expect(mockDb.reads.some((r) => r.table === 'child_phone_bindings' && r.filters.some(([op, col]) => op === 'eq' && col === 'phone_norm'))).toBe(true);
});

test('a revoked binding is not a binding: the phone falls through to the next rung (unknown here)', async () => {
  world([{ id: 'b-1', canonical_id: 'k-1', phone_norm: BindRepo.normalisePhone(PHONE), revoked_at: '2026-10-02T00:00:00Z', expires_at: FUTURE, bound_at: '2026-10-01T00:00:00Z', via: 'guest' }]);
  expect(await Role.resolveRole({ user: { id: 'u-1', ...ROW }, phone: PHONE })).toMatchObject({ side: 'unknown', src: 'none' });
});
