'use strict';
/**
 * bd-mg9c7.77 — the pre-send teacher PDF must mark EVERY correct option on a
 * "select all that apply" question, not just the first, and the misses loop
 * must skip every correct position (not only the first) when it decides
 * which options get a misconception line.
 *
 * Filed by lane E before lane C's PR #692; #692 claims it fixed this. This
 * suite proves it against the real template render function, in both
 * languages, with a fixture where EVERY option (including both correct ones)
 * carries a `distractor_misconceptions` entry — the shape that would expose
 * a "skip only the first correct position" bug.
 */
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const VideoRender = require('../../bot/shared/services/quiz/video-quiz-render.service');
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

const MULTI_ROW = {
  external_id: 'tq:q-77:S1:1',
  question_text: 'Which numbers are prime?',
  option_a: '2', option_b: '4', option_c: '5', option_d: '6',
  correct_option: 'A,C',
  media: { answer_mode: 'multi' },
  // A and C are correct but STILL carry a misconceptions entry — a bug that
  // only skips the FIRST correct position would print one of these as a miss.
  distractor_misconceptions: {
    A: 'MUST-NOT-RENDER-A', B: 'thinks even numbers can be prime',
    C: 'MUST-NOT-RENDER-C', D: 'confuses composite with prime',
  },
  selected_because: 'the board list of numbers 2 through 6',
};

function renderMulti(language, questions = [MULTI_ROW]) {
  return render({
    topic: 'Numbers', teacherName: 'T', date: '5 Sep 2026', link: 'https://wa.me/1',
    digest: { slos: [] }, questions, language, contentLanguage: language,
  });
}

describe('bd-mg9c7.77 — every correct option marked on a select-all-that-apply question', () => {
  const labels = VideoRender.optionLabels(MULTI_ROW);
  const order = VideoRender.displayOrder(MULTI_ROW, labels);
  const posA = order.indexOf(0);   // stored 'A' = '2'
  const posC = order.indexOf(2);   // stored 'C' = '5'

  test('English: both A and C are marked correct, wherever the shuffle put them', () => {
    const html = renderMulti('en');
    const marked = [...html.matchAll(/<div class="opt( correct)? content"/g)].map((m) => Boolean(m[1]));
    expect(marked[posA]).toBe(true);
    expect(marked[posC]).toBe(true);
    expect(marked.filter(Boolean)).toHaveLength(2);
  });

  test('English: two "correct" tags, one per correct option', () => {
    const html = renderMulti('en');
    expect([...html.matchAll(/<span class="tag">correct<\/span>/g)]).toHaveLength(2);
  });

  test('the "select all that apply" chip renders in English with the ux-strings text', () => {
    const html = renderMulti('en');
    expect(html).toMatch(/class="multichip"/);
    expect(html).toContain(resolveUx('vqMultiSelectAll', { language: 'en' }));
  });

  test('the "select all that apply" chip renders in Urdu with the ux-strings text', () => {
    const html = renderMulti('ur');
    expect(html).toMatch(/class="multichip"/);
    expect(html).toContain(resolveUx('vqMultiSelectAll', { language: 'ur' }));
    // and the Urdu doc never leaks the English chrome/chip text
    expect(html).not.toContain(resolveUx('vqMultiSelectAll', { language: 'en' }));
  });

  test('exactly one miss line per wrong option with a misconception; none for A or C even though they also have entries', () => {
    const html = renderMulti('en');
    expect([...html.matchAll(/<div class="miss">/g)]).toHaveLength(2);
    expect(html).toMatch(/thinks even numbers can be prime/);
    expect(html).toMatch(/confuses composite with prime/);
    expect(html).not.toMatch(/MUST-NOT-RENDER/);
  });

  test('regression guard: a single-answer question still renders exactly one correct row and no multi chip', () => {
    const single = { ...MULTI_ROW, correct_option: 'B', media: undefined };
    const html = renderMulti('en', [single]);
    const marked = [...html.matchAll(/<div class="opt( correct)? content"/g)].map((m) => Boolean(m[1]));
    expect(marked.filter(Boolean)).toHaveLength(1);
    expect(html).not.toMatch(/class="multichip"/);
  });
});

describe('bd-mg9c7.77 — vqMultiSelectAll exists in both languages, within the PDF chip length', () => {
  test('en and ur variants exist; code-point length reported for both (no invented cap)', () => {
    expect(UX_STRINGS.vqMultiSelectAll.en).toBeTruthy();
    expect(UX_STRINGS.vqMultiSelectAll.ur).toBeTruthy();
    const enLen = [...UX_STRINGS.vqMultiSelectAll.en].length;
    const urLen = [...UX_STRINGS.vqMultiSelectAll.ur].length;
    // eslint-disable-next-line no-console
    console.log(`vqMultiSelectAll code-point length — en:${enLen} ur:${urLen}`);
    expect(enLen).toBeGreaterThan(0);
    expect(urLen).toBeGreaterThan(0);
  });
});
