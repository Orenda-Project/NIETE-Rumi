/**
 * /observe2 — from the command to the live form in the coach's hands.
 *
 *   /observe2 → the visit planner (the same Flow as /observe) carrying the marker
 *   <userId>:observe2-visit → Start binds the teacher exactly as today (so the recording still
 *   attaches) → a record is created → "How long is this period?" → the live form, whose token is
 *   <userId>:observe2-form:<recordId>.
 *
 * Mocks only at the boundaries: WhatsApp, the database store, the observe state and the visit
 * handler's bind. The gate, the handlers and the strings run for real.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  createForm: jest.fn(() => Promise.resolve({ ok: true, form: { id: 'form-1' } })),
  getForm: jest.fn(),
  setPeriod: jest.fn(() => Promise.resolve({ ok: true })),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(() => Promise.resolve(true)), getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const b = { select: () => b, eq: () => b, limit: () => Promise.resolve({ data: [{ id: 'ls1' }], error: null }), single: () => Promise.resolve({ data: global.__OBS2_USER || null, error: null }) };
  return { from: () => b };
});
jest.mock('../../bot/shared/handlers/observe-visit-flow.handler', () => ({
  handle: jest.fn(() => Promise.resolve({ boundTeacher: { teacher_ext_id: 'tx1', school_ext_id: 'sx1', teacher_name: 'Rabia', user_id: 'teacher-1' } })),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const VisitHandler = require('../../bot/shared/handlers/observe-visit-flow.handler');
const { evaluateObserve2Trigger } = require('../../bot/shared/services/observe/observe2/gate');
const Start = require('../../bot/shared/services/observe/observe2/start');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en', preferences: { observe_onboarded: true } };
const ENV = { OBSERVE2_FIELD_FORM_FLOW_ID: 'F-FORM', OBSERVE2_CHECK_FLOW_ID: 'F-CHECK', OBSERVE_VISIT_FLOW_ID: 'F-VISIT', OBSERVE_MEWAKA_FLOW_ID: 'F-FICO' };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, ENV);
  global.__OBS2_USER = COACH;
});
afterAll(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

describe('the gate', () => {
  test('matches /observe2 only when both /observe2 Flows and the visit planner are configured', () => {
    expect(evaluateObserve2Trigger({ messageBody: '/observe2', user: COACH })).toEqual({ match: true, action: 'start' });
    delete process.env.OBSERVE2_CHECK_FLOW_ID;
    expect(evaluateObserve2Trigger({ messageBody: '/observe2', user: COACH })).toEqual({ match: false });
  });
  test('does not match /observe, and /observe does not match /observe2', () => {
    const { OBSERVE_TRIGGER_RX } = require('../../bot/shared/services/observe/observe-gate');
    expect(evaluateObserve2Trigger({ messageBody: '/observe', user: COACH })).toEqual({ match: false });
    expect(OBSERVE_TRIGGER_RX.test('/observe2')).toBe(false);
  });
  test('a teacher is told it is for coaches; no user is refused', () => {
    expect(evaluateObserve2Trigger({ messageBody: '/observe2', user: { id: 't', role: 'teacher' } })).toEqual({ match: true, action: 'deny_role' });
    expect(evaluateObserve2Trigger({ messageBody: '/observe2', user: null })).toEqual({ match: true, action: 'deny_no_user' });
  });
});

describe('the command opens the visit planner with the observe2 marker', () => {
  test('the planner is the /observe visit Flow, token <userId>:observe2-visit', async () => {
    expect(await Start.handleObserve2Command(COACH, '923000000001', '/observe2')).toBe(true);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('923000000001', expect.objectContaining({ flowId: 'F-VISIT', flowToken: 'coach-1:observe2-visit' }));
  });
  test('a planner that fails to send is reported to the coach, not treated as launched', async () => {
    WhatsAppService.sendFlow.mockResolvedValueOnce(false);
    await Start.handleObserve2Command(COACH, '923000000001', '/observe2');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', observe2Strings('en').launch_failed);
  });
  test('a teacher gets the coaches-only line and no Flow', async () => {
    global.__OBS2_USER = { id: 't', role: 'teacher' };
    await Start.handleObserve2Command({ id: 't', role: 'teacher' }, '923000000002', '/observe2');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000002', observe2Strings('en').deny_role);
  });
});

describe('after Start: the record, then the period', () => {
  test('creates the record for this coach and teacher, then asks the period with three buttons', async () => {
    await Start.afterStart({ user: COACH, phoneNumber: '923000000001', boundTeacher: { teacher_ext_id: 'tx1', school_ext_id: 'sx1', teacher_name: 'Rabia', user_id: 'teacher-1' } });
    expect(Store.createForm).toHaveBeenCalledWith({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: { teacher_ext_id: 'tx1', school_ext_id: 'sx1' } });
    const [to, msg] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe('923000000001');
    expect(msg.body).toContain('Rabia');
    expect(msg.buttons.map((b) => b.id)).toEqual(['obs2_period:form-1:30', 'obs2_period:form-1:35', 'obs2_period:form-1:40']);
    for (const b of msg.buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
  });
  test('a record that cannot be created is said plainly', async () => {
    Store.createForm.mockResolvedValueOnce({ ok: false, error: 'x' });
    await Start.afterStart({ user: COACH, phoneNumber: '923000000001', boundTeacher: {} });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', observe2Strings('en').record_failed);
  });
});

describe('the period button sends the live form', () => {
  test('sets the period and sends the form with its own token and the before-the-lesson steps', async () => {
    Store.getForm.mockResolvedValueOnce({ ok: true, form: { id: 'form-1', observer_user_id: 'coach-1' } });
    expect(await Start.handlePeriodButton(COACH, '923000000001', 'obs2_period:form-1:40')).toBe(true);
    expect(Store.setPeriod).toHaveBeenCalledWith('form-1', 40);
    const [, flow] = WhatsAppService.sendFlow.mock.calls[0];
    expect(flow).toMatchObject({ flowId: 'F-FORM', flowToken: 'coach-1:observe2-form:form-1' });
    expect(flow.body).toMatch(/recorder/i);
    expect(flow.body).toMatch(/minute 20/);
    expect([...flow.buttonText].length).toBeLessThanOrEqual(20);
  });
  test('another coach\'s form is refused', async () => {
    Store.getForm.mockResolvedValueOnce({ ok: true, form: { id: 'form-1', observer_user_id: 'someone-else' } });
    await Start.handlePeriodButton(COACH, '923000000001', 'obs2_period:form-1:40');
    expect(Store.setPeriod).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });
  test('a malformed button id is not claimed', async () => {
    expect(await Start.handlePeriodButton(COACH, '923000000001', 'obs2_period:form-1:7')).toBe(false);
  });
});

describe('the visit planner\'s Start completion branches on the marker', () => {
  const { handleObserveVisitFlow } = require('../../bot/shared/handlers/flow-response.handler');
  const reply = (token) => ({ interactive: { nfm_reply: { response_json: JSON.stringify({ step: 'start', teacher_ext_id: 'tx1', school_ext_id: 'sx1', flow_token: token }) } } });

  test('an /observe2 Start binds the teacher as today, then asks the period instead of the capture prompt', async () => {
    await handleObserveVisitFlow(reply('coach-1:observe2-visit'), '923000000001', 'coach-1');
    expect(VisitHandler.handle).toHaveBeenCalledWith('coach-1', 'complete', 'BRIEF', expect.any(Object), 'coach-1:observe2-visit', expect.anything());
    expect(Store.createForm).toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalled();
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(texts).not.toMatch(/record it and send me the audio|draft the FICO form/i);
  });
  test('a classic /observe Start still gets today\'s capture prompt and no record', async () => {
    await handleObserveVisitFlow(reply('coach-1'), '923000000001', 'coach-1');
    expect(Store.createForm).not.toHaveBeenCalled();
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(texts).toMatch(/record it and send me the audio/i);
  });

  // The planner is a loop: adding a school or finishing the schedule closes it and a fresh one is
  // sent. That fresh one must still carry the /observe2 marker, or the Start that follows is a
  // classic /observe Start and the coach never gets the field form.
  const done = (token) => ({ interactive: { nfm_reply: { response_json: JSON.stringify({ observe_visit_action: 'done', visit_next: 'menu', flow_token: token }) } } });
  test('a planner reopened from an /observe2 loop keeps the marker', async () => {
    await handleObserveVisitFlow(done('coach-1:observe2-visit'), '923000000001', 'coach-1');
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('923000000001', expect.objectContaining({ flowId: 'F-VISIT', flowToken: 'coach-1:observe2-visit' }));
  });
  test('a classic reopen keeps the bare user id', async () => {
    await handleObserveVisitFlow(done('coach-1'), '923000000001', 'coach-1');
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('923000000001', expect.objectContaining({ flowId: 'F-VISIT', flowToken: 'coach-1' }));
  });
});

describe('strings', () => {
  test('every English key has an Urdu counterpart, and the Urdu never addresses the coach with a gendered verb', () => {
    const en = observe2Strings('en'), ur = observe2Strings('ur');
    for (const k of Object.keys(en)) expect(typeof ur[k]).toBe(typeof en[k]);
    const urText = JSON.stringify(Object.values(ur).filter((v) => typeof v === 'string'));
    expect(urText).not.toMatch(/آپ[^۔]{0,40}(رہی|رہے) (ہیں|ہوں)/);
  });
});
