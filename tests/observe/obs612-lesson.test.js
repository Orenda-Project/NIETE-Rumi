'use strict';
/**
 * bd-pni007 — the lesson's class decides the rubric, the same way in /observe and /observe2 (operator 11 Nov ~18:05).
 *
 *   switch off (app_settings.obs612_coach, the default)  nothing is asked; /observe2's period sends the FICO live
 *                                                        form exactly as before
 *   switch on                                            class → (grades 6-12) subject → FDE's tool for that class:
 *     /observe2  the visit's form row is stamped (rubric_version obs612-…, visit_context grade/subject/sheet) and FDE's
 *                form is sent; grades 1-5 → FICO's live form, the named class deciding the grades 1-5 gate
 *     /observe   the lesson waits in the observe state; the capture prompt names FDE's tool
 *
 * Mocks only the boundaries: WhatsApp, the form store, the observe state, the switch.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  getForm: jest.fn(),
  setPeriod: jest.fn(() => Promise.resolve({ ok: true })),
  setLesson: jest.fn((form, { rubricVersion, visitContextPatch }) => Promise.resolve({
    ok: true, form: { ...form, rubric_version: rubricVersion, visit_context: JSON.parse(JSON.stringify({ ...(form.visit_context || {}), ...visitContextPatch })) },
  })),
  findBySession: jest.fn(() => Promise.resolve({ ok: true, form: null })),
}));
const mockState = { value: null };
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn((id, state, data) => { mockState.value = { state, ...data }; return Promise.resolve(true); }),
  getState: jest.fn(() => Promise.resolve(mockState.value)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
const mockSwitchOn = { value: false };
jest.mock('../../bot/shared/services/coaching/obs612-switch', () => ({ isOn: jest.fn(() => Promise.resolve(mockSwitchOn.value)) }));
jest.mock('../../bot/shared/services/observe/observe2/rubric', () => ({
  visitRubric: jest.fn(() => Promise.resolve({ rubricVersion: 'fico17_v6', shadow: false })),
}));
const mockUpdates = [];
jest.mock('../../bot/shared/services/coaching/session-terminal', () => ({
  updateIfNotTerminal: jest.fn((id, patch) => { mockUpdates.push({ id, patch }); return Promise.resolve({ applied: true }); }),
}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const { visitRubric } = require('../../bot/shared/services/observe/observe2/rubric');
const Start = require('../../bot/shared/services/observe/observe2/start');
const V = require('../../bot/shared/services/observe/obs612/visit');
const { STRINGS } = require('../../bot/shared/services/observe/obs612/strings');

const COACH = { id: 'coach-1', role: 'coach', region: 'sihala', preferred_language: 'en' };
const FORM = { id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1', rubric_version: 'fico-ict-17-2026-09', period_minutes: null, visit_context: { teacher_ext_id: 'tx1' }, sealed_at: null, coaching_session_id: null };
const listRows = (call) => call[1].action.sections.flatMap((s) => s.rows);

beforeEach(() => {
  jest.clearAllMocks();
  mockSwitchOn.value = false;
  mockState.value = null;
  mockUpdates.length = 0;
  process.env.OBSERVE2_FIELD_FORM_FLOW_ID = 'F-FORM';
  process.env.OBS612_FLOW_ID = 'F-FDE';
  process.env.OBSERVE_FRAMEWORK = 'fico';
  Store.getForm.mockResolvedValue({ ok: true, form: { ...FORM } });
});
afterAll(() => { delete process.env.OBS612_FLOW_ID; delete process.env.OBSERVE2_FIELD_FORM_FLOW_ID; delete process.env.OBSERVE_FRAMEWORK; });

describe('/observe2', () => {
  test('switch off: the period sends the FICO live form, nothing is asked (today, unchanged)', async () => {
    await Start.handlePeriodButton(COACH, '9230', 'obs2_period:form-1:35');
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'F-FORM', flowToken: 'coach-1:observe2-form:form-1' });
  });

  test('switch on: the period asks the class (grades 1-5 in one row, then 6 to 12), no form yet', async () => {
    mockSwitchOn.value = true;
    await Start.handlePeriodButton(COACH, '9230', 'obs2_period:form-1:35');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    const rows = listRows(WhatsAppService.sendInteractiveMessage.mock.calls[0]);
    expect(rows.map((r) => r.id)).toEqual(['p', 6, 7, 8, 9, 10, 11, 12].map((g) => `o612:g:f:form-1:${g}`));
  });

  test('grade 7 → the subject list; Maths → the form is stamped Maths & Science and FDE\'s form is sent', async () => {
    mockSwitchOn.value = true;
    await V.handleTap(COACH, '9230', 'o612:g:f:form-1:7');
    const rows = listRows(WhatsAppService.sendInteractiveMessage.mock.calls[0]);
    expect(rows).toHaveLength(8);
    expect(rows[2].id).toBe('o612:s:f:form-1:7:maths');

    await V.handleTap(COACH, '9230', 'o612:s:f:form-1:7:maths');
    expect(Store.setLesson).toHaveBeenCalledWith(expect.objectContaining({ id: 'form-1' }), {
      rubricVersion: 'obs612-msci-v1',
      visitContextPatch: { grade: 7, subject: 'maths', sheet: null, via: 'observe2', shadow_v6: undefined },
    });
    const flow = WhatsAppService.sendFlow.mock.calls[0][1];
    expect(flow).toMatchObject({ flowId: 'F-FDE', flowToken: 'coach-1:obs612:form-1' });
    expect(flow.body).toMatch(/Grade 7 · Maths/);
    expect(flow.body).toMatch(/Maths and Science/);
    expect(flow.body).toMatch(/as you watch/); // no recording yet: the live wording
  });

  test.each([
    ['8:english', 'obs612-enur-v1', 'en'], ['6:urdu', 'obs612-enur-v1', 'ur'], ['8:science', 'obs612-msci-v1', null],
    ['7:islamiat', 'obs612-gen-v1', null], ['8:computer', 'obs612-gen-v1', null],
  ])('grade:subject %s → %s', async (gs, id, sheet) => {
    await V.handleTap(COACH, '9230', `o612:s:f:form-1:${gs}`);
    const [, patch] = Store.setLesson.mock.calls[0];
    expect(patch.rubricVersion).toBe(id);
    expect(patch.visitContextPatch.sheet).toBe(sheet);
  });

  // bd-ra8xu.40 (operator 12 Nov ~11:00): grades 9-12 stay on FICO (v6 when the coach switch says so): no subject is
  // asked, and the named class decides the gate as grades 1-5 does.
  test.each(['o612:g:f:form-1:10', 'o612:s:f:form-1:11:maths'])('grade 9-12 (%s): FICO\'s live form, no subject asked', async (id) => {
    await V.handleTap(COACH, '9230', id);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(visitRubric).toHaveBeenCalledWith(expect.objectContaining({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', lessonIsPrimary: true }));
    const [, patch] = Store.setLesson.mock.calls[0];
    expect(patch.rubricVersion).toBe('fico17_v6');
    expect(patch.visitContextPatch).toMatchObject({ grade_band: 'high' });
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'F-FORM' });
  });

  test('grades 1-5: FICO\'s live form; the named class decides the grades 1-5 gate, not the profile', async () => {
    await V.handleTap(COACH, '9230', 'o612:g:f:form-1:p');
    expect(visitRubric).toHaveBeenCalledWith(expect.objectContaining({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', lessonIsPrimary: true }));
    expect(Store.setLesson.mock.calls[0][1]).toEqual({ rubricVersion: 'fico17_v6', visitContextPatch: { grade_band: 'primary', shadow_v6: undefined } });
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'F-FORM', flowToken: 'coach-1:observe2-form:form-1' });
  });

  test('a visit already named for grades 6-12: a period or Fill tap re-sends FDE\'s form, never FICO\'s', async () => {
    mockSwitchOn.value = true;
    Store.getForm.mockResolvedValue({ ok: true, form: { ...FORM, rubric_version: 'obs612-gen-v1', visit_context: { grade: 9, subject: 'maths', via: 'observe2' }, coaching_session_id: 'sess-1' } });
    await Start.handleFillButton(COACH, '9230', 'obs2_fill:form-1');
    expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'F-FDE', flowToken: 'coach-1:obs612:form-1' });
    expect(WhatsAppService.sendFlow.mock.calls[0][1].body).toMatch(/while the lesson is fresh/); // recording in
  });

  test('a tap on a sealed form, or another coach\'s, changes nothing', async () => {
    Store.getForm.mockResolvedValue({ ok: true, form: { ...FORM, sealed_at: '2026-11-11T10:00:00Z' } });
    await V.handleTap(COACH, '9230', 'o612:s:f:form-1:7:maths');
    Store.getForm.mockResolvedValue({ ok: true, form: { ...FORM, observer_user_id: 'someone-else' } });
    await V.handleTap(COACH, '9230', 'o612:s:f:form-1:7:maths');
    expect(Store.setLesson).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('9230', STRINGS.en.gone);
  });

  test('OBS612_FLOW_ID unset: the coach is told; nothing is left waiting silently', async () => {
    delete process.env.OBS612_FLOW_ID;
    await V.handleTap(COACH, '9230', 'o612:s:f:form-1:7:maths');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('9230', STRINGS.en.form_not_ready);
  });
});

describe('/observe', () => {
  test('after Start: switch off asks nothing', async () => {
    expect(await V.asksClass(COACH)).toBe(false);
  });

  test('after Start: the class is asked with a nonce kept in the observe state; a 6-12 answer names FDE\'s tool in the capture prompt', async () => {
    mockSwitchOn.value = true;
    mockState.value = { state: 'awaiting_audio', origin: 'observe', boundTeacher: { teacher_name: 'Rabia' } };
    expect(await V.asksClass(COACH)).toBe(true);
    expect(await V.askForObserve(COACH, '9230', { teacherName: 'Rabia' })).toBe(true);
    const nonce = mockState.value.obs612Ask;
    expect(nonce).toMatch(/^[0-9a-f]{12}$/);
    const rows = listRows(WhatsAppService.sendInteractiveMessage.mock.calls[0]);
    expect(rows[1].id).toBe(`o612:g:o:${nonce}:6`);

    await V.handleTap(COACH, '9230', `o612:s:o:${nonce}:6:english`);
    expect(mockState.value.obs612Lesson).toMatchObject({ primary: false, grade: 6, subject: 'english', rubricId: 'obs612-enur-v1', tool: 'enur', sheet: 'en' });
    expect(mockState.value.boundTeacher).toEqual({ teacher_name: 'Rabia' }); // the bind is kept
    const prompt = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(prompt).toMatch(/Grade 6 · English/);
    expect(prompt).toMatch(/English & Urdu/);
    expect(prompt).toMatch(/Document/);
    expect(V.lessonOfState(mockState.value)).toMatchObject({ rubricId: 'obs612-enur-v1', sheet: 'en' });
  });

  test('a grade 1-5 answer: today\'s capture prompt; the lesson says primary', async () => {
    mockState.value = { state: 'awaiting_audio', obs612Ask: 'abc123abc123' };
    await V.handleTap(COACH, '9230', 'o612:g:o:abc123abc123:p');
    expect(mockState.value.obs612Lesson).toEqual({ primary: true, grade: null, subject: null });
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/draft the FICO form/);
  });

  test('a tap from an older visit (another nonce, or the state gone) changes nothing', async () => {
    mockState.value = { state: 'awaiting_audio', obs612Ask: 'aaaaaaaaaaaa' };
    await V.handleTap(COACH, '9230', 'o612:s:o:bbbbbbbbbbbb:7:maths');
    expect(mockState.value.obs612Lesson).toBeUndefined();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('9230', STRINGS.en.gone);
  });
});

describe('after the recording is transcribed', () => {
  test('an FDE session waits for its form (not a status the watchdog re-queues); a submitted one is back to review complete', async () => {
    Store.findBySession.mockResolvedValueOnce({ ok: true, form: { id: 'f', rubric_version: 'obs612-msci-v1', sealed_at: null } });
    expect(await V.afterTranscription('s1', { framework: 'obs612-msci-v1' })).toEqual({ handled: true, action: 'obs612_form' });
    Store.findBySession.mockResolvedValueOnce({ ok: true, form: { id: 'f', rubric_version: 'obs612-msci-v1', sealed_at: '2026-11-11T10:00:00Z' } });
    expect(await V.afterTranscription('s2', { framework: 'obs612-msci-v1' })).toEqual({ handled: true, action: 'observer_review_complete' });
    expect(mockUpdates.map((u) => [u.id, u.patch.status])).toEqual([['s1', 'obs612_form'], ['s2', 'observer_review_complete']]);
  });

  test('an /observe2 FDE form linked to the recording is found by the session', async () => {
    Store.findBySession.mockResolvedValueOnce({ ok: true, form: { id: 'f', rubric_version: 'obs612-gen-v1', sealed_at: null } });
    expect((await V.afterTranscription('s3', { framework: 'fico' })).handled).toBe(true);
  });

  test('every other observation is left alone', async () => {
    Store.findBySession.mockResolvedValueOnce({ ok: true, form: { id: 'f', rubric_version: 'fico-ict-17-2026-09' } });
    expect(await V.afterTranscription('s4', { framework: 'fico' })).toEqual({ handled: false });
    expect(await V.afterTranscription('s5', { framework: 'fico17_v6' })).toEqual({ handled: false });
    expect(mockUpdates).toHaveLength(0);
  });
});

describe('WhatsApp caps and the Urdu drafts', () => {
  const cps = (s) => [...String(s)].length;
  test.each(['en', 'ur'])('%s: list rows ≤ 24, descriptions ≤ 72, buttons ≤ 20 code points', async (lang) => {
    const coach = { ...COACH, preferred_language: lang };
    await V.askClass(coach, '9230', { kind: 'f', ref: 'form-1' });
    await V.askSubject(coach, '9230', { kind: 'f', ref: 'form-1', grade: 12 });
    for (const call of WhatsAppService.sendInteractiveMessage.mock.calls) {
      expect(cps(call[1].action.button)).toBeLessThanOrEqual(20);
      for (const s of call[1].action.sections) expect(cps(s.title)).toBeLessThanOrEqual(24);
      for (const r of listRows(call)) {
        expect(cps(r.title)).toBeLessThanOrEqual(24);
        if (r.description) expect(cps(r.description)).toBeLessThanOrEqual(72);
        expect(r.title).toBe([...r.title].slice(0, 24).join('')); // never clipped mid-word by the cap
      }
      expect(cps(call[1].body.text)).toBeLessThanOrEqual(1024);
    }
    expect(cps(STRINGS[lang].form_cta)).toBeLessThanOrEqual(20);
  });

  test('Urdu prose carries Urdu digits, and addresses the coach without gendered verb endings', () => {
    const ur = STRINGS.ur;
    expect(ur.grade_row(12)).toBe('جماعت ۱۲');
    expect(ur.subject_body(7)).not.toMatch(/[0-9]/);
    const prose = [ur.class_body(null), ur.fde_record_hint('msci'), ur.form_body(7, 'ریاضی', 'msci'), ur.recording_saved(false)].join(' ');
    expect(prose).not.toMatch(/(رہی|رہے) ہیں|کریں گے|کریں گی/);
  });
});

describe('the form closing (nfm_reply)', () => {
  const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
  test('an FDE form completion is claimed as obs612, by its key or by its token, never the attendance fallback', () => {
    expect(detectFlowType({ obs612: 'submitted', form_id: 'f', flow_token: 'coach-1:obs612:f' })).toBe('obs612');
    expect(detectFlowType({ flow_token: 'coach-1:obs612:f' })).toBe('obs612');
    expect(detectFlowType({ observe2: 'sealed', flow_token: 'coach-1:observe2-form:f' })).toBe('observe2');
  });
});
