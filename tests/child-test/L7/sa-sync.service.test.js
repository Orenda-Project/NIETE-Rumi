/**
 * The Learning assessment — what the phone sends while and after a child takes the battery.
 *
 * The engine on the coach's phone keeps every event and result on the phone first, then sends them
 * in batches (numbered per session) and uploads each task's recording straight to R2. Pinned here:
 *   - only the coach's own session, and only one marked self-administered
 *   - the battery: this child's block of the form (five children, five different blocks), or the whole form
 *     when the coach asks for it; fixed on the session at the first fetch
 *   - a batch stores per-task results, turns subtask and hand-over events into timings, and acks seqTo
 *   - the battery's end completes the session
 *   - a recording's key is minted per session, task and spoken answer, and must be that key when registered
 *   - a recording is handed to the existing scorer only when CHILD_TEST_SA_SCORE_LATER is on, and only for
 *     a v3 block's whole-task recording
 */

const SVC = '../../../bot/shared/services/child-test/app/sa-api.service';

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SCHOOL = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const PLAIN = '66666666-6666-4666-8666-666666666666';
const KEY = `child-test/sandbox/${SCHOOL}/${SESSION}/sa/ur.letters.webm`;
const CLIENT = '77777777-7777-4777-8777-777777777777';
const ITEM_KEY = `child-test/sandbox/${SCHOOL}/${SESSION}/sa/ur.story_comp__q2.webm`;

const BANK = {
  version: 'child-test-items-sa-v1',
  lines: { welcome: {} },
  conventions: {},
  forms: {
    'coach.G3.A': {
      surface: 'coach', order: ['ur.letters', 'en.letters', 'ma.add1'], full: ['ur.letters', 'en.letters', 'ma.add1'],
      blocks: { B1: ['ur.letters'], B2: ['en.letters'], B3: ['en.letters'], B4: ['ma.add1'], B5: ['ma.add1'] },
      block_names: { B1: { en: 'Urdu reading', ur: 'اردو پڑھنا' }, B2: { en: 'English reading', ur: 'انگریزی پڑھنا' } },
    },
  },
  tasks: {
    'coach.G3.A/ur.letters': { task: 'ur.letters' },
    'coach.G3.A/en.letters': { task: 'en.letters' },
    'coach.G3.A/ma.add1': { task: 'ma.add1' },
  },
};

function makeDeps(over = {}) {
  const sessions = {
    [SESSION]: { id: SESSION, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'B', status: 'in_progress', item_bank_version: 'sa-battery', visit_key: 'day:x' },
    [PLAIN]: { id: PLAIN, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'A', status: 'in_progress', item_bank_version: 'v1' },
  };
  return {
    store: {
      getSession: jest.fn(async (id) => ({ ok: true, session: sessions[id] || null })),
      setSessionStatus: jest.fn(async () => ({ ok: true })),
      recordTiming: jest.fn(async () => ({ ok: true })),
      listSessionsForVisit: jest.fn(async () => ({ ok: true, sessions: [
        { id: SESSION, device: null }, { id: 'a', device: { block: 'B1' } }, { id: 'b', device: { block: 'B2' } }, { id: 'c', device: null },
      ] })),
    },
    saStore: {
      findByClient: jest.fn(async () => ({ ok: true, sessionId: null })),
      putResults: jest.fn(async () => ({ ok: true })),
      setAudio: jest.fn(async () => ({ ok: true })),
      markSynced: jest.fn(async (id, { block } = {}) => ({ ok: true, device: { block } })),
      summary: jest.fn(async () => ({ ok: true, block: null, lastSeq: 41, tasksDone: ['ur.letters'], audio: ['ur.letters'] })),
    },
    r2: {
      getPresignedUploadUrl: jest.fn(async (key) => `https://r2.example/${key}?sig=1`),
      headObject: jest.fn(async () => ({ exists: true, sizeBytes: 1000 })),
    },
    bank: BANK,
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
    expect(deps.saStore.markSynced).not.toHaveBeenCalled();
  });
});

