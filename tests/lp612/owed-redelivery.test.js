'use strict';
/**
 * bd-s8mi25 — a lesson authored, marked ready, and half-delivered when a deploy killed the worker.
 *
 * Sandbox, 11 Nov: the summary text reached her, the PDF never did. The worker had already claimed
 * (and so emptied) the waiter list, and SQS's redelivery saw `status: 'ready'` and skipped — the
 * only record of who was owed the PDF died with the container.
 *
 * Now the claimed audience is remembered (Redis, hours) before the first send and forgotten after
 * the loop. A redelivered job for a ready row finishes the delivery for every owed teacher with no
 * delivery row; with nothing remembered it skips exactly as before.
 */

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDeliverRender = jest.fn();
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({
  deliverRender: (...a) => mockDeliverRender(...a),
}));
const mockClaims = jest.fn();
const mockRecord = jest.fn();
jest.mock('../../bot/shared/services/lp612-deliveries.store', () => ({
  claimsRender: (...a) => mockClaims(...a),
  record: (...a) => mockRecord(...a),
}));
const ROW = {
  id: 'render-1', status: 'ready', segment_id: 'grade_6_geography.c03.p041-042', r2_key: 'lp612/v9.1/en/g.pdf',
  one_screen: 'summary', overlay_dropped: false, render_degraded: false,
};
jest.mock('../../bot/shared/config/supabase', () => {
  const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: ROW, error: null }) };
  return { from: () => b };
});

const Owed = require('../../bot/shared/services/lp612-owed.store');
const { redeliverOwed } = require('../../bot/workers/lp612-redeliver');

const SEGMENT = { segment_id: ROW.segment_id, grade: 6, subject: 'Geography' };
const loadSegment = jest.fn(async () => SEGMENT);
const JOB = { renderId: 'render-1', segmentId: ROW.segment_id, lang: 'en', correlationId: 'c1' };
const U1 = { user_id: 'u1', phone: '923001111111' };
const U2 = { user_id: 'u2', phone: '923002222222' };

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockDeliverRender.mockResolvedValue(undefined);
});

describe('the owed store', () => {
  test('remembers, recalls and forgets the claimed audience of one render', async () => {
    await Owed.remember('render-1', [U1, U2]);
    expect(await Owed.recall('render-1')).toEqual([U1, U2]);
    await Owed.forget('render-1');
    expect(await Owed.recall('render-1')).toEqual([]);
  });

  test('nothing to remember writes nothing; a junk value recalls as []', async () => {
    await Owed.remember('render-1', []);
    expect(mockStore.size).toBe(0);
    mockStore.set('lp612:owed:render-1', 'junk');
    expect(await Owed.recall('render-1')).toEqual([]);
  });
});

describe('a redelivered job for a ready row', () => {
  test('sends the PDF to every owed teacher with no delivery row, then forgets them', async () => {
    await Owed.remember('render-1', [U1, U2]);
    mockClaims.mockImplementation(async (_r, uid) => uid === 'u1'); // u1 got it before the kill
    const out = await redeliverOwed(JOB, { loadSegment });
    expect(out).toMatchObject({ status: 'redelivered', delivered: 1, alreadyHad: 1, deliveryFailures: 0 });
    expect(mockDeliverRender).toHaveBeenCalledTimes(1);
    expect(mockDeliverRender.mock.calls[0][0]).toMatchObject({
      phone: U2.phone, userId: 'u2', r2Key: ROW.r2_key, segment: SEGMENT, lang: 'en', oneScreen: 'summary', renderId: 'render-1',
    });
    expect(await Owed.recall('render-1')).toEqual([]);
  });

  test('a portal waiter gets her claim row, never a WhatsApp send', async () => {
    await Owed.remember('render-1', [{ user_id: 'p1', surface: 'portal' }]);
    mockClaims.mockResolvedValue(false);
    const out = await redeliverOwed(JOB, { loadSegment });
    expect(mockDeliverRender).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ userId: 'p1', renderId: 'render-1', surface: 'portal' }));
    expect(out.selfServe).toBe(1);
  });

  test('nothing remembered → null, so the worker skips exactly as before', async () => {
    expect(await redeliverOwed(JOB, { loadSegment })).toBeNull();
    expect(mockDeliverRender).not.toHaveBeenCalled();
  });

  test('one failed send is counted, not thrown, and the rest still go', async () => {
    await Owed.remember('render-1', [U1, U2]);
    mockClaims.mockResolvedValue(false);
    mockDeliverRender.mockRejectedValueOnce(new Error('meta down'));
    const out = await redeliverOwed(JOB, { loadSegment });
    expect(out).toMatchObject({ delivered: 1, deliveryFailures: 1 });
  });
});
