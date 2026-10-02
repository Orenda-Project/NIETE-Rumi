/**
 * Child test store — sessions and blocks. What it must guarantee whoever calls it: one session per
 * drawn child, copied from the draw; the AI's marks are written once and never changed; the coach's
 * marks are written once, next to the AI's, with what changed; a database error is reported, never
 * read as "no row".
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const { logToFile } = require('../../../bot/shared/utils/logger');
const store = require('../../../bot/shared/services/child-test/store');

const DRAW = {
  id: 'draw-1', cycle_id: 'ICT-2026-Q4', region: 'ict', school_id: 'school-1', class_id: 'g3a', grade: 3,
  student_id: 'st-07', roll_number: 7, frame_size: 25, draw_rank: 3, seed_digest: 'd', algo_version: 'v',
  sample_role: 'returning', form: 'B', status: 'tested', list_slot: 'main', attempts: 0, last_listed_visit_id: 'visit-1', history: [],
};

beforeEach(() => {
  mockFake = createFakeSupabase({ child_test_draws: [DRAW], child_test_sessions: [], child_test_blocks: [] }, { unique: CHILD_TEST_UNIQUE });
  jest.clearAllMocks();
});

const newSession = () => store.createSession({ drawId: 'draw-1', coachUserId: 'coach-1', visitId: 'visit-1', itemBankVersion: 'child-test-items-v1' });

describe('sessions', () => {
  test('a session copies school, class, grade, child, form and class size from the draw', async () => {
    const r = await newSession();
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.session).toMatchObject({
      draw_id: 'draw-1', coach_user_id: 'coach-1', visit_id: 'visit-1', school_id: 'school-1', class_id: 'g3a', grade: 3,
      student_id: 'st-07', form: 'B', frame_size: 25, selection_method: 'random_draw', channel: 'whatsapp',
      item_bank_version: 'child-test-items-v1', status: 'in_progress',
    });
  });
  test('one session per draw: a second call returns the first', async () => {
    const a = await newSession();
    const b = await newSession();
    expect(b).toMatchObject({ ok: true, created: false });
    expect(b.session.id).toBe(a.session.id);
    expect(mockFake.__tables.child_test_sessions).toHaveLength(1);
  });
  test('a draw that was not marked present cannot start a session', async () => {
    mockFake.__tables.child_test_draws[0].status = 'listed';
    expect(await newSession()).toMatchObject({ ok: false, reason: 'not_tested' });
  });
  test('the app channel is recorded; an unknown channel is refused', async () => {
    expect((await store.createSession({ drawId: 'draw-1', coachUserId: 'coach-1', visitId: 'visit-1', channel: 'app' })).session.channel).toBe('app');
    expect(await store.createSession({ drawId: 'draw-1', coachUserId: 'c', channel: 'sms' })).toMatchObject({ ok: false, reason: 'bad_channel' });
  });
  test('reads by id, by draw and by visit', async () => {
    const { session } = await newSession();
    expect((await store.getSession(session.id)).session.id).toBe(session.id);
    expect((await store.getSessionByDraw('draw-1')).session.id).toBe(session.id);
    expect((await store.listSessionsForVisit('visit-1')).sessions.map((s) => s.id)).toEqual([session.id]);
    expect(await store.getSession('nope')).toEqual({ ok: true, session: null });
  });
  test('completed and abandoned stamp finished_at; an unknown status is refused', async () => {
    const { session } = await newSession();
    const done = await store.setSessionStatus(session.id, 'completed');
    expect(done.session.status).toBe('completed');
    expect(done.session.finished_at).toBeTruthy();
    expect(await store.setSessionStatus(session.id, 'lost')).toMatchObject({ ok: false, reason: 'bad_status' });
  });
  test('timings merge; the first write of a key wins', async () => {
    const { session } = await newSession();
    await store.recordTiming(session.id, 'urdu.card_sent', new Date('2026-10-05T06:00:00Z'));
    await store.recordTiming(session.id, 'urdu.voice_received', new Date('2026-10-05T06:02:10Z'));
    const again = await store.recordTiming(session.id, 'urdu.card_sent', new Date('2026-10-05T06:09:00Z'));
    expect(again.timings).toEqual({ 'urdu.card_sent': '2026-10-05T06:00:00.000Z', 'urdu.voice_received': '2026-10-05T06:02:10.000Z' });
  });
  test('a database error is reported and logged at error, not read as "no row"', async () => {
    mockFake.__failNext({ message: 'permission denied' });
    const r = await store.getSession('x');
    expect(r).toMatchObject({ ok: false, error: 'permission denied' });
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/getSession failed/), expect.any(Object), 'error');
  });
});

describe('blocks: media', () => {
  test('the first media call creates the block; the next sets the photo on the same row', async () => {
    const { session } = await newSession();
    const a = await store.attachBlockMedia({ sessionId: session.id, block: 'maths', audioR2Key: 'child-test/sandbox/school-1/s/maths.ogg' });
    expect(a.block).toMatchObject({ session_id: session.id, block: 'maths', audio_r2_key: 'child-test/sandbox/school-1/s/maths.ogg', ai_status: 'pending' });
    const b = await store.attachBlockMedia({ sessionId: session.id, block: 'maths', photoR2Key: 'child-test/sandbox/school-1/s/maths-strip.jpg' });
    expect(b.block.id).toBe(a.block.id);
    expect(b.block).toMatchObject({ audio_r2_key: 'child-test/sandbox/school-1/s/maths.ogg', photo_r2_key: 'child-test/sandbox/school-1/s/maths-strip.jpg' });
    expect((await store.listBlocks(session.id)).blocks).toHaveLength(1);
  });
  test('an unknown block is refused', async () => {
    const { session } = await newSession();
    expect(await store.attachBlockMedia({ sessionId: session.id, block: 'science', audioR2Key: 'k' })).toMatchObject({ ok: false, reason: 'bad_block' });
  });
});

describe('blocks: AI marks are written once', () => {
  const MARKS = { version: 'ai-marks-v1', story: { words_correct: 41, words_attempted: 45, seconds: 60, flagged: [], confidence: 0.9 } };
  async function scoredBlock() {
    const { session } = await newSession();
    await store.attachBlockMedia({ sessionId: session.id, block: 'urdu', audioR2Key: 'k' });
    return session;
  }
  test('saved with status, model versions, transcript and time', async () => {
    const s = await scoredBlock();
    const r = await store.saveAiMarks({ sessionId: s.id, block: 'urdu', aiMarks: MARKS, modelVersions: { counts: 'google/gemini-3.8-flash' }, transcript: { words: [] } });
    expect(r.ok).toBe(true);
    expect(r.block).toMatchObject({ ai_marks: MARKS, ai_status: 'scored', ai_model_versions: { counts: 'google/gemini-3.8-flash' }, transcript: { words: [] } });
    expect(r.block.ai_scored_at).toBeTruthy();
  });
  test('a second save changes nothing and says so', async () => {
    const s = await scoredBlock();
    await store.saveAiMarks({ sessionId: s.id, block: 'urdu', aiMarks: MARKS });
    const again = await store.saveAiMarks({ sessionId: s.id, block: 'urdu', aiMarks: { ...MARKS, story: { words_correct: 99 } } });
    expect(again).toMatchObject({ ok: false, alreadyScored: true });
    expect(again.block.ai_marks.story.words_correct).toBe(41);
  });
  test('the write is guarded by ai_marks IS NULL', async () => {
    const s = await scoredBlock();
    await store.saveAiMarks({ sessionId: s.id, block: 'urdu', aiMarks: MARKS });
    const upd = mockFake.__calls.filter((c) => c.table === 'child_test_blocks' && c.action === 'update').pop();
    expect(upd.filters).toContainEqual(['is', 'ai_marks', null]);
  });
  test('marks for a block with no recording yet create the block (the scorer may run from a queue)', async () => {
    const { session } = await newSession();
    const r = await store.saveAiMarks({ sessionId: session.id, block: 'english', aiMarks: MARKS, aiStatus: 'partial', reason: 'no_cue_phrase' });
    expect(r.block).toMatchObject({ block: 'english', ai_status: 'partial', ai_reason: 'no_cue_phrase' });
  });
  test('ai status can move while unscored, not after', async () => {
    const s = await scoredBlock();
    expect((await store.setAiStatus({ sessionId: s.id, block: 'urdu', aiStatus: 'failed', reason: 'stt_timeout' })).block).toMatchObject({ ai_status: 'failed', ai_reason: 'stt_timeout' });
    expect((await store.saveAiMarks({ sessionId: s.id, block: 'urdu', aiMarks: MARKS })).ok).toBe(true);
    expect(await store.setAiStatus({ sessionId: s.id, block: 'urdu', aiStatus: 'scoring' })).toMatchObject({ ok: false, alreadyScored: true });
    expect(await store.setAiStatus({ sessionId: s.id, block: 'urdu', aiStatus: 'scored' })).toMatchObject({ ok: false, reason: 'bad_status' });
  });
  test('a recording cannot be swapped under marks already given', async () => {
    const s = await scoredBlock();
    await store.saveAiMarks({ sessionId: s.id, block: 'urdu', aiMarks: MARKS });
    expect(await store.attachBlockMedia({ sessionId: s.id, block: 'urdu', audioR2Key: 'other' })).toMatchObject({ ok: false, alreadyScored: true });
  });
});

describe('blocks: the coach\'s check', () => {
  const AI = { version: 'ai-marks-v1', story: { words_correct: 41 } };
  const COACH = { version: 'ai-marks-v1', story: { words_correct: 43 } };
  const EDITS = [{ path: 'story.words_correct', ai: 41, coach: 43 }];
  async function scored() {
    const { session } = await newSession();
    await store.saveAiMarks({ sessionId: session.id, block: 'urdu', aiMarks: AI });
    return session;
  }
  test('saved next to the AI marks, which stay as they were', async () => {
    const s = await scored();
    const r = await store.saveCoachMarks({ sessionId: s.id, block: 'urdu', coachMarks: COACH, coachEdits: EDITS });
    expect(r.ok).toBe(true);
    expect(r.block).toMatchObject({ coach_marks: COACH, coach_edits: EDITS, ai_marks: AI });
    expect(r.block.checked_at).toBeTruthy();
    const upd = mockFake.__calls.filter((c) => c.table === 'child_test_blocks' && c.action === 'update').pop();
    expect(Object.keys(upd.values)).not.toContain('ai_marks');
    expect(upd.filters).toContainEqual(['is', 'checked_at', null]);
  });
  test('submitted once', async () => {
    const s = await scored();
    await store.saveCoachMarks({ sessionId: s.id, block: 'urdu', coachMarks: COACH, coachEdits: EDITS });
    const again = await store.saveCoachMarks({ sessionId: s.id, block: 'urdu', coachMarks: AI, coachEdits: [] });
    expect(again).toMatchObject({ ok: false, alreadyChecked: true });
    expect(again.block.coach_marks).toEqual(COACH);
  });
  test('a block that does not exist cannot be checked', async () => {
    const { session } = await newSession();
    expect(await store.saveCoachMarks({ sessionId: session.id, block: 'maths', coachMarks: COACH, coachEdits: [] })).toMatchObject({ ok: false, reason: 'no_block' });
  });
});
