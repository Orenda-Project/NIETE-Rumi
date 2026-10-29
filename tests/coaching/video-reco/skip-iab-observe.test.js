'use strict';
/**
 * bd-9dbhh0.1 (VIDREC), COS 20261028T151950 §1.1–1.2: on the coach /observe path the teacher's report image carries the
 * clip's /v link as its caption's LAST lines (the pick now starts before the send), and no clip message follows. The
 * companion still rides in the caption when all fits; over the cap the companion goes as its own text, as before, and the
 * link stays on the image. Engine off / not shown → the caption exactly as before. Real observe-send, real send.js and
 * caption-link; the engine's pick and the row store are faked. The harness of observe-send.video-reco-send.test.js.
 */
const SID_REC = '1a2b3c4d-1111-4222-8333-444455556666';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
let mockRow = null;
jest.mock('../../../bot/shared/services/coaching/video-reco/engine', () => ({
  recommendForReport: jest.fn(() => Promise.resolve(mockRow)), prefetchReads: jest.fn(() => false),
}));
const mockMarkSent = jest.fn(async () => true);
jest.mock('../../../bot/shared/services/coaching/video-reco/store', () => ({
  markSent: (...a) => mockMarkSent(...a), readForSession: jest.fn(async () => mockRow),
}));
const mockHero = jest.fn(async () => ({ png: Buffer.from('png'), caption: 'cap', narrative: null }));
jest.mock('../../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({ generateHeroReport: (...a) => mockHero(...a) }));
jest.mock('../../../bot/shared/services/coaching/report-v2/narrative-store', () => ({ persistReportNarrative: jest.fn(async () => true) }));
const SESSION_ID = 'sess-1';
const COACH_PHONE = '923330000001';
const TEACHER_PHONE = '923001234567';
const PNG = Buffer.from('png');

let mockTables;
let mockUpdates;
let mockRedis;

jest.mock('../../../bot/shared/config/supabase', () => {
  const { chain } = require('../../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain(() => ({ data: (mockTables[table] || (() => null))(), error: null }));
      // Writes are recorded and answered without touching the row stub.
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
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => (mockRedis.has(k) ? mockRedis.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRedis.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockRedis.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  del: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  setNX: jest.fn().mockResolvedValue(true),
  isAvailable: () => true,
}));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  showTypingIndicator: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
};
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn().mockRejectedValue(new Error('LLM unavailable in test — fallback guide')),
}));
jest.mock('../../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue(true),
  queueObserveDebrief: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
// Playwright is the render boundary. The real renderer returns null for a harmful
// debrief (no celebration card) — mirrored here so that path stays testable.
jest.mock('../../../bot/shared/services/observe/observe-coach-card', () => ({
  renderCoachCard: jest.fn(async (fb) => (fb && fb.rubric && fb.rubric.disparaged_teacher ? null : Buffer.from('png'))),
}));

const { observeStrings } = require('../../../bot/shared/services/observe/observe-strings');

const cp = (s) => [...String(s)].length;
const texts = (to) => mockWa.sendMessage.mock.calls.filter(([t]) => !to || t === to).map(([, b]) => String(b));

const COACH = { id: 'coach-1', phone_number: COACH_PHONE, preferred_language: 'en', first_name: 'Sana' };

function rubric(over = {}) {
  return {
    disparaged_teacher: false, opened_with_specific_praise: true, anchored_in_real_moment: true,
    asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true,
    ...over,
  };
}
const goodFeedback = (over = {}) => ({
  praise_line: 'You opened warmly and let the teacher think.',
  wins: [{ behaviour: 'Opened with specific praise', evidence: 'you named the pair work' }],
  try: { move: 'Let the teacher name the next step', evidence: 'you offered the plan', instead: 'ask what they will try, then wait' },
  reflection_question: 'What will you do differently next time?',
  value: null,
  rubric: rubric(),
  concern: null,
  ...over,
});

function sessionRow(over = {}) {
  return {
    id: SESSION_ID,
    user_id: 'teacher-1',
    observer_user_id: COACH.id,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'pending',
    analysis_data: { framework: 'fico' },
    users: { name: 'T', phone_number: TEACHER_PHONE, preferred_language: 'en' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates = [];
  mockRedis = new Map();
  mockTables = {
    coaching_sessions: () => sessionRow(),
    users: () => COACH,
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });


const Send = () => require('../../../bot/shared/services/observe/observe-send.service');
const CAPTION = 'Your lesson report';
const withDelivery = (over = {}) => {
  mockTables.coaching_sessions = () => sessionRow({
    analysis_data: {
      framework: 'fico',
      teacher_delivery: {
        status: 'awaiting_teacher_tap', report_key: 'observe-reports/x.png',
        teacher_phone: TEACHER_PHONE, teacher_name: 'T', caption: CAPTION, companion_text: null, ...over,
      },
    },
  });
};
const ENV = { ...process.env };
const SHOWN = { id: SID_REC, user_id: UID, coaching_session_id: SESSION_ID, status: 'shown', arm: 'video', module_id: 10, seg_id: '10-s1', start_s: 30, end_s: 210, reason_en: 'r', reason_ur: 'ر' };
beforeEach(() => {
  mockWa.sendImageFromBuffer.mockReset().mockResolvedValue(true);
  mockWa.sendCtaUrl = jest.fn(async () => true);
  mockRow = SHOWN;
  Object.assign(process.env, { VIDEO_RECO_ENABLED: 'true', INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk', VIDEO_RECO_STRIP_WAIT_MS: '200' });
  delete process.env.VIDEO_RECO_WA_MESSAGE;
});
afterAll(() => { process.env = ENV; });
const LINK = /\n\n▶ Watch next \([^)]*\): [^\n]*\nhttps:\/\/portal\.example\.pk\/v\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;
const teacherCaption = () => mockWa.sendImageFromBuffer.mock.calls.filter(([to]) => to === TEACHER_PHONE).map((c) => String(c[2]))[0];



describe('observe: the link in the teacher\'s report caption, no clip message', () => {
  test('teacher_tap, shown row → caption = report caption + link at the end; no cta_url, no text with the link; sent_via caption', async () => {
    withDelivery();
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    const cap = teacherCaption();
    expect(cap.startsWith(CAPTION)).toBe(true);
    expect(cap).toMatch(LINK);
    expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
    expect(texts(TEACHER_PHONE).some((t) => t.includes('/v/'))).toBe(false);
    expect(mockMarkSent).toHaveBeenCalledWith(SESSION_ID, { sent_via: 'caption', wamid: null, image_strip: false });
  });

  test('a companion that fits rides between the caption and the link; one that does not goes alone and the link stays on the image', async () => {
    withDelivery({ companion_text: 'From your coach: well done.' });
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    expect(teacherCaption()).toMatch(new RegExp(`^${CAPTION}\\n\\nFrom your coach: well done\\.\\n\\n▶ Watch next`));
    expect(teacherCaption()).toMatch(LINK);
    jest.clearAllMocks();
    mockWa.sendImageFromBuffer.mockResolvedValue(true);
    const big = 'w'.repeat(900);
    withDelivery({ companion_text: big });
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    expect(teacherCaption()).toMatch(new RegExp(`^${CAPTION}\\n\\n▶ Watch next`));
    expect(texts(TEACHER_PHONE)).toContain(big);
    expect(texts(TEACHER_PHONE).some((t) => t.includes('/v/'))).toBe(false);
  });

  test.each([
    ['engine off', () => { delete process.env.VIDEO_RECO_ENABLED; }],
    ['not shown', () => { mockRow = { ...SHOWN, status: 'none', none_reason: 'opted_out' }; }],
  ])('%s → the caption exactly as before (and the companion merged as before)', async (_n, set) => {
    set();
    withDelivery({ companion_text: 'From your coach: well done.' });
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    expect(teacherCaption()).toBe(`${CAPTION}\n\nFrom your coach: well done.`);
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  test('the coach\'s preview never carries the link', async () => {
    mockTables.coaching_sessions = () => sessionRow({ analysis_data: { framework: 'fico', teacher_delivery: { teacher_name: 'T', teacher_phone: TEACHER_PHONE } } });
    await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
    const all = mockWa.sendImageFromBuffer.mock.calls.map((c) => String(c[2]));
    expect(all.some((c) => c.includes('/v/'))).toBe(false);
  });
});
