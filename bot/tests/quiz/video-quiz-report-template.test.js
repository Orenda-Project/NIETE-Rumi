'use strict';
/**
 * bd-2473 — the teacher class report redesign, matching the coaching
 * hero-report visual system (navy hero, Fraunces/Lexend, jewel-tone cards)
 * per the approved mockup (06_Logs & Misc/Reports/Active/Video Quizzes -
 * Jul 2026/report-redesign/report_mockup_v1.html).
 *
 * The function SIGNATURE is unchanged (video-quiz-report.service.js's call
 * site is untouched) — this only tests the new markup/data-binding. Real
 * pixel appearance was verified by rendering + Read-tool review; this file
 * proves the template puts the right numbers and names in the right places,
 * with the new class names, so a future edit can't silently regress the
 * redesign back toward the old flat layout.
 */

const renderHtml = require('../../shared/templates/video-quiz-report.template');

const BASE = {
  topic: 'Classification of Animals: Insects and Worms',
  teacherName: 'Razia', grade: '5',
  started: 5, finished: 3, average: 74,
  students: [
    { student_name: 'Anum shazadi', student_class: '5', correct_answers: 11, total_questions_answered: 15, mastery_percentage: 73 },
    { student_name: 'Mehtab asghar', student_class: '5', correct_answers: 9, total_questions_answered: 15, mastery_percentage: 60 },
  ],
  hardest: [
    {
      question_text: 'Which is an example of an insect?', wrong: 6, total: 7,
      top_wrong_text: 'snake', correct_text: 'bees', misconception: null,
    },
  ],
  guidance: 'Start by counting legs together before naming any animal.',
  unfinished: ['Faizan waseem', 'Hassan ali'],
  generatedAt: '3 Aug 2026',
};

describe('bd-2473 — hero header (navy, Fraunces headline, hero score)', () => {
  test('topic renders as the hero headline', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="hero"/);
    expect(html).toMatch(/Classification of Animals: Insects and Worms/);
  });

  test('the class average is the big hero number', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="hscore"/);
    expect(html).toMatch(/74%/);
  });

  test('teacher name and grade appear in the "who" line, exactly "Razia · Grade 5"', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/<span class="nm content" dir="ltr">Razia<\/span> &middot; Grade 5/);
  });

  test('started/finished/worth-reteaching stat chips carry the real counts', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="stchip"[^]*?>5<\/div>[^]*?STARTED/i);
    expect(html).toMatch(/class="stchip"[^]*?>3<\/div>[^]*?FINISHED/i);
    expect(html).toMatch(/class="stchip"[^]*?>1<\/div>[^]*?WORTH RETEACHING/i);
  });
});

describe('bd-2473 — worth-reteaching moment cards', () => {
  test('renders a jewel-tone moment card with the wrong/correct pill pair', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="moment"/);
    expect(html).toMatch(/Which is an example of an insect\?/);
    expect(html).toMatch(/class="wrongpill content" dir="ltr">snake/);
    expect(html).toMatch(/class="rightpill content" dir="ltr">bees/);
  });

  test('with no hardest questions, no moment cards render (never an empty section)', () => {
    const html = renderHtml({ ...BASE, hardest: [] });
    expect(html).not.toMatch(/class="moment"/);
  });
});

describe('bd-2473 — roster with colored progress bars', () => {
  test('each student appears with name, class, and score', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="r-row"/);
    expect(html).toMatch(/Anum shazadi/);
    expect(html).toMatch(/11\/15/);
    expect(html).toMatch(/73%/);
  });

  test('band thresholds match the feature-wide 80/60 tier split (mastered/developing/needs_practice)', () => {
    const html = renderHtml(BASE);
    // 73% is "developing" tier feature-wide (scorecard badges use the same
    // 80/60 split) — mid, not strong, even though it's the class's best score.
    expect(html).toMatch(/Anum shazadi[^]*?band-mid/);
    expect(html).toMatch(/Mehtab asghar[^]*?band-mid/);
  });
});

