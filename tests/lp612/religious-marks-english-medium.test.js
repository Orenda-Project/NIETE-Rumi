/**
 * THE SCRIPT MANDATE IS AN URDU-MEDIUM RULE, NOT A UNIVERSAL ONE — bd-b8ypq (P1, 2026-09-14).
 *
 * `religiousMarks` rule 2 failed any document that wrote a sacred name in Latin script, and the
 * message told the author "These are set in Urdu/Arabic script as the book prints them". The rule
 * had no language guard, and the claim is false for an English book: Grade 6 English, Unit 1A
 * prints "Hazrat Muhammad" and "Khadijah radiallahu anha" in Latin script, because that is an
 * English book. Under the gate the author rewrote every one of them into Urdu script, and the
 * operator's report was simply "this isnt right".
 *
 * The gate's own comment at TRANSLIT_RE says it: "Latin script has no place in a sacred name on an
 * URDU religious page". Nothing checked whether the page was Urdu. `religiousMarks` never read a
 * language at all, even though `provenance.medium` is a required schema field.
 *
 * What survives the guard, because none of it is about script:
 *   - an ABBREVIATED honorific (PBUH, SAW, SAWW, RA) is still refused in either medium. §4c.5 bans
 *     abbreviation in its own right — "never de-pointed, abbreviated, transliterated or dropped".
 *   - the honorific itself is still demanded after the Prophet's name on an English page. Rule 1
 *     only knows the Urdu-script tokens, so an English lesson would otherwise have been left with
 *     no honorific rule at all once the script mandate stopped forcing the name into Urdu.
 *
 * Red-first: on this branch's base, test 1 reports RELIGIOUS_MARKS and test 5 does not.
 *
 * ── THE HOUSE STYLE FOR A COMPANION, added after the operator read the first fix's behaviour ──
 *
 * The fix above left companions entirely unconstrained on an English page: "Khadijah radiallahu
 * anha" and "Khadijah (may Allah be pleased with her)" both passed, because COMPANION_RE keys on
 * the literal "حضرت <name>" and cannot see a Latin name at all. Shown that table the operator
 * ruled: "for companions the salutation should be in urdu script as well".
 *
 * So the English lane splits the two halves of the phrase, which is exactly what the ﷺ row already
 * does for the Prophet: the NAME keeps the Latin spelling the English book prints, and the
 * SALUTATION is set in Urdu/Arabic script. "Khadijah رضی اللہ عنہا" — not "Khadijah radiallahu
 * anha", and not "Khadijah (may Allah be pleased with her)".
 *
 * This is a ban on the transliterated salutation, NOT a demand that every companion name carry one.
 * Demanding it would need a corpus of Latin companion names, which is the false-positive machine
 * rule 3 was written to avoid — a bare "Khadijah" in an English lesson is still the reviewer's call.
 *
 * The PROPHET's spelled-out "(peace be upon him)" is deliberately left passing. The operator asked
 * about companions and quoted the ﷺ row approvingly; making the same argument for the Prophet is a
 * one-line change she can call for separately, so it is pinned by a test rather than assumed.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

/** A religious document in `medium`, whose next_period line carries `text`. */
function docSaying(text, medium = 'en') {
  const d = JSON.parse(raw);
  d.provenance.medium = medium;
  d.needs_human_review = true;
  d.human_review_reason = 'Biography of the Prophet ﷺ — native-speaker review.';
  // Keeps `isReligious` true independently of what the case under test says, so a test about a
  // MISSING honorific is not silently answered by the gate returning early.
  d.page2.not_going = 'Unit 1A is the life of حضرت محمد ﷺ — the migration waits for Unit 2.';
  d.page2.next_period = text;
  return d;
}
const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

