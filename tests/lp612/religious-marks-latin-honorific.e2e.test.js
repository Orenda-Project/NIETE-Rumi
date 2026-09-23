/**
 * E2E — bd-b7txa, ACCEPT-AND-NORMALISE, AT THE LAYER THE TEACHER FEELS.
 *
 * Operator ruling, 2026-09-23. Asked whether a Latin PBUH/SAW should satisfy the gate she answered
 * "Yes it should", and when shown that the only way to make it satisfy the gate AS WRITTEN is to
 * delete PBUH/SAW from ABBREV_RE — reversing her own 2026-09-17 "must be our stamp" and the
 * bd-6tfw6 "go on option 1" tuning, both quoted in lint_lp.js — she ruled: "go with your
 * recommendation". That is accept-and-normalise.
 *
 * THE GATE IS NOT LOOSENED BY THIS COMMIT. ABBREV_RE is untouched. The document is NORMALISED
 * before it reaches the gate: a Latin honorific abbreviation sitting against a Prophet name is
 * rewritten to the stamp, and the gate then passes it on its existing rule. An abbreviation the
 * normaliser does not convert is still refused — fail-closed, with the gate as the backstop rather
 * than the thing being relaxed.
 *
 * The two production shapes, both measured in the Grades 6-12 page-truth corpus:
 *   grade_9_mathematics p.258   "Probability of a new prophet after Hazrat Muhammad (SAW) is 0."
 *   grade_10_pak_studies p.016  "... the Holy Prophet Hazrat Muhammad (PBUH) and maintaining ..."
 *
 * This suite asserts BOTH halves of the ruling: the lesson is delivered, AND what is delivered
 * carries ﷺ and no longer carries "(PBUH)". Delivering the abbreviation would honour half a
 * ruling and break the other half.
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

/** The delivered string, read back off the document the teacher's PDF is rendered from. */
const delivered = (out) => out.lpDoc.sections
  .find((s) => (s.blocks || []).some((b) => b.type === 'key_points'))
  .blocks.find((b) => b.type === 'key_points').items[0];

describe('P — the book\'s Latin salutation is accepted, and delivered as the stamp', () => {
  test('grade 9 Maths: "(SAW)" is delivered as ﷺ, in round 0', async () => {
    // Red on this branch's base: ABBREV_RE fires, the ladder runs out, authorLessonPlan throws.
    create.mockResolvedValue(reply(enDoc(
      'Probability of a new prophet after Hazrat Muhammad (SAW) is 0.')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
    expect(delivered(out)).toBe('Probability of a new prophet after Hazrat Muhammad ﷺ is 0.');
  });

  test('grade 10 Pak Studies: "(PBUH)" is delivered as ﷺ', async () => {
    create.mockResolvedValue(reply(enDoc(
      'The order stresses the importance of following the Sunnah of the Holy Prophet '
      + 'Hazrat Muhammad (PBUH) and maintaining a balance.')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    // Both halves of the ruling: accepted, AND what she receives is the stamp.
    expect(delivered(out)).toContain('Hazrat Muhammad ﷺ and maintaining');
    expect(delivered(out)).not.toContain('PBUH');
  });
});

describe('Q — the gate is still the backstop, not the thing that was relaxed', () => {
  test('an abbreviation NOT against a Prophet name is still refused, end to end', async () => {
    // Nothing licenses rewriting this one, so ABBREV_RE sees it exactly as it did before.
    create.mockResolvedValue(reply(enDoc(
      'The teachings were recorded by his companions (PBUH) in later collections.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/abbreviates an honorific/);
  });

  test('the Prophet named with NO honorific at all is still refused', async () => {
    create.mockResolvedValue(reply(enDoc('Muhammad taught his companions patience.')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });
});