describe('bd-2473 — guidance card and unfinished list', () => {
  test('the guidance paragraph renders inside the gold-accented "For tomorrow" card', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="try"/);
    expect(html).toMatch(/FOR TOMORROW/i);
    expect(html).toMatch(/Start by counting legs together/);
  });

  test('with no guidance, the card is omitted entirely', () => {
    const html = renderHtml({ ...BASE, guidance: null });
    expect(html).not.toMatch(/class="try"/);
  });

  test('unfinished students are listed by name', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/Faizan waseem/);
    expect(html).toMatch(/Hassan ali/);
  });
});

describe('bd-2473 — footer and font embedding', () => {
  test('the Rumi mark + generated date appear in the footer', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/class="foot"/);
    expect(html).toMatch(/3 Aug 2026/);
  });

  test('embeds Fraunces + Lexend as base64 — never trusts a system font', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/@font-face\{font-family:'Fraunces'/);
    expect(html).toMatch(/@font-face\{font-family:'Lexend'/);
  });
});

describe('bd-2473 — HTML escaping (unchanged contract)', () => {
  test('a student name with HTML-special characters is escaped', () => {
    const html = renderHtml({
      ...BASE,
      students: [{ student_name: '<script>x</script>', student_class: '5', correct_answers: 1, total_questions_answered: 1, mastery_percentage: 100 }],
    });
    expect(html).not.toMatch(/<script>x</);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});

// bd-mg9c7.48/D6 — the operator's own words: "the report I got on staging
// says 'for teachers' and then says 'for Haroon' — there should be no such
// duplication, should just say my name." The lockup and the "For"/"forTeacher"
// wording are removed from this document entirely.
describe('bd-mg9c7.48 — D6 header: no lockup, no "For", name · grade only', () => {
  test('the hero never emits the lockup chrome or the word "For"', () => {
    const html = renderHtml(BASE);
    expect(html).not.toMatch(/class="lockup"/);
    expect(html).not.toMatch(/FOR TEACHERS/);
    expect(html).not.toMatch(/>For </);
    expect(html).not.toMatch(/For <b>/);
  });

  test('an empty teacherName falls back to the class-results string, not a blank "For"', () => {
    const html = renderHtml({ ...BASE, teacherName: '' });
    expect(html).toMatch(/<div class="who">Class results/);
    // the "who" line itself carries no name span (a roster/unfinished name
    // span elsewhere in the document is a separate, expected thing).
    expect(html).toMatch(/<div class="who">Class results &middot; Grade 5<\/div>/);
  });

  test('an empty grade drops the " · Grade N" half entirely — no trailing separator', () => {
    const html = renderHtml({ ...BASE, grade: '' });
    expect(html).toMatch(/<span class="nm content" dir="ltr">Razia<\/span><\/div>/);
    expect(html).not.toMatch(/Grade\s*<\/div>/);
    expect(html).not.toMatch(/&middot;\s*<\/div>/);
  });
});

describe('bd-mg9c7.48 — three-part "For tomorrow" guidance', () => {
  const MISSED_GUIDANCE = {
    muddled: 'They think a half means any small piece.',
    board: 'Draw a circle, shade one half, ask what fraction is shaded.',
    check: 'If I shade 3 of 4 parts, what fraction is that?',
  };
  const ZERO_MISSED_GUIDANCE = {
    secure: 'The class has this cold — halves and quarters are solid.',
    stretch: 'What would three quarters look like on the same circle?',
  };

  test('renders three labelled parts for the "something missed" shape', () => {
    const html = renderHtml({ ...BASE, guidance: MISSED_GUIDANCE });
    expect(html).toMatch(/What they muddled/);
    expect(html).toMatch(/They think a half means any small piece\./);
    expect(html).toMatch(/On the board/);
    expect(html).toMatch(/Draw a circle, shade one half/);
    expect(html).toMatch(/Check question/);
    expect(html).toMatch(/If I shade 3 of 4 parts/);
    expect(html).not.toMatch(/Secure/);
    expect(html).not.toMatch(/One to stretch them/);
  });

  test('renders only the secure + stretch pair for the "nothing missed" shape', () => {
    const html = renderHtml({ ...BASE, guidance: ZERO_MISSED_GUIDANCE });
    expect(html).toMatch(/Secure/);
    expect(html).toMatch(/The class has this cold/);
    expect(html).toMatch(/One to stretch them/);
    expect(html).toMatch(/What would three quarters look like/);
    expect(html).not.toMatch(/What they muddled/);
    expect(html).not.toMatch(/Check question/);
  });

  test('a legacy plain string still renders as one unlabelled paragraph', () => {
    const html = renderHtml({ ...BASE, guidance: 'Start by counting legs together before naming any animal.' });
    expect(html).toMatch(/class="try"/);
    expect(html).toMatch(/Start by counting legs together/);
    expect(html).not.toMatch(/class="try-label"/);
  });

  test('guidance = null omits the card entirely, same as today', () => {
    const html = renderHtml({ ...BASE, guidance: null });
    expect(html).not.toMatch(/class="try"/);
  });
});

describe('bd-mg9c7.48 — most-missed card: explanation + misconception as two distinct lines', () => {
  test('both present render two lines, never both labelled "Explanation"', () => {
    const html = renderHtml({
      ...BASE,
      hardest: [{
        question_text: 'Which is an example of an insect?', wrong: 6, total: 7,
        top_wrong_text: 'snake', correct_text: 'bees',
        explanation: 'Bees have six legs and a segmented body, the definition of an insect.',
        misconception: 'They picked snake because it moves close to the ground like some insects do.',
      }],
    });
    expect(html).toMatch(/Explanation:<\/b> <span[^>]*>Bees have six legs/);
    expect(html).toMatch(/Why they picked it:<\/b> <span[^>]*>They picked snake because/);
  });

  test('only explanation present renders just that one line', () => {
    const html = renderHtml({
      ...BASE,
      hardest: [{
        question_text: 'Which is an example of an insect?', wrong: 6, total: 7,
        top_wrong_text: 'snake', correct_text: 'bees',
        explanation: 'Bees have six legs and a segmented body, the definition of an insect.',
        misconception: null,
      }],
    });
    expect(html).toMatch(/Explanation:<\/b> <span[^>]*>Bees have six legs/);
    expect(html).not.toMatch(/Why they picked it:/);
  });

  test('only misconception present renders just that one line, still labelled "Explanation:" (legacy shape)', () => {
    const html = renderHtml(BASE); // BASE's only hardest entry has misconception: null — use a variant with one set
    const withMisconception = renderHtml({
      ...BASE,
      hardest: [{
        question_text: 'Which is an example of an insect?', wrong: 6, total: 7,
        top_wrong_text: 'snake', correct_text: 'bees',
        misconception: 'They picked snake because it moves close to the ground like some insects do.',
      }],
    });
    expect(withMisconception).toMatch(/Explanation:<\/b> <span[^>]*>They picked snake because/);
    expect(withMisconception).not.toMatch(/Why they picked it:/);
    expect(html).not.toMatch(/Why they picked it:/);
  });
});

describe('bd-mg9c7.48 — unfinished names render one span each', () => {
  test('a mixed-script roster gets one nameCell-style span per child, joined by a plain separator', () => {
    const html = renderHtml({ ...BASE, unfinished: ['Faizan waseem', 'عائشہ بی بی', 'Hassan ali'] });
    expect(html).toMatch(/<span class="nm content" dir="ltr">Faizan waseem<\/span>/);
    expect(html).toMatch(/<span class="nm content" dir="rtl">عائشہ بی بی<\/span>/);
    expect(html).toMatch(/<span class="nm content" dir="ltr">Hassan ali<\/span>/);
    // separator sits OUTSIDE the spans, not inside either one
    expect(html).toMatch(/<\/span>, <span class="nm content"/);
  });
});
// bd-2664 — Urdu quizzes (270 of ~440 real share codes) rendered as tofu
// boxes: no Nastaliq @font-face was embedded, and every chrome label stayed
// English regardless of the quiz's own language. Fixed by porting the
// language-aware pattern already proven in hero-report.template.js.
describe('bd-2664 — Urdu report is fully localised + RTL', () => {
  const UR_BASE = {
    topic: 'چھوٹی یے اور بڑی یے کی آوازیں',
    teacherName: 'مہام', grade: 'Prep',
    started: 8, finished: 6, average: 79,
    students: [
      { student_name: 'زینب بی بی', student_class: 'Nursery', correct_answers: 9, total_questions_answered: 10, mastery_percentage: 90 },
    ],
    hardest: [{
      question_text: 'لفظ "آزادی" میں یے کی آواز کیا بتائی گئی؟', wrong: 4, total: 8,
      top_wrong_text: 'ی', correct_text: 'ای', misconception: 'بچے آخر کی آواز الجھا دیتے ہیں۔',
    }],
    guidance: 'وہ سمجھتے ہیں یے ہمیشہ ایک جیسی آواز دیتی ہے۔ بورڈ پر آزادی اور یرقان لکھیں۔ اب آپ خود بتائیں کون سی آواز ہے؟',
    unfinished: ['محمد ولید'],
    generatedAt: '5 Aug 2026',
    language: 'ur',
  };

  test('the <html> tag carries dir="rtl" lang="ur"', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
  });

  test('embeds the Nastaliq font as base64 — the actual bug (tofu boxes)', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu'/);
    // the base64 payload itself must be non-empty, not just the @font-face rule
    expect(html).toMatch(/@font-face\{font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{100,}/);
  });

  test('chrome labels are translated, not left in English', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/کلاس کوئز کے نتائج/); // "Class quiz results"
    expect(html).toMatch(/ہر طالب علم کی کارکردگی/); // "How each student did"
    expect(html).toMatch(/کل کے لیے/); // "For tomorrow"
    expect(html).not.toMatch(/Class quiz results/);
    expect(html).not.toMatch(/Worth reteaching/);
    expect(html).not.toMatch(/How each student did/);
  });

  test('an HTML entity in a translated chrome string is not double-escaped', () => {
    // worthReteachingHeading contains a real &mdash; — must render as the
    // entity, never as literal text "&amp;mdash;" (the double-escape bug).
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/دوبارہ پڑھانے کے قابل &mdash; سب سے زیادہ غلط/);
    expect(html).not.toMatch(/&amp;mdash;/);
  });

  // bd-mg9c7.48/D6 — the staging report the operator saw said "FOR TEACHERS"
  // then "For Haroon"; he asked for just his name. The lockup and the "for"
  // wording are gone from this document entirely (the name still needs its
  // own <span> — dropping HTML escaping is not this test's concern, kept in
  // the escaping-in-RTL-mode test below).
  test('the who line is "name · جماعت N" — no lockup, no "کے لیے"/"for" wording', () => {
    const html = renderHtml(UR_BASE);
    // "Prep" is a Latin run inside Urdu chrome, so it is isolated in its own
    // .ltr span (same bidi rule as everywhere else in this document).
    expect(html).toMatch(/<span class="nm content" dir="rtl">مہام<\/span> &middot; جماعت <span class="ltr">Prep<\/span>/);
    // the OLD forTeacher() output was literally "مہام <b>کے لیے</b>" — that
    // exact "name کے لیے" shape must be gone (the unrelated "کل کے لیے" /
    // "For tomorrow" section header legitimately contains the same two words
    // and is not what this asserts against).
    expect(html).not.toMatch(/مہام <b>کے لیے/);
    expect(html).not.toMatch(/class="lockup"/);
  });

  test('real Urdu question/option/explanation content passes through verbatim', () => {
    const html = renderHtml(UR_BASE);
    // bd-2679 — esc() no longer entity-escapes quote characters (T()/L() are
    // only ever interpolated into text content, never an attribute value, so
    // a literal quote is markup-safe; entity-escaping it was actively
    // fragmenting mixed-script sentences at the entity boundary — see esc()'s
    // own comment). The source " now passes through as a literal character.
    expect(html).toMatch(/لفظ "آزادی" میں یے کی آواز کیا بتائی گئی؟/);
    expect(html).toMatch(/class="wrongpill content" dir="rtl">ی</);
    expect(html).toMatch(/class="rightpill content" dir="rtl">ای</);
    expect(html).toMatch(/بچے آخر کی آواز الجھا دیتے ہیں۔/);
  });

  test('the guidance paragraph renders in Urdu inside the "کل کے لیے" card', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/class="try"/);
    expect(html).toMatch(/وہ سمجھتے ہیں یے ہمیشہ ایک جیسی آواز دیتی ہے۔/);
  });

  test('a student name with HTML-special characters is still escaped in RTL mode', () => {
    const html = renderHtml({
      ...UR_BASE,
      students: [{ student_name: '<script>x</script>', student_class: 'Nursery', correct_answers: 1, total_questions_answered: 1, mastery_percentage: 100 }],
    });
    // UPDATED bd-mg9c7.44 (deliberate, escaping unchanged): a roster name is
    // now isolated by ITS OWN script rather than the quiz's, so a Latin name
    // in an Urdu report is one dir="ltr" element instead of a Nastaliq-faced
    // RTL one that wrapLatin() then had to fragment into per-run .ltr spans.
    // The safety property under test — the raw tag never survives — is the
    // same, and asserted here on the whole, now-contiguous escaped string.
    expect(html).not.toMatch(/<script>x</);
    expect(html).toMatch(/&lt;/);
    expect(html).toMatch(/&gt;/);
    expect(html).toMatch(/<span class="nm content" dir="ltr">&lt;script&gt;x&lt;\/script&gt;<\/span>/);
  });

  test('a stray Latin word inside Urdu content is isolated in an .ltr span', () => {
    const html = renderHtml({ ...UR_BASE, topic: 'Science کا سبق' });
    expect(html).toMatch(/<span class="ltr">Science<\/span>/);
  });

  // Caught by rendering the REAL bd-2664 verification PDF and reading it:
  // the footer date "13 Aug 2026" visually painted as "Aug 2026 13" under
  // <html dir="rtl"> because unicode-bidi:isolate alone doesn't force LTR —
  // it still resolves direction from the inherited (rtl) `direction`
  // property. A text-matching test can't see the bug (raw HTML order is
  // unchanged, only paint order); this locks in the actual fix so a future
  // edit can't silently drop it.
  test('the .ltr isolation class forces its own LTR base direction', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/\.ltr\{[^}]*direction:ltr/);
  });

  // bd-mg9c7.48/D1 — the footer stamp is faced by ITS OWN script, not by a
  // hardcoded LTR class. A Latin date in an Urdu report still needs the LTR
  // isolate (otherwise "5 Sep 2026" paints as "Sep 2026 5"), but an Urdu date
  // in an Urdu report must NOT be forced LTR: direction:ltr splits the two
  // numeric runs around the Urdu month and reorders them ("5 ستمبر 2026"
  // printed as "5 2026 ستمبر" — seen in renders/round4/report before the fix).
  test('a Latin footer date in an Urdu report is faced LTR', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/<div class="stamp content" dir="ltr">5 Aug 2026<\/div>/);
    // and it keeps the Latin face rather than inheriting the document's Nastaliq
    expect(html).toMatch(/\.stamp\[dir="ltr"\]\{[^}]*Lexend/);
  });

  test('an Urdu footer date in an Urdu report keeps its own RTL direction', () => {
    const html = renderHtml({ ...UR_BASE, generatedAt: '5 ستمبر 2026' });
    expect(html).toMatch(/<div class="stamp content" dir="rtl">/);
    expect(html).not.toMatch(/<div class="stamp content" dir="rtl">\s*<span class="ltr">5 ستمبر 2026/);
  });

  test('default language (no field passed) stays English/LTR — no regression', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Worth reteaching/);
  });
});

