/**
 * Which recordings get length guidance, and which are left alone.
 *
 * A recording under the classroom threshold is not refused — it is handed to the
 * chat assistant, and the assistant was never told the rule. On 4 September a
 * teacher's own voice note contained "it should be 15 to 20 seconds" (she was
 * coaching a child through a recording) and the assistant paraphrased her own
 * sentence back at her as if it were the bot's rule.
 *
 * The rule has to be narrow, because most short audio genuinely is conversation.
 * Measured over seven days on production: 1,009 recordings landed between 30 and
 * 899 probed seconds and got a chat answer with no guidance; 30 hand-read
 * transcripts of 1,000 characters or more were 27 lessons, 3 coach debriefs and
 * 0 chats, while 30 read from the 200-999 band were 18 chats. So the character
 * boundary is 1,000, not 200 — a teacher asking a question must never be
 * lectured about length.
 *
 * This is the planner: pure, table-driven, no IO.
 */

const {
  classifyShortRecording,
  GUIDANCE_MIN_SECONDS,
  GUIDANCE_MIN_TRANSCRIPT_CHARS,
} = require('../../bot/shared/services/coaching/short-recording-guidance');
const { CLASSROOM_AUDIO_THRESHOLD } = require('../../bot/shared/config/classroom-audio.config');

const TEACHER = { id: 'u1', role: 'teacher' };
const PRINCIPAL = { id: 'u2', role: 'principal' };
const COACH = { id: 'u3', role: 'coach' };

const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 3600_000).toISOString();
const declared = (user, expires = future()) => ({
  ...user,
  conversation_state: { flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO' },
  conversation_state_expires_at: expires,
});

describe('tier 1 — she asked for an analysis', () => {
  test('a declared intent gets guidance at any length', () => {
    const r = classifyShortRecording({
      user: declared(TEACHER), durationSeconds: 20, transcriptChars: 60,
    });
    expect(r.tier).toBe(1);
  });

  test('even with nothing known about the length', () => {
    const r = classifyShortRecording({
      user: declared(TEACHER), durationSeconds: null, transcriptChars: 12,
    });
    expect(r.tier).toBe(1);
  });

  test('an expired declaration is not a declaration', () => {
    const r = classifyShortRecording({
      user: declared(TEACHER, past()), durationSeconds: 20, transcriptChars: 60,
    });
    expect(r.tier).toBe(null);
  });
});

describe('tier 2 — it sounds like a lesson', () => {
  test('a probed duration inside the band', () => {
    const r = classifyShortRecording({ user: TEACHER, durationSeconds: 700, transcriptChars: 40 });
    expect(r.tier).toBe(2);
  });

  test('the lower edge of the band is included', () => {
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: GUIDANCE_MIN_SECONDS, transcriptChars: 0,
    }).tier).toBe(2);
  });

  test('just under the lower edge is left alone', () => {
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: GUIDANCE_MIN_SECONDS - 1, transcriptChars: 0,
    }).tier).toBe(null);
  });

  test('at or above the classroom threshold this never runs — that is a real session', () => {
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: CLASSROOM_AUDIO_THRESHOLD, transcriptChars: 9000,
    }).tier).toBe(null);
  });

  test('a long transcript with no duration at all', () => {
    const r = classifyShortRecording({ user: TEACHER, durationSeconds: null, transcriptChars: 4000 });
    expect(r.tier).toBe(2);
  });

  test('the character boundary is 1,000 and it is inclusive', () => {
    expect(GUIDANCE_MIN_TRANSCRIPT_CHARS).toBe(1000);
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: null, transcriptChars: 1000,
    }).tier).toBe(2);
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: null, transcriptChars: 999,
    }).tier).toBe(null);
  });
});

describe('tier 3 — ordinary conversation, untouched', () => {
  test('a short voice question gets nothing', () => {
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: 20, transcriptChars: 80,
    }).tier).toBe(null);
  });

  test('a 600-character aside — the middle of the measured chat band — gets nothing', () => {
    expect(classifyShortRecording({
      user: TEACHER, durationSeconds: null, transcriptChars: 600,
    }).tier).toBe(null);
  });
});

describe('who this is for', () => {
  test("a coach's own debrief recording is never told it needs 15 minutes", () => {
    // Three of the thirty hand-read long transcripts were exactly this.
    expect(classifyShortRecording({
      user: COACH, durationSeconds: 700, transcriptChars: 4000,
    }).tier).toBe(null);
    expect(classifyShortRecording({
      user: declared(COACH), durationSeconds: 700, transcriptChars: 4000,
    }).tier).toBe(null);
  });

  test('a principal DOES get it — she records her own lessons', () => {
    // Gated on the self-coaching capability, not on "is a school leader": the
    // leader gate would silence the guidance for the people most likely to need
    // it.
    expect(classifyShortRecording({
      user: PRINCIPAL, durationSeconds: 700, transcriptChars: 4000,
    }).tier).toBe(2);
  });

  test('an unknown role keeps the guidance, like it keeps the feature', () => {
    expect(classifyShortRecording({
      user: { id: 'u4', role: 'something_new' }, durationSeconds: 700, transcriptChars: 0,
    }).tier).toBe(2);
  });

  test('no user at all decides nothing', () => {
    expect(classifyShortRecording({ user: null, durationSeconds: 700, transcriptChars: 4000 }).tier)
      .toBe(null);
  });
});
