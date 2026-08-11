/**
 * A voice reply must be in a language this deployment actually serves.
 *
 * This is the mechanism behind a defect the audit MEASURED but could not explain:
 * production held 19 Punjabi and 2 Arabic `output_language` rows for teachers
 * whose stored preference is only ever English or Urdu.
 *
 * The chain:
 *   getConfirmedLanguage() is a RECOGNITION function — deliberately broader than
 *   the offer, because Soniox writes Sindhi/Balochi/Pashto in Urdu script and the
 *   detector must be able to name them to tell them apart. It can return
 *   'bal-PK', 'sd-PK', 'ps-PK', 'pa-PK', 'ar', 'es'.
 *
 *   For a LOCKED user that value is replaced by her stored preference. But 99.6%
 *   of teachers are UNLOCKED, so for almost everyone the raw detection flowed
 *   onward untouched — into the AI system prompt (so Rumi answered in Balochi)
 *   AND into generateSpeechForLanguage (so the TTS routed on it too).
 *
 * Which is why the clamp belongs HERE, at the single point the reply language is
 * resolved, and not inside the AI service: the same value feeds the prompt, the
 * TTS and the logs. Clamping in one consumer and not the other would produce
 * Urdu text read aloud by a Punjabi voice — worse than either alone.
 *
 * Source-level, following tests/coaching/audio-never-writes-language.test.js:
 * driving processVoiceMessage() end to end would need the whole audio pipeline
 * mocked and would test the mocks. What must hold is structural.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, '../../bot/shared/handlers/voice-message.handler.js');
const RAW = fs.readFileSync(SOURCE_PATH, 'utf8');
const CODE = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('voice reply language — clamped to the offer', () => {
  it('imports the shared clamp rather than rolling its own', () => {
    expect(CODE).toMatch(/clampLanguage/);
    expect(CODE).toMatch(/require\([^)]*ux-strings[^)]*\)/);
  });

  it('clamps the resolved reply language', () => {
    expect(CODE).toMatch(/detectedLanguage\s*=\s*clampLanguage\(/);
  });

  it('clamps AFTER the locked/unlocked branch, so both paths are covered', () => {
    // The locked branch assigns preferred_language; the unlocked branch leaves the
    // raw detection. A clamp placed before them would miss the unlocked path,
    // which is the one carrying 99.6% of traffic.
    const lockedBranch = CODE.search(/language_locked\s*===\s*true/);
    const clampIdx = CODE.search(/detectedLanguage\s*=\s*clampLanguage\(/);
    expect(lockedBranch).toBeGreaterThan(-1);
    expect(clampIdx).toBeGreaterThan(lockedBranch);
  });

  it('clamps BEFORE the value reaches the AI prompt', () => {
    const clampIdx = CODE.search(/detectedLanguage\s*=\s*clampLanguage\(/);
    const promptIdx = CODE.search(/getResponseWithFormat\s*\(/);
    // Both asserted present first: a bare ordering check passes vacuously when
    // the clamp is absent, because search() returns -1 and -1 precedes anything.
    expect(clampIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeGreaterThan(-1);
    expect(clampIdx).toBeLessThan(promptIdx);
  });

  it('clamps BEFORE the reply reaches text-to-speech', () => {
    // The split-brain this prevents: an Urdu reply spoken by a Punjabi voice.
    //
    // Targeted at the call that actually carries detectedLanguage. The handler has
    // THREE generateSpeechForLanguage sites and the other two are already safe by
    // construction — the name-retry prompt uses the stored preference, and the
    // switch confirmation uses an override already gated by isMarketLanguage — so
    // matching the first occurrence anywhere would test the wrong one.
    const clampIdx = CODE.search(/detectedLanguage\s*=\s*clampLanguage\(/);
    const replyTtsIdx = CODE.search(/generateSpeechForLanguage\([^)]*detectedLanguage/);
    expect(clampIdx).toBeGreaterThan(-1);
    expect(replyTtsIdx).toBeGreaterThan(-1);
    expect(clampIdx).toBeLessThan(replyTtsIdx);
  });

  it('leaves the two already-safe speech paths alone', () => {
    // Recording why they need no clamp, so a future reader does not "fix" them.
    expect(CODE).toMatch(/generateSpeechForLanguage\(retryMessage,\s*userLanguage\)/);
    expect(CODE).toMatch(/isMarketLanguage\(/);
  });

  it('records what was heard, so the clamp is observable rather than silent', () => {
    // If a teacher speaks Balochi we still want to KNOW that — the detection is
    // real information about her, even though we cannot answer in it.
    // Scoped to the clamp's own log line, not the whole file — 'clamped' appearing
    // anywhere would otherwise satisfy this.
    expect(CODE).toMatch(/rule:\s*'reply-language-clamped'/);
  });
});

describe('the AI prompt ladder offers only what the deployment serves', () => {
  const AI_RAW = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/openai.service.js'),
    'utf8'
  );
  const AI = AI_RAW
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('has no branch for a language outside the offer', () => {
    // Each of these was a live branch: an unlocked teacher whose voice note was
    // detected as Balochi got a Balochi system prompt.
    const offMarket = ['ar', 'es', 'bal-PK', 'sd-PK', 'ps-PK', 'pa-PK', 'ta-LK'];
    const offenders = offMarket.filter((code) =>
      new RegExp(`language\\s*===\\s*'${code.replace('-', '\\-')}'`).test(AI)
    );
    expect(offenders).toEqual([]);
  });

  it('no longer seeds a system message in the history builder', () => {
    // getConversationHistory used to prepend a system prompt hardcoded to
    // "Always respond in Urdu" regardless of the teacher's language. It was
    // survivable only because the one live caller stripped it with .slice(1) —
    // safety resting on a convention, one new caller away from reaching a model.
    //
    // Scoped to that METHOD, not the whole file: the ur branches of the prompt
    // builder legitimately instruct the model to answer in Urdu, and a file-wide
    // assertion would forbid the correct thing along with the wrong one.
    // Boundaries are found in the RAW source, because the doc-comment that starts
    // the next method is the only reliable delimiter — and comment-stripping
    // removes it, which silently widened an earlier version of this check to the
    // whole file.
    const start = AI_RAW.indexOf('async getConversationHistory(');
    expect(start).toBeGreaterThan(-1);
    const next = AI_RAW.indexOf('\n  /*', start);
    expect(next).toBeGreaterThan(start);
    const body = AI_RAW.slice(start, next)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).not.toMatch(/role:\s*'system'/);
    expect(body).not.toMatch(/Always respond in Urdu/);
  });

  it('does not keep the language-blind response method', () => {
    // getResponse(userMessage, userId) took no language and fed the seeded
    // history straight to the model. It had zero callers; leaving it exported is
    // an invitation.
    expect(AI).not.toMatch(/async\s+getResponse\s*\(\s*userMessage\s*,\s*userId\s*\)/);
  });

  it('does not rely on .slice(1) to strip a system message', () => {
    expect(AI).not.toMatch(/\.slice\(1\)/);
  });
});
