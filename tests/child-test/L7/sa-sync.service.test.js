/**
 * The Learning assessment — what the phone sends while and after a child takes the battery.
 *
 * The engine on the coach's phone keeps every event and result on the phone first, then sends them
 * in batches (numbered per session) and uploads each task's recording straight to R2. Pinned here:
 *   - only the coach's own session, and only one marked self-administered
 *   - the battery for the session's grade and form, in the language asked for
 *   - a batch is idempotent: the server upserts by (session, seq) and (session, task) and acks seqTo
 *   - the battery's end completes the session
 *   - a recording's key is minted per session and task, and must be that key when registered
 *   - a recording is handed to the existing scorer only when CHILD_TEST_SA_SCORE_LATER is on
 */

const SVC = '../../../bot/shared/services/child-test/app/sa-api.service';

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SCHOOL = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const PLAIN = '66666666-6666-4666-8666-666666666666';
const KEY = `child-test/sandbox/${SCHOOL}/${SESSION}/sa/ur.letters.webm`;

function makeDeps(over = {}) {
  const sessions = {
    [SESSION]: { id: SESSION, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'B', status: 'in_progress', item_bank_version: 'sa-battery' },
    [PLAIN]: { id: PLAIN, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'A', status: 'in_progress', item_bank_version: 'v1' },
  };
  return {
    store: {
      getSession: jest.fn(async (id) => ({ ok: true, session: sessions[id] || null })),
      setSessionStatus: jest.fn(async () => ({ ok: true })),
      recordTiming: jest.fn(async () => ({ ok: true })),
      attachBlockMedia: jest.fn(async () => ({ ok: true })),
    },
    saStore: {
      putEvents: jest.fn(async () => ({ ok: true })),
      putResults: jest.fn(async () => ({ ok: true })),
      setResultAudio: jest.fn(async () => ({ ok: true })),
      summary: jest.fn(async () => ({ ok: true, lastSeq: 41, tasksDone: ['ur.letters'], audio: ['ur.letters'] })),
    },
    r2: {
      getPresignedUploadUrl: jest.fn(async (key) => `https://r2.example/${key}?sig=1`),
      headObject: jest.fn(async () => ({ exists: true, sizeBytes: 1000 })),
    },
    loadBattery: jest.fn((grade, form, lang) => (form === 'A' ? { battery_id: `sa-coach-g${grade}-a-${lang}`, lang, tasks: [] } : null)),
    scoreLater: false,
    env: 'sandbox',
    now: () => new Date('2026-10-02T09:00:00Z'),
    enabled: () => true,
    log: jest.fn(),
    logError: jest.fn(),
    ...over,
  };
}

let Svc;
beforeEach(() => {
  jest.resetModules();
  Svc = require(SVC);
});

describe('identity', () => {
  test("another coach's session, or a coach-recorded one, is not found", async () => {
    const deps = makeDeps();
    expect(await Svc.saBattery({ userId: OTHER, sessionId: SESSION, lang: 'ur' }, deps)).toEqual({ status: 'not_found' });
    expect(await Svc.saBatch({ userId: COACH, sessionId: PLAIN, seqFrom: 0, seqTo: 0, events: [], results: [] }, deps)).toEqual({ status: 'not_found' });
    expect(deps.saStore.putEvents).not.toHaveBeenCalled();
  });
});

describe('saBattery', () => {
  test("the session's grade, its form — or form A when that form has no battery yet — in the language asked", async () => {
    const deps = makeDeps();
    const res = await Svc.saBattery({ userId: COACH, sessionId: SESSION, lang: 'en' }, deps);
    expect(res).toEqual({ status: 'ok', battery: { battery_id: 'sa-coach-g3-a-en', lang: 'en', tasks: [] } });
    expect(deps.loadBattery).toHaveBeenCalledWith(3, 'B', 'en');
    expect(deps.loadBattery).toHaveBeenCalledWith(3, 'A', 'en');
  });

  test('Urdu by default; no battery at all is not_ready', async () => {
    const deps = makeDeps({ loadBattery: jest.fn(() => null) });
    expect(await Svc.saBattery({ userId: COACH, sessionId: SESSION }, deps)).toEqual({ status: 'not_ready', reason: 'no_battery' });
    expect(deps.loadBattery).toHaveBeenCalledWith(3, 'B', 'ur');
  });
});

