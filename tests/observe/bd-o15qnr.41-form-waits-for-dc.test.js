/**
 * bd-o15qnr.41 (queue #228) — the Feedback Form waits for the Digital Coach's draft, on every rubric.
 *
 * Seen on prod, 23 Nov (a principal's grade 6-12 FICO-S v1.2 visit, Digital Coach on): the recording landed 15:17:02 PKT,
 * the visit page offered the Feedback Form at once and it was opened 15:17:18, empty; Rumi's pre-fill landed on the form
 * row 15:18:20; the next save from the open page, 15:18:37, wrote the page's values over it. The operator, 15:40:
 * "dont open the form till analysis is complete."
 *
 * Why: portal-observe-step read EVERY FDE/FICO-S visit as "the form is hers" from the moment the recording landed. That
 * was right while no model read a FICO-S visit; since queue #184 a FICO-S visit stamped 'fico_s_dc' goes to the Digital
 * Coach first, and its form is ready only once the pre-fill is on it (fico-s-dc.onAnalysisReady → 'obs612_form').
 *
 *   step     a FICO-S Digital Coach visit is 'analysing' until 'obs612_form', then 'draft' (as a FICO17 v6 review waits
 *            for 'awaiting_observer_review'); an FDE / FICO-S visit no model reads is still the observer's from capture.
 *   draft    while the step is 'analysing', the draft is refused as { not_ready, reason: 'analysing' } on every rubric
 *            (FICO17 v6, FICO-S), read AND save, so no page can fill or write a form the Digital Coach has not filled.
 */
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendTemplateMessage: jest.fn(() => Promise.resolve(true)),
  sendImage: jest.fn(() => Promise.resolve(true)),
  sendDocument: jest.fn(() => Promise.resolve(true)),
}));

const PortalObserve = require('../../bot/shared/services/observe/portal-observe.service');
const { stepOfRow } = require('../../bot/shared/services/observe/portal-observe-step');

const OBSERVER = 'principal-1';
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const sessionRow = (id) => mockFake.__tables.coaching_sessions.find((r) => r.id === id);
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

// The statuses a visit passes through between the recording landing and the Digital Coach's draft.
const BEFORE_THE_DRAFT = ['confirmed', 'transcribing', 'transcription_complete', 'analyzing', 'analysis_complete'];

/** A FICO-S visit (rubric as given), stamped for the Digital Coach unless `reason` says otherwise. */
function ficoS(id, { status, rubric = 'fico_s_v1_2', reason = 'fico_s_dc', answers = {} } = {}) {
  return {
    session: {
      id, status, framework: rubric, framework_selection_reason: reason, observation_type: 'leader_observation',
      observer_user_id: OBSERVER, user_id: 'teacher-1', debrief_status: 'pending', audio_url: 'https://r2.example/classroom_audio/p/portal_x.webm',
      analysis_data: null,
    },
    form: {
      id: `form-${id}`, rubric_version: rubric, coaching_session_id: id, observer_user_id: OBSERVER, teacher_user_id: 'teacher-1',
      visit_context: { grade: 7, subject: 'english', via: 'observe', channel: 'portal' }, answers, photos: [],
      sealed_at: null, checked_at: null, final_levels: null,
    },
  };
}

const VISITS = [
  ...BEFORE_THE_DRAFT.map((s) => ficoS(`dc-${s}`, { status: s })),
  ficoS('dc-v11-analyzing', { status: 'analyzing', rubric: 'fico_s_v1_1' }),
  ficoS('dc-ready', { status: 'obs612_form', answers: { obs612: { A1: '2', ev_A1: 'Rumi heard the objective at 00:40.' }, fico_s_dc: { levels: { A1: { result: 2, because: 'x', evidence: [] } } } } }),
  ficoS('plain-transcribing', { status: 'transcribing', reason: 'fico_s_lesson' }),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [
      { id: OBSERVER, name: 'Principal Hina', role: 'principal', phone_number: '923000000009', preferred_language: 'en' },
      { id: 'teacher-1', name: 'Kashif', school_name: 'IMSG I-8/1', phone_number: '923000000002' },
    ],
    coaching_sessions: [
      ...VISITS.map((v) => v.session),
      { id: 'v6-analyzing', status: 'analyzing', framework: 'fico17_v6', observation_type: 'leader_observation', observer_user_id: OBSERVER, user_id: 'teacher-1', analysis_data: null },
      { id: 'v6-transcribing', status: 'transcribing', framework: 'fico17_v6', observation_type: 'leader_observation', observer_user_id: OBSERVER, user_id: 'teacher-1', analysis_data: null },
    ],
    observation_field_forms: VISITS.map((v) => v.form),
  });
});
afterEach(flush);

