/**
 * bd-snkn32 — "Make my own": the request and the status read (lp612-own.service).
 *
 * Every dependency is passed in (createOwnService), so these tests stand up no Supabase, no R2 and no queue.
 */

const { createOwnService, OWN_JOB_TYPE } = require('../../bot/shared/services/lp612-own.service');

const ANSWERS = { size: '51_70', resources: ['board'], level: 'mixed', way: 'tarl', note: '' };
const SEG = 'grade_8_science.c02.p010-013';

function harness(over = {}) {
  const calls = { inserts: [], patches: [], queued: [], requested: [] };
  const deps = {
    templateVersion: () => 'v9.1',
    segmentExists: jest.fn(async (id) => id === SEG),
    readStoredDoc: jest.fn(async () => ({ sections: {} })),
    requestParent: jest.fn(async (args) => { calls.requested.push(args); return { outcome: 'queued' }; }),
    insertOwn: jest.fn(async (row) => { calls.inserts.push(row); return { id: 'own-1' }; }),
    patchOwn: jest.fn(async (id, fields) => { calls.patches.push({ id, fields }); }),
    queueJob: jest.fn(async (...args) => { calls.queued.push(args); }),
    selectOwn: jest.fn(async () => null),
    listChain: jest.fn(async () => []),
    countToday: jest.fn(async () => 0),
    now: () => Date.now(),
    log: jest.fn(),
    ...over,
  };
  return { svc: createOwnService(deps), deps, calls };
}

describe('requestOwn', () => {
  it('refuses bad answers without touching anything', async () => {
    const { svc, deps } = harness();
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...ANSWERS, way: 'lecture' } });
    expect(out.outcome).toBe('bad_request');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('needs a user and a segment', async () => {
    const { svc } = harness();
    expect((await svc.requestOwn({ segmentId: SEG, answers: ANSWERS })).outcome).toBe('bad_request');
    expect((await svc.requestOwn({ userId: 'u1', answers: ANSWERS })).outcome).toBe('bad_request');
  });

  it('a segment not in the catalogue is not found', async () => {
    const { svc, deps } = harness();
    expect((await svc.requestOwn({ userId: 'u1', segmentId: 'nope', answers: ANSWERS })).outcome).toBe('not_found');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('stores her parsed answers on her row, in English, on the current template, and queues the job', async () => {
    const { svc, calls } = harness();
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS, correlationId: 'c1' });
    expect(out).toEqual({ outcome: 'queued', ownId: 'own-1' });
    expect(calls.inserts[0]).toEqual({
      user_id: 'u1', segment_id: SEG, lang: 'en', template_version: 'v9.1', status: 'authoring',
      answers: { ...ANSWERS, resources: ['textbook', 'board'] }, correlation_id: 'c1',
    });
    expect(calls.queued[0][0]).toBe(SEG);
    expect(calls.queued[0][1]).toBe(OWN_JOB_TYPE);
    expect(calls.queued[0][2]).toEqual({ ownId: 'own-1', correlationId: 'c1' });
    expect(calls.queued[0][3].deduplicationId).toMatch(/own-1/);
  });

  it('asks for the shared plan first when it has not been written, exactly as her tap would', async () => {
    const { svc, calls } = harness({ readStoredDoc: jest.fn(async () => null) });
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(out.outcome).toBe('queued');
    expect(calls.requested).toEqual([{ segmentId: SEG, userId: 'u1', lang: 'en', surface: 'portal', correlationId: null }]);
  });

  it('does not ask for the shared plan when it is already stored', async () => {
    const { svc, calls } = harness();
    await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(calls.requested).toEqual([]);
  });

  it.each([['held'], ['not_found']])('a %s shared plan is answered as such, with no row', async (outcome) => {
    const { svc, deps } = harness({
      readStoredDoc: jest.fn(async () => null),
      requestParent: jest.fn(async () => ({ outcome })),
    });
    expect((await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS })).outcome).toBe(outcome);
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('a queue that fails marks her row failed and says so', async () => {
    const { svc, calls } = harness({ queueJob: jest.fn(async () => { throw new Error('sqs down'); }) });
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(out.outcome).toBe('error');
    expect(calls.patches[0]).toEqual({ id: 'own-1', fields: expect.objectContaining({ status: 'failed', error_code: 'ENQUEUE_FAILED' }) });
  });

  it('an insert that fails is an error, and nothing is queued', async () => {
    const { svc, deps } = harness({ insertOwn: jest.fn(async () => null) });
    expect((await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS })).outcome).toBe('error');
    expect(deps.queueJob).not.toHaveBeenCalled();
  });
});

