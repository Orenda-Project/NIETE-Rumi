/**
 * /observe2 — a visit whose next message never reached the coach can be picked up from the menu.
 *
 * Production, 5 Oct 2026: WhatsApp refused every message from the NIETE number for 50 minutes
 * (Meta #131042). Ten coaches had sent their recording; the moments were found and "Check the
 * moments" was sent to each of them, and every one of those messages failed. Their visits waited in
 * observe2_checking, a status the "Complete the form" worklist did not list, so once WhatsApp was
 * back there was no way for a coach to reach the check again.
 *
 * Now a visit waiting at an /observe2 step is in the worklist like any unfinished observation, and
 * tapping it sends what it is waiting for: the check when the record is sealed and the moments are
 * in, the form when it is not sealed yet, and a "still working" note otherwise.
 *
 * Real: /observe's worklist and resume, the /observe2 store, start and moments. Mocked: the database
 * (in-memory), WhatsApp.
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Debrief = require('../../bot/shared/services/observe/observe-debrief.service');
const Resume = require('../../bot/shared/services/observe/observe-resume.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en', role: 'coach' };
const PHONE = COACH.phone_number;
const MOMENTS = [{ id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why? Ali?' }];

function seed({ status, form }) {
  mockFake = createFakeSupabase({
    users: [COACH],
    coaching_sessions: [{
      id: 'sess-1', observer_user_id: 'coach-1', user_id: 'teacher-1', observation_type: 'leader_observation', status, debrief_status: 'pending',
      created_at: '2026-10-05T10:36:00Z', updated_at: '2026-10-05T10:39:00Z', analysis_data: {},
    }],
    observation_field_forms: [{
      id: 'form-1', observer_user_id: 'coach-1', coaching_session_id: 'sess-1', period_minutes: 40,
      answers: {}, photos: [], evidence_review: {}, ...form,
    }],
    observation_schedules: [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OBSERVE2_FIELD_FORM_FLOW_ID = 'field-flow';
  process.env.OBSERVE2_CHECK_FLOW_ID = 'check-flow';
});

describe('the worklist', () => {
  test('a visit waiting at an /observe2 step has its own resume kind', () => {
    expect(Debrief.resumeKindFor('observe2_checking', '2026-10-05T10:39:00Z')).toBe('observe2');
    expect(Debrief.resumeKindFor('observe2_ready', '2026-10-05T10:39:00Z')).toBe('observe2');
  });

  test('a visit whose check never arrived is listed under "Complete the form"', async () => {
    seed({ status: 'observe2_checking', form: { sealed_at: '2026-10-05T10:35:00Z', moments_ready_at: '2026-10-05T10:39:00Z', rumi_moments: { moments: MOMENTS } } });
    const list = await Debrief.listUnfinished('coach-1');
    expect(list.map((r) => [r.id, r.resume])).toEqual([['sess-1', 'observe2']]);
  });

  test.each(['en', 'ur', 'sw'])('its row says what is waiting, within the 72-character limit (%s)', (lang) => {
    const S = observeStrings(lang);
    expect(typeof S.resume_desc_observe2).toBe('string');
    expect([...S.resume_desc_observe2].length).toBeGreaterThan(0);
    expect([...S.resume_desc_observe2].length).toBeLessThanOrEqual(72);
    const payload = Debrief.buildPendingListPayload([], S, [], [{ id: 'sess-1', resume: 'observe2', created_at: '2026-10-05T10:36:00Z', analysis_data: {} }]);
    const row = payload.action.sections[0].rows[0];
    expect(row.description).toBe(S.resume_desc_observe2);
  });
});

describe('tapping the visit', () => {
  test('sealed, moments in, not checked: the check is sent again', async () => {
    seed({ status: 'observe2_checking', form: { sealed_at: '2026-10-05T10:35:00Z', moments_ready_at: '2026-10-05T10:39:00Z', rumi_moments: { moments: MOMENTS } } });
    await Resume.resume('sess-1', PHONE, COACH);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [to, flow] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(flow).toMatchObject({ flowId: 'check-flow', flowToken: 'coach-1:observe2-check:form-1' });
    expect(mockFake.__tables.coaching_sessions[0].status).toBe('observe2_checking');
  });

  test('a check that was never sent (observe2_ready, sealed, moments in) is sent now', async () => {
    seed({ status: 'observe2_ready', form: { sealed_at: '2026-10-05T10:35:00Z', moments_ready_at: '2026-10-05T10:39:00Z', rumi_moments: { moments: MOMENTS } } });
    await Resume.resume('sess-1', PHONE, COACH);
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'check-flow' });
    expect(mockFake.__tables.coaching_sessions[0].status).toBe('observe2_checking');
  });

  test('not sealed yet: the form is sent again, to finish and seal', async () => {
    seed({ status: 'observe2_ready', form: { sealed_at: null, moments_ready_at: '2026-10-05T10:39:00Z', rumi_moments: { moments: MOMENTS } } });
    await Resume.resume('sess-1', PHONE, COACH);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'field-flow', flowToken: 'coach-1:observe2-form:form-1' });
  });

  test('sealed, moments not in yet: the coach is told it is still working, and nothing is opened', async () => {
    seed({ status: 'observe2_ready', form: { sealed_at: '2026-10-05T10:35:00Z', moments_ready_at: null, rumi_moments: null } });
    await Resume.resume('sess-1', PHONE, COACH);
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    const said = [...WhatsAppService.sendMessage.mock.calls, ...WhatsAppService.sendInteractiveButtons.mock.calls].map((c) => JSON.stringify(c[1]));
    expect(said.join(' ')).toContain(JSON.stringify(observeStrings('en').resume_wait_ack).slice(1, 30));
  });
});
