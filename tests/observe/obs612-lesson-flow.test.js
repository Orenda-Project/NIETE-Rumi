'use strict';
/**
 * bd-ra8xu.50 — "Plan my visit" (operator 13 Nov ~13:35-13:38): the lesson's class (Primary / Middle / High), then
 * only that class's grades, then (Middle only) the subject, on three Flow screens instead of two chat lists. Its own
 * Flow, sent only where the chat lists were sent (a coach with obs612_coach on) and only once OBS612_LESSON_FLOW_ID is
 * set; the shared Plan my visit Flow is not touched. The completion carries the chat lists' own tap id, so
 * visit.handleTap finishes the visit exactly as for a list tap.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
}));
const mockState = { value: null };
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  setState: jest.fn((id, state, data) => { mockState.value = { state, ...data }; return Promise.resolve(true); }),
  getState: jest.fn(() => Promise.resolve(mockState.value)),
}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const fs = require('fs');
const path = require('path');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const LF = require('../../bot/shared/services/observe/obs612/lesson-flow');
const V = require('../../bot/shared/services/observe/obs612/visit');
const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
const { STRINGS } = require('../../bot/shared/services/observe/obs612/strings');

const COACH = { id: 'c0ffee00-0000-4000-8000-000000000001', preferred_language: 'en' };
const TOKEN = LF.lessonToken(COACH.id, 'o', 'abc123');
const cp = (s) => Array.from(String(s)).length;
const req = (action, data) => LF.handleRequest({ action, flow_token: TOKEN, data }, { userLang: async () => 'en', teacherName: async () => 'Ms Nadia' });

beforeEach(() => {
  jest.clearAllMocks();
  mockState.value = null;
  delete process.env.OBS612_LESSON_FLOW_ID;
});

describe('the three screens', () => {
  test('INIT: the class, Primary / Middle / High with their grades and form', async () => {
    const res = await req('INIT');
    expect(res.screen).toBe('CLASS');
    expect(res.data.heading).toBe("Which class is Ms Nadia's lesson?");
    expect(res.data.options.map((o) => o.title)).toEqual(['Primary', 'Middle', 'High']);
    expect(res.data.options.map((o) => o.description)).toEqual(['Grades 1 to 5 · FICO form', "Grades 6 to 8 · FDE's own tool", 'Grades 9 to 12 · FICO form']);
    expect(res.version).toBeUndefined();
  });

  test.each([['primary', ['1', '2', '3', '4', '5']], ['middle', ['6', '7', '8']], ['high', ['9', '10', '11', '12']]])(
    'class %s → only its grades', async (band, grades) => {
      const res = await req('data_exchange', { step: 'class', band });
      expect(res.screen).toBe('GRADE');
      expect(res.data.options.map((o) => o.id)).toEqual(grades);
    },
  );

  test('a Middle grade asks the subject; the subject closes the Flow with the chat list\'s own tap id', async () => {
    let res = await req('data_exchange', { step: 'grade', grade: '7' });
    expect(res.screen).toBe('SUBJECT');
    expect(res.data.options.map((o) => o.id)).toEqual(['english', 'urdu', 'maths', 'science', 'social_studies', 'islamiat', 'computer', 'other']);
    res = await req('data_exchange', { step: 'subject', grade: '7', subject: 'science' });
    expect(res).toEqual({ screen: 'SUCCESS', data: { extension_message_response: { params: { obs612_lesson: 'named', tap: 'o612:s:o:abc123:7:science' } } } });
  });

  test.each([['3', 'o612:g:o:abc123:3'], ['10', 'o612:g:o:abc123:10']])('grade %s (a FICO lesson) closes at once, no subject', async (g, tap) => {
    const res = await req('data_exchange', { step: 'grade', grade: g });
    expect(res.data.extension_message_response.params.tap).toBe(tap);
  });

  test('an Urdu coach gets the Urdu draft', async () => {
    const res = await LF.handleRequest({ action: 'INIT', flow_token: TOKEN }, { userLang: async () => 'ur' });
    expect(res.data.options.map((o) => o.title)).toEqual(STRINGS.ur.lf_bands ? Object.values(STRINGS.ur.lf_bands).map((b) => b.title) : []);
    expect(res.data.heading).toBe(STRINGS.ur.lf_class_heading(null));
  });

  test('a token that is not this Flow\'s is refused', async () => {
    const res = await LF.handleRequest({ action: 'INIT', flow_token: 'x:obs612:form-1' }, {});
    expect(res.data.error).toBeTruthy();
  });

  test.each(['en', 'ur'])('%s: every word fits Meta\'s caps', async (lang) => {
    const deps = { userLang: async () => lang };
    const all = [
      await LF.handleRequest({ action: 'INIT', flow_token: TOKEN }, deps),
      ...await Promise.all(['primary', 'middle', 'high'].map((band) => LF.handleRequest({ action: 'data_exchange', flow_token: TOKEN, data: { step: 'class', band } }, deps))),
      await LF.handleRequest({ action: 'data_exchange', flow_token: TOKEN, data: { step: 'grade', grade: '6' } }, deps),
    ];
    for (const r of all) {
      expect(cp(r.data.lbl)).toBeLessThanOrEqual(30);
      expect(cp(r.data.next_label)).toBeLessThanOrEqual(35);
      r.data.options.forEach((o) => { expect(cp(o.title)).toBeLessThanOrEqual(30); if (o.description) expect(cp(o.description)).toBeLessThanOrEqual(300); });
    }
  });
});

describe('the Flow JSON', () => {
  const flow = LF.buildFlow();
  test('CLASS → GRADE → SUBJECT, closed by the endpoint; screen ids letters only; the committed copy is current', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['CLASS', 'GRADE', 'SUBJECT', 'SUCCESS']);
    expect(flow.routing_model).toEqual({ CLASS: ['GRADE'], GRADE: ['SUBJECT', 'SUCCESS'], SUBJECT: ['SUCCESS'], SUCCESS: [] });
    const committed = fs.readFileSync(path.join(__dirname, '../../bot/docs/flows/obs612-lesson-flow.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(flow);
  });
  test('every ${data.x} a screen binds is declared on it', () => {
    for (const s of flow.screens) {
      const used = new Set([...JSON.stringify(s.layout).matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
      used.forEach((k) => expect(Object.keys(s.data)).toContain(k));
    }
  });
});

describe('sending it, and its completion', () => {
  test('with OBS612_LESSON_FLOW_ID set, the class question is the Flow (no chat list)', async () => {
    process.env.OBS612_LESSON_FLOW_ID = 'flow-123';
    await V.askClass(COACH, '920000000000', { kind: 'f', ref: 'form-1', teacherName: null });
    expect(WhatsAppService.sendFlow).toHaveBeenCalledWith('920000000000', expect.objectContaining({
      flowId: 'flow-123', flowToken: `${COACH.id}:o612lesson:f:form-1`, buttonText: 'Choose the class',
    }));
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
  });

  test('without it, the two chat lists exactly as before', async () => {
    await V.askClass(COACH, '920000000000', { kind: 'f', ref: 'form-1', teacherName: null });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();
  });

  test('the Flow does not send: the chat lists instead', async () => {
    process.env.OBS612_LESSON_FLOW_ID = 'flow-123';
    WhatsAppService.sendFlow.mockResolvedValueOnce(false);
    await V.askClass(COACH, '920000000000', { kind: 'f', ref: 'form-1', teacherName: null });
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();
  });

  test('the completion is told apart from the FDE form\'s', () => {
    expect(detectFlowType({ obs612_lesson: 'named', tap: 'o612:g:o:abc123:3' })).toBe('obs612_lesson');
    expect(detectFlowType({ obs612: 'submitted', form_id: 'f' })).toBe('obs612');
  });

  test('a primary grade named in the Flow is a FICO lesson with its grade', () => {
    expect(V.parseTap('o612:g:o:abc123:3')).toEqual({ step: 'g', kind: 'o', ref: 'abc123', primary: true, grade: 3 });
    expect(V.parseTap('o612:g:o:abc123:p')).toEqual({ step: 'g', kind: 'o', ref: 'abc123', primary: true });
  });

  test('/observe: the named lesson waits in the visit\'s state, as a list tap does', async () => {
    mockState.value = { state: 'awaiting_audio', obs612Ask: 'abc123', obs612Teacher: 'Ms Nadia' };
    await V.handleTap(COACH, '920000000000', 'o612:s:o:abc123:7:science');
    expect(mockState.value.obs612Lesson).toMatchObject({ primary: false, grade: 7, subject: 'science' });
  });
});
