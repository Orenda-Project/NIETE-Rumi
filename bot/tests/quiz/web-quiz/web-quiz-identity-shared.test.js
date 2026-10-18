'use strict';
/**
 * The hub's identity lookup shared within one visit (web_quiz_hub_fanout): canonicalStudentIdsShared answers again
 * from a lookup made (or still out) under 1.5 s ago for every id asked, never from a failed one, and is today's
 * canonicalStudentIds while the switch is off or its cache is cold. Supabase is the faked boundary; the roster runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');

const NOW = Date.UTC(2026, 9, 14, 6, 0, 0);
const KID = '44444444-4444-4444-8444-000000000001';
const OLD = '44444444-4444-4444-8444-000000000003';
const SIB = '44444444-4444-4444-8444-000000000002';

let lookups = 0;
let failing = false;
function seed(fanout) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_identity_canon', value: 'true' }, ...(fanout ? [{ key: 'web_quiz_hub_fanout', value: true }] : [])],
    students: [
      { id: KID, list_id: null, is_active: true, status: 'active', merged_into: null },
      { id: OLD, list_id: null, is_active: true, status: 'merged', merged_into: KID },
      { id: SIB, list_id: null, is_active: true, status: 'active', merged_into: null },
    ],
    class_enrollments: [],
    student_lists: [],
  });
  Object.assign(supabase, {
    from: (t) => {
      if (t === 'class_enrollments') { lookups += 1; if (failing) throw new Error('read failed'); }
      return fake.from(t);
    },
    rpc: fake.rpc,
  });
  Flags._resetCache();
  IdFlags._resetCache();
  Roster._resetCache();
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
  lookups = 0;
  failing = false;
});
afterEach(() => jest.useRealTimers());

describe('off (or a cold switch cache): today\'s lookup every time', () => {
  test('switch off: two calls, two lookups, the same answers as canonicalStudentIds', async () => {
    seed(false);
    await Flags.flags();
    const a = await Roster.canonicalStudentIdsShared([OLD, SIB]);
    const b = await Roster.canonicalStudentIdsShared([OLD]);
    expect(lookups).toBe(2);
    expect([...a]).toEqual([...(await Roster.canonicalStudentIds([OLD, SIB]))]);
    expect([...b]).toEqual([[OLD, KID]]);
  });

  test('switch on but the hub has not read its switches yet: no share', async () => {
    seed(true);
    await Roster.canonicalStudentIdsShared([OLD]);
    await Roster.canonicalStudentIdsShared([OLD]);
    expect(lookups).toBe(2);
  });
});

describe('on: shared within the visit', () => {
  test('a second call for the same or fewer ids inside 1.5 s answers from the first (also while it is still out)', async () => {
    seed(true);
    await Flags.flags();
    const first = Roster.canonicalStudentIdsShared([OLD, SIB]);
    const second = Roster.canonicalStudentIdsShared([OLD]);
    expect([...(await first)]).toEqual([[OLD, KID], [SIB, SIB]]);
    expect([...(await second)]).toEqual([[OLD, KID]]);
    expect([...(await Roster.canonicalStudentIdsShared([SIB, OLD]))]).toEqual([[SIB, SIB], [OLD, KID]]);
    expect(lookups).toBe(1);
  });

  test('an id the first call did not ask for, or a call after 1.5 s, looks up afresh', async () => {
    seed(true);
    await Flags.flags();
    await Roster.canonicalStudentIdsShared([OLD]);
    await Roster.canonicalStudentIdsShared([OLD, KID]);
    expect(lookups).toBe(2);
    jest.setSystemTime(NOW + 1500);
    await Roster.canonicalStudentIdsShared([OLD]);
    expect(lookups).toBe(3);
  });

  test('a failed lookup (ids kept as given) is never shared', async () => {
    seed(true);
    await Flags.flags();
    failing = true;
    expect([...(await Roster.canonicalStudentIdsShared([OLD]))]).toEqual([[OLD, OLD]]);
    failing = false;
    expect([...(await Roster.canonicalStudentIdsShared([OLD]))]).toEqual([[OLD, KID]]);
    expect(lookups).toBe(2);
  });

  test('other callers always look up afresh (canonicalStudentIds is never shared)', async () => {
    seed(true);
    await Flags.flags();
    await Roster.canonicalStudentIdsShared([OLD]);
    await Roster.canonicalStudentIds([OLD]);
    await Roster.canonicalStudentId(OLD);
    expect(lookups).toBe(3);
  });
});
