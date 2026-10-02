/**
 * bd-s1oo0.7 (L7) — the coach-app path over the REAL child-test store (L3), the
 * real item bank (L1) and L4's real gate, with only the network faked: the
 * Supabase client (L3's fake), R2, and the scorer (L5 is not on the integration
 * branch yet). One child, start to finish:
 *   present → app session → card → upload → the AI's marks land → the check → saved twice.
 */

const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));

const store = require('../../../bot/shared/services/child-test/store');
const bank = require('../../../bot/shared/data/child-test/item-bank.v1.json');
const Svc = require('../../../bot/shared/services/child-test/app/app-api.service');

const COACH = 'coach-1';
const VISIT = 'visit-1';
const DRAW = {
  id: 'draw-1', cycle_id: 'ICT-2026-Q4', region: 'ict', school_id: 'school-1', class_id: 'g3a', grade: 3,
  student_id: 'st-07', roll_number: 7, frame_size: 25, draw_rank: 3, seed_digest: 'd', algo_version: 'v',
  sample_role: 'new', form: 'A', status: 'listed', list_slot: 'main', attempts: 0, last_listed_visit_id: VISIT, history: [],
};

const ENV = ['CHILD_TEST_ENABLED', 'CHILD_TEST_COACH_IDS', 'CHILD_TEST_REGIONS', 'CHILD_TEST_R2_ENV'];
let saved;
let deps;
let scored;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_R2_ENV = 'sandbox';
  delete process.env.CHILD_TEST_COACH_IDS;
  delete process.env.CHILD_TEST_REGIONS;
  mockFake = createFakeSupabase({
    users: [{ id: COACH, role: 'coach', region: 'niete-sandbox' }],
    observation_field_forms: [{ id: VISIT, observer_user_id: COACH, created_at: '2026-10-02T05:00:00Z', visit_context: {}, answers: {} }],
    schools: [{ id: 'school-1', name: 'IMCB G-10/4' }],
    child_test_draws: [{ ...DRAW }],
    child_test_sessions: [],
    child_test_blocks: [],
  }, { unique: CHILD_TEST_UNIQUE });
  scored = [];
  deps = {
    // the draw marks the outcome the way L3 does (present → tested); its own suite covers the rest
    draw: {
      resolveVisitSchool: async () => ({ ok: true, schoolId: 'school-1' }),
      markOutcome: async ({ drawId, outcome }) => {
        await mockFake.from('child_test_draws').update({ status: outcome === 'present' ? 'tested' : outcome, tested_at: '2026-10-02T06:00:00Z' }).eq('id', drawId);
        return { ok: true, list: { children: [], alternates: [] } };
      },
    },
    r2: {
      getPresignedUploadUrl: async (key) => `https://r2.example/${key}`,
      headObject: async () => ({ exists: true, sizeBytes: 900_000 }),
    },
    scoring: { scoreBlock: async (args) => { scored.push(args); return { ok: true, aiStatus: 'scored' }; } },
    defer: (fn) => fn(),
    now: () => new Date('2026-10-02T06:10:00Z'),
    log: () => {},
    logError: jest.fn(),
  };
});

afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function rowsOf(table) {
  const { data } = await mockFake.from(table).select('*');
  return data;
}

