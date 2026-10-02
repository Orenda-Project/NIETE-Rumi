/**
 * bd-5rz1v.6.9 — a coach's PORTAL observation sends no "Step 1/5" / "Step 2/5".
 *
 * Those two progress messages are written for a teacher recording her own
 * lesson ("Transcribing your classroom audio… I'll message you as each step
 * finishes"). For a coach's observation started in the portal they went to the
 * COACH's WhatsApp, in the observed teacher's language, and no later step ever
 * followed there — the portal shows the progress. On sandbox the Meta bill cut
 * happens to skip them for every observation; staging and production do not
 * carry that change, so the skip is made explicit here, for portal
 * observations only. A WhatsApp /observe observation and a teacher's own
 * session (portal or WhatsApp) keep their step messages exactly as before.
 *
 * Setup borrowed from bd-jbjrx-step-language.test.js (select-aware double).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn((to, text) => { mockSent.push({ to, text }); return Promise.resolve({}); }),
  sendSticker: jest.fn(() => Promise.resolve({})),
  sendButtonMessage: jest.fn(() => Promise.resolve({})),
  sendInteractiveButtons: jest.fn(() => Promise.resolve({})),
  downloadMedia: jest.fn(() => Promise.resolve(Buffer.from(''))),
}));

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

// Heavy collaborators the two processors pull in at module load. None of them
// runs before the step message, so they only have to exist.
jest.mock('../../bot/shared/services/audio.service', () => ({}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadClassroomAudio: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve({})),
  updateConversationState: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.reject(new Error('stop here'))),
}));

/** The teacher's own preference, as the users table would hold it. */
let mockTeacherLanguage = 'ur';
/** The coaching_sessions row the processors read. */
let mockSession = null;

jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const b = { _cols: '', filters: {} };
    b.select = (cols) => { b._cols = String(cols || ''); return b; };
    ['order', 'limit', 'not', 'in', 'is', 'neq', 'update'].forEach((m) => { b[m] = () => b; });
    b.eq = (c, v) => { b.filters[c] = v; return b; };
    const settle = () => {
      if (table === 'users') {
        return { data: { preferred_language: mockTeacherLanguage }, error: null };
      }
      // PostgREST embeds `users` ONLY when the select names the column.
      const embedsLanguage = /preferred_language/.test(b._cols);
      const embedsUsers = /users\s*!?\w*\s*[:(]/.test(b._cols);
      const users = embedsUsers
        ? {
          phone_number: '923016669553',
          name: 'Test Teacher',
          ...(embedsLanguage ? { preferred_language: mockTeacherLanguage } : {}),
        }
        : undefined;
      return { data: { ...mockSession, ...(users ? { users } : {}) }, error: null };
    };
    b.single = async () => settle();
    b.maybeSingle = async () => settle();
    b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
    return b;
  },
}));

const TranscriptionProcessorService = require('../../bot/shared/services/coaching/transcription-processor.service');
const AnalysisProcessorService = require('../../bot/shared/services/coaching/analysis-processor.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const SID = 'sess-6-9';
const FROM = '923016669553';
const PORTAL_AUDIO = 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/classroom_audio/coach-1/2026-10/portal_abc-123.webm';
const WA_AUDIO = 'https://acct.r2.cloudflarestorage.com/digital-coach-audio/classroom_audio/teacher-1/2026-10/wamid_abc.ogg';

const sentStep = (key) => mockSent.some(({ text }) => ['ur', 'en'].some((l) => text === getCoachingMessage(key, l))
  || text.startsWith(getCoachingMessage(key, 'en').slice(0, 12))
  || text.startsWith(getCoachingMessage(key, 'ur').slice(0, 8)));

async function driveStep1() { await TranscriptionProcessorService.processTranscription(SID, { from: FROM }).catch(() => {}); }
async function driveStep2() { await AnalysisProcessorService.processAnalysis(SID, { from: FROM }).catch(() => {}); }

beforeEach(() => {
  mockSent.length = 0;
  mockTeacherLanguage = 'ur';
});

describe('a coach\'s portal observation', () => {
  beforeEach(() => {
    mockSession = { id: SID, user_id: 'teacher-1', status: 'transcribing', observation_type: 'leader_observation', observer_user_id: 'coach-1', audio_url: PORTAL_AUDIO };
  });

  test('sends no Step 1/5 (transcription)', async () => {
    await driveStep1();
    expect(sentStep('step1_transcribing')).toBe(false);
  });

  test('sends no Step 2/5 (analysis)', async () => {
    await driveStep2();
    expect(sentStep('step2_analyzing')).toBe(false);
  });
});

describe('everything else keeps its step messages', () => {
  test.each([
    ['a WhatsApp /observe observation', { observation_type: 'leader_observation', observer_user_id: 'coach-1', audio_url: WA_AUDIO }],
    ['a teacher\'s own portal recording', { observation_type: null, audio_url: PORTAL_AUDIO.replace('coach-1', 'teacher-1') }],
    ['a teacher\'s own WhatsApp recording', { observation_type: null, audio_url: WA_AUDIO }],
  ])('%s: Step 1/5 and Step 2/5 are sent', async (_label, over) => {
    mockSession = { id: SID, user_id: 'teacher-1', status: 'transcribing', ...over };
    await driveStep1();
    expect(sentStep('step1_transcribing')).toBe(true);
    mockSent.length = 0;
    await driveStep2();
    expect(sentStep('step2_analyzing')).toBe(true);
  });
});
