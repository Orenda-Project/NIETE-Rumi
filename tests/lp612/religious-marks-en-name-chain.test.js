/*
 * bd-6ld74 — the CHAINED name on an ENGLISH page.
 *
 * The Urdu lane learned this on the G5c Q3 ruling (operator, 2026-09-17: "For English keep the
 * name as shown in the page truth Hazrat Muhammad (salutation) ... it should stay as shown in the
 * book but with our salutation stamp/script"): a chained name carries ONE salutation and it sits
 * at the END of the chain, so `skipNameChain()` (lint_lp.js) moves WHERE the gate looks. The
 * English lane never got that fix, and its honorific test still anchors immediately after the
 * matched name word.
 *
 * The books print the chain in Latin with the salutation in Arabic script, which is exactly what
 * §4c.5 asks for — and the gate refuses it:
 *
 *     "Hazrat Muhammad Rasulullah صلى الله عليه وسلم - An Embodiment of Justice"
 *
 * 15 of the 18 measured LATER occurrences in the Grades 6-12 page-truth corpus are this one shape
 * — 14 in grade_8_english (the unit title, on three pages) and 1 in grade_9_english (a hadith
 * attribution). Measurement: `08_Grades 6-12 LP Build/_b7txa_latin_honorific_2026-09-23/`.
 *
 * THIS SUITE MUST NOT BE READ AS WIDENING WHAT COUNTS AS A SALUTATION. It moves the window and
 * nothing else, so the FAIL-CLOSED half below is the more important half: a chain that runs out
 * with no salutation at its end is still refused, at the original match, exactly as before.
 */
const { blocked, withProse, setSecondProse } = require('./helpers/religious-marks');

// Puts the document in religious scope so the lane under test is reached at all. The fixture is
// `provenance.medium: "en"`, which is what selects the English lane in check 2.
const TRIGGER = 'سیرت کا سبق: نبی کریم ﷺ کی زندگی';

const refused = (prose) => blocked(setSecondProse(withProse(TRIGGER), prose));

describe('the book saluted at the END of the chain, and the gate must read that far', () => {
  it('grade 8 English: the unit title, exactly as the book prints it', () => {
    expect(refused('Hazrat Muhammad Rasulullah صلى الله عليه وسلم - An Embodiment of Justice'))
      .toBe(false);
  });

  it('grade 9 English: the hadith attribution, salutation in parentheses', () => {
    expect(refused('Abu Hurairah reports Hazrat Muhammad Rasulullah (ﷺ) as saying that a '
      + 'traveller who was thirsty found a well in the way.')).toBe(false);
  });

  it('the adjacent case is untouched — it passed before and still passes', () => {
    expect(refused('Hazrat Muhammad ﷺ taught his companions patience.')).toBe(false);
  });
});

describe('FAIL-CLOSED — the window moved; the requirement did not', () => {
  it('a chain that ENDS with no salutation is still refused', () => {
    expect(refused('Hazrat Muhammad Rasulullah taught his companions patience.')).toBe(true);
  });

  it('the bare name with no salutation is still refused, identically to before', () => {
    expect(refused('Muhammad taught his companions patience.')).toBe(true);
  });

  it('an ordinary word after the name does not start a chain, so nothing is skipped', () => {
    // If the skip accepted any word, a salutation belonging to a LATER sentence would clear this.
    expect(refused('Muhammad Zubair addressed the gathering. Nabi Kareem ﷺ said so.')).toBe(true);
  });

  it('the salutation still has to be the stamp — a Latin one does not close the chain', () => {
    // Operator, 2026-09-17: "must be our stamp". Widening the window may not widen the alphabet.
    expect(refused('Hazrat Muhammad Rasulullah peace be upon him taught patience.')).toBe(true);
  });
});
