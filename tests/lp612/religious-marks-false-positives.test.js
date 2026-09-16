/**
 * RELIGIOUS_MARKS REFUSED THREE REAL LESSONS AND SENT THE TEACHER NOTHING — bd-kpqu6.
 *
 * On 2026-09-15 every `status='failed'` row in `niete_lp612_renders` — all three of them, all
 * non-Islamiat — was this gate firing on a document that was fine. The teacher got no plan at
 * all, and two of the three segments could never have passed on any retry.
 *
 * Three independent defects produced them. Each gets its own describe block, and each block
 * asserts the REAL violation still blocks, because the point of bd-qzitp is not negotiable:
 * the Prophet named without an honorific in the lesson body must never reach a teacher.
 *
 *   A. PROPHET_RE had no word boundary, so "نبی" matched inside "انبیاء" — the ordinary plural
 *      "prophets". `سیرتِ انبیاء` is a stock chapter title; the gate read it as an unhonorified
 *      mention of the Prophet and refused the lesson. Arabic script has no usable \b, so the
 *      boundary is "not flanked by an Arabic LETTER", with diacritics and honorific signs left
 *      out of the class so "نبی ﷺ" still matches.
 *
 *   B. TRANSLIT_RE was applied to English strings. Its own rule reads "Latin script has no place
 *      in a sacred name ON AN URDU RELIGIOUS PAGE" — but on an English page, "Muhammad" is how
 *      the name is correctly printed. A Grade 6 History SLO quoting the curriculum verbatim
 *      ("...the role of Muhammad Ali Jinnah...") was refused, and being a verbatim quote it could
 *      not be edited to comply: permanently undeliverable.
 *
 *   C. Enforcement read fields no teacher sees. `/human_review_reason` is where the model writes
 *      "this needs religious review" — it was refused for saying so. DETECTION still reads that
 *      field, so the `needs_human_review` hold (check 6) is untouched; only DELIVERY refusal is
 *      narrowed.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

/** `lint()` returns { fails, warns } — a BLOCKING defect is in `fails`. */
const fails = (doc) => (lint(doc).fails || []).map(String);
const religious = (doc) => fails(doc).filter((e) => e.startsWith('RELIGIOUS_MARKS'));
const blocked = (doc) => religious(doc).length > 0;

/**
 * Put `text` in a teacher-facing prose slot, with the human-review hold already set.
 *
 * It MUTATES the fixture's existing `paragraph` block rather than substituting a block of its
 * own. An invented block shape fails SCHEMA, `lint` stops at the schema tier and never reaches
 * the religious gate at all — so every "does not block" assertion would pass while asserting
 * nothing. Mutating a block the fixture already validates keeps the document schema-clean and
 * the gate actually running.
 */
function withProse(text) {
  const d = JSON.parse(raw);
  d.needs_human_review = true;               // isolate checks 1-5 from check 6
  const para = d.sections[1].blocks.find((b) => b.type === 'paragraph');
  para.text = text;
  return d;
}

/** A second teacher-facing prose slot, for the cases that need the trigger and the defect apart. */
function setSecondProse(d, text) {
  d.sections[1].blocks.find((b) => b.type === 'key_points').items = [text];
  return d;
}

/** Guard: the fixture must be schema-clean, or every assertion below is vacuous. */
beforeAll(() => {
  const schema = fails(withProse('ordinary prose')).filter((e) => e.startsWith('SCHEMA'));
  expect(schema).toEqual([]);
});

describe('A — "انبیاء" is an ordinary word, not an unhonorified Prophet', () => {
  it('does not block the stock chapter title "سیرتِ انبیاء"', () => {
    expect(blocked(withProse('سیرتِ انبیاء سے متعلق مواد'))).toBe(false);
  });

  it('does not block the exact string from the 2026-09-15 production refusal', () => {
    expect(blocked(withProse('سیرتِ انبیاء سے متعلق مواد — نبی ﷺ'))).toBe(false);
  });

  it('does not block the plural "نبیوں کی تعلیمات"', () => {
    expect(blocked(withProse('نبیوں کی تعلیمات پر عمل کریں'))).toBe(false);
  });

  it('STILL blocks the bare Prophet in lesson body — bd-qzitp holds', () => {
    expect(blocked(withProse('نبی نے فرمایا کہ علم حاصل کرو'))).toBe(true);
  });

  it('STILL blocks a bare compound title in lesson body', () => {
    expect(blocked(withProse('نبی کریم نے فرمایا کہ علم حاصل کرو'))).toBe(true);
  });

  it('accepts the honorific when it is actually there', () => {
    expect(blocked(withProse('نبی کریم ﷺ نے فرمایا کہ علم حاصل کرو'))).toBe(false);
  });
});

