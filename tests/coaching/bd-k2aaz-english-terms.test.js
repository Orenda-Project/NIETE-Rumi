/**
 * bd-k2aaz (NIETE DC) — reflection question translates scientific/subject terms into Urdu.
 *
 * Reported (R47, 17 Aug): terms like "Murda" appeared where "dead organism" should,
 * "Istlahat" for "terminology", "Qaleedi" for "basic/fundamental". The prompt had a
 * soft "subject-matter terms stay in English" line the model wasn't obeying. Operator:
 * blanket rule — English technical/subject terms are ALWAYS written in English, never
 * translated. The questions are read aloud (ElevenLabs), so this also protects the voice.
 */

const { buildQuestionPrompt } = require('../../bot/shared/services/coaching/reflective-questions/question-prompt');
const { resolveProfile } = require('../../bot/shared/services/coaching/reflective-questions/language-profiles');

const corpus = {
  lesson_throughline_en: 'place value in two-digit numbers',
  significant_moments: [{ approx_time_phrase: 'early on', named_student: null }],
  collective_moments: [],
};

describe('bd-k2aaz — English terms always stay in English (Urdu reflection question)', () => {
  const prompt = buildQuestionPrompt(1, corpus, resolveProfile('ur'), 'Afshan');

  it('states the rule as non-negotiable and forbids translating technical terms', () => {
    expect(prompt).toMatch(/ENGLISH TERMS ALWAYS STAY IN ENGLISH/);
    expect(prompt.toLowerCase()).toMatch(/never translated|never be translated|is never translated/);
  });
  it('carries the concrete R47 examples (dead organism / terminology / fundamental)', () => {
    expect(prompt).toMatch(/dead organism/);
    expect(prompt).toMatch(/terminology/);
    expect(prompt).toMatch(/Murda|Istlahat|Qaleedi/); // named as the wrong forms to avoid
  });
});
