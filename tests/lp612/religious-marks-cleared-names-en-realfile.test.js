/*
 * bd-5t71f — the REAL clearance file, not a fixture.
 *
 * `religious-marks-cleared-names-en.test.js` mocks `g5c_cleared_names_en.json` so it can prove the
 * MECHANISM in isolation. That mock means those suites stay green whatever the real file contains
 * — including the empty file the mechanism shipped with. So they cannot tell us the one thing that
 * matters now: whether the reviewer's decided list is actually installed and actually moves the
 * gate.
 *
 * This suite deliberately does NOT mock. It loads the shipped file and drives the real gate.
 *
 * It asserts DATA, not judgement. Gate G5c: "automated checks do NOT clear religious content: the
 * native-speaker review remains a hard hold before any teacher delivery." Every expectation below
 * is a transcription of a Y/N written by Amena Ahmed, the named reviewer of record, on
 * `08_Grades 6-12 LP Build/_g5c_english_name_lane_2026-09-17/English-name-list-ANSWER-SHEET.md`.
 * Nothing here decides which Mohammad is which — it checks that what she decided is what ships.
 */
const CLEARED = require('../../bot/vendor/lp-v9/g5c_cleared_names_en.json');
const { withProse, setSecondProse, blocked, fails } = require('./helpers/religious-marks');

// The trigger that puts the document in religious scope, so the lane under test is reached at all.
const TRIGGER = 'سیرت کا سبق: نبی کریم ﷺ کی زندگی';

const refused = (prose) => blocked(setSecondProse(withProse(TRIGGER), prose));

describe('the shipped English clearance file is the reviewer\'s, and is complete', () => {
  it('is DECIDED, not the empty file the mechanism shipped with', () => {
    expect(CLEARED.status).toBe('DECIDED');
    expect(CLEARED.decided_by).toBe('Amena Ahmed');
    expect(CLEARED.person.length + CLEARED.prophet.length).toBeGreaterThan(0);
  });

  it('carries every one of the 134 candidate rows, with none left undecided', () => {
    expect(CLEARED.counts).toMatchObject({ rows: 134, prophet: 15, person: 119, undecided: 0 });
    expect(CLEARED.person).toHaveLength(134 - 15);
    expect(CLEARED.prophet).toHaveLength(15);
    expect(CLEARED.undecided_rows).toEqual([]);
  });

  it('keeps the two lists disjoint — no phrase is both cleared and blocking', () => {
    const both = CLEARED.person.filter((p) => CLEARED.prophet.includes(p));
    expect(both).toEqual([]);
  });
});

describe('names she marked N are no longer refused in English prose', () => {
  it('Muhammad Ali Jinnah — the Quaid, in a Pakistan Studies lesson', () => {
    expect(refused('Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.')).toBe(false);
    expect(refused('Muhammad Ali Jinnah addressed the League at Lahore.')).toBe(false);
  });

  it('Muhammad Educational Conference — an institution, not a person', () => {
    expect(refused('The Muhammad Educational Conference met in Aligarh that year.')).toBe(false);
  });

  it('Muhammad ibn Ali — a historical figure in an Abbasid lesson', () => {
    expect(refused('Muhammad ibn Ali was an ancestor of the Abbasid caliphs.')).toBe(false);
  });

  it('matches case-folded, because the books print names in headings too', () => {
    // NOT `MOHAMMAD ALI JINNAH` — the gate's TRANSLIT_PROPHET_RE has no /i flag, so a fully
    // upper-case name is invisible to it and such a string would pass here vacuously, whatever
    // this file contained. That blind spot is bd-6zbts (sized: 7 occurrences, all benign).
    // This asserts the case-folding the CLEARANCE does, on a form the gate genuinely sees.
    expect(refused('Muhammad Ali JINNAH and the Pakistan Movement')).toBe(false);
  });
});

describe('FAIL-CLOSED — what she marked Y is still refused, and unreviewed names still are', () => {
  it('the bare token Muhammad stays blocking — she ruled it MIXED and chose to fail safe', () => {
    expect(CLEARED.prophet).toContain('Muhammad');
    expect(refused('The teacher explains what Muhammad said to his companions.')).toBe(true);
  });

  it('a name she never saw is not cleared by this file', () => {
    expect(refused('Muhammad Zubair Farooqi addressed the gathering.')).toBe(true);
  });

  it('the longest decided phrase rules: Jinnah clears although bare Muhammad blocks', () => {
    // This is the whole reason the matching is keyed on the word SEQUENCE. If the bare token won,
    // marking it PROPHET to fail safe would have re-refused every ordinary person in the list.
    expect(refused('Muhammad Ali Jinnah spoke; Muhammad Zubair Farooqi replied.')).toBe(true);
    expect(refused('Muhammad Ali Jinnah addressed the League.')).toBe(false);
  });
});

describe('KNOWN GAP, guarded not fixed — the Latin honorific (bd-b7txa)', () => {
  /*
   * She marked rows 72 and 73 (`Hazrat Muhammad PBUH` / `... SAW`) PROPHET, which is correct: they
   * denote the Prophet. The consequence is that a line the BOOK saluted correctly stays refused,
   * because the gate's honorific test recognises only the single glyph and the Arabic form. That
   * is bd-b7txa and is explicitly out of this bead's scope. Guarded here so the day it is fixed,
   * this test fails and someone reads the bead rather than silently widening the clearance.
   */
  it('a correctly-saluted PBUH line is still refused today', () => {
    expect(CLEARED.prophet).toContain('Hazrat Muhammad PBUH');
    expect(refused('Hazrat Muhammad PBUH taught his companions patience.')).toBe(true);
  });

  it('the file records the gap rather than papering over it', () => {
    expect(JSON.stringify(CLEARED.reviewer_notes)).toContain('bd-b7txa');
  });
});

describe('the clearance is traceable back to the human who gave it', () => {
  it('names the reviewer of record and the sheet it was transcribed from', () => {
    expect(CLEARED.reviewer_role).toMatch(/native-speaker reviewer of record for gate G5c/);
    expect(CLEARED.source_file).toMatch(/English-name-list-ANSWER-SHEET\.md$/);
    expect(CLEARED.source_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves her reasoning on the two rows where she wrote some', () => {
    expect(CLEARED.reviewer_notes.Muhammad).toMatch(/Sultan is normal person|MIXED/);
    expect(CLEARED.reviewer_notes.Rasul).toMatch(/after Rasul/);
  });

  it('does not block on a plain lesson with no religious content at all', () => {
    expect(fails(withProse('Students will solve two-step equations.'))
      .filter((f) => String(f).includes('RELIGIOUS_MARKS'))).toEqual([]);
  });
});
