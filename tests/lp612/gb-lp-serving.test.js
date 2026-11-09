'use strict';
/**
 * bd-rj6w0n.14.16 — GB's own lesson-plan lane: its own cache rows (niete_gb_lp_renders), its own R2 prefix
 * (gb-lp/), its own job (gb_lp_author). It never reads or writes niete_lp612_renders or lp612/ keys.
 */
const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockQueueJob = jest.fn();
const mockDeliverRender = jest.fn().mockResolvedValue(undefined);
const mockRpc = jest.fn();

jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: (...a) => mockSendMessage(...a) }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: (...a) => mockQueueJob(...a) }));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({ deliverRender: (...a) => mockDeliverRender(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: 'select', filters: [] };
  const settle = () => {
    mockDbCalls.push(state);
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle, maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)), rpc: (...a) => mockRpc(...a),
}));

const GbLane = require('../../bot/shared/services/gb-lp-serving.service');

const SEG = {
  segment_id: 'nbf_snc_grade_2_urdu.c07.s005', grade: 2, subject: 'Urdu', language: 'ur', curriculum: 'nbf_snc',
};
const ENG = { ...SEG, segment_id: 'nbf_snc_grade_3_english.c02.s004', grade: 3, subject: 'English', language: 'en' };
const REQ = { segment: SEG, userId: 'user-1', phone: '920000000000', voice: 'ur', correlationId: 'c-1' };
const tables = () => [...new Set(mockDbCalls.map((c) => c.table))];

const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  mockSendMessage.mockResolvedValue(true);
  mockDeliverRender.mockResolvedValue(undefined);
  process.env = { ...saved };
  delete process.env.LP_GB_TEMPLATE_VERSION;
  process.env.LP_GB_AUTHOR_ENABLED = 'true';
});
afterAll(() => { process.env = saved; });

describe('GB keys live under gb-lp/, never lp612/', () => {
  test('key shape is gb-lp/{tv}/{lang}/{segment}.{ext}', () => {
    expect(GbLane.keyFor(SEG.segment_id, 'ur', 'gb_k5_v9')).toBe('gb-lp/gb_k5_v9/ur/nbf_snc_grade_2_urdu.c07.s005.pdf');
    expect(GbLane.keyFor(SEG.segment_id, 'ur', 'gb_k5_v10.1', 'lp.json')).toMatch(/\.lp\.json$/);
    expect(() => GbLane.keyFor('../x', 'ur', 'tv')).toThrow();
  });
  test('the template version defaults to gb_k5_v9 (the built v9 plans) and follows LP_GB_TEMPLATE_VERSION', () => {
    expect(GbLane.templateVersion()).toBe('gb_k5_v9');
    process.env.LP_GB_TEMPLATE_VERSION = 'gb_k5_v10.2';
    expect(GbLane.templateVersion()).toBe('gb_k5_v10.2');
  });
  test.each(['lp612/v9.1/ur/x.pdf', 'pre_gen_lps/x.pdf', 'gb-lp/../lp612/x.pdf', '', undefined])(
    'a GB write refuses %s', (k) => { expect(() => GbLane.assertGbKey(k)).toThrow(/gb-lp/); },
  );
  test('deliver refuses an lp612/ key', async () => {
    await expect(GbLane.deliver({ r2Key: 'lp612/v9.1/ur/x.pdf', segment: SEG })).rejects.toThrow(/non-GB key/);
    expect(mockDeliverRender).not.toHaveBeenCalled();
  });
});

