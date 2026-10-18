/**
 * bd-d6c8y — a menu row that names the Prophet must not lose the salutation the
 * book gave him.
 *
 * Eight rows shipped that way on sandbox: `Hazrat Muhammad: reading`,
 * `اخلاقِ نبوی: تفہیم` and six like them, while the chapter title and subtopic of
 * the very same segment carried `صلى الله عليه وسلم` / `ﷺ`. The corpus was right;
 * only the WhatsApp row dropped it.
 *
 * It was first reported as the 30-code-point cap eating the stamp. It is not:
 * adding ` ﷺ` fits inside the cap on every affected row, most with ten characters
 * to spare. The salutation is simply not carried across.
 *
 * WHY THIS WARNS AND DOES NOT AUTO-CORRECT. Gate G5c: automated checks do not
 * clear religious content. WHERE a salutation belongs in a line is a religious
 * judgement — `سیرتِ نبوی ﷺ میں …` puts it mid-phrase, `Review: Hazrat Muhammad ﷺ`
 * at the end — and a rule that guesses would eventually guess wrong on a teacher's
 * screen. So the importer reports the row and the reviewer places the stamp. The
 * repair itself is a reviewed migration, not an inference.
 *
 * The negative cases below are the point of the whole test. The operator ruled on
 * 2026-09-23 that the ADJECTIVAL forms need no salutation ("3b - can be left as
 * is") and that grade 8 Islamiat ch.4 is left alone. A warning fired on either of
 * those would be this check overreaching into a judgement she has already made.
 */

const { validateSegment } = require('../../bot/scripts/import-lp612-segments');

const LOST = /salutation/i;
const warnsLostSalutation = (over) => validateSegment({
  segment_id: 'grade_6_english.c01a.p001-006.reading_comprehension',
  book_stem: 'grade_6_english',
  grade: 6,
  subject: 'English',
  language: 'en',
  chapter_key: 'c01a',
  printed_page_start: 1,
  order_index: 1,
  ...over,
}).warnings.some((w) => LOST.test(w));

describe('the salutation the book gave is carried into the menu row', () => {
  test('the grade 6 English row that shipped bare — chapter and subtopic both stamped', () => {
    expect(warnsLostSalutation({
      chapter_title: 'Hazrat Muhammad صلى الله عليه وسلم (biography)',
      subtopic_title: 'Reading and understanding: the biography of Hazrat Muhammad (ﷺ)',
      menu_title: 'Hazrat Muhammad: reading',
    })).toBe(true);
  });

  test('the grade 9 English review row', () => {
    expect(warnsLostSalutation({
      chapter_title: 'Hazrat Muhammad Rasulullah (ﷺ): A Mercy for All Creation',
      subtopic_title: 'Chapter 1 review: Hazrat Muhammad Rasulullah (ﷺ)',
      menu_title: 'Review: Hazrat Muhammad',
    })).toBe(true);
  });

  test('the Urdu rows — the stamp sits mid-phrase in the source and the row dropped it', () => {
    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'اخلاقِ نبوی ﷺ (سیرت)',
      subtopic_title: 'اخلاقِ نبوی ﷺ — سبق کا مطالعہ، فہم اور سوالات',
      menu_title: 'اخلاقِ نبوی: تفہیم',
    })).toBe(true);

    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'اخلاص و تقویٰ',
      subtopic_title: 'سیرتِ نبوی ﷺ میں اخلاص و تقویٰ اور اس کے معاشرتی فوائد و نقصانات',
      menu_title: 'سیرتِ نبوی میں اخلاص و تقویٰ',
    })).toBe(true);
  });

  test('the warning says the salutation was LOST, not that the row is too long', () => {
    const { warnings } = validateSegment({
      segment_id: 'x', book_stem: 'grade_6_english', grade: 6, subject: 'English',
      chapter_key: 'c01a', printed_page_start: 1, order_index: 1,
      chapter_title: 'Hazrat Muhammad صلى الله عليه وسلم (biography)',
      subtopic_title: 'Writing: the message of Hazrat Muhammad (ﷺ)',
      menu_title: 'Hazrat Muhammad: writing',
    });
    const w = warnings.find((x) => LOST.test(x));
    expect(w).toBeDefined();
    // It must tell the reviewer there is ROOM, because "the cap ate it" was the
    // wrong diagnosis once already and cost a round trip.
    expect(w).toMatch(/fits|room|24/);
  });
});