// bd-mg9c7.48/D1 — the document is single-language: every chrome label,
// including the new D6 who-line and the new three-part guidance labels, must
// come out in the quiz's language with NO sibling-language chrome word
// anywhere — the two exceptions being a person's own typed-script name and
// genuine quiz content (both of which legitimately carry either script).
describe('bd-mg9c7.48/D1 — full single-language chrome, both directions', () => {
  const FULL = {
    ...BASE,
    students: [{ student_name: 'Anum shazadi', student_class: '5', correct_answers: 11, total_questions_answered: 15, mastery_percentage: 73 }],
    hardest: [{
      question_text: 'Which is an example of an insect?', wrong: 6, total: 7,
      top_wrong_text: 'snake', correct_text: 'bees',
      explanation: 'Bees have six legs and a segmented body.',
      misconception: 'Snakes move low to the ground like some insects.',
    }],
    guidance: { muddled: 'placeholder', board: 'placeholder', check: 'placeholder' },
  };

  test('language+contentLanguage both "ur": no English chrome word anywhere', () => {
    const html = renderHtml({ ...FULL, language: 'ur', contentLanguage: 'ur' });
    ['Class quiz results', 'Class results', 'Class average', 'Started', 'Finished',
      'Worth reteaching', 'Most chose', 'correct answer', 'Explanation:', 'Why they picked it:',
      'How each student did', 'Not finished yet:', 'For tomorrow',
      'What they muddled', 'On the board', 'Check question', 'Secure', 'One to stretch them',
      // The roster's class label is chrome too — classLabel() prefixed "Grade "
      // unconditionally, so every row of an Urdu roster printed an English word.
      'Grade ',
    ].forEach((chrome) => expect(html).not.toContain(chrome));
  });

  test('language+contentLanguage both "en": no Urdu chrome word anywhere', () => {
    const html = renderHtml({ ...FULL, language: 'en', contentLanguage: 'en' });
    ['کلاس کوئز کے نتائج', 'کلاس کے نتائج', 'کلاس اوسط', 'شروع کیا', 'مکمل کیا',
      'دوبارہ پڑھانا', 'زیادہ تر نے چنا', 'درست جواب', 'وضاحت:', 'انہوں نے یہ کیوں چنا:',
      'ہر طالب علم کی کارکردگی', 'ابھی مکمل نہیں کیا:', 'کل کے لیے',
      'کیا الجھن ہوئی', 'بورڈ پر', 'جانچ کا سوال', 'یہ پکا ہو گیا', 'ایک اور آگے کا سوال',
    ].forEach((chrome) => expect(html).not.toContain(chrome));
  });
});

