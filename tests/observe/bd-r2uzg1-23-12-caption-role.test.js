'use strict';
/**
 * bd-r2uzg1.23.12 (queue #274, call 27A; ICT sheet HITL 44, 45): the teacher's report caption on a coach's visit says
 * it is her coach's or her principal's, by name, in English and Urdu (the Urdu caption named nobody). The real
 * observe-send preview phase (D33: the coach sees exactly what the teacher gets); the hero render, LLM, WhatsApp and
 * the row store are faked. Harness of fico-s-report-caption.test.js.
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

const SESSION_ID = 'sess-27a-1';
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

const person = (role, lang = 'en') => ({ id: 'coach-1', name: 'Ayesha Khan', role, phone_number: COACH_PHONE, preferred_language: lang });
const session = (framework, teacherLang = 'en') => ({
  id: SESSION_ID,
  user_id: 'teacher-1',
  observer_user_id: 'coach-1',
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
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });

const Send = () => require('../../bot/shared/services/observe/observe-send.service');
const storedCaption = () => {
  const w = mockUpdates.filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data && u.payload.analysis_data.teacher_delivery);
  return w.length ? w[w.length - 1].payload.analysis_data.teacher_delivery.caption : undefined;
};

test('en, a coach: "Prepared from your coach Ayesha Khan\'s visit"', async () => {
  mockTables = { users: () => person('coach'), coaching_sessions: () => session('fico', 'en') };
  await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
  expect(storedCaption()).toContain("Prepared from your coach Ayesha Khan's visit");
});

test('en, a principal: says principal', async () => {
  mockTables = { users: () => person('principal'), coaching_sessions: () => session('fico', 'en') };
  await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
  expect(storedCaption()).toContain("your principal Ayesha Khan's visit");
});

test('ur, a coach: the Urdu caption names her coach', async () => {
  mockTables = { users: () => person('coach', 'ur'), coaching_sessions: () => session('fico', 'ur') };
  await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
  const cap = storedCaption();
  expect(cap).toMatch(/[؀-ۿ]/);
  expect(cap).toContain('آپ کے کوچ Ayesha Khan');
});
