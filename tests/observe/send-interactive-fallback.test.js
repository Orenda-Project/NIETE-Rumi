'use strict';
/**
 * The report-send flow never leaves a coach facing silence when WhatsApp refuses an interactive message.
 *
 * Sandbox E2E, 15 Oct 2026: the coach tapped "Someone else" on the report preview. handleSendOther sent
 * the roster pick list; Meta answered 500 #131000 ("Something went wrong") and sendInteractiveMessage
 * returned false. The code logged "roster pick offered" anyway, the state waited for a tap on a list
 * the coach never got, and the coach saw nothing for five minutes.
 *
 * Now every interactive send in the flow is checked. A refused send is retried once; a second refusal
 * falls back to a plain-text step (for the teacher pick: "type the teacher's name and number"), and is
 * logged at error with Meta's code. "Offered" is logged only when the list went out.
 *
 * Real: observe-send.service, the roster (from the coach's saved list), observe-strings, and Meta's error
 * code reading. Mocked at the boundary: WhatsApp (refuses, then accepts), the database, the chat state
 * store, the logger.
 */

const COACH_PHONE = '923000000201';
const SID = 'sess-send-1';
const ROSTER = [
  { name: 'Teacher One', phone: '923000000301' },
  { name: 'Teacher Two', phone: '923000000302' },
  { name: 'Teacher Three', phone: '923000000303' },
  { name: 'Teacher Four', phone: '923000000304' },
];
const COACH = { id: 'coach-1', name: 'Coach', phone_number: COACH_PHONE, preferred_language: 'en', preferences: { observe_teachers: ROSTER } };

// A Graph refusal as axios surfaces it: Meta's 500 #131000.
const META_131000 = Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: { error: { message: 'Something went wrong', code: 131000 } } },
});

let mockWa;
let mockState;
let mockLog;
let mockSession;

// `plan` is the outcome of each successive interactive send: 'fail' or 'ok'.
function waSends(plan) {
  const outcomes = [...plan];
  const next = () => (outcomes.length ? outcomes.shift() : 'ok');
  const send = jest.fn(async (_to, _payload, opts = {}) => {
    if (next() === 'fail') {
      if (opts && typeof opts.onError === 'function') opts.onError(META_131000);
      return false;
    }
    return true;
  });
  return send;
}

function wire({ list = [], buttons = [], hero = null } = {}) {
  jest.resetModules();
  mockLog = [];
  mockState = {};
  mockSession = {
    id: SID, user_id: 'coach-1', observer_user_id: 'coach-1', observation_type: 'leader_observation',
    status: 'observer_review_complete', debrief_status: 'done', analysis_data: { framework: 'fico', teacher_delivery: {} },
  };
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { chain } = require('../quiz/helpers/supabase-chain');
    return {
      // The coach's own row answers any users lookup, so the coach's language (en) is what the flow reads.
      from: jest.fn((table) => chain(() => ({
        data: table === 'coaching_sessions' ? mockSession : (table === 'users' ? [{ ...COACH }] : null), error: null,
      }))),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn((msg, data, level) => { mockLog.push({ msg, data, level }); }),
    logError: jest.fn(), logWarn: jest.fn(),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: jest.fn(async () => null), set: jest.fn(async () => true), setexWithCeiling: jest.fn(async () => true),
    delete: jest.fn(async () => true), del: jest.fn(async () => true), setNX: jest.fn().mockResolvedValue(true), isAvailable: () => true,
  }));
  mockWa = {
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: waSends(list),
    sendInteractiveButtons: waSends(buttons),
    sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
  jest.doMock('../../bot/shared/services/observe/observe-state.service', () => ({
    getState: jest.fn(async (id) => mockState[id] || null),
    setState: jest.fn(async (id, state, data) => { mockState[id] = { state, ...(data || {}) }; return true; }),
    clearState: jest.fn(async (id) => { delete mockState[id]; return true; }),
  }));
  jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueObserveTeacherReport: jest.fn().mockResolvedValue(true) }));
  // The preview's report image is not what is under test here: a rendered PNG, or the narrative failure.
  jest.doMock('../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({
    generateHeroReport: jest.fn(hero || (async () => ({ png: Buffer.from('png'), caption: 'cap', narrative: null }))),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    downloadFromR2: jest.fn(async () => Buffer.from('x')), uploadImageBuffer: jest.fn(async (_b, key) => key), extractKeyFromUrl: jest.fn(),
  }));
  const Send = require('../../bot/shared/services/observe/observe-send.service');
  const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
  return { Send, S: observeStrings('en') };
}

const said = (text) => mockWa.sendMessage.mock.calls.some(([to, body]) => to === COACH_PHONE && body === text);
const logged = (re) => mockLog.filter((l) => re.test(l.msg));

