/**
 * bd-2531 — the teacher-facing Supervisor Remark narrative.
 *
 * THE product rule this file defends: the teacher receives strengths → growth →
 * action plan and NEVER sees a score. Not the 1-4s, not S_pct, not the rubric
 * labels, not "your principal rated you". The principal keeps the numbers.
 *
 * That rule is enforced in three independent places, because a prompt is a
 * request, not a guarantee:
 *   1. the prompt says so (buildRemarkPrompt)
 *   2. the INPUT to the model carries anchors, not digits
 *   3. a post-generation scrubber rejects/strips any number that appears anyway
 * Tests below cover all three. (3) is the one that actually holds when the model
 * misbehaves.
 *
 * Reuses report-v2/narrative.service.js's hard-won rules rather than re-deriving
 * them: second-person-only (bd-2220 — teachers saw themselves called "he" then
 * "she" in the same report), the plain-language jargon ban, and the Urdu
 * code-switch normalizer.
 */
const {
  buildRemarkPrompt,
  scrubScores,
  generateRemarkNarrative,
  NARRATIVE_SHAPE,
} = require('../../shared/services/remark/remark-narrative.service');

const SCORES = [
  { ordinal: 1, score: 4 }, { ordinal: 2, score: 3 }, { ordinal: 3, score: 3 },
  { ordinal: 4, score: 2 }, { ordinal: 5, score: 1 },
];
const BASE = {
  scores: SCORES,
  comment: 'Ayesha has grown a lot this term but rarely calls parents.',
  teacherName: 'Ayesha',
  language: 'en',
};

describe('bd-2531 — the prompt carries ANCHORS, never digits', () => {
  test('no bare indicator score appears in the prompt', () => {
    const p = buildRemarkPrompt(BASE);
    // The model cannot leak a number it was never given. Feeding "4/4" invites
    // "you scored 4 out of 4" no matter what the instructions say.
    expect(p).not.toMatch(/\b[1-4]\s*\/\s*4\b/);
    expect(p).not.toMatch(/\bscore[sd]?\s*[:=]\s*[1-4]\b/i);
  });

  test('S_pct never reaches the prompt', () => {
    const p = buildRemarkPrompt(BASE);
    expect(p).not.toMatch(/65(\.0)?\s*%/);
    expect(p.toLowerCase()).not.toContain('s_pct');
  });

  test('the anchor TEXT for each score is what the model sees', () => {
    const p = buildRemarkPrompt(BASE);
    const { getAnchor } = require('../../shared/services/remark/remark-rubric');
    expect(p).toContain(getAnchor(1, 4, 'en'));   // her strongest
    expect(p).toContain(getAnchor(5, 1, 'en'));   // her growth edge
  });

  test('the principal comment is included verbatim', () => {
    expect(buildRemarkPrompt(BASE)).toContain(BASE.comment);
  });

  test('the strongest and weakest indicators are named as such', () => {
    const p = buildRemarkPrompt(BASE);
    // Indicator 1 scored 4 (strength), indicator 5 scored 1 (growth edge).
    // Without this the model picks arbitrarily and the growth section may
    // celebrate the thing she is worst at.
    expect(p).toContain('Professional Growth & Feedback Uptake');
    expect(p).toContain('Parents & Community Engagement');
  });

  test('an incomplete rubric refuses to build a prompt', () => {
    expect(() => buildRemarkPrompt({ ...BASE, scores: SCORES.slice(0, 3) }))
      .toThrow(/incomplete/i);
  });
});

