/**
 * Live moves (bd-v0toag.31): what the live screen saw rides the upload and is stored as
 * coaching_sessions.analysis_data.live_moves. The bot validates it; a bad record is DROPPED
 * with a warn, never refused — the recording is the valuable part.
 */
const RECORD = '../../../bot/shared/services/coaching/live-moves/live-record';
const SERVICE = '../../../bot/shared/services/coaching/portal-coaching.service';

const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const KEY = `classroom_audio/${USER}/2026-10/portal_abc123.webm`;
const tap = { idx: 1, choice: 'did', at: '2026-10-19T08:00:00Z', live_state: 'unticked' };
const live = (over = {}) => ({
  lessonId: 'L1', stamp: 's1', liveId: 'live-1',
  moves: [{ idx: 0, covers: ['m1'], tickedAtMs: 61_000 }, { idx: 1, covers: [], tickedAtMs: null }],
  taps: [tap], drops: 0, bytesSent: 1200,
  ...over,
});

describe('liveRecord', () => {
  const { liveRecord, MAX_MOVES } = require(RECORD);

  test('a valid record keeps only its named fields', () => {
    expect(liveRecord({ ...live(), userId: 'x' })).toEqual({ record: live() });
  });

  test('no record → nothing, and not a drop', () => {
    expect(liveRecord(undefined)).toEqual({ record: null });
    expect(liveRecord(null)).toEqual({ record: null });
  });

  test('invalid taps are filtered, at most the last 200 kept', () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ ...tap, idx: i }));
    const { record } = liveRecord(live({ taps: [{ idx: 'x' }, ...many] }));
    expect(record.taps).toHaveLength(200);
    expect(record.taps[0].idx).toBe(5);
  });

  test.each([
    ['a non-object', 'live'],
    ['no lessonId', live({ lessonId: '' })],
    ['no liveId', live({ liveId: undefined })],
    ['moves not an array', live({ moves: {} })],
    ['too many moves', live({ moves: Array.from({ length: MAX_MOVES + 1 }, (_, i) => ({ idx: i, covers: [], tickedAtMs: null })) })],
    ['a move with a bad idx', live({ moves: [{ idx: -1, covers: [], tickedAtMs: null }] })],
    ['a move with non-string covers', live({ moves: [{ idx: 0, covers: [1], tickedAtMs: null }] })],
    ['a move with a bad tick time', live({ moves: [{ idx: 0, covers: [], tickedAtMs: 'soon' }] })],
    ['negative drops', live({ drops: -1 })],
    ['taps not an array', live({ taps: 'x' })],
  ])('%s is dropped', (_n, raw) => {
    expect(liveRecord(raw).bad).toEqual(expect.any(String));
  });
});

function fakeSupabase() {
  const writes = { inserts: [] };
  const from = (table) => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
    q.insert = (row) => { writes.inserts.push({ table, row }); q._inserted = row; return q; };
    q.update = () => q;
    q.single = async () => (q._inserted
      ? { data: { id: 'cs-new', ...q._inserted }, error: null }
      : { data: table === 'users' ? { id: USER, phone_number: '923006657687' } : null, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return q;
  };
  return { from, writes };
}
function deps() {
  return {
    supabase: fakeSupabase(),
    library: { resolveAsset: jest.fn().mockResolvedValue({ id: 'asset-1' }), readyRender: jest.fn(), link: jest.fn().mockResolvedValue(true), recent: jest.fn() },
    log: jest.fn(),
    r2: { getPresignedUploadUrl: jest.fn(), headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1000 }), buildR2PublicUrl: (k) => `https://r2.example/${k}` },
    queue: { queueTranscription: jest.fn().mockResolvedValue('m') },
    reflective: {}, getUserLanguage: jest.fn().mockResolvedValue('en'),
    now: () => new Date('2026-10-19T08:00:00Z'), newId: () => 'abc123',
  };
}
const row = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;

describe('startPortalSession — live moves', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('start stores live_moves on the session', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, lessonPlan: { lessonId: 'L1' }, liveMoves: live() }, d);
    expect(out.status).toBe('ok');
    expect(row(d).analysis_data).toEqual({ live_moves: live() });
  });

  test('start drops live_moves for a different lesson', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, lessonPlan: { lessonId: 'L2' }, liveMoves: live() }, d);
    expect(out.status).toBe('ok');
    expect('analysis_data' in row(d)).toBe(false);
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/live moves/i), expect.anything(), 'warn');
  });

  test('start drops a malformed live_moves with a warn; the recording still starts', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, liveMoves: live({ moves: 'x' }) }, d);
    expect(out.status).toBe('ok');
    expect('analysis_data' in row(d)).toBe(false);
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/live moves/i), expect.anything(), 'warn');
  });

  test('start without liveMoves is unchanged', async () => {
    const d = deps();
    await Svc.startPortalSession({ userId: USER, key: KEY }, d);
    expect('analysis_data' in row(d)).toBe(false);
    expect(d.log).not.toHaveBeenCalledWith(expect.stringMatching(/live moves/i), expect.anything(), 'warn');
  });
});

describe('the internal route carries the record', () => {
  test('/coaching/start passes liveMoves to the service', async () => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const svc = { startPortalSession: jest.fn().mockResolvedValue({ status: 'ok', coachingSessionId: 'cs-1' }) };
    jest.doMock(SERVICE, () => svc);
    const router = require('../../../bot/shared/routes/internal-api.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/coaching/start' && l.route.methods.post);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body: { userId: 'u1', key: 'k', liveMoves: live() }, headers: { 'x-api-key': 'secret' }, path: '/coaching/start', ip: '127.0.0.1' };
    await new Promise((resolve) => {
      const res = { status() { return this; }, json() { resolve(); return this; } };
      const run = (i) => handlers[i](req, res, () => run(i + 1));
      run(0);
    });
    expect(svc.startPortalSession).toHaveBeenCalledWith(expect.objectContaining({ liveMoves: live() }));
  });
});
