'use strict';
/**
 * bd-5rz1v.6 — when a PORTAL-started observation fails, the coach is not told on
 * WhatsApp: the operator wants nothing of this flow sent there. The row still
 * goes to 'failed' (the portal shows "This observation was stopped"), and the
 * watchdog still retries a stuck one. A WhatsApp observation — and a teacher's
 * own lesson — is told exactly as before.
 */
const PORTAL_URL = 'https://r2.example/bucket/classroom_audio/coach-1/2026-10/portal_abc.webm';
const WA_URL = 'https://r2.example/bucket/classroom_audio/coach-1/2026-10/683335f3_1790852380454.ogg';
const COACH_PHONE = '923333232533';

let mockRow;
let mockUpdates;

jest.mock('../../bot/shared/config/supabase', () => {
  const { chain } = require('../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain(() => {
        if (table === 'users') return { data: { id: 'coach-1', name: 'Sana', phone_number: COACH_PHONE, preferred_language: 'en' }, error: null };
        return { data: [mockRow], error: null };
      });
      return new Proxy(c, {
        get(target, prop) {
          if (prop === 'update') return (payload) => { mockUpdates.push(payload); return c; };
          return target[prop];
        },
      });
    }),
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockWa = { sendMessage: jest.fn().mockResolvedValue(true) };
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m') }));
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn() }));

const obs = (audioUrl, over = {}) => ({
  id: 'cs-1', user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation',
  audio_url: audioUrl, audio_id: null, status: 'analysis_started',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  watchdog: { retried_at: '2026-10-01T01:00:00Z' },
  users: { name: 'Ayesha', phone_number: '923120004471', preferred_language: 'ur' },
  ...over,
});

beforeEach(() => { jest.clearAllMocks(); mockUpdates = []; });

describe('transcription and analysis failures', () => {
  const T = () => require('../../bot/shared/services/coaching/transcription-processor.service');
  const A = () => require('../../bot/shared/services/coaching/analysis-processor.service');

  test.each([
    ['transcription', () => T().handleTranscriptionError('cs-1', new Error('asr 500'), COACH_PHONE)],
    ['analysis', () => A().handleAnalysisError('cs-1', new Error('llm 500'), COACH_PHONE)],
  ])('%s: a portal observation is marked failed and the coach is NOT messaged', async (_n, run) => {
    mockRow = obs(PORTAL_URL);
    await run();
    expect(mockUpdates.some((u) => u.status === 'failed')).toBe(true);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  test.each([
    ['transcription', () => T().handleTranscriptionError('cs-1', new Error('asr 500'), COACH_PHONE)],
    ['analysis', () => A().handleAnalysisError('cs-1', new Error('llm 500'), COACH_PHONE)],
  ])('%s: a WhatsApp observation is told on WhatsApp, as before', async (_n, run) => {
    mockRow = obs(WA_URL);
    await run();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, expect.any(String));
  });
});

describe('the mid-flight watchdog', () => {
  const W = () => require('../../bot/workers/stale-session.worker');

  test('a portal observation that died twice is failed loudly in the logs — and the coach is not messaged', async () => {
    mockRow = obs(PORTAL_URL);
    const out = await W().processStuckMidFlightSessions();
    expect(out.failed).toBe(1);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  test('a WhatsApp observation that died twice: the coach is told, as before', async () => {
    mockRow = obs(WA_URL);
    const out = await W().processStuckMidFlightSessions();
    expect(out.failed).toBe(1);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, expect.any(String));
  });
});