describe('the step: a FICO-S Digital Coach visit is analysing until the pre-fill is on its form', () => {
  test.each(BEFORE_THE_DRAFT)('status %s → analysing (not the form)', (status) => {
    expect(stepOfRow(sessionRow(`dc-${status}`)).step).toBe('analysing');
  });

  test('a v1.1 Digital Coach visit waits the same way', () => {
    expect(stepOfRow(sessionRow('dc-v11-analyzing')).step).toBe('analysing');
  });

  test('once the pre-fill is on it (obs612_form) the form is hers: draft', () => {
    expect(stepOfRow(sessionRow('dc-ready')).step).toBe('draft');
  });

  test('after Submit it is the debrief, as before', () => {
    expect(stepOfRow({ ...sessionRow('dc-ready'), status: 'observer_review_complete' }).step).toBe('talk');
  });

  test('a cancelled Digital Coach visit is stopped, not analysing', () => {
    expect(stepOfRow({ ...sessionRow('dc-analyzing'), status: 'cancelled' }).step).toBe('stopped');
  });

  test('a FICO-S visit no model reads is still the observer\'s from capture (unchanged)', () => {
    expect(stepOfRow(sessionRow('plain-transcribing')).step).toBe('draft');
  });
});

describe('the draft: refused as analysing until the Digital Coach\'s draft is in', () => {
  test.each(BEFORE_THE_DRAFT)('FICO-S Digital Coach visit at %s: GET is refused as analysing', async (status) => {
    const out = await PortalObserve.getDraft({ userId: OBSERVER, coachingSessionId: `dc-${status}` });
    expect(out).toEqual(expect.objectContaining({ status: 'not_ready', reason: 'analysing' }));
  });

  test('FICO-S Digital Coach visit before its pre-fill: a save is refused and the form row is untouched', async () => {
    const before = JSON.stringify(formRow('form-dc-analysis_complete').answers);
    const out = await PortalObserve.saveDraft({ userId: OBSERVER, coachingSessionId: 'dc-analysis_complete', edits: { A1: '3' } });
    expect(out).toEqual(expect.objectContaining({ status: 'not_ready', reason: 'analysing' }));
    expect(JSON.stringify(formRow('form-dc-analysis_complete').answers)).toBe(before);
  });

  test('once the pre-fill is on it, the form opens with Rumi\'s level and evidence in it', async () => {
    const out = await PortalObserve.getDraft({ userId: OBSERVER, coachingSessionId: 'dc-ready' });
    expect(out).toEqual(expect.objectContaining({ status: 'ok', kind: 'obs612', tool: 'ficos', editable: true }));
    expect(out.values).toEqual(expect.objectContaining({ A1: '2', ev_A1: 'Rumi heard the objective at 00:40.' }));
  });

  test('a FICO-S visit no model reads still opens from capture (unchanged)', async () => {
    const out = await PortalObserve.getDraft({ userId: OBSERVER, coachingSessionId: 'plain-transcribing' });
    expect(out).toEqual(expect.objectContaining({ status: 'ok', kind: 'obs612' }));
  });

  test.each(['v6-analyzing', 'v6-transcribing'])('FICO17 v6 (grades 1-5) visit %s: GET and save are refused as analysing', async (id) => {
    expect(await PortalObserve.getDraft({ userId: OBSERVER, coachingSessionId: id })).toEqual(expect.objectContaining({ status: 'not_ready', reason: 'analysing' }));
    expect(await PortalObserve.saveDraft({ userId: OBSERVER, coachingSessionId: id, edits: { r_C1: '3' } })).toEqual(expect.objectContaining({ status: 'not_ready', reason: 'analysing' }));
  });
});
