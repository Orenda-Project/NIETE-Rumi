'use strict';
/**
 * bd-2337 — a child should type their name once, not before every quiz.
 *
 * The identity lives in the existing `students` table (Rule 15: no new table),
 * with list_id NULL so the child is invisible to attendance rosters. The three
 * cases that matter:
 *
 *   nobody on this handset  -> ask name + class, remember them
 *   exactly one            -> greet by name, straight to question 1
 *   more than one          -> siblings share a phone; ask which one, never guess
 *
 * The last case is the one worth writing down. Assuming the first match would
 * silently file one child's score under their sibling's name, and the teacher
 * would have no way to notice.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const identity = require('../../shared/services/quiz/student-identity.service');

/** Stub `students` reads/writes. `rows` is what a phone lookup returns. */
function stubStudents({ rows = [], inserted = { id: 'new-student' } } = {}) {
  const captured = { insert: null, update: null };
  supabase.from.mockImplementation(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve) => resolve({ data: rows, error: null }),
      insert: (payload) => {
        captured.insert = payload;
        return { select: () => ({ single: async () => ({ data: inserted, error: null }) }) };
      },
      update: (payload) => {
        captured.update = payload;
        return { eq: async () => ({ data: null, error: null }) };
      },
    };
    return chain;
  });
  return captured;
}

beforeEach(() => jest.clearAllMocks());

describe('bd-2337 — normalising the handset', () => {
  test('the same number in different shapes is one handset', () => {
    const forms = ['+92 300 1234567', '923001234567', '0300 1234567', '+923001234567'];
    const normalised = forms.map(identity.normalisePhone);
    expect(new Set(normalised).size).toBe(1);
  });

  test('a local 03xx number resolves to the same key as its E.164 form', () => {
    expect(identity.normalisePhone('03001234567')).toBe(identity.normalisePhone('923001234567'));
  });
});

describe('bd-2337 — who is on this handset?', () => {
  test('an unknown number returns nobody, so the child is asked', async () => {
    stubStudents({ rows: [] });
    const found = await identity.findByPhone('923001234567');
    expect(found).toEqual([]);
  });

  test('a returning child is recognised', async () => {
    stubStudents({
      rows: [{ id: 's1', student_name: 'Hooria', self_reported_class: 'Class 1-B' }],
    });
    const found = await identity.findByPhone('+92 300 1234567');
    expect(found).toHaveLength(1);
    expect(found[0].student_name).toBe('Hooria');
  });

  test('siblings on one handset both come back — the caller must disambiguate', async () => {
    stubStudents({
      rows: [
        { id: 's1', student_name: 'Hooria', self_reported_class: 'Class 1-B' },
        { id: 's2', student_name: 'Bilal', self_reported_class: 'Class 3-A' },
      ],
    });
    const found = await identity.findByPhone('923001234567');
    expect(found).toHaveLength(2);
  });
});

describe('bd-2337 — remembering a new child', () => {
  test('a new child is stored against the handset, off every roster', async () => {
    const captured = stubStudents({ rows: [] });

    await identity.remember({
      phone: '+92 300 1234567', name: 'Hooria', className: 'Class 1-B',
    });

    expect(captured.insert).toBeTruthy();
    expect(captured.insert.student_name).toBe('Hooria');
    expect(captured.insert.self_reported_class).toBe('Class 1-B');
    expect(captured.insert.phone).toBe('923001234567');   // stored normalised
    // list_id NULL is what keeps this child out of every attendance roster —
    // all those reads are scoped by list_id.
    expect(captured.insert.list_id ?? null).toBeNull();
  });

  test('a name is capped rather than trusted', async () => {
    const captured = stubStudents({ rows: [] });
    await identity.remember({
      phone: '923001234567', name: 'x'.repeat(200), className: 'y'.repeat(200),
    });
    expect(captured.insert.student_name.length).toBeLessThanOrEqual(60);
    expect(captured.insert.self_reported_class.length).toBeLessThanOrEqual(40);
  });
});
