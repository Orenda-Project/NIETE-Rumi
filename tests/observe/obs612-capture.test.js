'use strict';
/**
 * bd-pni007 — /observe: the recording of a lesson the coach named grades 6-12 makes an FDE visit at once.
 *
 *   the session is stamped with the rubric id (before transcription is queued, so every later step sees it), gets its
 *   own form row (linked, visit_context.via 'observe'), and FDE's form goes to the coach as the acknowledgement;
 *   the recording is still transcribed and kept. FICO's v6 decision is not asked for it.
 *   A grade 1-5 lesson: FICO, the named class deciding the grades 1-5 gate. No lesson named: today, unchanged.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
}));
const mockState = { value: null };
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn(() => Promise.resolve(true)),
  getState: jest.fn(() => Promise.resolve(mockState.value)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/bound-teacher', () => ({ resolveBoundTeacherUserId: jest.fn(() => Promise.resolve('teacher-1')) }));
jest.mock('../../bot/shared/services/observe/observe2/capture-link', () => ({ linkRecording: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueTranscription: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-schedule.service', () => ({ markDone: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-who.service', () => ({ maybeAskObservedTeacher: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../bot/shared/services/observe/observe-fico17-v6', () => ({ decideVisitFramework: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  createLessonForm: jest.fn((row) => Promise.resolve({ ok: true, form: { id: 'form-9', observer_user_id: row.observerUserId, rubric_version: row.rubricVersion, visit_context: row.visitContext, coaching_session_id: row.sessionId } })),
}));
const mockWrites = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = { _t: table };
    q.insert = (row) => { mockWrites.push(['insert', table, row]); return q; };
    q.update = (patch) => { mockWrites.push(['update', table, patch]); return q; };
    q.select = () => q;
    q.eq = () => q;
    q.single = () => Promise.resolve({ data: { id: 'sess-1', framework: null }, error: null });
    q.then = (res) => res({ data: null, error: null });
    return q;
  }),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Queue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const { startFromAudio } = require('../../bot/shared/services/observe/observe-capture.service');

const COACH = { id: 'coach-1', region: 'sihala', preferred_language: 'en' };
const BOUND = { user_id: 'teacher-1', teacher_ext_id: 'tx1', school_ext_id: 'sx1', teacher_name: 'Rabia' };

beforeEach(() => {
  jest.clearAllMocks();
  mockWrites.length = 0;
  process.env.OBS612_FLOW_ID = 'F-FDE';
});
afterAll(() => { delete process.env.OBS612_FLOW_ID; });

test('a grade 7 Maths lesson: stamped before transcription, its own form row, FDE\'s form is the acknowledgement', async () => {
  mockState.value = {
    state: 'awaiting_audio', origin: 'observe', boundTeacher: BOUND,
    obs612Lesson: { primary: false, grade: 7, subject: 'maths', rubricId: 'obs612-msci-v1', tool: 'msci', sheet: null },
  };
  const session = await startFromAudio(COACH, '9230', 'audio-1', 'chat-1', 1800);
  expect(session.framework).toBe('obs612-msci-v1');
  expect(O6.decideVisitFramework).not.toHaveBeenCalled();
  const stamp = mockWrites.find(([op, t, p]) => op === 'update' && t === 'coaching_sessions' && p.framework);
  expect(stamp[2]).toEqual({ framework: 'obs612-msci-v1', framework_selection_reason: 'obs612_lesson' });
  expect(Store.createLessonForm).toHaveBeenCalledWith({
    observerUserId: 'coach-1', teacherUserId: 'teacher-1', sessionId: 'sess-1', rubricVersion: 'obs612-msci-v1',
    visitContext: { grade: 7, subject: 'maths', sheet: null, via: 'observe', teacher_ext_id: 'tx1', school_ext_id: 'sx1', teacher_name: 'Rabia' },
  });
  // the stamp and the form come before transcription is queued
  const stampOrder = Store.createLessonForm.mock.invocationCallOrder[0];
  expect(stampOrder).toBeLessThan(Queue.queueTranscription.mock.invocationCallOrder[0]);
  expect(Queue.queueTranscription).toHaveBeenCalledWith('sess-1', { from: '9230', audioId: 'audio-1' });
  expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
  expect(WhatsAppService.sendFlow.mock.calls[0][1]).toMatchObject({ flowId: 'F-FDE', flowToken: 'coach-1:obs612:form-9' });
  expect(WhatsAppService.sendFlow.mock.calls[0][1].body).toMatch(/while the lesson is fresh/);
  expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled(); // no second "okay / wait" message
});

test('a grade 1-5 lesson: FICO as today, the named class deciding the grades 1-5 gate', async () => {
  mockState.value = { state: 'awaiting_audio', origin: 'observe', boundTeacher: BOUND, obs612Lesson: { primary: true, grade: null, subject: null } };
  await startFromAudio(COACH, '9230', 'audio-1', 'chat-1', 1800);
  expect(O6.decideVisitFramework).toHaveBeenCalledWith({ userId: 'coach-1', region: 'sihala', teacherUserId: 'teacher-1', lessonIsPrimary: true });
  expect(Store.createLessonForm).not.toHaveBeenCalled();
  expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
});

test('no lesson named (the switch off): exactly today\'s capture', async () => {
  mockState.value = { state: 'awaiting_audio', origin: 'observe', boundTeacher: BOUND };
  await startFromAudio(COACH, '9230', 'audio-1', 'chat-1', 1800);
  expect(O6.decideVisitFramework).toHaveBeenCalledWith({ userId: 'coach-1', region: 'sihala', teacherUserId: 'teacher-1' });
  expect(Store.createLessonForm).not.toHaveBeenCalled();
  expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  const ack = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
  expect(ack.buttons.map((b) => b.id)).toEqual(['observe_ok_sess-1', 'observe_cancel_sess-1']);
});
