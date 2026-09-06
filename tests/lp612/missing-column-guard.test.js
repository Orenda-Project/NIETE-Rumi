/**
 * A COLUMN THAT DOES NOT EXIST YET MUST NOT BE A TOTAL OUTAGE — bd-oak77.14.
 *
 * Every lp612 migration since V1.3.3 carries the same warning in its own header, because deploys
 * do not run migrations on NIETE (bd-tqkq9): *"A merged column that does not exist is a total
 * lp612 outage."* The mechanism is unforgiving — PostgREST rejects the WHOLE update when it names
 * an unknown column, so the success patch fails, the row never reaches `ready`, the waiters are
 * never claimed, and every lesson on the fleet dies at the last step with a document already in
 * R2. It has been avoided three times by remembering to hand-apply first. On a prod go-live day,
 * with four lanes merging, "remembering" is not a control.
 *
 * So the write degrades instead: on PostgREST's undefined-column error (PGRST204, or Postgres
 * 42703) the patch is retried ONCE with the unknown column dropped, and `lp612.row.column_missing`
 * is emitted naming it. The lesson ships; one flag is lost; the event says which and is
 * impossible to miss.
 *
 * This is NOT a licence to skip the migration — it converts a fleet outage into one missing flag.
 * V1.3.9's header states the ordering as a requirement either way.
 */

describe('the row patch survives a column the database does not have yet', () => {
  const mockLogEvent = jest.fn();
  const updates = [];
  let nextError = null;

  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));

  function mockBuilder() {
    const state = { payload: null };
    const settle = () => {
      updates.push(state.payload);
      const err = nextError;
      nextError = null;              // the error fires once, exactly like a real missing column
      return Promise.resolve({ data: err ? null : { id: 'r' }, error: err });
    };
    const b = {
      update: (p) => { state.payload = p; return b; },
      select: () => b,
      eq: () => b,
      single: settle,
      maybeSingle: settle,
      then: (res, rej) => settle().then(res, rej),
    };
    return b;
  }
  jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockBuilder(), rpc: jest.fn() }));

  const { patchForTest } = require('../../bot/workers/lp612-author.worker');

  beforeEach(() => { jest.clearAllMocks(); updates.length = 0; nextError = null; });

  test('PGRST204 on an unknown column retries WITHOUT it and the lesson still ships', async () => {
    nextError = {
      code: 'PGRST204',
      message: "Could not find the 'render_degraded' column of 'niete_lp612_renders' in the schema cache",
    };

    await patchForTest('r1', { status: 'ready', r2_key: 'k', render_degraded: true });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toHaveProperty('render_degraded', true);
    expect(updates[1]).not.toHaveProperty('render_degraded');
    // …and everything else the lesson needs is still in the retry.
    expect(updates[1]).toMatchObject({ status: 'ready', r2_key: 'k' });
  });

  test('it says WHICH column went missing — a silent drop is the bug, not the fix', async () => {
    nextError = { code: '42703', message: 'column "render_degraded" of relation "niete_lp612_renders" does not exist' };

    await patchForTest('r1', { status: 'ready', render_degraded: true });

    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.row.column_missing');
    expect(ev).toBeTruthy();
    expect(ev[1]).toMatchObject({ renderId: 'r1', column: 'render_degraded' });
  });

  test('any OTHER database error is left exactly as it was — no retry, no swallow', async () => {
    // A permission error or a constraint violation must not be quietly re-tried with a field
    // removed; that would turn a real fault into a mystery.
    nextError = { code: '23505', message: 'duplicate key value violates unique constraint' };

    await patchForTest('r1', { status: 'ready', render_degraded: true });

    expect(updates).toHaveLength(1);
    expect(mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.row.column_missing')).toBeUndefined();
  });

  test('an unknown-column error naming a column we did not send is not retried', async () => {
    // Otherwise the retry sends the identical payload and loops the failure.
    nextError = { code: 'PGRST204', message: "Could not find the 'something_else' column" };

    await patchForTest('r1', { status: 'ready', render_degraded: true });

    expect(updates).toHaveLength(1);
  });
});
