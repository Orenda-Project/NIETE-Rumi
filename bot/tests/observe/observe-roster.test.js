/**
 * FEAT-053 bd-45 — the officer's teacher ROSTER (attendance-parity).
 *
 * The picker used to be a read-only memory derived from past deliveries; an
 * officer couldn't remove a mistyped teacher or manage their list. The roster
 * is now EXPLICIT — `users.preferences.observe_teachers` (zero new tables):
 *  - lazily backfilled ONCE from delivery history for existing officers;
 *  - upserted on every send (same phone → name updates, moves to front);
 *  - removable via the manage flow;
 *  - capped so it can't grow without bound.
 */

const mockDb = { user: null, past: [], userUpdates: [] };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.user ? { data: mockDb.user, error: null } : { data: null, error: { message: 'not found' } }));
function mockMakeChain(table) {
  const chain = { _table: table };
  for (const m of ['select', 'eq', 'neq', 'not', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: mockDb.past, error: null });
  chain.update = jest.fn((patch) => {
    if (table === 'users') {
      mockDb.userUpdates.push(patch);
      if (mockDb.user) mockDb.user = { ...mockDb.user, ...patch };
    }
    return { eq: jest.fn().mockResolvedValue({ error: null }) };
  });
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockMakeChain(t)) }));

const {
  getRoster,
  upsertTeacher,
  removeTeacher,
  ROSTER_CAP,
} = require('../../shared/services/observe/observe-roster');

const FO = () => ({ id: 'fo-1', preferences: { observe_onboarding_arm: 'why_coaching' } });
const pastRow = (name, phone) => ({
  analysis_data: { teacher_delivery: { teacher_name: name, teacher_phone: phone } },
  created_at: '2026-07-14',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.user = FO();
  mockDb.past = [];
  mockDb.userUpdates = [];
});

describe('getRoster', () => {
  test('reads the explicit roster when present — no history query, no write', async () => {
    const u = FO();
    u.preferences.observe_teachers = [{ name: 'Bi. Zainabu', phone: '255712345678' }];
    const r = await getRoster(u);
    expect(r).toEqual([{ name: 'Bi. Zainabu', phone: '255712345678' }]);
    expect(mockDb.userUpdates).toHaveLength(0);
  });

  test('no roster yet → backfills ONCE from delivery history and persists it (preserving other preferences)', async () => {
    mockDb.past = [pastRow('Bi. Zainabu', '255712345678'), pastRow('Mw. Neema', '255755000111')];
    const r = await getRoster(FO());
    expect(r.map((t) => t.phone)).toEqual(['255712345678', '255755000111']);
    expect(mockDb.userUpdates).toHaveLength(1);
    const saved = mockDb.userUpdates[0].preferences;
    expect(saved.observe_teachers).toHaveLength(2);
    expect(saved.observe_onboarding_arm).toBe('why_coaching');   // merge, not clobber
  });

  test('no roster and no history → empty roster, persisted as [] so backfill never re-runs', async () => {
    const r = await getRoster(FO());
    expect(r).toEqual([]);
    expect(mockDb.userUpdates[0].preferences.observe_teachers).toEqual([]);
  });
});

describe('upsertTeacher', () => {
  test('new teacher goes to the FRONT of the roster', async () => {
    const u = FO();
    u.preferences.observe_teachers = [{ name: 'Mw. Neema', phone: '255755000111' }];
    const r = await upsertTeacher(u, { name: 'Bi. Zainabu', phone: '255712345678' });
    expect(r[0]).toEqual({ name: 'Bi. Zainabu', phone: '255712345678' });
    expect(r).toHaveLength(2);
  });

  test('same phone → name updates and moves to front (this IS the rename path)', async () => {
    const u = FO();
    u.preferences.observe_teachers = [
      { name: 'Mw. Neema', phone: '255755000111' },
      { name: 'Zainabu M.', phone: '255712345678' },
    ];
    const r = await upsertTeacher(u, { name: 'Bi. Zainabu Mushi', phone: '255712345678' });
    expect(r[0]).toEqual({ name: 'Bi. Zainabu Mushi', phone: '255712345678' });
    expect(r).toHaveLength(2);   // no duplicate
  });

  test('roster is capped — the oldest falls off, never unbounded growth', async () => {
    const u = FO();
    u.preferences.observe_teachers = Array.from({ length: ROSTER_CAP }, (_, i) =>
      ({ name: `T${i}`, phone: `25570000${String(1000 + i)}` }));
    const r = await upsertTeacher(u, { name: 'Newest', phone: '255799999999' });
    expect(r).toHaveLength(ROSTER_CAP);
    expect(r[0].name).toBe('Newest');
    expect(r.find((t) => t.name === `T${ROSTER_CAP - 1}`)).toBeUndefined();
  });
});

describe('removeTeacher', () => {
  test('removes by phone and persists', async () => {
    const u = FO();
    u.preferences.observe_teachers = [
      { name: 'Bi. Zainabu', phone: '255712345678' },
      { name: 'Mw. Neema', phone: '255755000111' },
    ];
    const r = await removeTeacher(u, '255712345678');
    expect(r).toEqual([{ name: 'Mw. Neema', phone: '255755000111' }]);
    expect(mockDb.userUpdates.at(-1).preferences.observe_teachers).toHaveLength(1);
  });

  test('removing an unknown phone is a harmless no-op', async () => {
    const u = FO();
    u.preferences.observe_teachers = [{ name: 'Mw. Neema', phone: '255755000111' }];
    const r = await removeTeacher(u, '255700000000');
    expect(r).toHaveLength(1);
  });
});
