'use strict';
/**
 * bd-o15qnr.39.2 (queue #204) — the observer's copy of the report she sent.
 *
 * The operator, 22 Nov ~00:55: "when sending to the teacher it should also be sent to me as well." So when a coach (or
 * a principal) on the v6/v7 switch taps Send in the app and the report REACHES the teacher on WhatsApp, the observer
 * gets the same report image too, captioned "Copy of the report sent to <teacher>", in the OBSERVER's own language.
 *
 *   the switch    the portal's own rule (/config features.coachFlowV2 / principalFlowV2): portal_coach_flow_v2 names her
 *                 AND (portal_coach_v2 + portal_coach_full_app name her, OR she is a principal portal_principal_app
 *                 names). No row, a failed read or anything else: no copy (fail-closed).
 *   when          only once the report itself went to the teacher: the direct send, or her tap on the invite. Never
 *                 for the invite alone, operator review, a failed send, or a WhatsApp-run send (the coach already had
 *                 the preview in that chat).
 *   best effort   after the teacher's send, in its own try/catch: a refused or broken copy never fails, delays or
 *                 re-runs the teacher's delivery. Outside her own 24-hour window WhatsApp refuses it (131047): logged,
 *                 and that is all.
 *   telemetry     observe_report.observer_copy.sent | .failed | .skipped, with the job's correlation id.
 *
 * Drives the real send service and the real copy module; only the network boundary (Supabase, WhatsApp, R2) and the
 * neighbouring services are stubbed.
 */
const SID = 'cs-copy-1';
const COACH_PHONE = '923330000001';
const TEACHER_PHONE = '923001234567';
const COACH_ID = '11111111-1111-4111-8111-111111111111';
const mockPng = Buffer.from('the report png');

let mockTables;
let mockUpdates;

jest.mock('../../bot/shared/config/supabase', () => {
  const { chain } = require('../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain((calls) => {
        const rows = (mockTables[table] || (() => null))(calls);
        if (table !== 'app_settings') return { data: rows, error: null };
        // app_settings answers by key, the way each reader asks (.eq('key', k) or .in('key', [...])).
        if (rows && rows.error) return { data: null, error: rows.error };
        const list = Array.isArray(rows) ? rows : [];
        const eq = calls.find(([op, col]) => op === 'eq' && col === 'key');
        const inn = calls.find(([op, col]) => op === 'in' && col === 'key');
        const keys = eq ? [eq[2]] : (inn ? inn[2] : null);
        return { data: keys ? list.filter((r) => keys.includes(r.key)) : list, error: null };
      });
      const record = (op) => (payload) => { mockUpdates.push({ table, op, payload }); return c; };
      return new Proxy(c, {
        get(target, prop) {
          if (prop === 'update' || prop === 'insert' || prop === 'upsert') return record(prop);
          return target[prop];
        },
      });
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), setexWithCeiling: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true), del: jest.fn().mockResolvedValue(true), setNX: jest.fn().mockResolvedValue(true), isAvailable: () => true,
}));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/meta-window-cache.service', () => ({ markWindowClosed: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => mockPng),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn().mockResolvedValue(false) }));

const QuizDelivery = require('../../bot/shared/services/quiz/quiz-delivery.service');
const SL = require('../../bot/shared/utils/structured-logger');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const Send = () => require('../../bot/shared/services/observe/observe-send.service');

const COACH = { id: COACH_ID, name: 'Sana Malik', phone_number: COACH_PHONE, preferred_language: 'en', role: 'coach' };
const ON_FOR_COACH = [
  { key: 'portal_coach_flow_v2', value: [COACH_ID] },
  { key: 'portal_coach_v2', value: true },
  { key: 'portal_coach_full_app', value: [COACH_ID] },
];
const READY = {
  status: 'awaiting_confirm', report_key: `observe-reports/${SID}.png`, teacher_phone: TEACHER_PHONE,
  teacher_name: 'Ayesha Bibi', caption: 'Your lesson report', companion_text: null, channel: 'portal',
};