describe('saBattery', () => {
  // 2026-10-02 is day 20728 since 1970 in Pakistan time; 20728 % 5 = 3 → the rotation starts at B4
  test("a block no other child of the visit holds, from today's place in the rotation, fixed on the session", async () => {
    const deps = makeDeps();
    const res = await Svc.saBattery({ userId: COACH, sessionId: SESSION, lang: 'en' }, deps);
    expect(res.status).toBe('ok');
    expect(res.battery).toEqual(expect.objectContaining({ formId: 'coach.G3.A', block: 'B4', lang: 'en', version: 'child-test-items-sa-v1' }));
    expect(res.battery.forms['coach.G3.A'].order).toEqual(['ma.add1']);
    expect(Object.keys(res.battery.tasks)).toEqual(['coach.G3.A/ma.add1']);
    expect(deps.saStore.markSynced).toHaveBeenCalledWith(SESSION, { block: 'B4' });
    expect(deps.store.listSessionsForVisit).toHaveBeenCalledWith('day:x');
  });

  test('taken blocks are skipped; a block already fixed is kept; full on the first fetch gives the whole form', async () => {
    const deps = makeDeps();
    deps.store.listSessionsForVisit.mockResolvedValueOnce({ ok: true, sessions: [{ id: 'a', device: { block: 'B4' } }, { id: 'b', device: { block: 'B5' } }] });
    expect((await Svc.saBattery({ userId: COACH, sessionId: SESSION }, deps)).battery.block).toBe('B1');
    deps.saStore.summary.mockResolvedValueOnce({ ok: true, block: 'B2' });
    const kept = await Svc.saBattery({ userId: COACH, sessionId: SESSION, full: true }, deps);
    expect(kept.battery).toEqual(expect.objectContaining({ block: 'B2', blockName: { en: 'English reading', ur: 'انگریزی پڑھنا' }, lang: 'ur' }));
    const full = await Svc.saBattery({ userId: COACH, sessionId: SESSION, full: true }, deps);
    expect(full.battery.block).toBe('full');
    expect(full.battery.forms['coach.G3.A'].order).toEqual(['ur.letters', 'en.letters', 'ma.add1']);
  });

  test('no bank, or no form for the grade, is not_ready', async () => {
    expect(await Svc.saBattery({ userId: COACH, sessionId: SESSION }, makeDeps({ bank: null }))).toEqual({ status: 'not_ready', reason: 'no_battery' });
    expect(await Svc.saBattery({ userId: COACH, sessionId: SESSION }, makeDeps({ bank: { forms: { 'coach.G5.A': {} }, tasks: {} } })))
      .toEqual({ status: 'not_ready', reason: 'no_battery' });
  });
});

describe('saBatch', () => {
  const ev = (seq, type = 'tap', extra = {}) => ({ seq, t_ms: seq * 100, at: '2026-10-02T09:00:00Z', type, task_id: 'ur.letters', item_id: 'i1', value: { x: 1 }, ...extra });

  test('stores the results, turns subtask events into timings, records the sync and acks seqTo', async () => {
    const deps = makeDeps();
    const results = [{ task_id: 'ur.letters', correct: 12, attempted: 20, stop_reason: 'time_up', scored_on: 'phone', answers: [] }];
    const res = await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 0, seqTo: 2, lang: 'ur',
      events: [ev(0, 'session_start', { task_id: null }), ev(1, 'task_start'), ev(2)], results, device: { ua: 'x', skew_ms: 5 } }, deps);
    expect(res).toEqual({ status: 'ok', ackedTo: 2 });
    expect(deps.saStore.putResults).toHaveBeenCalledWith(SESSION, results, 'ur');
    expect(deps.store.recordTiming.mock.calls.map((c) => c[1])).toEqual(['sa.session_start', 'sa.ur.letters.task_start']);
    expect(deps.store.recordTiming.mock.calls[0][2]).toEqual(new Date('2026-10-02T09:00:00Z'));
    expect(deps.saStore.markSynced).toHaveBeenCalledWith(SESSION, { lastSeq: 2, device: { ua: 'x', skew_ms: 5 }, clientStartedAt: '2026-10-02T09:00:00.000Z', clientFinishedAt: null });
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
    expect(deps.saStore.putResults).not.toHaveBeenCalled();
    expect(deps.saStore.markSynced).not.toHaveBeenCalled();
  });

  test("the battery's end completes the session", async () => {
    const deps = makeDeps();
    await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 5, seqTo: 5, events: [ev(5, 'battery_end', { task_id: null })], results: [] }, deps);
    expect(deps.store.setSessionStatus).toHaveBeenCalledWith(SESSION, 'completed');
    expect(deps.store.recordTiming).toHaveBeenCalledWith(SESSION, 'sa.finished', expect.any(Date));
    expect(deps.saStore.markSynced.mock.calls[0][1].clientFinishedAt).toBe('2026-10-02T09:00:00.000Z');
  });

  test('a store failure is an error, never an ack', async () => {
    const deps = makeDeps();
    deps.saStore.putResults.mockResolvedValueOnce({ ok: false, error: 'boom' });
    expect(await Svc.saBatch({ userId: COACH, sessionId: SESSION, seqFrom: 0, seqTo: 0, events: [], results: [{ task_id: 'ur.letters' }] }, deps))
      .toEqual({ status: 'error', reason: 'internal' });
  });
});

