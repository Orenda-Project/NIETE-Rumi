/**
 * P1.1 (bd-1hae7.5) — ONE coaching voice, two pipelines.
 *
 * The operator's requirement: the teacher who rings us must meet the same coach
 * who writes her reflective questions on WhatsApp. So the voice lives in ONE
 * module that both import, and this suite is what stops them drifting.
 *
 * Two guarantees:
 *  1. **The extraction changed nothing.** `question-prompt.golden.txt` was
 *     captured from the LIVE prompt builder BEFORE the refactor. The reflective
 *     chain must still render byte-for-byte identically — coaching is a shipped,
 *     working product and this refactor is not allowed to move a single byte.
 *  2. **Both pipelines really share it.** The call persona and the reflective
 *     prompt each contain the module's exact output, so a future edit to the
 *     voice reaches both or neither.
 */

const fs = require('fs');
const path = require('path');

const { buildQuestionPrompt } = require('../../shared/services/coaching/reflective-questions/question-prompt');
const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');
const { buildCoachingVoice } = require('../../shared/config/coaching-voice');

const GOLDEN = path.join(__dirname, 'fixtures', 'question-prompt.golden.txt');
const CORPUS = { lesson_throughline_en: 'x', significant_moments: [] };
const CASES = [
  [1, CORPUS, { language: 'Urdu', script: 'Nastaliq', region: 'Pakistan', avoid_hint: ' AVOID-X', gender_hint: 'GH' }, 'Afshan'],
  [1, CORPUS, { language: 'English', script: 'Latin', region: 'Pakistan' }, ''],
  [2, CORPUS, { language: 'Kiswahili', script: 'Latin', region: 'Tanzania', avoid_hint: '', gender_hint: 'G2' }, 'Neema'],
];

describe('the extraction moved nothing in the live coaching product', () => {
  test('the reflective prompt renders byte-for-byte as it did before the refactor', () => {
    const rendered = CASES.map((c) => buildQuestionPrompt(...c)).join('\n<<<CASE-SEP>>>\n');
    expect(rendered).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });
});

describe('one module, both pipelines', () => {
  test('the reflective prompt contains the shared voice verbatim', () => {
    expect(buildQuestionPrompt(...CASES[0]))
      .toContain(buildCoachingVoice({ language: 'Urdu', firstName: 'Afshan' }));
  });

  test('the call persona contains the shared voice verbatim', () => {
    expect(buildCallPrompt({ language: 'ur' }))
      .toContain(buildCoachingVoice({ language: 'Urdu', firstName: '' }));
  });

  test('editing the voice would reach BOTH — they share the same sentinels', () => {
    const sentinels = [
      'OPEN-ENDEDNESS',
      'NEVER state the diagnosis or conclusion',
      'WARM, RESPECTFUL, NEVER ACCUSATORY',
      'ADVICE WITH A QUESTION MARK',
    ];
    const call = buildCallPrompt({ language: 'ur' });
    const chat = buildQuestionPrompt(...CASES[0]);
    sentinels.forEach((s) => {
      expect(call).toContain(s);
      expect(chat).toContain(s);
    });
  });
});

describe('the module itself', () => {
  test('interpolates the language it is given', () => {
    expect(buildCoachingVoice({ language: 'Kiswahili' })).toContain('Kiswahili');
  });

  test('falls back to "the teacher" when no first name is known', () => {
    expect(buildCoachingVoice({ language: 'Urdu' })).toContain('the teacher');
  });

  test('uses the first name when there is one', () => {
    expect(buildCoachingVoice({ language: 'Urdu', firstName: 'Ayesha' })).toContain('Ayesha');
  });

  test('is callable with no arguments at all (never throws into a live call)', () => {
    expect(() => buildCoachingVoice()).not.toThrow();
  });

  test('emits no unresolved template placeholders', () => {
    expect(buildCoachingVoice({ language: 'Urdu', firstName: 'Ayesha' })).not.toMatch(/\$\{/);
  });
});
