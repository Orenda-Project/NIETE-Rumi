/**
 * A deploy must not leave a teacher's paper parked behind a dead worker.
 *
 * What happened: a deploy restarted the worker while a paper was being made. The platform gives the
 * process seconds, not the ten-minute drain the worker asks for, so the run died with its message
 * still invisible (the visibility heartbeat had pushed it 900 s out) and its paper row still
 * `generating`. The teacher's next paper sat behind it in the same FIFO group, and the redelivered
 * job only took the row over once it had been silent for ten minutes. About fifteen minutes, all
 * told, for nothing.
 *
 * Now:
 *   - on SIGTERM an in-flight paper is handed back AT ONCE: its row goes back to `queued` first,
 *     then its message's visibility is set to 0, so the next worker can start it straight away;
 *   - a `queued` row is taken over immediately; a `generating` one once it is silent 180 s;
 *   - while a paper is being made the worker touches its row every minute, so 180 s of silence
 *     only ever means the run is gone (a pattern section alone can wait 300 s on the model).
 *
 * Drives the REAL worker (executeJob, processJob, shutdown) and the REAL orchestrator take-over,
 * against an in-memory database and a doubled SQS. The only part of the orchestrator replaced is
 * `process` when the worker runs it, so a test can hold a paper "in progress".
 */

const mockState = { rows: {}, seq: 0, events: [] };

function mockFakeDb() {
  const now = () => new Date().toISOString();
  function from(table) {
    const st = { table, op: 'select', payload: null, filters: [], order: null, limit: null };
    const rows = () => (mockState.rows[table] ||= []);
    const match = (r) => st.filters.every(([k, op, v]) => (op === 'is' ? (v === null ? r[k] == null : r[k] === v) : r[k] === v));
    const run = () => {
      if (st.op === 'insert') {
        const p = st.payload;
        if (table === 'assessment_papers') {
          const clash = rows().find((r) => r.request_id === p.request_id && (r.attempt || 1) === (p.attempt || 1) && r.edited_from == null);
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        mockState.seq += 1;
        const row = { id: `paper-new-${mockState.seq}`, attempt: 1, edited_from: null, created_at: now(), updated_at: now(), ...p };
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        mockState.events.push({ kind: 'db-update', table, payload: st.payload, filters: st.filters.slice(), matched: hit.length });
        return { data: null, error: null };
      }
      let hit = rows().filter(match);
      if (st.order) hit = hit.slice().sort((a, b) => (st.order.ascending ? 1 : -1) * ((a[st.order.col] || 0) - (b[st.order.col] || 0)));
      if (st.limit != null) hit = hit.slice(0, st.limit);
      return { data: hit, error: null };
    };
    const b = {
      insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      select: () => b,
      eq: (k, v) => { st.filters.push([k, 'eq', v]); return b; },
      is: (k, v) => { st.filters.push([k, 'is', v]); return b; },
      order: (col, o = {}) => { st.order = { col, ascending: o.ascending !== false }; return b; },
      limit: (n) => { st.limit = n; return b; },
      single: async () => { const r = run(); if (r.error) return r; const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: d ? null : { message: 'no rows' } }; },
      maybeSingle: async () => { const r = run(); if (r.error) return r; const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: null }; },
      then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  }
  return { from };
}

const mockExtend = jest.fn(() => Promise.resolve());
const mockRelease = jest.fn((rh, q) => { mockState.events.push({ kind: 'sqs-release', rh, q }); return Promise.resolve(); });
const mockComplete = jest.fn(() => Promise.resolve());
const mockGenerateExam = jest.fn();
let mockProcess = jest.fn();

jest.mock('../../bot/shared/config/supabase', () => mockFakeDb());
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  releaseInFlightMessage: (...a) => mockRelease(...a),
  receiveJobs: jest.fn(() => Promise.resolve([])),
  deleteJob: jest.fn(() => Promise.resolve()),
  completeJob: (...a) => mockComplete(...a),
  extendJobTimeout: (...a) => mockExtend(...a),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: async () => ({ content: '=== Page 12 ===\nFractions', pageReference: '12-20', chapterTitle: 'Fractions' }),
  loadPageRangeContent: async () => ({ content: '=== Page 12 ===\nFractions', pageReference: '12-20', chapterTitle: 'Fractions' }),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({
  generateExam: (...a) => mockGenerateExam(...a),
}));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({ ext: 'pdf', render: async () => Buffer.from('%PDF-1.4 fake') }),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: async ({ filename }) => `exams/teacher-1/${filename}`,
  buildR2PublicUrl: (k) => `https://r2/${k}`,
  getPresignedUrl: async (u) => `${u}?signed`,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async () => true), sendMessage: jest.fn(async () => true), sendFlow: jest.fn(),
}));
// The real orchestrator, except `process`, which the worker tests hold open.
jest.mock('../../bot/shared/services/assessment/assessment-orchestrator.service', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/assessment-orchestrator.service'),
  process: (...a) => mockProcess(...a),
}));