describe('audio', () => {
  test('presign mints the per-task key under the session, and per spoken answer', async () => {
    const deps = makeDeps();
    const res = await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', mime: 'audio/webm;codecs=opus', bytes: 5000 }, deps);
    expect(res).toEqual(expect.objectContaining({ status: 'ok', key: KEY, url: `https://r2.example/${KEY}?sig=1`, contentType: 'audio/webm' }));
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.story_comp', itemId: 'q2', mime: 'audio/webm' }, deps)).key).toBe(ITEM_KEY);
  });

  test('presign refuses a bad task or item id, a wrong type and an oversized file', async () => {
    const deps = makeDeps();
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: '../x', mime: 'audio/webm' }, deps)).reason).toBe('bad_task');
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', itemId: '../q', mime: 'audio/webm' }, deps)).reason).toBe('bad_item');
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', mime: 'video/mp4' }, deps)).reason).toBe('wrong_type');
    expect((await Svc.saPresign({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', mime: 'audio/webm', bytes: 1e9 }, deps)).reason).toBe('too_large');
  });

  test('register keeps the recording for later; not handed to the scorer while the switch is off', async () => {
    const deps = makeDeps();
    expect(await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).toEqual({ status: 'ok', scoring: 'later' });
    expect(deps.saStore.setAudio).toHaveBeenCalledWith(SESSION, 'ur.letters', null, KEY, { scoreLater: false });
  });

  test('with the switch on, only a v3 block whole-task recording is queued for the scorer', async () => {
    const deps = makeDeps({ scoreLater: true });
    expect(await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).toEqual({ status: 'ok', scoring: 'queued' });
    expect(deps.saStore.setAudio).toHaveBeenLastCalledWith(SESSION, 'ur.letters', null, KEY, { scoreLater: true });
    expect(await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.story_comp', itemId: 'q2', key: ITEM_KEY }, deps)).toEqual({ status: 'ok', scoring: 'later' });
    expect(deps.saStore.setAudio).toHaveBeenLastCalledWith(SESSION, 'ur.story_comp', 'q2', ITEM_KEY, { scoreLater: false });
  });

  test('register refuses a key it did not mint, one that never reached R2, and a task already marked', async () => {
    const deps = makeDeps();
    expect((await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: 'child-test/x.webm' }, deps)).reason).toBe('not_your_upload');
    deps.r2.headObject.mockResolvedValueOnce({ exists: false });
    expect((await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).reason).toBe('upload_missing');
    expect(deps.saStore.setAudio).not.toHaveBeenCalled();
    deps.saStore.setAudio.mockResolvedValueOnce({ ok: false, reason: 'frozen' });
    expect((await Svc.saRegister({ userId: COACH, sessionId: SESSION, taskId: 'ur.letters', key: KEY }, deps)).reason).toBe('already_scored');
  });
});

describe('saStatus', () => {
  test("what the server holds for the session, so the coach's visit bar can show it", async () => {
    const res = await Svc.saStatus({ userId: COACH, sessionId: SESSION }, makeDeps());
    expect(res).toEqual({
      status: 'ok',
      session: { id: SESSION, status: 'in_progress', grade: 3, form: 'B' },
      block: null,
      lastSeq: 41, tasksDone: ['ur.letters'], audio: ['ur.letters'],
    });
  });
});

describe("the phone's own session id (offline between children)", () => {
  test('a sink call by the client id reaches the session it names', async () => {
    const deps = makeDeps();
    deps.store.getSession.mockImplementation(async (id) => ({ ok: true, session: id === SESSION ? { id: SESSION, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'A', status: 'in_progress', item_bank_version: 'sa-battery' } : null }));
    deps.saStore.findByClient = jest.fn(async (id) => ({ ok: true, sessionId: id === CLIENT ? SESSION : null }));
    const res = await Svc.saStatus({ userId: COACH, sessionId: CLIENT }, deps);
    expect(res.session.id).toBe(SESSION);
    expect(deps.saStore.summary).toHaveBeenCalledWith(SESSION);
    expect(await Svc.saStatus({ userId: COACH, sessionId: '99999999-0000-4000-8000-000000000000' }, deps)).toEqual({ status: 'not_found' });
  });
});