describe('ownStatus — the row in the render shape, hers only', () => {
  const row = {
    id: 'own-1', user_id: 'u1', segment_id: SEG, status: 'ready', r2_key: 'lp612/v9.1/en/edits/x/h.pdf',
    error_code: null, lang: 'en', started_at: 't0', completed_at: 't1',
  };

  it('reads by id AND her user id', async () => {
    const { svc, deps } = harness({ selectOwn: jest.fn(async () => row) });
    const out = await svc.ownStatus('own-1', 'u1');
    expect(deps.selectOwn).toHaveBeenCalledWith('own-1', 'u1');
    expect(out).toEqual({
      id: 'own-1', segment_id: SEG, status: 'ready', r2_key: row.r2_key, one_screen: null,
      error_code: null, lang: 'en', started_at: 't0', completed_at: 't1', changes_left: 2, own_band: 'g612',
      library_eligible: false, review_score: null, // bd-snkn32.16: not reviewed yet
    });
  });

  it('nothing for someone else, or no id', async () => {
    const { svc } = harness();
    expect(await svc.ownStatus('own-1', 'u2')).toBeNull();
    expect(await svc.ownStatus('', 'u1')).toBeNull();
    expect(await svc.ownStatus('own-1', '')).toBeNull();
  });

  it('a read that throws is nothing, never a crash', async () => {
    const { svc } = harness({ selectOwn: jest.fn(async () => { throw new Error('db'); }) });
    expect(await svc.ownStatus('own-1', 'u1')).toBeNull();
  });
});

describe('bd-snkn32.15 — the daily limit and changes left', () => {
  it('a sixth make in her Pakistan day is refused before anything is written or asked for', async () => {
    const { svc, deps } = harness({ countToday: jest.fn(async () => 5) });
    const out = await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: ANSWERS });
    expect(out.outcome).toBe('daily_limit');
    expect(deps.requestParent).not.toHaveBeenCalled();
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('a ready plan says how many changes are left and which band it is', async () => {
    const row = { id: 'own-1', user_id: 'u1', segment_id: SEG, status: 'ready', r2_key: 'lp612/k.pdf', lang: 'en', parent_own_id: null };
    const chain = [row, { id: 'r1', parent_own_id: 'own-1', edit_round: 1, status: 'ready' }];
    const { svc, deps } = harness({ selectOwn: jest.fn(async () => row), listChain: jest.fn(async () => chain) });
    const out = await svc.ownStatus('own-1', 'u1');
    expect(out).toMatchObject({ changes_left: 1, own_band: 'g612' });
    expect(deps.listChain).toHaveBeenCalledWith('own-1', 'u1');
  });

  it('a change row counts its root\'s chain; a plan still being written says nothing about changes', async () => {
    const row = { id: 'r1', user_id: 'u1', lesson_id: 'grade_3_urdu_ch1_seg2', status: 'ready', parent_own_id: 'own-1' };
    const { svc, deps } = harness({ selectOwn: jest.fn(async () => row), listChain: jest.fn(async () => [row]) });
    expect(await svc.ownStatus('r1', 'u1')).toMatchObject({ changes_left: 1, own_band: 'k5' }); // r1 itself is used
    expect(deps.listChain).toHaveBeenCalledWith('own-1', 'u1');
    const { svc: s2 } = harness({ selectOwn: jest.fn(async () => ({ ...row, status: 'authoring' })) });
    expect(await s2.ownStatus('r1', 'u1')).not.toHaveProperty('changes_left');
  });
});
