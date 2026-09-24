'use strict';
/**
 * The teacher's quiz PDF must be able to draw the Urdu INSIDE a figure.
 *
 * Sandbox, 23 Sep: a word_blank question on سلام reached the child as four
 * letter tiles (س ل ☐ م) — and reached the teacher's PDF as four EMPTY tiles.
 * The diagram engine writes Urdu into a foreignObject whose font stack is
 * 'Noto Nastaliq Urdu','Gulzar','Noto Naskh Arabic',serif. The teacher page
 * embeds Nastaliq under a different family name, so on the Linux worker
 * (no system Urdu font) none of those families exists and every letter is
 * drawn in nothing. A Mac has Noto Nastaliq Urdu installed system-wide, which
 * is why a local render looked right.
 *
 * The property: every font stack the figure uses for Urdu names at least one
 * family this page EMBEDS (an @font-face), before its generic fallback. Both
 * are read from the real renderers — the figure engine and the template.
 */
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const unquote = (f) => f.trim().replace(/^['"]|['"]$/g, '');

/** Family names this page declares with @font-face. */
function embeddedFamilies(html) {
  return new Set([...html.matchAll(/@font-face\s*\{[^}]*font-family:\s*([^;}]+)/g)].map((m) => unquote(m[1])));
}

/** The font stack of every Urdu text box the figure draws. */
function urduStacks(svg) {
  return [...svg.matchAll(/<div[^>]*lang="ur"[^>]*style="([^"]*)"/g)]
    .map((m) => (m[1].match(/font-family:([^;]+)/) || [])[1])
    .filter(Boolean)
    .map((stack) => stack.split(',').map(unquote));
}

const QUESTION = {
  question_text: "تصویر میں 'سلام' لفظ کے جوڑ توڑ میں کون سا حرف غائب ہے؟",
  option_a: 'ا', option_b: 'س', option_c: 'ل', correct_option: 'A',
  explanation: 'سلام میں س، ل، ا، م ہیں۔',
  option_feedback: { correct: 'ٹھیک', wrong: { 1: 'نہیں', 2: 'نہیں' } },
};
const BASE = {
  topic: 'تیمارداری کے آداب', teacherName: 'Rifat Noor', grade: '3', date: '16 ستمبر 2026',
  link: 'https://wa.me/923222482222?text=QUIZ-ABC234',
  digest: { subject: 'islamiat', slos: [{ id: 'S1', statement: 'الفاظ کے جوڑ توڑ', taught_level: 'recall' }] },
  language: 'ur', lessonSummary: 'آپ نے سلام کے حروف الگ الگ کر کے دکھائے۔',
};

describe('an Urdu figure on the teacher PDF has a font it can draw with', () => {
  const svg = Figure.renderFigureSvg({ type: 'word_blank', word: 'سلام', style: 'tiles', blanks: [2] }, 'ur');
  const html = render({ ...BASE, questions: [{ ...QUESTION, figureSvg: svg }] });

  test('the figure really does draw its letters as Urdu text boxes (the case under test)', () => {
    expect(html).toContain(svg);
    expect(urduStacks(svg).length).toBe(3); // س ل م — the blank tile has no text
  });

  test('every Urdu font stack in the figure names a family this page embeds', () => {
    const embedded = embeddedFamilies(html);
    const unreachable = urduStacks(svg)
      .filter((stack) => {
        const named = stack.filter((f) => !GENERIC.has(f.toLowerCase()));
        return !named.some((f) => embedded.has(f));
      })
      .map((stack) => stack.join(', '));
    expect({ embedded: [...embedded].sort(), unreachable }).toEqual({ embedded: [...embedded].sort(), unreachable: [] });
  });

  test('the embedded family comes before every non-Nastaliq fallback, so Naskh or a generic serif never wins', () => {
    const embedded = embeddedFamilies(html);
    for (const stack of urduStacks(svg)) {
      const first = stack.findIndex((f) => embedded.has(f));
      const firstOther = stack.findIndex((f) => !/nastaliq/i.test(f));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(firstOther);
    }
  });
});
