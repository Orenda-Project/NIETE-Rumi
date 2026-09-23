/**
 * E2E — bd-6ld74, THE CHAINED NAME AT THE LAYER THE TEACHER FEELS.
 *
 * The unit suite proves the gate stops calling a chained Latin name unsaluted. This one proves the
 * LESSON REACHES THE TEACHER: it drives the real authoring path (`authorLessonPlan` → the revision
 * ladder → `lint`) with only the LLM `create` call doubled, so what is asserted is what is
 * delivered and not what a regex returns.
 *
 * The production shape: a grade 8 English lesson on the unit the book titles
 * "Hazrat Muhammad Rasulullah صلى الله عليه وسلم - An Embodiment of Justice". The book saluted, in
 * the stamp script §4c.5 requires. The gate looked one word too early, the ladder burned every
 * round on a line no teacher would change, and `authorLessonPlan` threw — the teacher got nothing.
 *
 * The other direction matters more: a chain that ENDS with no salutation must still refuse, end to
 * end. Brief §4c / gate G5c — the automated gate never clears religious content.
 */

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

const {
  create, religiousDoc, reply, installPageTruth, run, religiousFails, refusal,
} = require('./helpers/religious-e2e');

installPageTruth();

/** Latin prose in a teacher-facing slot, with the Urdu religious trigger left in place — without
 *  the trigger the document is not religious, the gate never runs, and nothing here asserts. */
function enDoc(text) {
  const d = religiousDoc();
  d.sections.find((s) => (s.blocks || []).some((b) => b.type === 'key_points'))
    .blocks.find((b) => b.type === 'key_points').items = [text];
  return d;
}

describe('N — the chained name the book prints is delivered, in round 0', () => {
  test('the grade 8 English unit title reaches the teacher lint-clean', async () => {
    // Red on this branch's base: the ladder runs out of rounds and `authorLessonPlan` throws.
    create.mockResolvedValue(reply(enDoc(
      'Hazrat Muhammad Rasulullah صلى الله عليه وسلم - An Embodiment of Justice')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('the grade 9 English hadith attribution, salutation in parentheses, is delivered too', async () => {
    create.mockResolvedValue(reply(enDoc(
      'Abu Hurairah reports Hazrat Muhammad Rasulullah (ﷺ) as saying that a traveller '
      + 'who was thirsty found a well in the way.')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });
});

describe('O — a chain with no salutation at its end is STILL refused, end to end', () => {
  test('the Prophet named through a chain and never saluted never reaches a teacher', async () => {
    create.mockResolvedValue(reply(enDoc(
      'Hazrat Muhammad Rasulullah taught his companions patience.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('a Latin salutation does not close the chain — the stamp is the stamp', async () => {
    // Operator, 2026-09-17: "must be our stamp". Moving the window may not widen the alphabet.
    create.mockResolvedValue(reply(enDoc(
      'Hazrat Muhammad Rasulullah peace be upon him taught patience.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
  });
});
