/**
 * E2E — THE ENGLISH-MEDIUM RULINGS, AT THE LAYER THE TEACHER FEELS. bd-xo6mb, bd-c61xh.
 *
 * Split out of `religious-marks-delivery.e2e.test.js` when describe H took that file past the
 * 300-line limit. Same harness, same real authoring path — only the LLM `create` call is doubled,
 * so what is asserted is what the teacher receives, not what a regex returns.
 *
 * Two operator rulings live here, both from the G5c native-speaker review of 2026-09-17:
 *   Q3 — "For English keep the name as shown in the page truth ... dont write the English text in
 *        urdu, it should stay as shown in the book but with our salutation stamp/script"  (G)
 *   the stamp ruling — "must be our stamp"                                               (H)
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

describe('G — a chained name reaches the teacher on its one salutation', () => {
  // G5c ruling Q3 (operator, 2026-09-17): "For English keep the name as shown in the page truth
  // Hazrat Muhammad (salutation) ... dont write the English text in urdu, it should stay as shown
  // in the book but with our salutation stamp/script".
  //
  // What production showed: grade_8_english.c01.p009-012.reading_comprehension carries three v9.2
  // fails on one sentence — "the justice of حضرت محمد رسول اللہ ﷺ: the compani…" — where the
  // salutation IS present. The gate was asking for a second ﷺ in the middle of the chained name,
  // so the author could not satisfy it without writing something the books do not print.
  //
  // These drive the real authoring path, only the LLM call doubled, so what is asserted is what
  // the teacher receives.

  test('the production Grade 8 sentence is delivered, lint-clean, in round 0', async () => {
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: the justice of حضرت محمد رسول اللہ ﷺ: the companions saw it daily')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('an English sentence keeps its Latin name and our stamp, and is delivered', async () => {
    // The ruling's other half, end to end: the book's spelling survives to the teacher. If this
    // ever fails the gate has started demanding the English text be rewritten in Urdu.
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: By Allah ﷻ, if Fatima, the daughter of Muhammad ﷺ, stole, I would punish her')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });

  test('a chain that never reaches a salutation is STILL refused', async () => {
    // The protection. A chain must not be able to absorb the requirement without meeting it.
    create.mockResolvedValue(reply(religiousDoc('حضرت محمد رسول اللہ کا فرمان یاد رکھیں')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('the bare Latin name is STILL refused, and is told to keep the book spelling', async () => {
    // The v9.6 production fail. Under the ruling this refusal is CORRECT — the salutation is
    // missing. What must never happen is the author being told to write the sentence in Urdu.
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: By Allah ﷻ, if Fatima, the daughter of Muhammad, stole, I would punish her')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/keeps the spelling the book prints/);
  });
});

describe('H — "(peace be upon him)" is not our stamp, end to end', () => {
  // The ruling (operator, 2026-09-17), answering the one question the Q3 work left open: the gate
  // also accepted the spelled-out English "(peace be upon him)". Her answer was "must be our
  // stamp". So an English lesson keeps the Latin NAME the book prints — that is Q3 and describe G
  // above — but the SALUTATION is ﷺ, in every medium.

  test('a lesson whose only honorific is the English phrase does NOT reach the teacher', async () => {
    // Red on the base branch: the phrase satisfied TRANSLIT_HONORIFIC_RE, so this was delivered.
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: By Allah ﷻ, if Fatima, the daughter of Muhammad (peace be upon him), stole, I would punish her')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('and the author is told to write the stamp, not the English phrase', async () => {
    // The consequence that actually costs rounds: if the refusal message keeps OFFERING the phrase
    // the gate now refuses, the ladder is being instructed straight back into its own refusal and
    // the segment burns every round before landing undeliverable.
    //
    // The vehicle is a BARE name, and the choice is load-bearing twice over. It was
    // 'Muhammad (PBUH)' until bd-b7txa, which normalises that to the stamp before the gate reads
    // it — so it now delivers, correctly, and can no longer carry a refusal. And it cannot be
    // 'Muhammad (peace be upon him)' either: the message QUOTES the offending excerpt, so the
    // phrase would appear in it whatever the advice said, and the `not.toMatch` below would be
    // asserting the quote instead of the instruction. A bare name refuses on the same rule and
    // leaves the advice text as the only place the phrase could come from, which is the subject.
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: the teachings of Muhammad are studied in this chapter')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/ﷺ/);
    expect(message).not.toMatch(/peace\s+be\s+upon\s+him/i);
  });

  test('the stamp itself still delivers, which is the whole point of the ruling', async () => {
    create.mockResolvedValue(reply(religiousDoc(
      'سیرت کا سبق: By Allah ﷻ, if Fatima, the daughter of Muhammad ﷺ, stole, I would punish her')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });
});
