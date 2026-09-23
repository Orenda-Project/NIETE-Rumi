/**
 * E2E — THE G5c CLEARED-NAME LIST, LATIN HALF, AT THE LAYER THE TEACHER FEELS. bd-5t71f (P0).
 *
 * The unit suite proves the gate stops demanding ﷺ after a Latin name the native-speaker review
 * cleared. This one proves the LESSON REACHES THE TEACHER: it drives the real authoring path
 * (`authorLessonPlan` → revision ladder → `lint`), with only the LLM `create` call doubled, so
 * what is asserted is what is delivered and not what a regex returns.
 *
 * The production shape: an English-medium Pakistan Studies lesson naming Quaid-e-Azam Mohammad
 * Ali Jinnah. The Urdu lane clears `محمد علی جناح` off the G5c review; the Latin lane had no such
 * list, so the ladder burned every round on a name no teacher would change, and `authorLessonPlan`
 * threw — the teacher got nothing. 436 unhonorified Latin occurrences sit on 192 pages of the
 * Grades 6-12 corpus.
 *
 * The other direction is the one that matters more: a Latin name the review did NOT clear must
 * still refuse, end to end. Brief §4c / G5c — the automated gate never clears religious content.
 *
 * The REAL list ships EMPTY and is with Amena for sign-off, so a FIXTURE clearance stands in.
 */

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

// `person` clears; `prophet` never clears and only arbitrates. Both halves are driven below.
jest.mock('../../bot/vendor/lp-v9/g5c_cleared_names_en.json', () => ({
  person: ['Mohammad Ali Jinnah'],
  prophet: ['Hazrat Muhammad'],
}));

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

describe('L — a cleared Latin name reaches the teacher, in round 0', () => {
  test('the Quaid, in the sentence a Pakistan Studies lesson writes, is delivered lint-clean', async () => {
    // Red on this branch's base: the ladder runs out of rounds and `authorLessonPlan` throws.
    create.mockResolvedValue(reply(enDoc(
      'Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('the possessive the prose actually uses is delivered too', async () => {
    create.mockResolvedValue(reply(enDoc(
      'Mohammad Ali Jinnah’s vision shaped the new state.')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });
});

describe('M — a Latin name the review did not clear is STILL refused, end to end', () => {
  test('the Prophet named without his salutation never reaches a teacher', async () => {
    create.mockResolvedValue(reply(enDoc('Muhammad taught his companions patience.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('an unreviewed name of the SAME SHAPE as the cleared one is still refused', async () => {
    // The protection. `Mohammad` opening a compound name is not, by itself, a clearance — only
    // the decided rows are. If this ever delivers, the gate has started deciding for the reviewer.
    create.mockResolvedValue(reply(enDoc('Mohammad Ali Bogra became Prime Minister in 1953.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('a phrase the reviewer marked `prophet` never clears, however it is written', async () => {
    create.mockResolvedValue(reply(enDoc('Hazrat Muhammad was born in Makkah.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });
});