describe('it does not fire where the reviewer has already ruled', () => {
  test('ADJECTIVAL نبوی with no salutation anywhere in the source — operator: leave as is', () => {
    // مسجدِ نبوی, معجزاتِ نبوی, اسوۂ نبوی, نعتِ رسولِ مقبول. The source carries no
    // stamp either, so there is nothing that was "lost".
    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'بدگمانی',
      subtopic_title: 'اسوہ نبوی و صحابہ کرام کی روشنی میں بدگمانی کے نقصانات',
      menu_title: 'بدگمانی کے نقصانات',
    })).toBe(false);

    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'نعت (نظم) — ظفر علی خان',
      subtopic_title: 'نعتِ رسولِ مقبول — نظم پڑھنا اور سمجھنا',
      menu_title: 'نعت — پڑھنا اور فہم',
    })).toBe(false);
  });

  test('an adjectival row sitting UNDER a saluted chapter — her 3b ruling, the trap case', () => {
    // Grade 6 Islamiat ch.3 pp.49-51. The CHAPTER is saluted (سیرتِ طیبہ صلی اللہ علیہ
    // وسلم) while the subtopic and the menu row carry the plain adjective (مسجدِ نبوی),
    // which the operator ruled correct as printed on 2026-09-23 ("3b - can be left as
    // is"). A check that asked only "does any field on this segment carry a stamp?"
    // would flag it and re-open a question she has closed. The salutation has to belong
    // to the SAME word the menu row uses — سیرتِ طیبہ is saluted, نبوی is not.
    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'سیرتِ طیبہ صلی اللہ علیہ وسلم',
      section: 'مدنی معاشرے کا قیام',
      subtopic_title: 'مدنی معاشرے کا قیام اور مسجدِ نبوی کی تعمیر',
      menu_title: 'مسجدِ نبوی کی تعمیر',
    })).toBe(false);
  });

  test('a SEVERED salutation is named as severed, not as a dropped one', () => {
    // grade_8_islamiat.c04.r990. The 30-code-point cut landed INSIDE the salutation
    // and left the row ending on `صلی` — the one genuine cap casualty in the corpus.
    //
    // The dropped-salutation message is actively wrong here. It tells the reviewer the
    // stamp FITS and to place it, and a reviewer who does exactly that ships
    // `... نبوی صلی ﷺ` — 26 code points, inside the cap, and a half salutation followed
    // by a whole one. The row cannot be repaired by adding anything; it has to be
    // re-cut, which is what the operator ruled on 2026-09-23.
    //
    // So the check has to distinguish the two. Warning either way is not enough when
    // the warning names the wrong repair.
    const { warnings } = validateSegment({
      language: 'ur',
      chapter_title: 'احادیثِ نبوی ﷺ',
      subtopic_title: 'دہرائی: باب 4 — احادیثِ نبوی صلی اللہ علیہ وآلہ وصحابہ',
      menu_title: 'دہرائی: احادیثِ نبوی صلی',
    });
    const w = warnings.filter((x) => LOST.test(x));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/cut|sever|re-cut/i);
    expect(w[0]).not.toMatch(/the stamp FITS/);
  });

  test('a complete salutation spelled out in full is not mistaken for a severed one', () => {
    // `صلی اللہ علیہ` already satisfies the salutation test, and must keep doing so —
    // the severed check only looks at rows the salutation test rejected.
    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'احادیثِ نبوی ﷺ',
      subtopic_title: 'احادیثِ نبوی ﷺ کا مطالعہ',
      menu_title: 'نبوی صلی اللہ علیہ',
    })).toBe(false);
  });

  test('a row that already carries the stamp is left alone', () => {
    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'اخلاقِ نبوی ﷺ (سیرت)',
      subtopic_title: 'اخلاقِ نبوی ﷺ — بلند آواز سے پڑھنا',
      menu_title: 'اخلاقِ نبوی ﷺ: بلند خوانی',
    })).toBe(false);
  });

  test('an ordinary chemistry row is not dragged into a religious check', () => {
    expect(warnsLostSalutation({
      chapter_title: 'Nature of Chemistry in Science',
      subtopic_title: 'Definition of chemistry and its branches',
      menu_title: 'Branches of chemistry',
    })).toBe(false);
  });

  test('no room for the stamp means no warning — the reviewer cannot act on it anyway', () => {
    expect(warnsLostSalutation({
      language: 'ur',
      chapter_title: 'احادیثِ نبوی صلی اللہ علیہ وآلہ وصحابہ',
      subtopic_title: 'احادیثِ نبوی صلی اللہ علیہ وآلہ وصحابہ کا مطالعہ اور ان کی روشنی میں عملی زندگی',
      menu_title: 'احادیثِ نبوی کا مطالعہ اور عمل',
    })).toBe(false);
  });
});