describe('B — Latin script is correct on an English page', () => {
  // The document must still be detected as religious, or these assert nothing. An Urdu religious
  // string elsewhere supplies the trigger, exactly as the Grade 6 History doc did.
  const TRIGGER = 'سیرت کا سبق';

  it('does not block an English SLO naming Muhammad Ali Jinnah', () => {
    const d = withProse(TRIGGER);
    d.slo.text_verbatim = 'Students will explain the role of Muhammad Ali Jinnah in the Pakistan Movement.';
    expect(blocked(d)).toBe(false);
  });

  it('does not block Mohammad Ali Jinnah in English teacher prose', () => {
    const d = setSecondProse(withProse(TRIGGER), 'Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.');
    expect(blocked(d)).toBe(false);
  });

  it('STILL blocks a transliterated sacred name inside an URDU string', () => {
    expect(blocked(withProse('سیرت کا سبق: یہ Allah کی وحدانیت پر ہے'))).toBe(true);
  });

  it('STILL blocks "PBUH" inside an Urdu string', () => {
    expect(blocked(withProse('نبی کریم PBUH کا فرمان سیرت میں ہے'))).toBe(true);
  });

  it('does not fire on "RA" used as an ordinary abbreviation', () => {
    const d = setSecondProse(withProse(TRIGGER), 'Identify the RA value on the diagram.');
    expect(blocked(d)).toBe(false);
  });
});

describe('C — enforcement reads only what the teacher reads', () => {
  it('does not block on /human_review_reason, the model\'s own routing note', () => {
    const d = withProse('سیرت کا سبق');
    d.human_review_reason = 'سیرتِ انبیاء سے متعلق مواد — نبی';
    expect(blocked(d)).toBe(false);
  });

  it('does not block on /slo/text_verbatim, which is quoted and cannot be edited', () => {
    const d = withProse('سیرت کا سبق');
    d.slo.text_verbatim = 'نبی کے اخلاق بیان کریں';
    expect(blocked(d)).toBe(false);
  });

  it('does not block on a third party\'s video title', () => {
    const d = withProse('سیرت کا سبق');
    d.sections[0].video = { title: 'حضرت ابراہیم خلیل اللہ علیہ السلام', yt: 'abc123' };
    expect(blocked(d)).toBe(false);
  });

  it('DETECTION still sees human_review_reason — the needs_human_review hold still fires', () => {
    const d = withProse('an ordinary maths line');
    delete d.needs_human_review;                       // the hold is NOT set
    d.human_review_reason = 'سیرتِ انبیاء سے متعلق مواد';   // only religious signal in the doc
    const msg = religious(d).join(' | ');
    expect(msg).toMatch(/needs_human_review/);
  });

  it('a non-religious document is untouched by any of this', () => {
    expect(religious(JSON.parse(raw))).toEqual([]);
  });
});

describe('D — a companion honorific that IS there, rejected by the matcher', () => {
  // Found 2026-09-16 re-reading the actual flagged text rather than the field path. Check 3 is
  // the CONSISTENCY rule: it only fires on a bare name the document honorifies elsewhere. Both
  // defects below make a correctly-honorified name LOOK bare, so the gate reports a slip that
  // the author did not make — and in the Grade 6 case refused a live lesson over it.
  //
  //   D1. COMPANION_HON did not accept "رضی اللہ تعالیٰ عنہا". That is not a lesser form; it is
  //       the MORE reverent one, and it is what the Grade 6 Urdu book prints.
  //   D2. The window comment reads "a name is at most three words" but `if (i >= 2) break` stops
  //       after TWO, so a three-word name never reaches its honorific. Both "زینب بنت علی" and
  //       "ابراہیم خلیل اللہ" are three-word names printed with the honorific right after.

  /** The consistency rule needs the same first name honorified somewhere, or nothing fires. */
  const honorifiedElsewhere = (d, first) => setSecondProse(d, `حضرت ${first} رضی اللہ عنہا کا ذکر`);

  it('D1 — accepts "رضی اللہ تعالیٰ عنہا" (the production Grade 6 tafheem line)', () => {
    const d = honorifiedElsewhere(
      withProse('حضرت خدیجۃ الکبریٰ رضی اللہ تعالیٰ عنہا کا لقب کیا تھا؟'), 'خدیجۃ');
    expect(blocked(d)).toBe(false);
  });

  it('D1 — the plain "رضی اللہ عنہا" form still passes, as it always did', () => {
    const d = honorifiedElsewhere(
      withProse('حضرت خدیجۃ الکبریٰ رضی اللہ عنہا کا لقب کیا تھا؟'), 'خدیجۃ');
    expect(blocked(d)).toBe(false);
  });

  it('D2 — accepts a three-word name: "حضرت زینب بنت علی رضی اللہ عنہا"', () => {
    const d = honorifiedElsewhere(withProse('حضرت زینب بنت علی رضی اللہ عنہا کا ذکر آتا ہے'), 'زینب');
    expect(blocked(d)).toBe(false);
  });

  it('D2 — accepts "حضرت ابراہیم خلیل اللہ علیہ السلام" in lesson body', () => {
    const d = setSecondProse(
      withProse('حضرت ابراہیم خلیل اللہ علیہ السلام کا واقعہ پڑھیں'),
      'حضرت ابراہیم علیہ السلام کا ذکر');
    expect(blocked(d)).toBe(false);
  });

  it('STILL blocks a genuinely bare companion the document honorifies elsewhere', () => {
    const d = honorifiedElsewhere(withProse('حضرت خدیجۃ الکبریٰ کا لقب کیا تھا؟'), 'خدیجۃ');
    expect(blocked(d)).toBe(true);
  });

  it('a name never honorified anywhere is left to the reviewer, not blocked', () => {
    // Not a slip — there is no internal inconsistency to point at. Check 6 still holds it.
    expect(blocked(withProse('حضرت خدیجۃ الکبریٰ کا لقب کیا تھا؟'))).toBe(false);
  });
});
