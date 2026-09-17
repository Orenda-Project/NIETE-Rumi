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

const {
  fails, religious, blocked, withProse, setSecondProse, cleanDoc,
} = require('./helpers/religious-marks');

// The English-medium rulings (Q3 bd-xo6mb, and the stamp ruling bd-c61xh) live in their own
// suite — `religious-marks-english.test.js` — because describe G took this file past the
// 300-line limit. Same harness, imported above rather than copied.

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
    expect(religious(cleanDoc())).toEqual([]);
  });
});

// describe D — the companion-honorific matcher (COMPANION_HON's endings, and the three-word name
// bound) — lived here and is REMOVED, not skipped: its fix is bd-j335i (P1), which the operator
// held back from this cherry-pick. Re-authoring it from memory when bd-j335i ships would lose the
// production strings it was built from, so take it from 065766b7 on branch
// bd-kpqu6-religious-marks-false-positives instead. Cost of the hold, stated plainly:
// grade_6_urdu.c10.p051-054.tafheem ("حضرت خدیجۃ الکبریٰ رضی اللہ تعالیٰ عنہا") stays refused.

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

describe('F — a prophet other than Muhammad takes علیہ السلام, not ﷺ', () => {
  // OPERATOR RULING, 2026-09-17 (G5c native-speaker review, bd-zipoe packet, Q1):
  //   "any prophet not Muhammad gets their proper salutation alaihis salam in the
  //    stamp/nastaliq script"
  //
  // This is the native-speaker clearance brief §4c/G5c requires. It is a decision, not a
  // heuristic derived here.
  //
  // PROPHET_TOKENS carries the bare common noun نبی alongside the Prophet Muhammad's own name and
  // his conventional epithets, and HONORIFIC_RE accepts only his salutation. So a correctly
  // salutated mention of ANY other prophet read as an unhonorified mention of him — and the
  // failure message instructed the author to write "نبی ﷺ", which for Hazrat Ibrahim is the wrong
  // thing. A lesson cannot be repaired into compliance by being told to write something false, so
  // it stayed refused on every round.
  //
  // PRODUCTION: grade_7_urdu.c11.p062-064.tafheem (v9.6), REFUSED 2026-09-15 04:53, one teacher
  // waiting. /sections/0/warmup/items/1/a — "وہ اللہ کے نبی تھے، جنہوں نے بتوں کی…". The chapter
  // is Hazrat Ibrahim.

  it('F1 — "نبی علیہ السلام" is a complete salutation and does not block', () => {
    expect(blocked(withProse('حضرت ابراہیم اللہ کے نبی علیہ السلام تھے'))).toBe(false);
  });

  it('F1 — the elaborated "علیہ الصلوٰۃ والسلام" is accepted too', () => {
    expect(blocked(withProse('حضرت موسیٰ نبی علیہ الصلوٰۃ والسلام کا ذکر'))).toBe(false);
  });

  it('F2 — "نبی ﷺ" still passes, exactly as before', () => {
    expect(blocked(withProse('نبی ﷺ نے فرمانے کا ذکر کیا ہے'))).toBe(false);
  });

  it('STILL blocks محمد with علیہ السلام — his salutation is ﷺ and nothing else', () => {
    // The guard on the ruling's own words: "any prophet NOT Muhammad". If this goes green the
    // fix has demoted the Prophet's salutation, which is the defect bd-qzitp exists to prevent.
    expect(blocked(withProse('محمد علیہ السلام نے ارشاد کیا'))).toBe(true);
  });

  it('STILL blocks an epithet of the Prophet with علیہ السلام — رسول اللہ', () => {
    expect(blocked(withProse('رسول اللہ علیہ السلام کا فرمان'))).toBe(true);
  });

  it('STILL blocks a LATIN "alaihis salam" — the ruling says stamp/nastaliq script', () => {
    expect(blocked(withProse('حضرت ابراہیم اللہ کے نبی alaihis salam تھے'))).toBe(true);
  });

  it('the production Grade 7 line still fails, but now names علیہ السلام as the fix', () => {
    // It carries no salutation at all, so it must still be caught — the change is WHAT the author
    // is told to write. Demanding "نبی ﷺ" for Hazrat Ibrahim is why this segment could not be
    // repaired on any round.
    const msgs = religious(withProse('وہ اللہ کے نبی تھے، جنہوں نے بتوں کی پرستش سے منع کیا'));
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join('\n')).toMatch(/علیہ السلام/);
    expect(msgs.join('\n')).toMatch(/ﷺ/);
  });
});