function withDelivery(over = {}) {
  mockTables.coaching_sessions = () => ({
    id: SID, user_id: 'teacher-1', observer_user_id: COACH_ID, observation_type: 'leader_observation',
    status: 'observer_review_complete', debrief_status: 'done', created_at: '2026-11-21T04:00:00Z',
    analysis_data: { framework: 'fico', teacher_delivery: { ...READY, ...over } },
  });
}
const imagesTo = (phone) => mockWa.sendImageFromBuffer.mock.calls.filter(([to]) => to === phone);
const toCoach = () => [...mockWa.sendMessage.mock.calls, ...mockWa.sendImageFromBuffer.mock.calls, ...mockWa.sendTemplate.mock.calls]
  .filter(([to]) => to === COACH_PHONE);
const lastStatus = () => mockUpdates
  .filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data && u.payload.analysis_data.teacher_delivery)
  .map((u) => u.payload.analysis_data.teacher_delivery.status).filter(Boolean).pop();
const events = (name) => SL.logger.info.mock.calls.map(([o]) => o).filter((o) => o && o.event === name);

beforeEach(() => {
  jest.clearAllMocks();
  // An implementation set by one test (a refused or throwing send) must not leak into the next.
  mockWa.sendImageFromBuffer.mockReset().mockResolvedValue(true);
  mockUpdates = [];
  mockTables = { coaching_sessions: () => null, users: () => COACH, app_settings: () => ON_FOR_COACH };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });

