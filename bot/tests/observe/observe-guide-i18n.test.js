/**
 * bd-62 — the debrief guide must be fully localized for non-Swahili officers.
 *
 * Found while rendering the PK launch demo (2026-07-17): the Urdu guide LLM
 * output exceeded the 1600-char budget on EVERY attempt (the ur/en prompt has
 * no length instruction, unlike the sw prompt), so production would always
 * fall back — and the fallback's non-sw branch carries Kiswahili say_this
 * lines ("Asante kwa kunikaribisha…"), built for TZ's English-locked
 * officers. A PK officer would get a half-Kiswahili guide.
 */
const {
  buildGuidePrompt,
  buildFallbackGuide,
  validateGuide,
  renderGuideMessage,
} = require('../../shared/services/observe/observe-debrief-guide');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const KISWAHILI_MARKERS = ['Asante kwa kunikaribisha', 'Nilipenda hili', 'Wewe mwenyewe', 'Vipi kesho ukijaribu', 'Tukutane tena'];

const urAnalysis = {
  framework: 'hots',
  strengths: [{ title_sw: 'فعال سوال', evidence_sw: 'استاد نے پوچھا: "یہ کیوں ہوا؟"' }],
  focus_area_sw: { title_sw: 'کھلے سوالات', try_sw: 'جوڑی بنا کر پوچھیں', why_sw: 'شمولیت بڑھے گی' },
  domains: {},
};

describe('bd-62 — fallback guide localization', () => {
  test('ur fallback carries NO Kiswahili — scaffold and say_this are Urdu', () => {
    const g = buildFallbackGuide(urAnalysis, { language: 'ur' });
    const text = JSON.stringify(g);
    for (const marker of KISWAHILI_MARKERS) expect(text).not.toContain(marker);
    expect(text).toMatch(/شکریہ|خوش آمدید|کلاس/);     // natively Urdu scaffold
    // ur/en now use the rubric-shaped notes (went well / work on first / six
    // conversation lines). sw keeps its 6 steps — asserted below.
    expect(g.conversation).toHaveLength(6);
    expect(g.went_well.length).toBeGreaterThanOrEqual(1);
    expect(validateGuide(g, observeStrings('ur'), 'ur')).toBe(true);
  });

  test('en fallback say_this is English (PK English-locked officers)', () => {
    const g = buildFallbackGuide(urAnalysis, { language: 'en' });
    const text = JSON.stringify(g);
    for (const marker of KISWAHILI_MARKERS) expect(text).not.toContain(marker);
    expect(validateGuide(g, observeStrings('en'), 'en')).toBe(true);
  });

  test('sw fallback byte-identical (Tanzania untouched)', () => {
    const g = buildFallbackGuide(urAnalysis, { language: 'sw' });
    expect(g.steps[0].say_this).toBe('Asante kwa kunikaribisha — lengo langu ni tusaidiane kwa ajili ya watoto.');
    expect(g.outro).toBe('Hakuna namba ya kumpa mwalimu — sifa moja ya kweli na jaribio moja tu. 💛');
  });
});

describe('bd-62 — length budget', () => {
  // The rule under test is the BUDGET (ur/en 2200, sw 1600), not the shape.
  // bd-y7jr8 gave ur/en the 3+1 shape, so each language is sized in its own.
  const bigSteps = () => ({
    intro: 'x'.repeat(100),
    steps: [1, 2, 3, 4, 5, 6].map((n) => ({ n, title: 't'.repeat(20), body: 'b'.repeat(120), say_this: 's'.repeat(140) })),
    outro: 'o'.repeat(80),
  });
  const bigSections = () => ({
    intro: 'x'.repeat(100),
    went_well: ['w'.repeat(160), 'w'.repeat(160)],
    work_on_first: { title: 't'.repeat(30), seen: 'e'.repeat(150), next_step: 'n'.repeat(150) },
    moment: { time: null, text: 'm'.repeat(200) },
    conversation: ['c'.repeat(110), 'c'.repeat(110), 'c'.repeat(80), 'c'.repeat(110), 'c'.repeat(80), 'c'.repeat(80)],
    outro: 'o'.repeat(80),
  });

  test('a ~1800-char guide passes for ur (Urdu runs long) but still fails for sw', () => {
    const g = bigSections();
    const rendered = renderGuideMessage(g, observeStrings('ur'));
    expect(rendered.length).toBeGreaterThan(1600);
    expect(rendered.length).toBeLessThan(2200);
    expect(validateGuide(g, observeStrings('ur'), 'ur')).toBe(true);
    const sw = bigSteps();
    expect(() => validateGuide(sw, observeStrings('sw'), 'sw')).toThrow(/over budget/);
    expect(() => validateGuide(sw, observeStrings('sw'))).toThrow(/over budget/);   // default stays sw-strict
  });

  test('the ur/en prompt instructs the LLM about total length (the sw prompt already does)', () => {
    const p = buildGuidePrompt(urAnalysis, { language: 'ur' });
    expect(p).toMatch(/2200|character/i);
  });
});