// bd-2679 — an Urdu-medium quiz whose SUBJECT is English (a real, expected
// shape: English vocabulary taught via Urdu instruction, e.g. Maham Riaz's
// real "Tall and Short" report) renders its mostly-English question text as
// visually scrambled clauses. wrapLatin()'s Latin-run regex excludes ASCII
// digits and common punctuation (, : ; ? ! ( ) % /) from a "run", so any
// digit/punctuation inside an English sentence splits it into MULTIPLE
// separate .ltr-isolated spans with bare, un-isolated characters between
// them. The browser's bidi algorithm then reorders those adjacent isolated
// islands (and the bare punctuation) per the surrounding dir="rtl"
// paragraph — scrambling clause order even though no individual span's own
// text is corrupted. Real production evidence: the PDF for Maham Riaz
// (+92 309 5871532) renders "A child says: tall broom, short broom, tall
// axe are 3 tall things. What is the correct tall count?" reordered into
// something unreadable.
describe('bd-2679 — English question content inside an Urdu report is not bidi-scrambled', () => {
  const ENGLISH_SUBJECT_UR_BASE = {
    topic: 'Tall and Short',
    teacherName: 'Maham', grade: 'Prep',
    started: 14, finished: 11, average: 84,
    students: [
      { student_name: 'Maham Riaz', student_class: 'Prep', correct_answers: 10, total_questions_answered: 10, mastery_percentage: 100 },
    ],
    hardest: [{
      // The exact real question from the production PDF, word for word.
      question_text: 'A child says: tall broom, short broom, tall axe are 3 tall things. What is the correct tall count?',
      wrong: 5, total: 11,
      top_wrong_text: '2', correct_text: '3',
      misconception: 'You counted every object as tall, but the short broom is not tall. The correct answer is 2, because tall broom and tall axe are tall.',
    }],
    guidance: 'کل کے لیے: axe, broom, tree, chair, witch, Pinky, Lamboo ایک ایک کر کے دکھائیں۔',
    unfinished: [],
    generatedAt: '14 Aug 2026',
    language: 'ur',
  };

  test('the full English question renders as ONE contiguous LTR span, not fragmented at digits/punctuation', () => {
    const html = renderHtml(ENGLISH_SUBJECT_UR_BASE);
    // Escaped form: esc() turns nothing here (no &<>"' in the source), so
    // the raw sentence should appear verbatim inside a single .ltr span.
    expect(html).toMatch(
      /<span class="ltr">A child says: tall broom, short broom, tall axe are 3 tall things\. What is the correct tall count\?<\/span>/
    );
  });

  test('the wrong/correct answer pills (bare digits) still render, isolated', () => {
    const html = renderHtml(ENGLISH_SUBJECT_UR_BASE);
    expect(html).toMatch(/class="wrongpill content" dir="rtl"><span class="ltr">2<\/span>/);
    expect(html).toMatch(/class="rightpill content" dir="rtl"><span class="ltr">3<\/span>/);
  });

  test('the misconception explanation (English, multiple sentences with commas/periods) is not fragmented either', () => {
    const html = renderHtml(ENGLISH_SUBJECT_UR_BASE);
    expect(html).toMatch(
      /<span class="ltr">You counted every object as tall, but the short broom is not tall\. The correct answer is 2, because tall broom and tall axe are tall\.<\/span>/
    );
  });

  // Found by rendering the REAL Maham Riaz report and reading the actual
  // image (not just this test suite) — a THIRD real question from the same
  // report uses "+" as a separator, which the first pass of this fix missed
  // (only added digits/,/:/;/?/!/(/)/%// — not +). Without it, this
  // question reordered its whole clauses around the bare "+" signs the
  // exact same way the other two questions did around commas/colons.
  test('a "+"-joined English list question is not fragmented at the plus signs', () => {
    const html = renderHtml({
      ...ENGLISH_SUBJECT_UR_BASE,
      hardest: [{
        question_text: 'Short witch + short chair + short tree + tall Lamboo: how many are short?',
        wrong: 4, total: 11, top_wrong_text: '4', correct_text: '3',
        misconception: 'You counted all the things, but we count only the short ones.',
      }],
    });
    expect(html).toMatch(
      /<span class="ltr">Short witch \+ short chair \+ short tree \+ tall Lamboo: how many are short\?<\/span>/
    );
  });

  // Found by bd-2680's production audit (real SENT ur-language reports):
  // esc() turns a literal apostrophe into the numeric entity &#39; BEFORE
  // wrapLatin() runs. wrapLatin's own tag/entity pre-split regex then pulls
  // &#39; out as its own opaque, unwrappable segment — so an English
  // contraction/possessive gets torn into two separate .ltr spans with a
  // bare &#39; between them, mid-WORD, not just mid-clause. Real examples:
  // "My cat's name is Lado", "don't have", "Jojo's hair". T()/L() are only
  // ever interpolated into element TEXT CONTENT in this template (never an
  // HTML attribute value — grepped every call site), so a literal quote
  // character is markup-safe here; the fix is to stop entity-escaping ' and
  // " at all, so they flow through as literal characters wrapLatin can
  // isolate as part of the surrounding Latin run.
  test('an apostrophe inside an English word does not split it into two spans', () => {
    const html = renderHtml({
      ...ENGLISH_SUBJECT_UR_BASE,
      hardest: [{
        question_text: "My cat's name is Lado.", wrong: 2, total: 11,
        top_wrong_text: 'a', correct_text: 'b',
        misconception: "Invertebrates are animals that don't have a backbone.",
      }],
    });
    expect(html).toMatch(/<span class="ltr">My cat's name is Lado\.<\/span>/);
    expect(html).toMatch(/<span class="ltr">Invertebrates are animals that don't have a backbone\.<\/span>/);
  });

  test('a double-quoted English phrase does not split at the quote marks', () => {
    const html = renderHtml({
      ...ENGLISH_SUBJECT_UR_BASE,
      hardest: [{
        question_text: 'Which word means "big"?', wrong: 3, total: 11,
        top_wrong_text: 'small', correct_text: 'large', misconception: null,
      }],
    });
    expect(html).toMatch(/<span class="ltr">Which word means "big"\?<\/span>/);
  });
});

/**
 * bd-mg9c7.48 (lane C manager pass) — the four things the round-4 renders
 * showed once the D6 header and the three-part guidance were in place. Every
 * one of these was READ off a rasterised PDF page in
 * renders/round4/report/ before it was written down here.
 */
describe('bd-mg9c7.48 — what the round-4 renders showed', () => {
  const { classLabel } = require('../../shared/utils/text-format');

  describe('the roster class label follows the document language (D1)', () => {
    test('classLabel labels the unit in Urdu for an Urdu document', () => {
      expect(classLabel('5', 'ur')).toBe('جماعت 5');
      expect(classLabel('5', 'en')).toBe('Grade 5');
      expect(classLabel('5')).toBe('Grade 5');           // unchanged default
    });

    test('a class the child already named keeps what they typed, in either language', () => {
      expect(classLabel('Class 3', 'ur')).toBe('Class 3');
      expect(classLabel('جماعت 4', 'ur')).toBe('جماعت 4');
      expect(classLabel('جماعت 4', 'en')).toBe('جماعت 4');
      expect(classLabel('', 'ur')).toBe('');
    });

    test('the Urdu report renders the Urdu label on the roster row', () => {
      const html = renderHtml({
        ...BASE, language: 'ur', contentLanguage: 'ur',
        students: [{ student_name: 'عائشہ', student_class: '5', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88 }],
      });
      expect(html).toMatch(/class="cls">[^<]*جماعت/);
    });
  });

  describe('the who-line carries the emphasis the removed bold used to carry (D6)', () => {
    test('the name span is white and bold in the hero', () => {
      const html = renderHtml(BASE);
      const rule = (html.match(/\.who \.nm\{([^}]*)\}/) || [])[1];
      expect(rule).toBeTruthy();
      expect(rule).toMatch(/color:#fff/);
      expect(rule).toMatch(/font-weight:700/);
    });
  });

  describe('the footer stamp is faced by its own script, not forced LTR', () => {
    test('an Urdu date is not dragged into an LTR run', () => {
      const html = renderHtml({ ...BASE, language: 'ur', contentLanguage: 'ur', generatedAt: '5 ستمبر 2026' });
      expect(html).toMatch(/<div class="stamp content" dir="rtl">/);
      expect(html).not.toMatch(/<div class="ltr">5 ستمبر 2026<\/div>/);
    });
  });

  describe('print pagination', () => {
    const html = renderHtml(BASE);

    test('nothing that reads as one unit may split across a page break', () => {
      const rule = (html.match(/\.moment,\.try,\.unfin,\.r-row\{([^}]*)\}/) || [])[1];
      expect(rule).toBeTruthy();
      expect(rule).toMatch(/break-inside:avoid/);
      expect(rule).toMatch(/page-break-inside:avoid/);
    });

    test('a section label may not be orphaned at the foot of a page', () => {
      // ONE .label rule, carrying the break control — a second rule of the same
      // name would win or lose by source order depending on where it landed.
      const rules = html.match(/\n\.label\{[^}]*\}/g) || [];
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatch(/break-after:avoid/);
      expect(rules[0]).toMatch(/page-break-after:avoid/);
    });

    test('the gap above the guidance box is padding on a wrapper, not a margin that a break drops', () => {
      const withGuidance = renderHtml({ ...BASE, guidance: { muddled: 'a', board: 'b', check: 'c' } });
      expect(withGuidance).toMatch(/<div class="trywrap">/);
      expect((withGuidance.match(/\.trywrap\{([^}]*)\}/) || [])[1]).toMatch(/padding:/);
      expect((withGuidance.match(/\n\.try\{([^}]*)\}/) || [])[1]).not.toMatch(/margin:/);
    });

    test('no guidance means no empty wrapper element', () => {
      expect(renderHtml({ ...BASE, guidance: null })).not.toMatch(/<div class="trywrap">/);
    });
  });
});
