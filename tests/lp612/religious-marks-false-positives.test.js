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
 *   B. A Grade 6 History SLO quoting the curriculum verbatim ("...the role of Muhammad Ali
 *      Jinnah...") was refused for the Latin spelling, and being a verbatim quote it could not be
 *      edited to comply: permanently undeliverable.
 *
 *      THE FIX THAT SHIPPED IS NOT THE ONE THIS BLOCK WAS WRITTEN FOR. The branch's answer was to
 *      scope TRANSLIT_RE by whether the STRING holds Urdu. Sandbox had since landed bd-b8ypq,
 *      which scopes it by the DOCUMENT's `provenance.medium`, and that supersedes it — so only
 *      defects A and C were taken (operator, 2026-09-16: "cherry pick the p0 for now only").
 *      The production SLO refusal is fixed either way, by C: an SLO is not teacher-facing.
 *      What the medium-aware lane does NOT cover is filed and skipped below — bd-5t71f, bd-6tfw6,
 *      bd-zlypp. None is a regression from this commit; all three are live on sandbox today.
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

  // SKIPPED, not deleted: this is a REAL and CURRENTLY LIVE gap, filed as bd-5t71f.
  // The English lane has no isCompoundGivenName guard, so Latin "Mohammad" opening another person’s name is refused.
  // Out of scope for bd-kpqu6's P0 — un-skip in the commit that fixes bd-5t71f.
  it.skip('does not block Mohammad Ali Jinnah in English teacher prose', () => {
    const d = setSecondProse(withProse(TRIGGER), 'Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.');
    expect(blocked(d)).toBe(false);
  });

  // SKIPPED, not deleted: this is a REAL and CURRENTLY LIVE gap, filed as bd-zlypp.
  // `medium` is read per-DOCUMENT, so an Urdu-script string in an en-medium plan never meets TRANSLIT_RE.
  // Out of scope for bd-kpqu6's P0 — un-skip in the commit that fixes bd-zlypp.
  it.skip('STILL blocks a transliterated sacred name inside an URDU string', () => {
    expect(blocked(withProse('سیرت کا سبق: یہ Allah کی وحدانیت پر ہے'))).toBe(true);
  });

  it('STILL blocks "PBUH" inside an Urdu string', () => {
    expect(blocked(withProse('نبی کریم PBUH کا فرمان سیرت میں ہے'))).toBe(true);
  });

  // SKIPPED, not deleted: this is a REAL and CURRENTLY LIVE gap, filed as bd-6tfw6.
  // ABBREV_RE holds a bare "RA", which is also right ascension / relative abundance / a resistance symbol.
  // Out of scope for bd-kpqu6's P0 — un-skip in the commit that fixes bd-6tfw6.
  it.skip('does not fire on "RA" used as an ordinary abbreviation', () => {
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

// describe D — the companion-honorific matcher (COMPANION_HON's endings, and the three-word name
// bound) — lived here and is REMOVED, not skipped: its fix is bd-j335i (P1), which the operator
// held back from this cherry-pick. Re-authoring it from memory when bd-j335i ships would lose the
// production strings it was built from, so take it from 065766b7 on branch
// bd-kpqu6-religious-marks-false-positives instead. Cost of the hold, stated plainly:
// grade_6_urdu.c10.p051-054.tafheem ("حضرت خدیجۃ الکبریٰ رضی اللہ تعالیٰ عنہا") stays refused.
