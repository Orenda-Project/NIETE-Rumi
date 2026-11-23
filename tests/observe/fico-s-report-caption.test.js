'use strict';
/**
 * bd-31ziu8 (queue #171) — a FICO 6-12 report reaches the teacher captioned as FICO 6-12, never as FDE's tool.
 *
 * Operator 18 Nov ~17:00: "the name people see is 'FICO 6-12' (review form title, Flow names, report, dashboards,
 * labels; EN + UR)". The staging walk (grade 10, 18 Nov) showed the report caption still read "… on FDE's observation
 * tool" (bd-pni007's obs612 caption), because a FICO-S score is also a grade 6-12 form score. A FICO-S visit keeps its
 * debrief (HITL), so its caption names FICO 6-12 and the conversation; FDE's obs612 caption is unchanged.
 *
 * Real observe-send preview phase (the coach sees EXACTLY what the teacher would receive, D33); the hero render, LLM,
 * WhatsApp and the row store are faked. Harness of tests/coaching/video-reco/skip-iab-observe.test.js.
 */
jest.mock('../../bot/shared/services/coaching/video-reco/engine', () => ({
  recommendForReport: jest.fn(async () => null), prefetchReads: jest.fn(() => false),
}));
jest.mock('../../bot/shared/services/coaching/video-reco/store', () => ({
  markSent: jest.fn(async () => true), readForSession: jest.fn(async () => null),
}));
jest.mock('../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: jest.fn(async () => ({ png: Buffer.from('png'), caption: 'cap', narrative: null })),
}));
jest.mock('../../bot/shared/services/coaching/report-v2/narrative-store', () => ({ persistReportNarrative: jest.fn(async () => true) }));

const SESSION_ID = 'sess-fs-1';
const COACH_PHONE = '923330000001';
const TEACHER_PHONE = '923001234567';
let mockTables;
let mockUpdates;
let mockRedis;

jest.mock('../../bot/shared/config/supabase', () => {
  const { chain } = require('../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain(() => ({ data: (mockTables[table] || (() => null))(), error: null }));
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
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn().mockRejectedValue(new Error('LLM unavailable in test — fallback guide')),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue(true),
  queueObserveDebrief: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
jest.mock('../../bot/shared/services/observe/observe-coach-card', () => ({ renderCoachCard: jest.fn(async () => Buffer.from('png')) }));

const COACH = { id: 'coach-1', phone_number: COACH_PHONE, preferred_language: 'en', first_name: 'Sana' };
const session = (framework, teacherLang = 'en') => ({
  id: SESSION_ID,
  user_id: 'teacher-1',
  observer_user_id: COACH.id,
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'complete',
  analysis_data: { framework, teacher_delivery: { teacher_name: 'T', teacher_phone: TEACHER_PHONE } },
  users: { name: 'T', phone_number: TEACHER_PHONE, preferred_language: teacherLang },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates = [];
  mockRedis = new Map();
  mockTables = { users: () => COACH };
  process.env.OBSERVE_FRAMEWORK = 'fico'; // NIETE's pack: en + ur
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });

const Send = () => require('../../bot/shared/services/observe/observe-send.service');
const previewCaption = () => mockWa.sendImageFromBuffer.mock.calls.filter(([to]) => to === COACH_PHONE).map((c) => String(c[2]))[0];
const storedCaption = () => {
  const w = mockUpdates.filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data && u.payload.analysis_data.teacher_delivery);
  return w.length ? w[w.length - 1].payload.analysis_data.teacher_delivery.caption : undefined;
};

describe('the teacher\'s report caption names the rubric the visit was scored on', () => {
  test('FICO 6-12 visit (en): names FICO 6-12 and the conversation, never FDE', async () => {
    mockTables.coaching_sessions = () => session('fico_s_v1_1', 'en');
    await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
    const cap = previewCaption();
    expect(cap).toMatch(/FICO 6-12/);
    expect(cap).not.toContain('{fo}');
    expect(cap).toMatch(/conversation/);
    expect(cap).not.toMatch(/FDE/);
    expect(storedCaption()).toBe(cap);
  });

  test('FICO 6-12 visit (ur): the Urdu caption names FICO 6-12 (isolated), never ایف ڈی ای', async () => {
    mockTables.coaching_sessions = () => session('fico_s_v1_1', 'ur');
    mockTables.users = () => ({ ...COACH, preferred_language: 'ur' }); // the teacher's stated language is read from users
    await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
    const cap = storedCaption();
    expect(cap).toMatch(/[؀-ۿ]/);
    expect(cap).toContain('⁦FICO 6-12⁩');
    expect(cap).not.toMatch(/ایف ڈی ای/);
  });

  test('FDE visit (obs612): FDE\'s caption, unchanged', async () => {
    mockTables.coaching_sessions = () => session('obs612-gen-v1', 'en');
    await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
    expect(previewCaption()).toMatch(/on FDE's observation tool/);
  });

  test('every language has the FICO 6-12 caption, with {fo}', () => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    for (const lang of ['en', 'ur', 'sw']) {
      const s = observeStrings(lang).report_caption_teacher_ficos;
      expect(s).toMatch(/FICO 6-12/);
      expect(s).toContain('{fo}');
    }
  });
});
