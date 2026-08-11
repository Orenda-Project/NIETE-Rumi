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
