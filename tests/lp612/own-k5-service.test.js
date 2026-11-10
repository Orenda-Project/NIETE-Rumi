/**
 * bd-snkn32.4 — "Make my own" for a grades 1–5 day: the request (lp612-own.service, lessonId) and the job
 * (lp612-own.worker, a row with lesson_id). Same table, same job type, same status poll as 6-12; the day's own plan
 * (its slide script) is the parent, rewritten in its book's language. Every dependency injected.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnService, OWN_JOB_TYPE } = require('../../bot/shared/services/lp612-own.service');
const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');

const ANSWERS = { size: 'over70', resources: ['board'], level: 'behind', way: 'tarl', note: '' };
const LESSON = 'grade_3_urdu_ch1_seg2';
const SCRIPT = { goal: 'ہدف', meta: { day: 2 }, hook: { conversation: [{ teacherAsks: 'کیا دیکھا؟' }] }, iDo: { steps: [{ say: 'سنیں' }] }, weDo: { action: 'مل کر' }, youDo: { action: 'خود' }, wrap: { homework: ['گھر'] } };

function service(over = {}) {
  const calls = { inserts: [], queued: [] };
  const deps = {
    templateVersion: () => 'v9.1',
    segmentExists: jest.fn(async () => false),
    readStoredDoc: jest.fn(),
    requestParent: jest.fn(),
    k5Lesson: jest.fn(async (id) => (id === LESSON ? { lessonId: LESSON, lang: 'ur', grade: 3, subject: 'urdu' } : null)),
    insertOwn: jest.fn(async (row) => { calls.inserts.push(row); return { id: 'own-k5' }; }),
    patchOwn: jest.fn(),
    queueJob: jest.fn(async (...a) => { calls.queued.push(a); }),
    selectOwn: jest.fn(async () => null),
    log: jest.fn(),
    ...over,
  };
  return { svc: createOwnService(deps), deps, calls };
}

describe('requestOwn with a grades 1–5 lessonId', () => {
  it('stores her row against the DAY, in its book\'s language, and queues the same job', async () => {
    const { svc, deps, calls } = service();
    const out = await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: ANSWERS, correlationId: 'c1' });
    expect(out).toEqual({ outcome: 'queued', ownId: 'own-k5' });
    expect(calls.inserts[0]).toEqual({
      user_id: 'u1', lesson_id: LESSON, lang: 'ur', template_version: 'k5_own_v1', status: 'authoring',
      answers: { ...ANSWERS, resources: ['textbook', 'board'] }, correlation_id: 'c1',
    });
    expect(calls.queued[0][0]).toBe(LESSON);
    expect(calls.queued[0][1]).toBe(OWN_JOB_TYPE);
    expect(deps.segmentExists).not.toHaveBeenCalled();
    expect(deps.requestParent).not.toHaveBeenCalled();
  });

  it('a day with no plan to rewrite (not in the catalogue, or no stored script) is not found, with no row', async () => {
    const { svc, deps } = service();
    expect((await svc.requestOwn({ userId: 'u1', lessonId: 'nope', answers: ANSWERS })).outcome).toBe('not_found');
    expect(deps.insertOwn).not.toHaveBeenCalled();
  });

  it('a segment AND a lesson, or bad answers, is a bad request', async () => {
    const { svc } = service();
    expect((await svc.requestOwn({ userId: 'u1', lessonId: LESSON, segmentId: 's', answers: ANSWERS })).outcome).toBe('bad_request');
    expect((await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: { ...ANSWERS, size: 'huge' } })).outcome).toBe('bad_request');
  });
});

const ROW = { id: 'own-k5', user_id: 'u1', segment_id: null, lesson_id: LESSON, lang: 'ur', template_version: 'k5_own_v1', status: 'authoring', answers: { ...ANSWERS, resources: ['textbook', 'board'] } };

function worker(over = {}) {
  const puts = [];
  const patches = [];
  const deps = {
    claimOwn: jest.fn(async () => ({ ...ROW })),
    loadSegment: jest.fn(),
    readStoredDoc: jest.fn(),
    revise: jest.fn(),
    render: jest.fn(),
    loadK5: jest.fn(async () => ({ script: SCRIPT, lang: 'ur', grade: 3, subject: 'urdu', subjectName: 'اردو' })),
    rewriteK5: jest.fn(async () => ({ script: { ...SCRIPT, weDo: { action: 'مل کر' } }, model: 'm-k5' })),
    renderK5: jest.fn(async () => Buffer.from('%PDF-k5')),
    readFile: jest.fn(),
    upload: jest.fn(async (buf, key, type) => { puts.push({ key, type, buf }); }),
    patchOwn: jest.fn(async (id, f) => { patches.push(f); }),
    sleep: jest.fn(), now: () => 0, log: jest.fn(),
    ...over,
  };
  return { w: createOwnWorker(deps), deps, puts, patches };
}

describe('the job for a grades 1–5 row', () => {
  it('rewrites the day\'s script with her answers, prints it, stores it under lp612/ only, and her row is ready', async () => {
    const { w, deps, puts, patches } = worker();
    await w.process({ ownId: 'own-k5', correlationId: 'c1' });
    expect(deps.loadK5).toHaveBeenCalledWith(LESSON);
    expect(deps.rewriteK5).toHaveBeenCalledWith(expect.objectContaining({ script: SCRIPT, answers: ROW.answers, lang: 'ur', grade: 3, subject: 'urdu' }));
    expect(deps.renderK5).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ur', grade: 3 }));
    expect(deps.revise).not.toHaveBeenCalled();
    expect(deps.readStoredDoc).not.toHaveBeenCalled();
    expect(puts[0].key).toMatch(new RegExp(`^lp612/own-k5/ur/${LESSON}/[0-9a-f]{16}\\.pdf$`));
    expect(puts[0].type).toBe('application/pdf');
    expect(puts[1].key).toMatch(/\.json$/);
    expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'ready', r2_key: puts[0].key, model_used: 'm-k5' }));
  });

  it('a day with no stored plan, a rejected rewrite, or a failed print ends her row failed, nothing stored', async () => {
    for (const [over, code] of [
      [{ loadK5: jest.fn(async () => null) }, 'NO_PARENT'],
      [{ loadK5: jest.fn(async () => ({ script: { ...SCRIPT, weDo: {} }, lang: 'ur', grade: 3, subject: 'urdu' })) }, 'INCOMPLETE_PARENT'],
      [{ rewriteK5: jest.fn(async () => null) }, 'NOT_ACCEPTED'],
      [{ renderK5: jest.fn(async () => { throw new Error('chrome'); }) }, 'RENDER_FAILED'],
    ]) {
      const { w, puts, patches } = worker(over);
      await w.process({ ownId: 'own-k5' });
      expect(puts).toEqual([]);
      expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: code }));
    }
  });
});

it('bd-snkn32.12: a parent missing a gradual-release part is refused before any rewrite, naming the part', async () => {
  const { w, deps, patches } = worker({ loadK5: jest.fn(async () => ({ script: { ...SCRIPT, hook: {} }, lang: 'ur', grade: 3, subject: 'urdu' })) });
  await w.process({ ownId: 'own-k5' });
  expect(deps.rewriteK5).not.toHaveBeenCalled();
  expect(patches[patches.length - 1]).toEqual(expect.objectContaining({ status: 'failed', error_code: 'INCOMPLETE_PARENT' }));
  expect(patches[patches.length - 1].error_detail).toMatch(/hook/);
});