describe('"Someone else": the roster pick list', () => {
  test('refused twice: the coach is asked to type the details instead, and the refusal is an error with its code', async () => {
    const { Send, S } = wire({ list: ['fail', 'fail'] });
    await Send.handleSendOther(SID, COACH_PHONE, COACH);
    expect(mockWa.sendInteractiveMessage).toHaveBeenCalledTimes(2);
    expect(said(S.send_ask_details)).toBe(true);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_details', sessionId: SID });
    const errors = mockLog.filter((l) => l.level === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((l) => l.data && l.data.metaErrorCode === 131000)).toBe(true);
    expect(logged(/roster pick offered/)).toEqual([]);
  });

  test('refused once, then sent: the list arrives on the retry, and no text ask', async () => {
    const { Send, S } = wire({ list: ['fail', 'ok'] });
    await Send.handleSendOther(SID, COACH_PHONE, COACH);
    expect(mockWa.sendInteractiveMessage).toHaveBeenCalledTimes(2);
    expect(said(S.send_ask_details)).toBe(false);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_pick', sessionId: SID });
    expect(logged(/roster pick offered/)).toHaveLength(1);
  });

  test('sent first time: one send, as before', async () => {
    const { Send } = wire({ list: ['ok'] });
    await Send.handleSendOther(SID, COACH_PHONE, COACH);
    expect(mockWa.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_pick' });
  });
});

describe('"Send report": the roster pick when the visit names no teacher', () => {
  test('refused twice: the text ask, never a silent wait', async () => {
    const { Send, S } = wire({ list: ['fail', 'fail'] });
    await Send.startSendFlow(SID, COACH_PHONE, COACH);
    expect(mockWa.sendInteractiveMessage).toHaveBeenCalledTimes(2);
    expect(said(S.send_ask_details)).toBe(true);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_details', sessionId: SID });
    expect(logged(/roster pick offered/)).toEqual([]);
  });

  test('refused once, then sent: the pick list', async () => {
    const { Send, S } = wire({ list: ['fail', 'ok'] });
    await Send.startSendFlow(SID, COACH_PHONE, COACH);
    expect(mockWa.sendInteractiveMessage).toHaveBeenCalledTimes(2);
    expect(said(S.send_ask_details)).toBe(false);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_pick' });
    expect(logged(/roster pick offered/)).toHaveLength(1);
  });
});

describe('the rest of the pick step', () => {
  async function onPick(Send) {
    mockState['coach-1'] = { state: 'awaiting_teacher_pick', sessionId: SID, teachers: [...ROSTER, ...ROSTER, ...ROSTER] };
    return Send;
  }

  test('"More teachers…" refused twice: the text ask', async () => {
    const { Send, S } = wire({ list: ['fail', 'fail'] });
    await onPick(Send);
    await Send.handleTeacherPick(COACH, COACH_PHONE, 'observe_pickt_more_8');
    expect(mockWa.sendInteractiveMessage).toHaveBeenCalledTimes(2);
    expect(said(S.send_ask_details)).toBe(true);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_details', sessionId: SID });
  });

  test('"Manage" refused twice: the text ask', async () => {
    const { Send, S } = wire({ list: ['fail', 'fail'] });
    await onPick(Send);
    await Send.handleTeacherPick(COACH, COACH_PHONE, 'observe_pickt_manage');
    expect(said(S.send_ask_details)).toBe(true);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_details', sessionId: SID });
  });

  test("a manage row's Remove/Back buttons refused twice: the text ask", async () => {
    const { Send, S } = wire({ buttons: ['fail', 'fail'] });
    mockState['coach-1'] = { state: 'awaiting_teacher_manage', sessionId: SID, teachers: ROSTER };
    await Send.handleTeacherManage(COACH, COACH_PHONE, 'observe_tmg_1');
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(2);
    expect(said(S.send_ask_details)).toBe(true);
    expect(mockState['coach-1']).toMatchObject({ state: 'awaiting_teacher_details', sessionId: SID });
  });
});

describe('the preview: its Send buttons, and Regenerate', () => {
  const previewing = () => {
    mockSession.analysis_data.teacher_delivery = { teacher_name: 'Teacher One', teacher_phone: '923000000301', status: 'previewing' };
  };

  test('the Send buttons refused twice: the coach is told the report is ready and where to send it from', async () => {
    const { Send, S } = wire({ buttons: ['fail', 'fail'] });
    previewing();
    await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
    expect(mockWa.sendImageFromBuffer).toHaveBeenCalledTimes(1);
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(2);
    expect(typeof S.send_confirm_unavailable).toBe('string');
    expect(said(S.send_confirm_unavailable)).toBe(true);
    expect(mockLog.some((l) => l.level === 'error' && l.data && l.data.metaErrorCode === 131000)).toBe(true);
  });

  test('the Send buttons refused once, then sent: no extra message', async () => {
    const { Send, S } = wire({ buttons: ['fail', 'ok'] });
    previewing();
    await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(2);
    expect(said(S.send_confirm_unavailable)).toBe(false);
  });

  test('Regenerate refused twice: the coach is told the report could not be made, and where to try again', async () => {
    const unavailable = async () => { throw Object.assign(new Error('narrative unavailable'), { code: 'NARRATIVE_UNAVAILABLE' }); };
    const { Send, S } = wire({ buttons: ['fail', 'fail'], hero: unavailable });
    previewing();
    await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(2);
    expect(typeof S.send_preview_failed_text).toBe('string');
    expect(said(S.send_preview_failed_text.replace('{name}', 'Teacher One'))).toBe(true);
  });
});