describe('RELIGIOUS_MARKS — Latin script is correct on an English-medium lesson', () => {
  it('does not rewrite the NAMES — Hazrat Muhammad, Khadijah — into Urdu script', () => {
    const got = codes(docSaying(
      'Write the order on the board: Hazrat Muhammad صلى الله عليه وسلم was known for honesty, '
      + 'and married Khadijah رضی اللہ عنہا at the age of 25.'));
    expect(got).not.toContain('RELIGIOUS_MARKS');
  });

  it('accepts the ligature form of the honorific on an English page too', () => {
    expect(codes(docSaying('The biography of Hazrat Muhammad ﷺ opens in Makkah.')))
      .not.toContain('RELIGIOUS_MARKS');
  });

  it('still refuses Latin script on an URDU-medium lesson', () => {
    expect(codes(docSaying('Hazrat Muhammad صلى الله عليه وسلم ka aswa.', 'ur')))
      .toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('آپ ﷺ نے Allah کا ذکر کیا۔', 'ur')))
      .toContain('RELIGIOUS_MARKS');
  });

  it('refuses an ABBREVIATED honorific in either medium — §4c.5 bans abbreviation itself', () => {
    expect(codes(docSaying('Hazrat Muhammad (PBUH) was known for honesty.'))).toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('Hazrat Muhammad (SAW) was known for honesty.'))).toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('آپ ﷺ کا نام۔ Muhammad (PBUH).', 'ur'))).toContain('RELIGIOUS_MARKS');
  });

  it('still demands the honorific after a Latin-script Prophet name on an English page', () => {
    expect(codes(docSaying('The biography of Muhammad opens in Makkah.'))).toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('Hazrat Mohammad was known for honesty.'))).toContain('RELIGIOUS_MARKS');
  });

  it('leaves a non-religious English lesson alone', () => {
    const d = JSON.parse(raw);
    expect(codes(d)).not.toContain('RELIGIOUS_MARKS');
  });
});

describe("RELIGIOUS_MARKS — a companion's SALUTATION is Urdu script even on an English page", () => {
  it('accepts the Latin name carrying the Urdu salutation', () => {
    for (const t of [
      'He married Khadijah رضی اللہ عنہا at the age of twenty-five.',
      'Abu Bakr رضی اللہ عنہ led the first hajj.',
      'Ask the class what Umar رضی اللہ عنہ did when he heard the news.',
    ]) expect(codes(docSaying(t))).not.toContain('RELIGIOUS_MARKS');
  });

  it('refuses a TRANSLITERATED companion salutation', () => {
    for (const t of [
      'He married Khadijah radiallahu anha at the age of twenty-five.',
      'He married Khadijah radi Allahu anha at the age of twenty-five.',
      'He married Khadijah raziallahu anha at the age of twenty-five.',
      'Abu Bakr rehmatullah alayh is buried beside him.',
      'Ask about Hazrat Isa alayhis salam in the same unit.',
    ]) expect(codes(docSaying(t))).toContain('RELIGIOUS_MARKS');
  });

  it('refuses the salutation TRANSLATED into English — it is a salutation, not prose', () => {
    for (const t of [
      'He married Khadijah (may Allah be pleased with her) at the age of twenty-five.',
      'Abu Bakr, may Allah be pleased with him, led the first hajj.',
    ]) expect(codes(docSaying(t))).toContain('RELIGIOUS_MARKS');
  });

  it("leaves the PROPHET's spelled-out honorific alone — the operator ruled on companions only", () => {
    // Deliberately NOT changed here. "Hazrat Muhammad (peace be upon him)" passes today, the
    // operator quoted the ﷺ row approvingly without asking for this one, and tightening it is a
    // one-line change she can call for separately. Pinned so the decision is visible, not implied.
    expect(codes(docSaying('Hazrat Muhammad (peace be upon him) was known for honesty.')))
      .not.toContain('RELIGIOUS_MARKS');
  });

  it('does not DEMAND a salutation after a bare Latin companion name', () => {
    // Rule 3's whole design is to avoid a corpus of names and the false positives it brings. A bare
    // "Khadijah" on an English page is still the native-speaker reviewer's call, not the gate's.
    expect(codes(docSaying('He married Khadijah at the age of twenty-five.')))
      .not.toContain('RELIGIOUS_MARKS');
  });

  it('leaves ordinary English prose that merely mentions Allah alone', () => {
    // `Allah` in Latin script is what an English book prints, and rule 2 keeps allowing it on `en`.
    expect(codes(docSaying('The lesson opens with the meaning of the word Allah.')))
      .not.toContain('RELIGIOUS_MARKS');
  });
});
