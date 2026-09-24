/**
 * «استاد چاہتے ہیں» is the masculine, not a neutral way to talk ABOUT a teacher.
 *
 * gender-neutral-address.js fixed the SECOND-person half of this for the
 * observe prompts (the officer or teacher addressed as آپ). The THIRD-person
 * half — sentences ABOUT the teacher — was still taught the other way:
 *   - the coach-the-coach feedback card: "Refer to the teacher with the
 *     respectful plural (استاد چاہتے ہیں)";
 *   - the debrief guide: "(استاد چاہتے ہیں، not چاہتی ہیں)";
 *   - the HOTS analysis prompt, in Urdu: «احترامی جمع (کرتے ہیں، پڑھاتے ہیں) …
 *     استعمال کریں».
 * A male teacher is «استاد چاہتے ہیں» and a female one «استاد چاہتی ہیں»; a
 * model told to write the first guesses "man" every time. The neutral forms
 * name no gender: a noun phrase («استاد کی خواہش ہے کہ…»), the past with نے
 * (the verb agrees with its object: «استاد نے پوچھا»), or an impersonal or
 * obligative form («یہ آزمایا جا سکتا ہے»).
 *
 * This suite pins what each model RECEIVES (the real prompt builders), and
 * holds every example the shared rule quotes to the quiz lane's own
 * third-person check (genderedTeacherForms), so the rule and the check cannot
 * disagree about what is neutral.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { URDU_THIRD_PERSON_RULE } = require('../../shared/config/gender-neutral-address');
const { buildGuidePrompt } = require('../../shared/services/observe/observe-debrief-guide');
const { buildCoachFeedbackPromptI18n } = require('../../shared/services/observe/observe-coach-feedback');
const { getObservePack } = require('../../shared/services/observe/observe-framework');
const { genderedTeacherForms } = require('../../shared/services/quiz/transcript-quiz-pedagogy');

const flat = (p) => String(p).replace(/\s+/g, ' ');

function hotsUrduPrompt() {
  const prev = process.env.OBSERVE_FRAMEWORK;
  process.env.OBSERVE_FRAMEWORK = 'hots';
  try {
    return getObservePack().module.buildAnalysisPrompt('T: transcript', { observerLanguage: 'ur', teacherName: '' });
  } finally {
    if (prev === undefined) delete process.env.OBSERVE_FRAMEWORK; else process.env.OBSERVE_FRAMEWORK = prev;
  }
}

describe('the shared third-person rule', () => {
  test('exists, and names «استاد چاہتے ہیں» AND «استاد چاہتی ہیں» as gendered', () => {
    expect(typeof URDU_THIRD_PERSON_RULE).toBe('string');
    expect(URDU_THIRD_PERSON_RULE).toContain('استاد چاہتے ہیں');
    expect(URDU_THIRD_PERSON_RULE).toContain('استاد چاہتی ہیں');
    expect(URDU_THIRD_PERSON_RULE).toMatch(/masculine/i);
  });

  test('every quoted example: the gendered ones are caught by the quiz check, the neutral ones pass it', () => {
    const quoted = [...URDU_THIRD_PERSON_RULE.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
    const banned = quoted.filter((q) => /(تے|تی) ہیں/.test(q));
    const neutral = quoted.filter((q) => !banned.includes(q));
    expect(banned.length).toBeGreaterThanOrEqual(3);
    expect(neutral.length).toBeGreaterThanOrEqual(4);
    banned.forEach((q) => expect(genderedTeacherForms(q, 'ur')).not.toEqual([]));
    neutral.forEach((q) => expect(genderedTeacherForms(q, 'ur')).toEqual([]));
    // the three neutral shapes are all offered
    expect(neutral.some((q) => /کی خواہش ہے/.test(q))).toBe(true);   // a noun phrase
    expect(neutral.some((q) => /استاد نے/.test(q))).toBe(true);      // past with نے
    expect(neutral.some((q) => /جا سکتا ہے|ہوگا|گیا/.test(q))).toBe(true);   // impersonal / obligative
  });
});

describe('what each observe model is told about the teacher', () => {
  const PROMPTS = {
    'the coach-feedback card (ur)': () => buildCoachFeedbackPromptI18n('T: transcript', { foName: 'Ali' }, 'ur'),
    'the debrief guide (ur)': () => buildGuidePrompt({ focus_area: {} }, { language: 'ur' }),
  };

  test.each(Object.keys(PROMPTS))('%s no longer recommends «استاد چاہتے ہیں», and carries the shared rule', (name) => {
    const p = flat(PROMPTS[name]());
    expect(p).not.toMatch(/respectful plural \(استاد چاہتے ہیں\)/);
    expect(p).not.toMatch(/\(استاد چاہتے ہیں، not چاہتی ہیں\)/);
    expect(p).toContain(flat(URDU_THIRD_PERSON_RULE));
  });

  test('the HOTS analysis prompt (Urdu) no longer asks for the masculine plural about the teacher', () => {
    const p = flat(hotsUrduPrompt());
    expect(p).not.toMatch(/احترامی جمع \(کرتے ہیں، پڑھاتے ہیں\)/);
    expect(p).not.toMatch(/احترامی جمع[^؛]{0,40}استعمال کریں/);
    // both genders named as what NOT to write, the neutral forms named as what to write
    expect(p).toMatch(/پڑھاتے ہیں/);
    expect(p).toMatch(/پڑھاتی ہیں/);
    expect(p).toContain('استاد نے پوچھا');
    expect(p).toMatch(/استاد کی خواہش ہے/);
  });
});