describe('switch on: the observer gets a copy once the report reaches the teacher', () => {
  test('Send from the app (her window open): the teacher first, then the same image to the coach, captioned in English', async () => {
    withDelivery();
    await SL.runWithCorrelation('corr-copy-1', () => Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' }));

    expect(imagesTo(TEACHER_PHONE)).toHaveLength(1);
    const copies = imagesTo(COACH_PHONE);
    expect(copies).toHaveLength(1);
    const [, buf, caption, mime] = copies[0];
    expect(buf).toBe(mockPng);
    expect(caption).toBe('Copy of the report sent to Ayesha Bibi');
    expect(mime).toBe('image/png');
    // The teacher's send went first, and her delivery is filed as sent.
    const order = mockWa.sendImageFromBuffer.mock.calls.map(([to]) => to);
    expect(order.indexOf(TEACHER_PHONE)).toBeLessThan(order.indexOf(COACH_PHONE));
    expect(lastStatus()).toBe('sent');
    expect(events('observe_report.observer_copy.sent')).toEqual([
      expect.objectContaining({ correlationId: 'corr-copy-1', sessionId: SID, observerUserId: COACH_ID }),
    ]);
  });

  test("the caption is in the OBSERVER's own language (the observe catalog), not the teacher's", async () => {
    mockTables.users = () => ({ ...COACH, preferred_language: 'ur' });
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    const [[, , caption]] = imagesTo(COACH_PHONE);
    expect(caption).toBe(observeStrings('ur').report_copy_observer.replace('{name}', 'Ayesha Bibi'));
    expect(caption).toMatch(/[؀-ۿ]/);
    expect(caption).toContain('Ayesha Bibi');
    expect(observeStrings('en').report_copy_observer).toBe('Copy of the report sent to {name}');
  });

  test('a principal on the principal app with the same switch: the copy too', async () => {
    mockTables.users = () => ({ ...COACH, role: 'principal' });
    mockTables.app_settings = () => [
      { key: 'portal_coach_flow_v2', value: [COACH_ID] },
      { key: 'portal_principal_app', value: JSON.stringify([COACH_ID]) },
    ];
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(imagesTo(COACH_PHONE)).toHaveLength(1);
  });

  test("her window was closed: the invite alone sends NO copy; her tap sends the report, and the copy with it", async () => {
    QuizDelivery._hasOpenMessageWindow.mockResolvedValueOnce(false);
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(mockWa.sendTemplate).toHaveBeenCalledTimes(1);
    expect(toCoach()).toEqual([]);

    jest.clearAllMocks();
    withDelivery({ status: 'awaiting_teacher_tap', template_sent_at: '2026-11-21T06:00:00Z' });
    await Send().processTeacherReport(SID, { from: TEACHER_PHONE, phase: 'teacher_tap' });
    expect(imagesTo(TEACHER_PHONE)).toHaveLength(1);
    expect(imagesTo(COACH_PHONE)).toHaveLength(1);
  });
});

describe('the copy never costs the teacher her report', () => {
  test("outside the coach's 24-hour window (131047): logged as failed, and the teacher's report is still sent", async () => {
    mockWa.sendImageFromBuffer.mockImplementation(async (to, _buf, _cap, _mime, opts) => {
      if (to !== COACH_PHONE) return true;
      if (opts && opts.onError) opts.onError({ response: { data: { error: { code: 131047, message: 'Re-engagement message' } } } });
      return false;
    });
    withDelivery();
    await expect(Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' })).resolves.toBeUndefined();
    expect(imagesTo(TEACHER_PHONE)).toHaveLength(1);
    expect(lastStatus()).toBe('sent');
    expect(events('observe_report.observer_copy.failed')).toEqual([
      expect.objectContaining({ reason: 'window_closed', metaErrorCode: 131047, sessionId: SID }),
    ]);
    // No template is invented for the coach, and nothing else is tried.
    expect(mockWa.sendTemplate).not.toHaveBeenCalled();
    expect(imagesTo(COACH_PHONE)).toHaveLength(1);
  });

  test('a copy that throws is caught: the delivery is still sent and the job does not fail', async () => {
    mockWa.sendImageFromBuffer.mockImplementation(async (to) => {
      if (to === COACH_PHONE) throw new Error('socket hang up');
      return true;
    });
    withDelivery();
    await expect(Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' })).resolves.toBeUndefined();
    expect(lastStatus()).toBe('sent');
    expect(events('observe_report.observer_copy.failed')).toEqual([expect.objectContaining({ reason: 'error' })]);
  });

  test("the teacher's send fails: no copy", async () => {
    mockWa.sendImageFromBuffer.mockImplementation(async (to) => to !== TEACHER_PHONE);
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(lastStatus()).toBe('send_failed');
    expect(imagesTo(COACH_PHONE)).toEqual([]);
  });
});

describe('switch off (or not the portal): exactly as before — no copy', () => {
  test.each([
    ['no rows at all', () => []],
    ['the settings read fails', () => ({ error: { message: 'boom' } })],
    ['flow v2 names someone else', () => [{ ...ON_FOR_COACH[0], value: ['someone-else'] }, ON_FOR_COACH[1], ON_FOR_COACH[2]]],
    ['flow v2 on, but not the full coach app (the portal says coachFlowV2 false)', () => [ON_FOR_COACH[0], ON_FOR_COACH[1]]],
    ['a malformed value', () => [{ key: 'portal_coach_flow_v2', value: 'yes' }, ON_FOR_COACH[1], ON_FOR_COACH[2]]],
  ])('%s', async (_why, settings) => {
    mockTables.app_settings = settings;
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(imagesTo(TEACHER_PHONE)).toHaveLength(1);
    expect(toCoach()).toEqual([]);
    expect(events('observe_report.observer_copy.sent')).toEqual([]);
  });

  test('portal_principal_app names someone who is not a principal (and no coach app): no copy', async () => {
    mockTables.users = () => ({ ...COACH, role: 'aeo' });
    mockTables.app_settings = () => [{ key: 'portal_coach_flow_v2', value: true }, { key: 'portal_principal_app', value: true }];
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(imagesTo(COACH_PHONE)).toEqual([]);
  });

  test('a send run on WhatsApp: the coach had the preview in that chat — only the usual "it landed"', async () => {
    withDelivery({ channel: 'whatsapp' });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver' });
    expect(imagesTo(COACH_PHONE)).toEqual([]);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, observeStrings('en').send_done_fo);
  });

  test('operator review: the report did not reach the teacher, so no copy', async () => {
    process.env.OBSERVE_REVIEW_MODE = 'operator';
    withDelivery();
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(imagesTo(COACH_PHONE)).toEqual([]);
  });
});