describe('a cache hit is sent from GB rows only', () => {
  test('ready row → 6-12 document send of the gb-lp/ key, renderId null, book language', async () => {
    mockDbResults.push({ data: { id: 'g1', status: 'ready', r2_key: 'gb-lp/gb_k5_v10.1/ur/x.pdf' }, error: null });
    const out = await GbLane.requestLesson({ ...REQ, voice: 'en' });
    expect(out).toEqual({ outcome: 'cache_hit', renderId: 'g1' });
    expect(mockDeliverRender).toHaveBeenCalledWith(expect.objectContaining({
      r2Key: 'gb-lp/gb_k5_v10.1/ur/x.pdf', renderId: null, lang: 'ur', segment: SEG,
    }));
    expect(tables()).toEqual(['niete_gb_lp_renders']);
    expect(mockDbCalls[0].filters).toEqual([['segment_id', SEG.segment_id], ['lang', 'ur'], ['template_version', 'gb_k5_v9']]);
  });
  test('a failed send tells her it failed', async () => {
    mockDbResults.push({ data: { id: 'g1', status: 'ready', r2_key: 'gb-lp/t/ur/x.pdf' }, error: null });
    mockDeliverRender.mockRejectedValueOnce(new Error('meta down'));
    expect((await GbLane.requestLesson(REQ)).outcome).toBe('deliver_failed');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('a miss is authored at runtime on GB\'s own job', () => {
  test('no row → insert into niete_gb_lp_renders, tell her, queue gb_lp_author', async () => {
    mockDbResults.push({ data: null, error: null }, { data: { id: 'new-1' }, error: null });
    const out = await GbLane.requestLesson({ ...REQ, segment: ENG, voice: 'en' });
    expect(out).toEqual({ outcome: 'queued', renderId: 'new-1' });
    const ins = mockDbCalls.find((c) => c.op === 'insert');
    expect(ins.table).toBe('niete_gb_lp_renders');
    expect(ins.payload).toMatchObject({ segment_id: ENG.segment_id, lang: 'en', template_version: 'gb_k5_v9', status: 'authoring' });
    expect(ins.payload.waiters[0]).toMatchObject({ user_id: 'user-1', phone: REQ.phone });
    expect(mockQueueJob).toHaveBeenCalledWith(ENG.segment_id, 'gb_lp_author', expect.objectContaining({
      renderId: 'new-1', lang: 'en', templateVersion: 'gb_k5_v9',
    }), expect.any(Object));
    expect(tables()).toEqual(['niete_gb_lp_renders']);
  });
  test('an insert race re-decides and joins the winner', async () => {
    mockDbResults.push({ data: null, error: null }, { data: null, error: { code: '23505', message: 'dup' } },
      { data: { id: 'w', status: 'authoring', started_at: new Date().toISOString() }, error: null });
    mockRpc.mockResolvedValueOnce({ data: 'joined', error: null });
    expect(await GbLane.requestLesson(REQ)).toEqual({ outcome: 'joined', renderId: 'w' });
    expect(mockRpc).toHaveBeenCalledWith('gb_lp_join_waiters', expect.objectContaining({ p_render_id: 'w' }));
  });
  test('a failed row is reset under compare-and-set and re-queued', async () => {
    mockDbResults.push({ data: { id: 'f1', status: 'failed' }, error: null }, { data: [{ id: 'f1' }], error: null });
    expect(await GbLane.requestLesson(REQ)).toEqual({ outcome: 'queued', renderId: 'f1' });
    const upd = mockDbCalls.find((c) => c.op === 'update');
    expect(upd.filters).toEqual([['id', 'f1'], ['status', 'failed']]);
    expect(upd.payload.status).toBe('authoring');
  });
  test('a stranded authoring row is reset, a live one joined', () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(GbLane.isStranded({ status: 'authoring', started_at: old })).toBe(true);
    expect(GbLane.isStranded({ status: 'authoring', started_at: new Date().toISOString() })).toBe(false);
  });
  test('enqueue failure marks the GB row failed, never an lp612 row', async () => {
    mockDbResults.push({ data: null, error: null }, { data: { id: 'n2' }, error: null });
    mockQueueJob.mockRejectedValueOnce(new Error('sqs down'));
    expect((await GbLane.requestLesson(REQ)).outcome).toBe('error');
    const fail = mockDbCalls.find((c) => c.op === 'update');
    expect(fail.table).toBe('niete_gb_lp_renders');
    expect(fail.payload.error_code).toBe('ENQUEUE_FAILED');
  });
});

describe('bd-rj6w0n.14.16: only English, Urdu, Maths and Science are written on request', () => {
  test.each(['Mathematics', 'Maths', 'English', 'Urdu'])('grade 3 %s is generated', async (subject) => {
    mockDbResults.push({ data: null, error: null }, { data: { id: 'n' }, error: null });
    const out = await GbLane.requestLesson({ ...REQ, segment: { ...SEG, grade: 3, subject } });
    expect(out.outcome).toBe('queued');
    expect(mockQueueJob).toHaveBeenCalledTimes(1);
  });
  test('grade 5 Science is generated', async () => {
    mockDbResults.push({ data: null, error: null }, { data: { id: 'n' }, error: null });
    expect((await GbLane.requestLesson({ ...REQ, segment: { ...SEG, grade: 5, subject: 'Science' } })).outcome).toBe('queued');
  });
  test.each([[3, 'Islamiat'], [2, 'GK'], [4, 'Social Studies'], [5, 'Computer']])(
    'grade %s %s is not: told coming soon, nothing read, written or queued', async (grade, subject) => {
      const out = await GbLane.requestLesson({ ...REQ, segment: { ...SEG, grade, subject } });
      expect(out.outcome).toBe('gb_subject_off');
      expect(mockDbCalls).toHaveLength(0);
      expect(mockQueueJob).not.toHaveBeenCalled();
      expect(mockDeliverRender).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    },
  );
});

describe('bd-rj6w0n.14.16.11: with runtime authoring off, an unbuilt lesson is coming soon, never queued', () => {
  beforeEach(() => { delete process.env.LP_GB_AUTHOR_ENABLED; });
  test('a built (ready) lesson is still sent', async () => {
    mockDbResults.push({ data: { id: 'g1', status: 'ready', r2_key: 'gb-lp/gb_k5_v9/en/x.pdf' }, error: null });
    expect((await GbLane.requestLesson({ ...REQ, segment: ENG })).outcome).toBe('cache_hit');
  });
  test.each([[null], [{ id: 'f', status: 'failed' }]])('row %j: told coming soon, nothing written or queued', async (row) => {
    mockDbResults.push({ data: row, error: null });
    const out = await GbLane.requestLesson({ ...REQ, segment: ENG });
    expect(out.outcome).toBe('gb_not_built');
    expect(mockDbCalls.filter((c) => c.op !== 'select')).toHaveLength(0);
    expect(mockQueueJob).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
  test('only the exact string "true" turns authoring on', () => {
    process.env.LP_GB_AUTHOR_ENABLED = '1';
    expect(GbLane.isAuthorEnabled()).toBe(false);
    process.env.LP_GB_AUTHOR_ENABLED = 'true';
    expect(GbLane.isAuthorEnabled()).toBe(true);
  });
});

describe('dark stages stay dark', () => {
  test('a GB grade 6-12 lesson is told coming soon and nothing is read or authored', async () => {
    const out = await GbLane.requestLesson({ ...REQ, segment: { ...SEG, grade: 7 } });
    expect(out.outcome).toBe('gb_design_pending');
    expect(mockDbCalls).toHaveLength(0);
    expect(mockQueueJob).not.toHaveBeenCalled();
  });
});

// Queue #71 — "GB follows ICT 6-12": the app asks on GB's lane like a 6-12 lesson, and is never sent anything.
describe('an app (portal) ask', () => {
  const APP = { ...REQ, phone: undefined, surface: 'portal' };
  test('a written lesson answers its render, with no send', async () => {
    mockDbResults.push({ data: { id: 'gb-r1', status: 'ready', r2_key: `gb-lp/gb_k5_v9/ur/${SEG.segment_id}.pdf` }, error: null });
    expect(await GbLane.requestLesson(APP)).toEqual({ outcome: 'cache_hit', renderId: 'gb-r1', r2Key: `gb-lp/gb_k5_v9/ur/${SEG.segment_id}.pdf` });
    expect(mockDeliverRender).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
  test('an unwritten lesson is claimed and queued with a phone-less waiter, with no send', async () => {
    mockDbResults.push({ data: null, error: null }, { data: { id: 'gb-new' }, error: null });
    const out = await GbLane.requestLesson({ ...APP, phone: '920000000000' });
    expect(out).toEqual({ outcome: 'queued', renderId: 'gb-new' });
    const insert = mockDbCalls.find((c) => c.op === 'insert');
    expect(insert.table).toBe('niete_gb_lp_renders');
    expect(insert.payload.waiters).toEqual([expect.objectContaining({ user_id: 'user-1', phone: null, surface: 'portal' })]);
    expect(mockQueueJob).toHaveBeenCalledWith(SEG.segment_id, 'gb_lp_author', expect.objectContaining({ renderId: 'gb-new' }), expect.anything());
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
