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

  test('teacher name and grade appear in the "who" line', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/Razia/);
    expect(html).toMatch(/Grade 5/);
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
    expect(html).toMatch(/class="wrongpill">snake/);
    expect(html).toMatch(/class="rightpill">bees/);
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

  test('the teacher-name lockup keeps its real <b> tag, not an escaped one', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/مہام <b>کے لیے<\/b>/);
    expect(html).not.toMatch(/&lt;b&gt;/);
  });

  test('real Urdu question/option/explanation content passes through verbatim', () => {
    const html = renderHtml(UR_BASE);
    // bd-2679 — esc() no longer entity-escapes quote characters (T()/L() are
    // only ever interpolated into text content, never an attribute value, so
    // a literal quote is markup-safe; entity-escaping it was actively
    // fragmenting mixed-script sentences at the entity boundary — see esc()'s
    // own comment). The source " now passes through as a literal character.
    expect(html).toMatch(/لفظ "آزادی" میں یے کی آواز کیا بتائی گئی؟/);
    expect(html).toMatch(/class="wrongpill">ی</);
    expect(html).toMatch(/class="rightpill">ای</);
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
    // wrapLatin() correctly isolates "script"/"x" as Latin runs (each becomes
    // its own <span class="ltr">), so the entities are no longer contiguous —
    // assert the dangerous raw tag is gone and both escaped entities exist,
    // rather than requiring an exact adjacent substring.
    expect(html).not.toMatch(/<script>x</);
    expect(html).toMatch(/&lt;/);
    expect(html).toMatch(/&gt;/);
    expect(html).toMatch(/<span class="ltr">script<\/span>/);
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

  test('the footer date is wrapped in the LTR-forcing class, not a bare isolate', () => {
    const html = renderHtml(UR_BASE);
    expect(html).toMatch(/<div class="ltr" style="font-family:'Lexend',sans-serif">5 Aug 2026<\/div>/);
  });

  test('default language (no field passed) stays English/LTR — no regression', () => {
    const html = renderHtml(BASE);
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Worth reteaching/);
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
    expect(html).toMatch(/class="wrongpill"><span class="ltr">2<\/span>/);
    expect(html).toMatch(/class="rightpill"><span class="ltr">3<\/span>/);
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
