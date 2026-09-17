/**
 * RELIGIOUS_MARKS — THE ENGLISH LANE. Two operator rulings, one file.
 *
 * On an English-medium page the gate splits a sacred mention in two: the NAME keeps the Latin
 * spelling the book prints, and the SALUTATION is ours. Both halves are the operator's rulings
 * under brief §4c / gate G5c, not inferences from the code — automated checks do not clear
 * religious content, so the rules here exist because she decided them.
 *
 *   G (bd-xo6mb) — "For English keep the name as shown in the page truth… it should stay as shown
 *                   in the book but with our salutation stamp/script"
 *   H (bd-c61xh) — the follow-up question, asked because the ruling above did not settle it:
 *                   does the spelled-out English "(peace be upon him)" still count as a
 *                   salutation? Answer: "must be our stamp".
 *
 * Split out of `religious-marks-false-positives.test.js` when describe G took that file past the
 * 300-line limit. The harness is shared, not copied — see `helpers/religious-marks.js`.
 */

const { religious, blocked, withProse, setSecondProse } = require('./helpers/religious-marks');

describe('G — English keeps the name the book prints, and carries our salutation stamp', () => {
  // OPERATOR RULING, 2026-09-17 (G5c native-speaker review, bd-zipoe packet, Q3):
  //   "For English keep the name as shown in the page truth Hazrat Muhammad (salutation) or
  //    'By Allah, if Fatima, the daughter of Muhammad (salutation), the justice of Hazrat
  //    Muhammad (salutation) should be enforced dont write the English text in urdu, it should
  //    stay as shown in the book but with our salutation stamp/script"
  //
  // Two halves, and only one of them is a code defect.
  //
  // THE JUDGEMENT HALF is already what the gate does: on an English page the NAME keeps its Latin
  // spelling and the SALUTATION is our stamp. The tests here pin that, because the rule now has an
  // explicit ruling behind it rather than only a source comment, and because a future narrowing of
  // the English lane would silently break it.
  //
  // THE MECHANICAL HALF is the defect. grade_8_english.c01.p009-012.reading_comprehension carries
  // three v9.2 fails on "the justice of حضرت محمد رسول اللہ ﷺ: the compani…". The honorific IS
  // there. محمد رسول اللہ is a CHAINED name — one salutation closes the whole chain, which is how
  // it is written — but HONORIFIC_RE is anchored immediately after each token, so the gate demands
  // a second ﷺ in the middle of the chain and refuses a line that is correct as printed.
  const TRIGGER = 'سیرت کا سبق';

  it('G1 — "محمد رسول اللہ ﷺ" is one chained name closed by one salutation', () => {
    expect(blocked(withProse('حضرت محمد رسول اللہ ﷺ کا فرمان'))).toBe(false);
  });

  it('G1 — the production Grade 8 line, mixed English and Urdu', () => {
    const d = setSecondProse(withProse(TRIGGER),
      'the justice of حضرت محمد رسول اللہ ﷺ: the companions saw it daily');
    expect(blocked(d)).toBe(false);
  });

  it('G1 — a three-token chain closes on one salutation: "نبی کریم محمد مصطفیٰ ﷺ"', () => {
    expect(blocked(withProse('نبی کریم محمد مصطفیٰ ﷺ کا ذکر'))).toBe(false);
  });

  it('STILL blocks a chain that never reaches a salutation', () => {
    // The whole point of check 1. If a chain can absorb the requirement without ever satisfying
    // it, the gate has been turned off rather than corrected.
    expect(blocked(withProse('حضرت محمد رسول اللہ کا فرمان یاد رکھیں'))).toBe(true);
  });

  it('STILL blocks a single bare token — the chain rule changes nothing there', () => {
    expect(blocked(withProse('نبی کریم کا فرمان یاد رکھیں'))).toBe(true);
  });

  it('G2 — an English page keeps "Hazrat Muhammad ﷺ" exactly as the book prints it', () => {
    const d = setSecondProse(withProse(TRIGGER),
      'Read the sentence: "the justice of Hazrat Muhammad ﷺ should be enforced".');
    expect(blocked(d)).toBe(false);
  });

  it('G2 — "the daughter of Muhammad ﷺ" passes with the Latin name intact', () => {
    const d = setSecondProse(withProse(TRIGGER),
      'Read the sentence: "By Allah, if Fatima, the daughter of Muhammad ﷺ, stole…"');
    expect(blocked(d)).toBe(false);
  });

  it('G2 — the bare Latin name is still caught, and is told to keep its spelling', () => {
    // The production v9.6 fail. Under the ruling this refusal is CORRECT — the salutation is
    // missing and must be added. What must never happen is the author being told to write the
    // English sentence in Urdu.
    const d = setSecondProse(withProse(TRIGGER),
      'Read the sentence: "By Allah, if Fatima, the daughter of Muhammad, stole…"');
    const msgs = religious(d);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join('\n')).toMatch(/keeps the spelling the book prints/);
  });
});