const JOB = {
  userId: 'teacher-1', requestId: 'req-1', grade: 5, subject: 'maths', chapterNumber: 2,
  questionTypes: [{ id: 'MCQs', count: 2, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};
const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();
const papers = () => mockState.rows.assessment_papers || [];
function seedPaper(row) {
  mockState.rows.assessment_papers = mockState.rows.assessment_papers || [];
  mockState.rows.assessment_papers.push({ attempt: 1, edited_from: null, created_at: secondsAgo(600), updated_at: secondsAgo(1), ...row });
}

async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function pending() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, finish: (v) => { resolve(v); return promise; } };
}

let Orchestrator;
let SQSCoachingWorker;

beforeEach(() => {
  jest.resetModules();
  mockState.rows = { users: [{ id: 'teacher-1', phone_number: 'wa-teacher-1', preferred_language: 'en', school_name: null }] };
  mockState.seq = 0;
  mockState.events = [];
  mockExtend.mockClear();
  mockRelease.mockClear();
  mockComplete.mockClear();
  mockGenerateExam.mockReset();
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q1', marks: 1 }, { question: 'q2', marks: 1 }] } } },
    questionCount: 2, tokenData: { inputTokens: 10, outputTokens: 5, model: 'm' },
  });
  process.env.SQS_QUEUE_URL = 'https://sqs/main';
  delete process.env.LP612_DRAIN_TIMEOUT_MS;
  Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('orchestrator: the stale take-over', () => {
  test('a generating row silent 200 s is taken over', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: secondsAgo(200) });
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out).toMatchObject({ status: 'ready', paperId: 'paper-1' });
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
    expect(papers()).toHaveLength(1);
  });

  test('a generating row silent 60 s is not taken over', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: secondsAgo(60) });
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out).toMatchObject({ status: 'skipped', duplicate: true, paperId: 'paper-1' });
    expect(mockGenerateExam).not.toHaveBeenCalled();
  });

  test('the threshold is at most 180 s', () => {
    expect(Orchestrator.PAPER_STALE_MS).toBeLessThanOrEqual(180 * 1000);
  });

  test('a row handed back at a deploy (queued) is taken over at once, however recently it was written', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'queued', updated_at: secondsAgo(2) });
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out).toMatchObject({ status: 'ready', paperId: 'paper-1' });
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
  });

  test('handing a paper back moves only a generating row to queued — never a finished one', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating' });
    seedPaper({ id: 'paper-2', request_id: 'req-2', status: 'ready' });
    expect(await Orchestrator.releasePaperForTakeover('req-1')).toBe(true);
    expect(await Orchestrator.releasePaperForTakeover('req-2')).toBe(true);
    expect(papers().find((p) => p.id === 'paper-1').status).toBe('queued');
    expect(papers().find((p) => p.id === 'paper-2').status).toBe('ready');
    expect(await Orchestrator.releasePaperForTakeover(null)).toBe(false);
  });

  test('the row heartbeat touches a generating row and nothing else', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: secondsAgo(170) });
    seedPaper({ id: 'paper-2', request_id: 'req-1', status: 'ready', edited_from: 'paper-1', updated_at: secondsAgo(170) });
    await Orchestrator.touchGeneratingPaper('req-1');
    const p1 = papers().find((p) => p.id === 'paper-1');
    const p2 = papers().find((p) => p.id === 'paper-2');
    expect(Date.now() - Date.parse(p1.updated_at)).toBeLessThan(5000);
    expect(p1.status).toBe('generating');
    expect(Date.now() - Date.parse(p2.updated_at)).toBeGreaterThan(160 * 1000);
  });
});

