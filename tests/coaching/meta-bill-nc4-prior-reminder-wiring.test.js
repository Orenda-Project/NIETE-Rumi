'use strict';
/**
 * Meta bill cut NC4 (N2-C10) — EXECUTED through the real transcription job.
 *
 * Before: text "💡 Quick reminder: Last time, you committed to: _"…"_ Let's see how
 *         it went in this session!"  →  [buttons] "📸 Would you like to add up to 3
 *         photos?…"
 * After:  [buttons] the photo offer whose body OPENS with that reminder.
 *
 * processTranscription runs end to end to the photo prompt; only the network
 * edges (whatsapp, supabase, R2, the ASR call, the audio-hash lookup) are faked.
 */
const os = require('os');
const path = require('path');

const SID = '22222222-3333-4444-8555-666666666666';
const FROM = '923001234567';
const sent = [];

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: require('path').join(require('os').tmpdir(), 'rumi-test-nc4-reminder'),
  LISTENING_ANIMATION_MEDIA_ID: undefined,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', body: p.body }); return true; }),
  sendSticker: jest.fn(async () => true),
  downloadMedia: jest.fn(async () => Buffer.from('OGG')),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({ getAudioDuration: jest.fn(async () => 1800) }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadClassroomAudio: jest.fn(async () => 'https://r2.example/a.ogg') }));
jest.mock('../../bot/shared/services/coaching/audio-hash-cache', () => ({
  computeAudioHash: () => 'hash-1',
  findRecentDuplicateSession: jest.fn(async () => null),
  resolveDuplicateSubmission: jest.fn(async () => false),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'),
  setUserLanguage: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(async () => ({})),
  updateConversationState: jest.fn(async () => ({})),
  markAsFailed: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const b = {};
    ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq', 'update'].forEach((m) => { b[m] = () => b; });
    const row = {
      id: '22222222-3333-4444-8555-666666666666', user_id: 'u-1', status: 'transcribing', observation_type: null,
      audio_duration_seconds: 1800, users: { phone_number: '923001234567', name: 'T', preferred_language: 'en' },
    };
    b.single = async () => ({ data: row, error: null });
    b.maybeSingle = async () => ({ data: row, error: null });
    // The list read is the prior-commitment lookup; the update chains resolve to one row (applied).
    b.then = (ok, ko) => Promise.resolve({ data: [{ id: row.id, prioritized_action: global.__nc4PriorAction }], error: null }).then(ok, ko);
    return b;
  },
}));

const TP = require('../../bot/shared/services/coaching/transcription-processor.service');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

beforeEach(() => {
  sent.length = 0;
  jest.spyOn(TP, 'transcribeWithDiarization').mockResolvedValue({
    transcript: 'Teacher: today we learn fractions.', diarization: { speakers: ['Teacher'], confidence: 0.9, segments: [] },
    tokens: [], silences: [],
  });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { try { require('fs').rmSync(path.join(os.tmpdir(), 'rumi-test-nc4-reminder'), { recursive: true, force: true }); } catch (_) { /* best effort */ } });

test('a teacher who committed last time: ONE bubble — the photo offer opening with the reminder', async () => {
  global.__nc4PriorAction = { teacher_response: 'yes', action: 'Ask one open question per activity' };
  await TP.processTranscription(SID, { from: FROM, audioId: 'aud-1', step1Announced: true });

  const reminder = getCoachingMessage('priorActionReminder', 'en').replace('{{action}}', 'Ask one open question per activity');
  const offer = resolveUx('coachingPhotoOffer', { language: 'en' });
  expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
  const prompts = sent.filter((s) => s.kind === 'buttons');
  expect(prompts).toHaveLength(1);
  expect(prompts[0].body).toBe(`${reminder}\n\n${offer}`);
});

test('CONTROL — no prior commitment: the plain offer, nothing before it', async () => {
  global.__nc4PriorAction = null;
  await TP.processTranscription(SID, { from: FROM, audioId: 'aud-1', step1Announced: true });
  const offer = resolveUx('coachingPhotoOffer', { language: 'en' });
  expect(sent).toEqual([{ kind: 'buttons', body: offer }]);
});

test('FALLBACK — a reminder too long for the 1,024 body cap keeps its own text, then the plain offer', async () => {
  global.__nc4PriorAction = { teacher_response: 'yes', action: 'y'.repeat(1100) };
  await TP.processTranscription(SID, { from: FROM, audioId: 'aud-1', step1Announced: true });
  const offer = resolveUx('coachingPhotoOffer', { language: 'en' });
  expect(sent.map((s) => s.kind)).toEqual(['text', 'buttons']);
  expect(sent[1].body).toBe(offer);
});