describe('saBatch', () => {
  const ev = (seq, type = 'tap', extra = {}) => ({ seq, t_ms: seq * 100, at: '2026-10-02T09:00:00Z', type, task_id: 'ur.letters', item_id: 'i1', value: { x: 1 }, ...extra });

  test('stores events and results and acks seqTo', async () => {
    const deps = makeDeps();
    const results = [{ task_id: 'ur.letters', correct: 12, attempted: 20, stop_reason: 'time_up' }];
    const res = await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 0, seqTo: 1, events: [ev(0), ev(1)], results }, deps);
    expect(res).toEqual({ status: 'ok', ackedTo: 1 });
    expect(deps.saStore.putEvents).toHaveBeenCalledWith(SESSION, [
      { seq: 0, t_ms: 0, at: '2026-10-02T09:00:00Z', type: 'tap', task_id: 'ur.letters', item_id: 'i1', value: { x: 1 } },
      { seq: 1, t_ms: 100, at: '2026-10-02T09:00:00Z', type: 'tap', task_id: 'ur.letters', item_id: 'i1', value: { x: 1 } },
    ]);
    expect(deps.saStore.putResults).toHaveBeenCalledWith(SESSION, [{ task_id: 'ur.letters', result: results[0] }]);
    expect(deps.store.setSessionStatus).not.toHaveBeenCalled();
  });

  test('a malformed batch is refused whole, nothing stored', async () => {
    const deps = makeDeps();
    const bad = [
      { seqFrom: 0, seqTo: 1, events: 'x', results: [] },
      { seqFrom: 0, seqTo: 1, events: [ev(0), { seq: -1, type: 'tap' }], results: [] },
      { seqFrom: 0, seqTo: 0, events: [{ seq: 0 }], results: [] },
      { seqFrom: 0, seqTo: 0, events: [], results: [{ correct: 1 }] },
      { seqFrom: 0, seqTo: 9999, events: Array.from({ length: 501 }, (_, i) => ev(i)), results: [] },
    ];
    for (const b of bad) {
      // eslint-disable-next-line no-await-in-loop
      expect(await Svc.saBatch({ userId: COACH, sessionId: SESSION, ...b }, deps)).toEqual({ status: 'invalid', reason: 'bad_batch' });
    }
    expect(deps.saStore.putEvents).not.toHaveBeenCalled();
  });

  test("the battery's end completes the session, once", async () => {
    const deps = makeDeps();
    await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 5, seqTo: 5, events: [ev(5, 'battery_end')], results: [] }, deps);
    expect(deps.store.setSessionStatus).toHaveBeenCalledWith(SESSION, 'completed');
    expect(deps.store.recordTiming).toHaveBeenCalledWith(SESSION, 'sa.finished', expect.any(Date));
  });

  test('a store failure is an error, never an ack', async () => {
    const deps = makeDeps();
    deps.saStore.putEvents.mockResolvedValueOnce({ ok: false, error: 'boom' });
    expect(await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 0, seqTo: 0, events: [ev(0)], results: [] }, deps))
      .toEqual({ status: 'error', reason: 'internal' });
  });
});

describe('audio', () => {
  test('presign mints the per-task key under the session', async () => {
    const deps = makeDeps();
    const res = await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', mime: 'audio/webm;codecs=opus', bytes: 5000 }, deps);
    expect(res).toEqual(expect.objectContaining({ status: 'ok', key: KEY, url: `https://r2.example/${KEY}?sig=1`, contentType: 'audio/webm' }));
  });

  test('presign refuses a bad task id, a wrong type and an oversized file', async () => {
    const deps = makeDeps();
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: '../x', mime: 'audio/webm' }, deps)).reason).toBe('bad_task');
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', mime: 'video/mp4' }, deps)).reason).toBe('wrong_type');
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', mime: 'audio/webm', bytes: 1e9 }, deps)).reason).toBe('too_large');
  });

  test('register keeps the key on the task result; not handed to the scorer while the switch is off', async () => {
    const deps = makeDeps();
    expect(await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).toEqual({ status: 'ok', scoring: 'later' });
    expect(deps.saStore.setResultAudio).toHaveBeenCalledWith(SESSION, 'ur.letters', KEY);
    expect(deps.store.attachBlockMedia).not.toHaveBeenCalled();
  });

  test('with the switch on, a v3 task recording goes onto its block for the existing scorer', async () => {
    const deps = makeDeps({ scoreLater: true });
    expect(await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).toEqual({ status: 'ok', scoring: 'queued' });
    expect(deps.store.attachBlockMedia).toHaveBeenCalledWith({ sessionId: SESSION, block: 'ur.letters', audioR2Key: KEY });
  });

  test('register refuses a key it did not mint and one that never reached R2', async () => {
    const deps = makeDeps();
    expect((await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: 'child-test/x.webm' }, deps)).reason).toBe('not_your_upload');
    deps.r2.headObject.mockResolvedValueOnce({ exists: false });
    expect((await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).reason).toBe('upload_missing');
    expect(deps.saStore.setResultAudio).not.toHaveBeenCalled();
  });
});

describe('saStatus', () => {
  test("what the server holds for the session, so the coach's visit bar can show it", async () => {
    const res = await Svc.saStatus({ userId: COACH, sessionId: SESSION }, makeDeps());
    expect(res).toEqual({
      status: 'ok',
      session: { id: SESSION, status: 'in_progress', grade: 3, form: 'B' },
      lastSeq: 41, tasksDone: ['ur.letters'], audio: ['ur.letters'],
    });
  });
});