describe('worker: a live paper keeps its row fresh', () => {
  test('while a paper is being made its row is written at least every minute, and not after', async () => {
    jest.useFakeTimers();
    ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: new Date().toISOString() });
    const paper = pending();
    mockProcess = jest.fn(() => paper.promise);
    const w = new SQSCoachingWorker('w-row-hb');

    const run = w.executeJob('req-1', 'assessment_generate', JOB, 'rh-1', 'main', {});
    // Five minutes of a model call that writes nothing itself.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await jest.advanceTimersByTimeAsync(60 * 1000);
      // eslint-disable-next-line no-await-in-loop
      await flush();
      expect(Date.now() - Date.parse(papers()[0].updated_at)).toBeLessThanOrEqual(60 * 1000);
    }
    // A redelivery now sees a live run, so it is not stolen.
    jest.useRealTimers();
    const dup = await Orchestrator.buildPaper(JOB, {});
    expect(dup.status).toBe('skipped');
    jest.useFakeTimers();

    paper.finish({ status: 'ready' });
    await run;
    const touches = mockState.events.filter((e) => e.kind === 'db-update').length;
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    await flush();
    expect(mockState.events.filter((e) => e.kind === 'db-update').length).toBe(touches);
  });
});

describe('worker: SIGTERM and an in-flight paper', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ({ SQSCoachingWorker } = require('../../bot/workers/sqs-worker'));
  });

  test("SIGTERM with an assessment_generate job that cannot finish inside the grace: the message's visibility is set to 0 and the paper row goes back to queued", async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: new Date().toISOString() });
    const w = new SQSCoachingWorker('w-term-1');
    const paper = pending();
    w.activeJobs.set('rh-paper', { promise: paper.promise, sourceQueue: 'main', jobType: 'assessment_generate', requestId: 'req-1' });

    let settled = false;
    const done = w.shutdown().then(() => { settled = true; });
    // Well inside the seconds a platform gives a stopping container.
    await jest.advanceTimersByTimeAsync(1000);

    expect(papers()[0].status).toBe('queued');
    expect(mockRelease).toHaveBeenCalledWith('rh-paper', 'main');
    // Row first, then the message: a delivery that beat the row change would read a fresh
    // `generating` row, skip it, and ack the only message the paper had.
    const order = mockState.events.map((e) => e.kind);
    expect(order.indexOf('db-update')).toBeLessThan(order.indexOf('sqs-release'));
    // Nothing else is running, so the worker does not wait on a paper it has handed back.
    expect(settled).toBe(true);
    await done;

    // The next delivery builds it straight away, into the same row.
    jest.useRealTimers();
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out).toMatchObject({ status: 'ready', paperId: 'paper-1' });
  });

  // bd-3itk00: an `analysis` is now finished on shutdown rather than handed back at 30 s
  // (tests/queue/bd-3itk00-deploy-finishes-analysis.test.js); a transcription still gets the 30 s grace.
  test('a coaching job is NOT released at SIGTERM — it still gets the 30 s grace', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating' });
    const w = new SQSCoachingWorker('w-term-2');
    const paper = pending();
    const transcription = pending();
    w.activeJobs.set('rh-paper', { promise: paper.promise, sourceQueue: 'main', jobType: 'assessment_generate', requestId: 'req-1' });
    w.activeJobs.set('rh-transcription', { promise: transcription.promise, sourceQueue: 'main', jobType: 'transcription' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith('rh-paper', 'main');

    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockRelease).toHaveBeenCalledTimes(2);
    expect(mockRelease).toHaveBeenLastCalledWith('rh-transcription', 'main');
    await done;
  });

  test('a paper whose row cannot be marked is not released (its message would be acked by a skip)', async () => {
    const w = new SQSCoachingWorker('w-term-3');
    const paper = pending();
    // No requestId: the row cannot be found, so the message is left to its visibility window.
    w.activeJobs.set('rh-paper', { promise: paper.promise, sourceQueue: 'main', jobType: 'assessment_generate' });

    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(31_000);
    expect(mockRelease).not.toHaveBeenCalled();
    await done;
  });

  test('once handed back, the paper stops extending its message and stops touching its row', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: new Date().toISOString() });
    const paper = pending();
    mockProcess = jest.fn(() => paper.promise);
    const w = new SQSCoachingWorker('w-term-4');
    w.processJob({ receiptHandle: 'rh-paper', sourceQueue: 'main', body: { sessionId: 'req-1', jobType: 'assessment_generate', payload: JOB } });
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(w.activeJobs.get('rh-paper').requestId).toBe('req-1');

    await w.shutdown();
    expect(papers()[0].status).toBe('queued');
    const extends0 = mockExtend.mock.calls.length;
    const updates0 = mockState.events.filter((e) => e.kind === 'db-update').length;
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
    await flush();
    // An extension now would hide the message for another 900 s from the worker that should take it.
    expect(mockExtend.mock.calls.length).toBe(extends0);
    expect(mockState.events.filter((e) => e.kind === 'db-update').length).toBe(updates0);
    expect(papers()[0].status).toBe('queued');

    // If the old run somehow finishes, it must not delete a message the next worker now holds.
    paper.finish({ status: 'ready' });
    await flush(20);
    expect(mockComplete).not.toHaveBeenCalled();
  });
  // bd-qyi45h.17 — prod 19 Nov 09:56: a worker got SIGTERM in the same second its long poll returned a
  // paper. Phase 0 had already run, so the paper was not handed back; at the 30 s grace it was released
  // as a "short" job with its row still `generating`. The next worker read a fresh `generating` row,
  // skipped it and acked the paper's only message. The teacher never got the paper (14 of 21 lost
  // papers in 18-24 Nov sat next to a restart).
  test('a job claimed after SIGTERM is not started: its message goes straight back', async () => {
    const w = new SQSCoachingWorker('w-term-5');
    mockProcess = jest.fn(() => pending().promise);
    const done = w.shutdown();
    w.processJob({ receiptHandle: 'rh-late', sourceQueue: 'main', body: { sessionId: 'req-1', jobType: 'assessment_generate', payload: JOB } });
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockProcess).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith('rh-late', 'main');
    expect(w.activeJobs.has('rh-late')).toBe(false);
    const { logToFile } = require('../../bot/shared/utils/logger');
    expect(logToFile).toHaveBeenCalledWith('Job claimed after shutdown began; handing it back unstarted',
      { workerId: 'w-term-5', jobType: 'assessment_generate', sourceQueue: 'main' });
    await jest.advanceTimersByTimeAsync(31_000);
    await done;
  });

  test('a late job with no source queue goes back to main; a failed hand-back is logged, not thrown', async () => {
    const w = new SQSCoachingWorker('w-term-7');
    mockProcess = jest.fn(() => pending().promise);
    mockRelease.mockImplementationOnce(() => Promise.reject(new Error('ReceiptHandleIsInvalid')));
    const done = w.shutdown();
    w.processJob({ receiptHandle: 'rh-late', body: { sessionId: 'req-1', jobType: 'assessment_generate', payload: JOB } });
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockRelease).toHaveBeenCalledWith('rh-late', 'main');
    expect(mockProcess).not.toHaveBeenCalled();
    const { logToFile } = require('../../bot/shared/utils/logger');
    expect(logToFile).toHaveBeenCalledWith('Job claimed after shutdown began; handing it back unstarted',
      { workerId: 'w-term-7', jobType: 'assessment_generate', sourceQueue: 'main' });
    expect(logToFile).toHaveBeenCalledWith('⚠️ Could not hand back a job claimed after shutdown began',
      { workerId: 'w-term-7', jobType: 'assessment_generate', error: 'ReceiptHandleIsInvalid' });
    await jest.advanceTimersByTimeAsync(31_000);
    await done;
  });

  test('a paper that joined after Phase 0 has its row handed back before its message at the grace deadline', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', updated_at: new Date().toISOString() });
    const w = new SQSCoachingWorker('w-term-6');
    // As on prod: another job was running, so Phase 1 waits out its 30 s grace.
    w.activeJobs.set('rh-analysis', { promise: pending().promise, sourceQueue: 'main', jobType: 'analysis' });
    const done = w.shutdown();
    await jest.advanceTimersByTimeAsync(1000);
    // In flight before shutdown could see it (a batch already returned when SIGTERM arrived).
    w.activeJobs.set('rh-paper', { promise: pending().promise, sourceQueue: 'main', jobType: 'assessment_generate', requestId: 'req-1' });
    await jest.advanceTimersByTimeAsync(31_000);
    await done;
    expect(papers()[0].status).toBe('queued');
    expect(mockRelease).toHaveBeenCalledWith('rh-paper', 'main');
    const order = mockState.events.map((e) => e.kind);
    expect(order.indexOf('db-update')).toBeLessThan(order.indexOf('sqs-release'));
    // The next delivery takes it over instead of skipping it.
    jest.useRealTimers();
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out).toMatchObject({ status: 'ready', paperId: 'paper-1' });
  });
});
