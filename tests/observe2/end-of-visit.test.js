/**
 * /observe2 — the end of the visit is /observe's end (Riffat, sandbox, 4 Oct 2026: "after the coach
 * submits, it should ask for the debrief recording; the flow stopped here").
 *
 * Only the middle of /observe2 differs from /observe (the live form instead of the FICO draft). When
 * the coach submits the check, the observation is saved the way /observe saves a submitted form
 * (status observer_review_complete, an analysis in the FICO shape the debrief, the coach card and the
 * teacher's report read), and from there /observe's own code runs unchanged: "debrief now or later?",
 * the debrief guide (here the /observe2 brief) with the request for the debrief recording, the
 * recording, the coach card, sending the report, completion.
 *
 * Real: the check endpoint, the store, the brief, the analysis builder, /observe's debrief service,
 * the report's score adapter and target resolver, completion. Mocked: the database (in-memory),
 * WhatsApp, the Redis observe state, the job queue, the model gateway (must not be called).
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)),
  setState: jest.fn(() => Promise.resolve(true)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveDebrief: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn(() => Promise.reject(new Error('the debrief guide must not call a model for /observe2'))),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const JobQueue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');
const Debrief = require('../../bot/shared/services/observe/observe-debrief.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const { CODES, PRIORITY, ROW } = require('../../bot/shared/services/observe/observe2/fico17');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');

const COACH = { id: 'coach-1', role: 'coach', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' };
const PHONE = COACH.phone_number;
const S = observeStrings('en');
const token = (id) => `coach-1:observe2-check:${id}`;
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const session = () => mockFake.__tables.coaching_sessions.find((r) => r.id === 'sess-1');
const flush = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };

const ANSWERS = {
  present: '32', p1_spoke: '6', p1_picked: 'once', p1_groups: 'alone', p1_listen: ['turns'], p1_materials: 'teacher', p1_change: 'yes', p1_change_how: 'slow',
  p2_spoke: '10', p2_new: '5', p2_picked: 'often', p2_groups: 'combine', p2_listen: ['once'], p2_materials: 'children', p2_change: 'no',
  incident: 'none', lp: 'used', priority: 'C8',
};
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight? Ali?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'No, that is wrong. Who else?', label: 'wrong answer left' },
];
// C: 3,1,3,1,2,2,3,2 = 17 of 32 · D: 3,4,2,(IE),1 = 10 of 16 · F: 3,2,2,1 = 8 of 16
const FINALS_ONE = { C1_final: '3', C2_final: '1', C3_final: '3', C6_final: '2', D1_final: '3', D2_final: '4', D4_final: 'IE', D5_final: '1' };
const FINALS_TWO = { C4_final: '1', C5_final: '2', C7_final: '3', C8_final: '2', D3_final: '2', F1_final: '3', F2_final: '2', F3_final: '2', F4_final: '1' };

async function checkable(patch = {}) {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), {
    period_minutes: 40, answers: ANSWERS, sealed_at: '2026-10-04T16:58:00.000Z', part1_done_at: 'x', part2_done_at: 'x',
    coaching_session_id: 'sess-1', rumi_moments: { moments: MOMENTS, counts: {} }, rumi_levels: {},
    moments_ready_at: '2026-10-04T17:05:00.000Z', photos: ['observe2/f/photo-1.jpg', 'observe2/f/photo-2.jpg'],
  }, patch);
  return form.id;
}

async function submit(id) {
  for (const s of ['HEARD_ASK', 'HEARD_WRONG', 'HEARD_WORK', 'HEARD_EXPLAIN']) {
    const out = { screen: s };
    for (let i = 1; i <= 8; i += 1) out[`${s.toLowerCase()}_${i}`] = i <= 2 ? 'yes' : '';
    // eslint-disable-next-line no-await-in-loop
    await Check.handleObserve2CheckDataExchange(token(id), s, out);
  }
  await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_ONE', { screen: 'ADDED_ONE', ...FINALS_ONE });
  await Check.handleObserve2CheckDataExchange(token(id), 'ADDED_TWO', { screen: 'ADDED_TWO', ...FINALS_TWO });
  const done = await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: 'the wrong answers mattered more' });
  await flush();
  return done;
}

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
  mockFake = createFakeSupabase({
    users: [COACH, { id: 'teacher-1', phone_number: '923000000002', name: 'Rabia', preferred_language: 'ur', role: 'teacher' }],
    coaching_sessions: [{
      id: 'sess-1', status: 'observe2_checking', observation_type: 'leader_observation', observer_user_id: 'coach-1',
      user_id: 'teacher-1', debrief_status: 'pending', created_at: '2026-10-04T17:00:00.000Z', analysis_data: null,
      transcript_text: '[00:40] Why do plants need sunlight? Ali?',
    }],
  });
});

describe('Submit hands the visit to /observe\'s end', () => {
  test('the observation is saved as /observe saves a submitted form, with an analysis in the FICO shape', async () => {
    const id = await checkable();
    expect((await submit(id)).screen).toBe('DONE');
    const s = session();
    expect(s.status).toBe('observer_review_complete');
    const a = s.analysis_data;
    expect(a.framework).toBe('fico');
    const C = a.domains.high_leverage_practices;
    expect(C.indicators.map((i) => i.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    expect(C).toMatchObject({ domain_score: 17, domain_max: 32, indicators_applicable: 8 });
    expect(C.indicators[1]).toMatchObject({ id: 'C2', name: ROW.C2, score: 1, applicable: true });
    const D = a.domains.student_engagement;
    expect(D).toMatchObject({ domain_score: 10, domain_max: 16, indicators_applicable: 4 });
    expect(D.indicators.find((i) => i.id === 'D4')).toMatchObject({ applicable: false, score: null });
    expect(a.domains.teacher_subject_knowledge).toMatchObject({ domain_score: 8, domain_max: 16 });
    // "a plan was used" but none attached: Section B says so, and is not counted.
    expect(a.domains.lesson_plan_fidelity).toMatchObject({ assessed: false, not_assessed_reason: 'lp_absent' });
    expect(a.scores).toMatchObject({ overall_marks: 35, overall_max_marks: 64 });
    expect(a.focus_area).toMatchObject({ indicator: 'C2', domain: 'high_leverage_practices', title: PRIORITY.C2 });
    expect(a.observe2).toMatchObject({ form_id: id, rubric: 'fico17' });
    expect(a.observe2.brief).toContain(PRIORITY.C2);
    expect(a.observe2.brief).toContain('Rabia');
    expect(s.classroom_photos).toEqual([{ url: 'observe2/f/photo-1.jpg' }, { url: 'observe2/f/photo-2.jpg' }]);
    // The coach's own pick is not turned into the cross-visit loop record (it is keyed to FICO v4).
    expect(s.prioritized_action).toBeUndefined();
  });

  test('the coach is asked "debrief now or later?" exactly as after /observe\'s form', async () => {
    const id = await checkable();
    await submit(id);
    // As /observe acknowledges its form on this branch: the saved line, then the two buttons.
    expect(WhatsAppService.sendMessage.mock.calls).toEqual([[PHONE, S.submitted_ack]]);
    const [to, msg] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(msg.buttons.map((b) => b.id)).toEqual(['observe_debrief_now_sess-1', 'observe_debrief_later_sess-1']);
    // The brief is the debrief guide now: it comes with "Debrief now", not before it.
    expect(WhatsAppService.sendMessage.mock.calls.flat().join(' ')).not.toContain('Open with questions');
  });

  test('the brief names the teacher the coach named after the recording ("who did you observe?")', async () => {
    const id = await checkable({ teacher_user_id: null });
    await submit(id);
    expect(session().analysis_data.observe2.brief).toContain('Rabia');
  });

  test('a second Submit writes nothing again and asks nothing again', async () => {
    const id = await checkable();
    await submit(id);
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'F1', why: '' });
    await flush();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(session().analysis_data.focus_area.indicator).toBe('C2');
  });

  test('the visit waits in /observe\'s pending-debrief list', async () => {
    const id = await checkable();
    await submit(id);
    const rows = await Debrief.listPendingDebriefs('coach-1');
    expect(rows.map((r) => r.id)).toEqual(['sess-1']);
  });
});

describe('when the hand-off cannot be saved', () => {
  test('the coach is told plainly, and submitting again hands the visit over', async () => {
    const id = await checkable();
    const saved = mockFake.__tables.coaching_sessions.splice(0, 1);       // the session can't be written
    const done = await submit(id);
    expect(done.data.next_line).not.toMatch(/debrief/i);
    expect(done.data.next_line).toMatch(/again/i);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    mockFake.__tables.coaching_sessions.push(...saved);                  // the database is back
    await Check.handleObserve2CheckDataExchange(token(id), 'PRIORITY', { screen: 'PRIORITY', priority_final: 'C2', why: '' });
    await flush();
    expect(session().status).toBe('observer_review_complete');
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });
});

describe('the debrief, as in /observe', () => {
  async function checked() {
    const id = await checkable();
    await submit(id);
    jest.clearAllMocks();
    return session().analysis_data.observe2.brief;
  }

  test('"Debrief now" sends the brief as the guide and asks for the recording, with no model call', async () => {
    const brief = await checked();
    await Debrief.startDebrief('sess-1', PHONE, COACH);
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    // On this branch /observe sends the guide, then the recording instruction, as two messages.
    const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(sent[0].startsWith(brief)).toBe(true);
    expect(sent.join('\n')).toContain(S.debrief_record_instruction);
    expect(ObserveState.setState).toHaveBeenCalledWith('coach-1', 'awaiting_debrief_audio', {
      sessionId: 'sess-1', guide_snapshot: expect.objectContaining({ text: brief }),
    });
  });

  test('a second tap while armed sends the same brief again', async () => {
    const brief = await checked();
    await Debrief.startDebrief('sess-1', PHONE, COACH);
    const armed = ObserveState.setState.mock.calls[0][2];
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', ...armed });
    WhatsAppService.sendMessage.mockClear();
    await Debrief.startDebrief('sess-1', PHONE, COACH);
    expect(WhatsAppService.sendMessage.mock.calls[0][1].startsWith(brief)).toBe(true);
  });

  test('the debrief recording is taken as /observe takes it, keeping the analysis', async () => {
    await checked();
    await Debrief.startDebrief('sess-1', PHONE, COACH);
    const armed = ObserveState.setState.mock.calls[0][2];
    await Debrief.startDebriefFromAudio(COACH, PHONE, 'debrief-audio', { state: 'awaiting_debrief_audio', ...armed });
    expect(JobQueue.queueObserveDebrief).toHaveBeenCalledWith('sess-1', expect.objectContaining({ audioId: 'debrief-audio' }));
    const a = session().analysis_data;
    expect(a.observer_debrief).toMatchObject({ audio_id: 'debrief-audio' });
    expect(a.framework).toBe('fico');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, S.debrief_audio_received);
  });

  test('once the debrief is done and the report reached the teacher, the visit completes', async () => {
    await checked();
    const s = session();
    s.debrief_status = 'done';
    s.analysis_data = { ...s.analysis_data, teacher_delivery: { status: 'sent' } };
    // maybeCompleteObservation reads the row through PostgREST's analysis_data->teacher_delivery alias
    // (the in-memory database does not project aliases), so the rule is applied to that projection.
    const { shouldComplete } = require('../../bot/shared/services/observe/observe-completion');
    expect(shouldComplete({ status: s.status, debrief_status: s.debrief_status, teacher_delivery: s.analysis_data.teacher_delivery })).toBe(true);
    // …which /observe2 rows never met while the visit ended at 'observe2_checked'.
    expect(shouldComplete({ status: 'observe2_checked', debrief_status: 'done', teacher_delivery: { status: 'sent' } })).toBe(false);
  });
});

describe('the teacher\'s report reads the coach\'s levels', () => {
  const form = (patch = {}) => ({
    id: 'f1', answers: ANSWERS, rumi_moments: { moments: MOMENTS, counts: {} },
    evidence_review: { heard_wrong_1: 'yes', priority_final: 'C2' },
    final_levels: Object.fromEntries(CODES.map((c) => [c, c === 'D4' ? 'IE' : '2'])),
    ...patch,
  });

  test('sections B, C, D and F, each on the coach\'s own 1-4 levels', () => {
    const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');
    const vm = buildScoreViewModel(buildAnalysis(form()), { framework: 'fico', language: 'en' });
    expect(vm.groups.map((g) => g.key)).toEqual(['B', 'C', 'D', 'F']);
    expect(vm.groups.find((g) => g.key === 'C')).toMatchObject({ score: 16, max: 32, pct: 50 });
    expect(vm.groups.find((g) => g.key === 'B')).toMatchObject({ notAssessed: true });
  });

  test('a plan the coach confirmed in the check is Section B, scored as /observe scores it', () => {
    const graded = { status: 'ok', fidelity_pct: 50, band: 'medium', prescribed_count: 4, moderators: { note: null }, moves: [] };
    const a = buildAnalysis(form({
      answers: { ...ANSWERS, lp_ref: { lesson_id: 'L1', label: 'Fractions' } },
      rumi_moments: { moments: MOMENTS, counts: {}, fidelity: graded },
      evidence_review: { priority_final: 'C2', fidelity: { fidelity_pct: 75, band: 'high', prescribed_count: 4, observer_edited: true, moves: [] } },
    }));
    // Section B on the scale /observe's framework uses on this branch.
    expect(a.domains.lesson_plan_fidelity).toMatchObject({ assessed: true, fidelity_pct: 75 });
    expect(a.domains.lesson_plan_fidelity.domain_score / a.domains.lesson_plan_fidelity.domain_max).toBeCloseTo(0.75, 2);
    expect(a.lp_fidelity).toMatchObject({ status: 'ok', fidelity_pct: 75, observer_edited: true });
  });

  test('a plan that could not be checked says which, never "no lesson plan was provided"', () => {
    const a = buildAnalysis(form({
      answers: { ...ANSWERS, lp_upload: { kind: 'photos', count: 2 } },
      rumi_moments: { moments: MOMENTS, counts: {}, fidelity: { status: 'lp_not_lesson_plan' } },
    }));
    expect(a.domains.lesson_plan_fidelity).toMatchObject({ assessed: false, not_assessed_reason: 'lp_not_lesson_plan' });
  });

  test('"there was no lesson plan" leaves Section B out of the total', () => {
    const a = buildAnalysis(form({ answers: { ...ANSWERS, lp: 'none' } }));
    expect(a.domains.lesson_plan_fidelity).toMatchObject({ assessed: false, not_assessed_reason: 'lp_absent' });
    expect(a.scores.overall_max_marks).toBe(a.domains.high_leverage_practices.domain_max
      + a.domains.student_engagement.domain_max + a.domains.teacher_subject_knowledge.domain_max);
  });
});

describe('a late moments run does not undo the hand-off', () => {
  test('a moments job that runs again after the check leaves the status alone', async () => {
    const id = await checkable();
    await submit(id);
    const Moments = require('../../bot/shared/services/observe/observe2/moments');
    const out = await Moments.runForSession('sess-1', PHONE);
    expect(out).toMatchObject({ handled: true, action: 'already_checked' });
    expect(session().status).toBe('observer_review_complete');
  });
});
