/**
 * Classroom audio must not change a teacher's stored language.
 *
 * This path was the mechanism behind every measured mismatch: 168 teachers had
 * been answered in a language that was not their stored preference, because the
 * language of a LESSON was being written to the teacher's PROFILE. A recording
 * is evidence about a classroom, not a request to change an interface.
 *
 * Deliberately a SOURCE-level guard, following the precedent already set by
 * tests/coaching/reflective-language-no-global-write.test.js — which asserts the
 * same class of invariant ("this service must never call the writer") the same
 * way. Driving processTranscription() end to end would need most of the audio
 * pipeline mocked, and would test the mocks more than the invariant. What must
 * hold is structural: the write is unreachable unless a flag is explicitly on.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(
  __dirname,
  '../../bot/shared/services/coaching/transcription-processor.service.js'
);
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

const FLAG = 'LANGUAGE_AUDIO_AUTOFLIP';

describe('coaching audio — the language write is gated', () => {
  it('reads a dedicated flag before it may write language', () => {
    expect(source).toContain(FLAG);
  });

  it('defaults the flag OFF — the safe behaviour is the default', () => {
    // Compared against the string 'true', so an unset, empty, misspelled or
    // otherwise malformed value all degrade to "do not write".
    expect(source).toMatch(
      new RegExp(`process\\.env\\.${FLAG}\\s*===\\s*['"]true['"]`)
    );
  });

  it('takes the no-write branch first, before any write path', () => {
    const gateIndex = source.search(/if\s*\(\s*!\s*AUDIO_MAY_WRITE_LANGUAGE\s*\)/);
    const writeIndex = source.search(/await\s+setUserLanguage\s*\(/);
    expect(gateIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(writeIndex);
  });

  it('has exactly one language write, so there is no second ungated path', () => {
    const writes = source.match(/await\s+setUserLanguage\s*\(/g) || [];
    expect(writes).toHaveLength(1);
  });

  it('records what it heard instead of acting on it', () => {
    // The lesson language is still worth logging — telemetry should be able to
    // show interface-vs-lesson divergence without a preference being rewritten.
    expect(source).toContain('audio-never-writes');
    expect(source).toMatch(/detectedLessonLanguage/);
  });

  it('keeps the leader-observation protection beneath the gate', () => {
    // If the flag is ever turned back on, the rule that an observer is not
    // re-languaged by the classroom they walked into must not have quietly
    // disappeared underneath it.
    expect(source).toContain('isLeaderObservation');
    const gateIndex = source.search(/if\s*\(\s*!\s*AUDIO_MAY_WRITE_LANGUAGE\s*\)/);
    const leaderIndex = source.search(/else if\s*\(\s*isLeaderObservation/);
    expect(leaderIndex).toBeGreaterThan(gateIndex);
  });
});

describe('coaching audio — the explicit verbal override is untouched', () => {
  it('leaves the override paths in the handlers, not in the audio processor', () => {
    // "Reply to me in Urdu" is a real statement of intent and still writes. It
    // lives in the text and voice handlers, already clamped to the offer — this
    // module should not have acquired a copy of it.
    expect(source).not.toMatch(/detectLanguageOverride/);
  });
});
