/**
 * bd-jbjrx (DC row 130) + bd-8ctnq (DC row 131) — the five DC step messages.
 *
 * Row 130: an Urdu teacher is walked through Step 1 (Transcription) and Step 2
 * (Analysis) in ENGLISH, then Steps 3/4/5 in Urdu — half-English, half-Urdu
 * inside one session.
 *
 * The catalog was never the problem: `step1_transcribing` … `step5_voiceDebrief`
 * all carry a reviewed `ur` string. Both emit sites route through
 * `getCoachingMessage()` correctly too. What they never do is pass a LANGUAGE:
 *
 *   transcription-processor.service.js:66   this.sendProgressUpdate(from, 1)
 *   analysis-processor.service.js:122       this.sendProgressUpdate(from, 2)
 *
 * …so the parameter default (`languageCode = 'en'`) decided it for every
 * teacher. Steps 3/4/5 resolve theirs (`_resolveSessionLanguage` /
 * `_languageFromSession`), which is exactly why only 1 and 2 came out English.
 *
 * Blast radius is EVERY teacher, not only the ones who picked Urdu:
 * `LANGUAGE_OFFER = ['ur','en']`, so `offerDefaultLanguage()` is 'ur'. Steps
 * 3/4/5 floor to Urdu; steps 1/2 floored to the literal 'en'.
 *
 * Row 131: the Urdu step counter rendered as Urdu numeral GLYPHS — `مرحلہ ۴ از ۵`.
 * The teacher asked for standard digits with only the label translated, so the
 * counter becomes `مرحلہ 1/5`. Per language-protocol §8.1 the digit run is
 * wrapped in LRI…PDI (U+2066…U+2069): `1/5` is neutral-direction with a neutral
 * separator, and an RTL paragraph reorders such a run. The catalog already uses
 * this isolate for `coaching_confirmAudio`'s `{minutes}`.
 *
 * Row 131 also repairs a latent bug in `sendProgressUpdate`: it renumbers a
 * non-2 step with `base.replace('2/5', `${step}/5`)`, which silently no-ops on
 * the Urdu string because `۲ از ۵` contains no `2/5`.
 *
 * The database double is SELECT-AWARE on purpose — it hands back a `users`
 * object only when the select asked for one. A double that always attaches
 * `users` would pass against the broken code and prove nothing.
 *
 * Every double-facing variable is `mock`-prefixed because babel-plugin-jest-hoist
 * refuses out-of-scope references inside a `jest.mock` factory otherwise.
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
const { offerDefaultLanguage } = require('../../bot/shared/config/languages');

const SID = 'sess-jbjrx-steps';
const FROM = '923016669553';

const LRI = '⁦';
const PDI = '⁩';
const URDU_DIGITS = /[٠-٩۰-۹]/;

const STEP_KEYS = [
  'step1_transcribing',
  'step2_analyzing',
  'step3_reflecting',
  'step4_generatingReport',
  'step5_voiceDebrief',
];

beforeEach(() => {
  mockSent.length = 0;
  mockTeacherLanguage = 'ur';
  mockSession = { id: SID, user_id: 'teacher-1', status: 'transcribing' };
});

/** Drive step 1 just past its progress message; the missing audioId stops it. */
async function driveStep1() {
  await TranscriptionProcessorService.processTranscription(SID, { from: FROM })
    .catch(() => {});
}

/** Drive step 2 just past its progress message; the mocked collaborator stops it. */
async function driveStep2() {
  await AnalysisProcessorService.processAnalysis(SID, { from: FROM })
    .catch(() => {});
}

const texts = () => mockSent.map((s) => s.text);

describe('bd-8ctnq (row 131) — the step counter is digits, not Urdu numeral glyphs', () => {
  test.each(STEP_KEYS)('%s renders its counter as digits in Urdu', (key) => {
    const ur = getCoachingMessage(key, 'ur');
    const n = STEP_KEYS.indexOf(key) + 1;

    expect(ur).toContain(`${n}/5`);
    expect(ur).not.toMatch(URDU_DIGITS);
  });

  test.each(STEP_KEYS)('%s isolates the digit run for bidi (LRI…PDI)', (key) => {
    const ur = getCoachingMessage(key, 'ur');
    const n = STEP_KEYS.indexOf(key) + 1;

    expect(ur).toContain(`${LRI}${n}/5${PDI}`);
  });

  test.each(STEP_KEYS)('%s still translates the LABEL around the digits', (key) => {
    expect(getCoachingMessage(key, 'ur')).toContain('مرحلہ');
  });

  // The renumbering path in sendProgressUpdate is a literal replace of '2/5'.
  // Before row 131 the Urdu string had no '2/5' in it, so it silently no-opped.
  test('a non-2 step renumbers in Urdu as well as English', async () => {
    await AnalysisProcessorService.sendProgressUpdate(FROM, 3, 'ur');

    expect(texts().join('\n')).toContain(`${LRI}3/5${PDI}`);
    expect(texts().join('\n')).not.toContain(`${LRI}2/5${PDI}`);
  });
});

describe('bd-jbjrx (row 130) — every step speaks the language the teacher chose', () => {
  // If en and ur were equal the rest of this file would prove nothing, so the
  // catalog's distinctness is asserted first.
  test.each(STEP_KEYS)('%s really does carry a distinct Urdu string', (key) => {
    expect(getCoachingMessage(key, 'ur')).not.toBe(getCoachingMessage(key, 'en'));
  });

  test('Step 1 reaches an Urdu teacher in URDU', async () => {
    await driveStep1();

    expect(texts()).toContain(getCoachingMessage('step1_transcribing', 'ur'));
    expect(texts()).not.toContain(getCoachingMessage('step1_transcribing', 'en'));
  });

  test('Step 2 reaches an Urdu teacher in URDU', async () => {
    await driveStep2();

    expect(texts()).toContain(getCoachingMessage('step2_analyzing', 'ur'));
    expect(texts()).not.toContain(getCoachingMessage('step2_analyzing', 'en'));
  });

  test('CONTROL — Step 1 still reaches an English teacher in English', async () => {
    mockTeacherLanguage = 'en';
    await driveStep1();

    expect(texts()).toContain(getCoachingMessage('step1_transcribing', 'en'));
  });

  test('CONTROL — Step 2 still reaches an English teacher in English', async () => {
    mockTeacherLanguage = 'en';
    await driveStep2();

    expect(texts()).toContain(getCoachingMessage('step2_analyzing', 'en'));
  });

  // We have her row in hand here, so "nothing can be determined" is not the
  // situation: the floor is what the deployment offers FIRST (Urdu), the same
  // floor steps 3/4/5 use — never the emergency 'en' floor.
  test('a teacher who never chose gets the OFFER floor, not English', async () => {
    mockTeacherLanguage = null;
    await driveStep1();

    expect(offerDefaultLanguage()).toBe('ur');
    expect(texts()).toContain(getCoachingMessage('step1_transcribing', offerDefaultLanguage()));
  });

  test('step 1 and step 2 default to the offer floor when no language is passed', async () => {
    await TranscriptionProcessorService.sendProgressUpdate(FROM, 1);
    await AnalysisProcessorService.sendProgressUpdate(FROM, 2);

    expect(texts()).toContain(getCoachingMessage('step1_transcribing', offerDefaultLanguage()));
    expect(texts()).toContain(getCoachingMessage('step2_analyzing', offerDefaultLanguage()));
  });
});