describe('H — "(peace be upon him)" is not our stamp', () => {
  // OPERATOR RULING, 2026-09-17, answering the one question Q3 left open:
  //
  //   Q: Q3 says English keeps the book's spelling "but with our salutation stamp/script". The
  //      gate ALSO accepts the written-out English "(peace be upon him)". Does that still count?
  //   A: "must be our stamp"
  //
  // So the English lane keeps exactly ONE thing in Latin script — the NAME. The salutation is the
  // ligature in either medium, which is the same split already applied to companions ("Khadijah
  // رضی اللہ عنہا", never "Khadijah radiallahu anha").
  //
  // This is a TIGHTENING, and tightenings are where a gate quietly starts refusing real lessons.
  // So the block below pins both directions: the English phrase no longer passes, AND every form
  // that must keep passing still does.
  const TRIGGER = 'سیرت کا سبق';

  it('H1 — the spelled-out English phrase no longer satisfies the gate', () => {
    const d = setSecondProse(withProse(TRIGGER),
      'Read the sentence: "the justice of Hazrat Muhammad (peace be upon him) should be enforced".');
    expect(blocked(d)).toBe(true);
  });

  it('H1 — without the brackets either', () => {
    const d = setSecondProse(withProse(TRIGGER), 'Muhammad peace be upon him said that justice is a duty.');
    expect(blocked(d)).toBe(true);
  });

  it('H1 — and the author is told to write the stamp, not to write the sentence in Urdu', () => {
    // The failure message is the whole repair path. If it named Urdu script here it would
    // re-create the bd-b8ypq defect the English lane exists to prevent.
    const d = setSecondProse(withProse(TRIGGER),
      'Read the sentence: "the justice of Hazrat Muhammad (peace be upon him) should be enforced".');
    const msgs = religious(d).join('\n');
    expect(msgs).toMatch(/ﷺ/);
    expect(msgs).toMatch(/keeps the spelling the book prints/);
  });

  it('H2 — the stamp itself still passes, which is the whole point of the ruling', () => {
    const d = setSecondProse(withProse(TRIGGER),
      'Read the sentence: "the justice of Hazrat Muhammad ﷺ should be enforced".');
    expect(blocked(d)).toBe(false);
  });

  it('H2 — the written-out Urdu salutation still passes', () => {
    const d = setSecondProse(withProse(TRIGGER), 'Muhammad صلی اللہ علیہ وسلم taught justice.');
    expect(blocked(d)).toBe(false);
  });

  it('H3 — "PBUH" is still refused, and is no longer told to write the English phrase', () => {
    // ABBREV_RE's message used to offer "peace be upon him" as an acceptable expansion. Left
    // alone it would send the author straight into H1 — the gate instructing its way into its own
    // refusal, which is exactly the loop that burns revision rounds and delivers nothing.
    const d = setSecondProse(withProse(TRIGGER), 'Muhammad (PBUH) taught justice.');
    const msgs = religious(d).join('\n');
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs).not.toMatch(/peace be upon him/i);
  });
});
