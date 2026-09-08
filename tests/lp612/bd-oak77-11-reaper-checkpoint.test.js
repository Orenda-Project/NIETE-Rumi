/**
 * bd-oak77.11 — A ROW WHOSE CHECKPOINT IS FRESH HAS A LIVING OWNER.
 *
 * `isStrandedAuthoring` infers "the worker that owned this run went away" from a clock, because
 * nothing else in the table can express it. bd-w36m5 already established which clock: the SQS
 * envelope, measured from `picked_up_at`. The checkpoint adds a SECOND, far more direct piece of
 * evidence — the owner wrote a document to this row ninety seconds ago — and a corpse detector that
 * ignores it will condemn a worker that is demonstrably alive, exactly the failed→ready flapping
 * bd-w36m5 removed.
 *
 * This also matters more after Layer A than before it. A draining worker legitimately holds a job
 * for up to ten minutes past SIGTERM, and its message's visibility is being re-extended throughout;
 * the sweep must not write `failed` underneath it.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ __isQueueSingleton: true, queueJob: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ getPresignedUrl: jest.fn(), buildR2PublicUrl: (k) => `https://r2/${k}` }));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [], columns: null };
  const settle = () => {
    mockDbCalls.push({ ...state });
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: (cols) => { if (cols && !state.op) state.columns = cols; return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    lt: (c, v) => { state.filters.push(['lt:' + c, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    limit: () => b,
    single: settle, maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: jest.fn(() => Promise.resolve({ data: 'joined', error: null })),
}));

const Serving = require('../../bot/shared/services/lp612-serving.service');
const { isStrandedAuthoring } = Serving;

const agoMs = (ms) => new Date(Date.now() - ms).toISOString();
const strandedPickup = () => agoMs(Serving.reapAfterPickupMs() + 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0; mockDbResults.length = 0;
  process.env.LP612_AUTHOR_TIMEOUT_MS = '420000';
});
afterEach(() => { delete process.env.LP612_AUTHOR_TIMEOUT_MS; });

describe('the checkpoint is evidence of life', () => {
  test('an old pickup with a FRESH checkpoint is NOT stranded', () => {
    expect(isStrandedAuthoring({
      status: 'authoring',
      picked_up_at: strandedPickup(),
      checkpoint: { v: 1, round: 2, at: agoMs(90 * 1000) },
    })).toBe(false);
  });

  test('an old pickup with an equally OLD checkpoint is still stranded', () => {
    expect(isStrandedAuthoring({
      status: 'authoring',
      picked_up_at: strandedPickup(),
      checkpoint: { v: 1, round: 2, at: strandedPickup() },
    })).toBe(true);
  });

  test('a malformed checkpoint timestamp cannot make a corpse look alive', () => {
    expect(isStrandedAuthoring({
      status: 'authoring',
      picked_up_at: strandedPickup(),
      checkpoint: { v: 1, round: 2, at: 'not-a-date' },
    })).toBe(true);
  });

  test('no checkpoint at all behaves exactly as it does today', () => {
    expect(isStrandedAuthoring({ status: 'authoring', picked_up_at: strandedPickup() })).toBe(true);
    expect(isStrandedAuthoring({ status: 'authoring', picked_up_at: agoMs(60 * 1000) })).toBe(false);
  });
});

describe('the sweep reads the column, and survives its absence', () => {
  test('the sweep asks for checkpoint', async () => {
    mockDbResults.push({ data: [], error: null });
    await Serving.reapStrandedRenders();
    const read = mockDbCalls.find((c) => c.op === null);
    expect(read).toBeDefined();
    expect(read.columns).toMatch(/checkpoint/);
  });

  test('a database without the column still sweeps (the migration is applied BY HAND)', async () => {
    mockDbResults.push({ data: null, error: { code: '42703', message: 'column niete_lp612_renders.checkpoint does not exist' } });
    mockDbResults.push({ data: [{ id: 'r1', segment_id: 's1', picked_up_at: strandedPickup(), updated_at: agoMs(60 * 60 * 1000) }], error: null });
    const n = await Serving.reapStrandedRenders();
    expect(n).toBe(1);
  });

  test('a fresh checkpoint spares the row from the sweep', async () => {
    mockDbResults.push({
      data: [{ id: 'r1', segment_id: 's1', picked_up_at: strandedPickup(), updated_at: agoMs(60 * 60 * 1000), checkpoint: { v: 1, round: 1, at: agoMs(30 * 1000) } }],
      error: null,
    });
    expect(await Serving.reapStrandedRenders()).toBe(0);
  });
});
