/**
 * FEAT-059 / bd-njn7u Phase 4 — the Sara conversation delta (TDD, red first).
 *
 * Most of what the voice needs already exists (URDU_VOICE_RULES, eleven_v3 on
 * both TTS paths). The two genuine gaps, both measured 2026-08-20 on the
 * corpus fleet (.claude/skills/lp-voicenotes/reference/subjects/
 * honorifics-and-religious-content.md):
 *
 *  1. HONORIFICS. The ligature ﷺ (U+FDFA) is a whole word and Sara speaks
 *     it; the COMBINING marks ؓ ؑ ؒ ؐ (U+0610–0613) are zero-width and Sara
 *     silently swallows them — a Companion honoured on the page and not in
 *     the audio. Conversation replies must write the full spoken phrase,
 *     gender/number correct. Also: never dash-syllabify inside Nastaliq
 *     (بَ-نا-یا reads as the whole word).
 *
 *  2. EMOTION TAGS. VOICE_MODELS.ur.supportsEmotionTags was false — an
 *     Uplift-era leftover. The audio moved to Sara/eleven_v3 (bd-2375), which
 *     RENDERS tags, but the flag never flipped, so every ur voice reply is
 *     tag-less today. Corpus evidence tags render on this exact voice+model:
 *     the v8 voicenotes ship [slowly]-style cues and the operator ear-checked
 *     them. The flip still gets a staging ear-check before prod (the flag
 *     being off was never explained by anyone — prove, don't assume).
 */

/* eslint-disable global-require */

jest.mock('../../shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: jest.fn() } } }),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getConversationHistory: jest.fn(async () => []),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { URDU_VOICE_RULES, voiceLanguageRules } = require('../../shared/config/voice-language-rules');
const { VOICE_MODELS } = require('../../shared/utils/constants');
const OpenAIService = require('../../shared/services/openai.service');

describe('4.1 — honorifics in the conversation voice rules', () => {
  test('the combining marks are named as unspeakable and banned from payload text', () => {
    // The four marks Sara swallows must appear in the rule (as what NOT to emit).
    expect(URDU_VOICE_RULES).toMatch(/ؓ/);
    expect(URDU_VOICE_RULES).toMatch(/ؑ/);
    expect(URDU_VOICE_RULES).toMatch(/NEVER write (them|a combining)/i);
  });

  test('the full spoken phrases are all present, gendered and numbered', () => {
    expect(URDU_VOICE_RULES).toContain('رَضِیَ ٱللَّٰهُ عَنْہُ');   // male Companion
    expect(URDU_VOICE_RULES).toContain('رَضِیَ ٱللَّٰهُ عَنْہا');   // female Companion / wife
    expect(URDU_VOICE_RULES).toContain('رَضِیَ ٱللَّٰهُ عَنْہُم');  // plural
    expect(URDU_VOICE_RULES).toContain('عَلَیْہِ السَّلام');        // another prophet
    expect(URDU_VOICE_RULES).toContain('رَحْمَۃُ ٱللَّٰهِ عَلَیْہِ'); // scholar
  });

  test('ﷺ is explicitly the safe exception (a ligature, it speaks)', () => {
    expect(URDU_VOICE_RULES).toContain('ﷺ');
  });

  test('never invent, never drop — honour who the lesson honours', () => {
    expect(URDU_VOICE_RULES).toMatch(/never (drop|invent)/i);
  });

  test('dash-syllabification inside Nastaliq is banned', () => {
    expect(URDU_VOICE_RULES).toMatch(/بَ-نا-یا|dash/i);
  });

  test('the ur rules still reach every voice surface via voiceLanguageRules', () => {
    expect(voiceLanguageRules('ur')).toBe(URDU_VOICE_RULES);
  });
});

describe('4.2 — Urdu emotion tags ON', () => {
  test('VOICE_MODELS.ur.supportsEmotionTags is true (Sara/eleven_v3 renders tags)', () => {
    expect(VOICE_MODELS.ur.supportsEmotionTags).toBe(true);
  });

  test('ur VOICE prompt carries the tag instructions', () => {
    const prompt = OpenAIService._getFormatAwareSystemPrompt('voice', 'ur', 'Ayesha');
    expect(prompt).toContain('EMOTION TAGS');
    expect(prompt).toContain('[warmly]');
  });

  test('ur TEXT prompt carries none (tags are a voice-format concern only)', () => {
    const prompt = OpenAIService._getFormatAwareSystemPrompt('text', 'ur', 'Ayesha');
    expect(prompt).not.toContain('EMOTION TAGS');
    expect(prompt).not.toContain('[warmly]');
  });

  test('[methodically] joins the tag palette, with a ≤3-per-reply budget', () => {
    const prompt = OpenAIService._getFormatAwareSystemPrompt('voice', 'ur', 'Ayesha');
    expect(prompt).toContain('[methodically]');
    expect(prompt).toMatch(/at most 3|no more than 3/i);
  });

  test('en voice tags unaffected (en rides the fallback prompt, which already carries them)', () => {
    const prompt = OpenAIService._getFormatAwareSystemPrompt('voice', 'en', 'Ayesha');
    expect(prompt).toMatch(/emotion tags/i);
    expect(prompt).toContain('[warmly]');
  });
});
