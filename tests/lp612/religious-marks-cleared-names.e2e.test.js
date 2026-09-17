/**
 * E2E — THE G5c CLEARED-NAME LIST, AT THE LAYER THE TEACHER FEELS. bd-zipoe (P1).
 *
 * The unit suite proves the gate stops demanding ﷺ after a name the native-speaker review
 * cleared. This one proves the LESSON REACHES THE TEACHER: it drives the real authoring path
 * (`authorLessonPlan` → revision ladder → `lint`), with only the LLM `create` call doubled, so
 * what is asserted is what is delivered and not what a regex returns.
 *
 * The production case: grade_10_urdu.p2c05.p135-135.tafheem carried four teacher-facing
 * RELIGIOUS_MARKS fails on `سیّد ولی محمد` — Nazeer Akbarabadi's real name — and burned the whole
 * revision ladder on a sentence the books print correctly.
 *
 * The other direction is the one that matters more: a name the review did NOT clear must still
 * refuse, end to end. Brief §4c / G5c — the automated gate never clears religious content.
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

describe('J — a cleared name reaches the teacher, in round 0', () => {
  test('the production Grade 10 sentence is delivered, lint-clean, with no revision round', async () => {
    // Red on this branch's base: the ladder runs out of rounds and `authorLessonPlan` throws, so
    // the teacher gets nothing for a name the reviewer decided on 2026-09-17.
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: نظیر اکبرآبادی کا اصل نام سیّد ولی محمد اور تخلص نظیر تھا')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('the bare board line — four words, no sentence around it — is delivered too', async () => {
    // /page2/board_final/diagram/steps/1/lines/0 in production was exactly this string.
    create.mockResolvedValue(reply(religiousDoc('سیرت کا سبق: سیّد ولی محمد')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });
});

describe('K — a name the review did not clear is STILL refused, end to end', () => {
  test('the Prophet named without his salutation never reaches a teacher', async () => {
    create.mockResolvedValue(reply(religiousDoc('سیرت کا سبق: حضرت محمد نے صبر کی تلقین کی')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('an unreviewed name of the SAME SHAPE as the cleared one is still refused', async () => {
    // The protection. `محمد` closing a compound name is not, by itself, a clearance — only the
    // 298 decided rows are. If this ever delivers, the gate has started deciding for the reviewer.
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: استاد زوار الخوارزمی محمد نے کلاس لی')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });
});