describe('bd-2531 — the prompt carries the report-v2 hard-won rules', () => {
  test('second person only (bd-2220 — no gender guessing)', () => {
    const p = buildRemarkPrompt(BASE);
    expect(p).toMatch(/second person|as "you"|address .* directly/i);
    expect(p).toMatch(/never .*(he|she|him|her)|do not .*(he|she)/i);
  });

  test('it bans the coach-jargon report-v2 bans', () => {
    const p = buildRemarkPrompt(BASE).toLowerCase();
    for (const jargon of ['scaffolding', 'differentiation', 'metacognition']) {
      expect(p).toContain(jargon);   // named in the ban list
    }
  });

  test('it forbids emitting rubric IDs / labels to the teacher', () => {
    expect(buildRemarkPrompt(BASE)).toMatch(/never .*(rubric|indicator|label)/i);
  });

  test('Urdu asks for Urdu output with English pedagogical terms kept inline', () => {
    const p = buildRemarkPrompt({ ...BASE, language: 'ur' });
    expect(p).toMatch(/URDU/i);
    expect(p).toMatch(/code-?switch|English \(Latin/i);
  });

  test('the requested JSON shape is strengths -> growth -> action plan', () => {
    expect(NARRATIVE_SHAPE).toEqual(['opening', 'strengths', 'growth', 'action_plan']);
    const p = buildRemarkPrompt(BASE);
    for (const k of NARRATIVE_SHAPE) expect(p).toContain(k);
    expect(p).toMatch(/\bJSON\b/);   // required for json_object mode
  });
});

describe('bd-2531 — scrubScores is the LAST line of defence', () => {
  test('a leaked "3 out of 4" is caught', () => {
    expect(() => scrubScores({ strengths: 'You scored 3 out of 4 on collaboration.' }))
      .toThrow(/score|number/i);
  });

  test('a leaked percentage is caught', () => {
    expect(() => scrubScores({ growth: 'Overall you are at 65%.' })).toThrow(/score|number/i);
  });

  test('a leaked bare rating is caught', () => {
    expect(() => scrubScores({ opening: 'Your rating: 4' })).toThrow(/score|number/i);
  });

  test('a leaked rubric label is caught', () => {
    expect(() => scrubScores({ growth: 'On indicator 5 you need work.' })).toThrow(/rubric|indicator/i);
  });

  test('ORDINARY numbers in prose are allowed through', () => {
    // Over-zealous scrubbing would mangle real coaching language. "three
    // students", "one thing to try", a year — all legitimate.
    const clean = {
      opening: 'You have grown a lot this term.',
      strengths: 'You noticed the three students at the back who had stopped following.',
      growth: 'One area to build on is contact with parents.',
      action_plan: 'Call two parents before the end of the month.',
    };
    expect(() => scrubScores(clean)).not.toThrow();
    expect(scrubScores(clean)).toEqual(clean);
  });

  test('Urdu digits are caught too (٤ / ۴), not just ASCII', () => {
    // A model writing Urdu may emit Eastern-Arabic numerals — an ASCII-only
    // regex would wave "آپ کا اسکور ۴" straight through to the teacher.
    expect(() => scrubScores({ growth: 'آپ کا اسکور ۴ ہے۔' })).toThrow(/score|number/i);
  });

  // ── Found by adversarially probing the scrubber, NOT by designing for it.
  // The first version passed all its own tests and still leaked all six of
  // these. A model told "never write a number" reaches for the WORD instead.
  test.each([
    ['spelled-out out-of', 'You scored four out of four on collaboration.'],
    ['spelled-out, principal-attributed', 'Your principal gave you four out of four.'],
    ['level + digit', 'You are at level 4 for parent contact.'],
    ['points', 'You earned 13 points this quarter.'],
    ['"a rating of N"', 'A rating of 3 on student support.'],
    ['"N of 20"', 'Your total was 13 of 20.'],
  ])('catches %s', (_label, text) => {
    expect(() => scrubScores({ growth: text })).toThrow(/score|number|rubric|rating/i);
  });

  test.each([
    ['three students', 'You noticed the three students at the back.'],
    ['two parents', 'Call two parents before the end of the month.'],
    ['one area', 'One area to build on is contact with families.'],
    ['a month name', 'Since January you have grown a lot.'],
    ['a grade level', 'Your grade 3 class responds well to you.'],
    ['an ordinal', 'This is your second term leading the reading circle.'],
    ['first/second in prose', 'You did two things well this term.'],
  ])('still allows ordinary prose: %s', (_label, text) => {
    // Over-zealous scrubbing is its own failure: it rejects good narratives and
    // sends the teacher nothing at all.
    expect(() => scrubScores({ growth: text })).not.toThrow();
  });
});

describe('bd-2531 — generateRemarkNarrative', () => {
  const okJson = {
    opening: 'You have had a strong term.',
    strengths: 'You seek out feedback and act on it.',
    growth: 'Building contact with families is the next step.',
    action_plan: 'Call two parents this month and note what you learn.',
  };

  test('returns the scrubbed narrative on success', async () => {
    const llm = { completeJson: async () => ({ result: okJson, usage: {} }) };
    await expect(generateRemarkNarrative(BASE, { llm })).resolves.toMatchObject(okJson);
  });

  test('a model that leaks a score is REJECTED, not delivered', async () => {
    const llm = { completeJson: async () => ({
      result: { ...okJson, strengths: 'You scored 4 out of 4 here.' }, usage: {} }) };
    await expect(generateRemarkNarrative(BASE, { llm })).rejects.toThrow(/score|number/i);
  });

  test('a missing section is REJECTED (the teacher gets all three or none)', async () => {
    const llm = { completeJson: async () => ({ result: { opening: 'hi' }, usage: {} }) };
    await expect(generateRemarkNarrative(BASE, { llm })).rejects.toThrow(/missing|shape/i);
  });

  test('an LLM failure propagates so the caller can queue a retry', async () => {
    // Design spec §6/§10: the remark + scores still save; the narrative is
    // queued. This function must NOT swallow the error into a null that the
    // caller mistakes for "delivered".
    const llm = { completeJson: async () => { throw new Error('upstream 503'); } };
    await expect(generateRemarkNarrative(BASE, { llm })).rejects.toThrow(/503/);
  });
});
