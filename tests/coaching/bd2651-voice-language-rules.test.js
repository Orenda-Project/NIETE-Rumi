/**
 * bd-2651 (NIETE DC) — coaching/general voice notes mix Hindi vocabulary into Urdu.
 *
 * Reported by Maria Karim (coach, 3 Aug 2026): "voice note is a mixture of Hindi and
 * Urdu ... many Hindi words are different from their Urdu equivalents, making it hard
 * to understand." Root cause: the voice-text prompts told the model "natural Urdu" but
 * never (a) pinned the script to Nastaliq, (b) forbade Hindi vocabulary, or (c) kept
 * English terms in Latin — and the debrief prompt even said "avoid English jargon"
 * (which forces transliteration). Sara (eleven_v3, "Urdu & Hindi" voice) then reads the
 * Hindi-leaning text with a Hindi accent.
 *
 * The fix: one shared rule block (voice-language-rules.js) injected into EVERY surface
 * whose text is spoken aloud — debrief, reflective question, acknowledgement, general
 * chat, reading feedback, video. English stays PURE English (Jessica).
 */

const fs = require('fs');
const path = require('path');
const src = (p) => fs.readFileSync(path.join(__dirname, '../../bot', p), 'utf8');

const {
  voiceLanguageRules,
  URDU_VOICE_RULES,
  ENGLISH_VOICE_RULES,
} = require('../../bot/shared/config/voice-language-rules');

describe('bd-2651 — shared voice-language rules', () => {
  it('Urdu rules pin Nastaliq script and forbid Roman-Urdu', () => {
    expect(URDU_VOICE_RULES).toMatch(/Nastaliq/);
    expect(URDU_VOICE_RULES).toMatch(/NEVER Roman-Urdu/);
  });
  it('Urdu rules forbid Hindi vocabulary with concrete word-pairs', () => {
    expect(URDU_VOICE_RULES).toMatch(/NOT HINDI/i);
    expect(URDU_VOICE_RULES).toContain('شکریہ'); // Urdu, not دھنیہ واد
    expect(URDU_VOICE_RULES).toContain('فوراً'); // Urdu, not ترنت
  });
  it('Urdu rules keep genuine English terms in Latin (no transliteration)', () => {
    expect(URDU_VOICE_RULES).toMatch(/Grade 3/);
    expect(URDU_VOICE_RULES).toMatch(/NEVER transliterate/i);
  });
  it('English rules force pure English — no Urdu/Hindi bleed (Jessica path)', () => {
    expect(ENGLISH_VOICE_RULES).toMatch(/ONLY in natural, simple English/);
    expect(ENGLISH_VOICE_RULES).toMatch(/Do NOT use any Urdu, Hindi/);
  });
  it('dispatcher routes by language and is safe for others', () => {
    expect(voiceLanguageRules('ur')).toBe(URDU_VOICE_RULES);
    expect(voiceLanguageRules('en')).toBe(ENGLISH_VOICE_RULES);
    expect(voiceLanguageRules('sw')).toBe('');
    expect(voiceLanguageRules(null)).toBe(ENGLISH_VOICE_RULES); // default en
  });
});

describe('bd-2651 — acknowledgement builder carries the voice rules', () => {
  const { buildAcknowledgementPrompt } = require('../../bot/shared/services/coaching/reflective-acknowledgement');
  it('Urdu ack prompt injects the anti-Hindi / Nastaliq rules', () => {
    const p = buildAcknowledgementPrompt('answer', 'question', 'Urdu', 'ur');
    expect(p).toMatch(/Nastaliq/);
    expect(p).toContain('شکریہ');
  });
  it('English ack prompt injects the pure-English rule', () => {
    const p = buildAcknowledgementPrompt('answer', 'question', 'English', 'en');
    expect(p).toMatch(/ONLY in natural, simple English/);
  });
});

describe('bd-2651 — every voice surface injects the shared rules (source guards)', () => {
  it('debrief drops "avoid English jargon" and injects voiceLanguageRules', () => {
    const s = src('shared/services/gpt5-mini.service.js');
    expect(s).toMatch(/voiceLanguageRules/);
    expect(s).not.toMatch(/Avoid English jargon where possible/);
  });
  it('general-chat voice prompt (openai) injects voiceLanguageRules', () => {
    expect(src('shared/services/openai.service.js')).toMatch(/voiceLanguageRules/);
  });
  it('reading voice-feedback injects voiceLanguageRules', () => {
    expect(src('shared/services/reading/voice-feedback.service.js')).toMatch(/voiceLanguageRules/);
  });
  it('video narration routes Urdu away from Jessica (uses Urdu voice id / language)', () => {
    const s = src('shared/services/video/video-script.service.js');
    expect(s).toMatch(/ELEVENLABS_URDU_VOICE_ID|URDU_VOICE_ID/);
  });
  it('constants actually EXPORTS ELEVENLABS_URDU_VOICE_ID (video import would be undefined otherwise)', () => {
    // Source-guard (constants.js requires dotenv, not always present in CI sandbox):
    // the identifier must appear in the module.exports block, not only be defined.
    const s = src('shared/utils/constants.js');
    const exportsBlock = s.slice(s.indexOf('module.exports'));
    expect(exportsBlock).toMatch(/ELEVENLABS_URDU_VOICE_ID/);
  });
});

describe('bd-2651 — reflective-question Urdu profile forbids Hindi vocabulary', () => {
  const { resolveProfile } = require('../../bot/shared/services/coaching/reflective-questions/language-profiles');
  it('Urdu avoid_hint names the Persian/Arabic-not-Hindi principle', () => {
    const hint = resolveProfile('ur').avoid_hint;
    expect(hint).toMatch(/Persian\/Arabic/i);
    expect(hint).toMatch(/Hindi/);
  });
});