test('one child through the app: session, upload, AI marks, check — saved twice, the AI mark untouched', async () => {
  const out = await Svc.markOutcome({ userId: COACH, visitId: VISIT, drawId: 'draw-1', outcome: 'present' }, deps);
  expect(out.status).toBe('ok');
  const sessionId = out.sessionId;
  const [session] = await rowsOf('child_test_sessions');
  expect(session).toMatchObject({ id: sessionId, channel: 'app', coach_user_id: COACH, grade: 3, form: 'A', item_bank_version: bank.version });

  const card = await Svc.getCard({ userId: COACH, sessionId, block: 'urdu' }, deps);
  expect(card.card.child.story.text).toBe(bank.grades['3'].forms.A.urdu.story.text);
  expect(JSON.stringify(card.card)).not.toMatch(/"accept"|"rubric"|"answer"/);

  const signed = await Svc.presignBlockUpload({ userId: COACH, sessionId, block: 'urdu', kind: 'audio', contentType: 'audio/webm;codecs=opus', sizeBytes: 800_000 }, deps);
  expect(signed.key).toBe(`child-test/sandbox/school-1/${sessionId}/urdu.webm`);
  const reg = await Svc.registerBlockMedia({
    userId: COACH, sessionId, block: 'urdu', audioKey: signed.key,
    timing: { startedAt: '2026-10-02T06:05:00.000Z', timedStartMs: 1500, timedEndMs: 61_500, finishedEarly: false, fallback: false },
  }, deps);
  expect(reg).toMatchObject({ status: 'ok', scoring: 'started' });
  expect(scored).toEqual([{ sessionId, block: 'urdu', grade: 3, form: 'A' }]);

  // L5's write, through the real store
  const ai = {
    version: 'ai-marks-v1',
    story: { words_correct: 41, words_attempted: 45, seconds: 60, finished_early: false, confidence: 0.9, flagged: [{ idx: 4, word: 'w', verdict: 'wrong', confidence: 0.9 }] },
    fallback: null,
    questions: bank.grades['3'].forms.A.urdu.questions.map((q, i) => ({ id: q.id, verdict: i === 1 ? 'wrong' : 'correct', heard: '…', confidence: i === 1 ? 0.4 : 0.9 })),
    first_sounds: bank.grades['3'].forms.A.urdu.first_sounds.map((f) => ({ id: f.id, verdict: 'correct', heard: '…', confidence: 0.4, hint_only: true })),
    nonwords: bank.grades['3'].forms.A.urdu.nonwords.map((n) => ({ id: n.id, verdict: 'correct', heard: '…', confidence: 0.9 })),
  };
  expect((await store.saveAiMarks({ sessionId, block: 'urdu', aiMarks: ai })).ok).toBe(true);

  const status = await Svc.sessionStatus({ userId: COACH, sessionId }, deps);
  const urdu = status.blocks.find((b) => b.block === 'urdu');
  expect(urdu).toMatchObject({ hasAudio: true, aiStatus: 'scored', checked: false });
  expect(urdu.prefill.questions[1].verdict).toBeNull();

  const form = JSON.parse(JSON.stringify(urdu.prefill));
  form.questions[1].verdict = 'correct';
  form.first_sounds.forEach((f) => { f.verdict = 'correct'; });
  form.story.words_correct = 42;
  const check = await Svc.submitCheck({ userId: COACH, sessionId, block: 'urdu', coachMarks: form }, deps);
  expect(check).toMatchObject({ status: 'ok', allChecked: false });

  const [block] = await rowsOf('child_test_blocks');
  expect(block.ai_marks).toEqual(ai); // the constant ruler, untouched
  expect(block.coach_marks.version).toBe('coach-marks-v1');
  // L6's path format (one rule for both channels, bd-s1oo0.16)
  expect(block.coach_marks.meta.shown_empty).toContain(`questions[${ai.questions[1].id}]`);
  expect(block.coach_edits).toEqual(expect.arrayContaining([
    { path: 'story.words_correct', ai: 41, coach: 42 },
    { path: `questions[${ai.questions[1].id}].verdict`, ai: 'wrong', coach: 'correct' },
  ]));
  expect(block.checked_at).toBeTruthy();

  const [after] = await rowsOf('child_test_sessions');
  expect(Object.keys(after.timings)).toEqual(expect.arrayContaining([
    'app.started', 'urdu.audio_received', 'urdu.app_recording_start', 'urdu.app_timed_start', 'urdu.app_timed_end', 'check.opened', 'check.urdu.submitted',
  ]));
  expect(after.timings['urdu.app_timed_start']).toBe('2026-10-02T06:05:01.500Z');

  // a second check of the same block is refused, and the coach's first answer stands
  const again = await Svc.submitCheck({ userId: COACH, sessionId, block: 'urdu', coachMarks: form }, deps);
  expect(again).toEqual({ status: 'invalid', reason: 'already_checked' });
});

test('maths: photo then voice note → scored once and the session is completed', async () => {
  const { sessionId } = await Svc.markOutcome({ userId: COACH, visitId: VISIT, drawId: 'draw-1', outcome: 'present' }, deps);
  const base = `child-test/sandbox/school-1/${sessionId}`;
  expect((await Svc.registerBlockMedia({ userId: COACH, sessionId, block: 'maths', photoKey: `${base}/maths-strip.jpg` }, deps)).scoring).toBe('waiting_for_audio');
  expect(scored).toEqual([]);
  expect((await Svc.registerBlockMedia({ userId: COACH, sessionId, block: 'maths', audioKey: `${base}/maths.webm` }, deps)).scoring).toBe('started');
  expect(scored).toEqual([{ sessionId, block: 'maths', grade: 3, form: 'A' }]);
  const [s] = await rowsOf('child_test_sessions');
  expect(s.status).toBe('completed');
  const [b] = await rowsOf('child_test_blocks');
  expect(b).toMatchObject({ audio_r2_key: `${base}/maths.webm`, photo_r2_key: `${base}/maths-strip.jpg` });
});

test("another coach cannot read this child's card or session", async () => {
  const { sessionId } = await Svc.markOutcome({ userId: COACH, visitId: VISIT, drawId: 'draw-1', outcome: 'present' }, deps);
  const other = { ...deps, enabled: async () => true };
  expect(await Svc.getCard({ userId: 'coach-2', sessionId, block: 'urdu' }, other)).toEqual({ status: 'not_found' });
  expect(await Svc.sessionStatus({ userId: 'coach-2', sessionId }, other)).toEqual({ status: 'not_found' });
});
