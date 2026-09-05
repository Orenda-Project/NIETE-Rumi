'use strict';
/**
 * The QUESTION CARD: when a stem or option carries notation WhatsApp cannot
 * draw (x², H₂O, sets, roots) or text too long for a reply button, the whole
 * question — figure, stem, lettered options — is rendered as one NIETE image
 * and the child taps A / B / C. Operator, 2026-09-05 21:48.
 */
const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');

describe('needsQuestionCard', () => {
  const q = (question, options) => ({ question, options });
  test('plain short questions do not need a card', () => {
    expect(Card.needsQuestionCard(q('What is 2 + 3?', ['5', '6', '4']))).toBe(false);
    expect(Card.needsQuestionCard(q('ایک Fraction کیا ہوتا ہے؟', ['حصہ', 'پورا', 'نمبر']))).toBe(false);
  });
  test('notation in the stem or an option needs a card', () => {
    expect(Card.needsQuestionCard(q('What is x^2 when x = 3?', ['9', '6', '3']))).toBe(true);
    expect(Card.needsQuestionCard(q('Which is water?', ['H2O', 'CO2', 'NaCl']))).toBe(true);
    expect(Card.needsQuestionCard(q('Which set has 3 members?', ['{1, 2, 3}', '{1}', '{}']))).toBe(true);
    expect(Card.needsQuestionCard(q('What is √16?', ['4', '8', '2']))).toBe(true);
    expect(Card.needsQuestionCard(q('Area of a 3 cm square?', ['9 cm²', '6 cm²', '12 cm²']))).toBe(true);
  });
  test('an option longer than a reply button (20 code points) needs a card', () => {
    expect(Card.needsQuestionCard(q('Which is right?', ['نیچے، Denominator میں', 'اوپر', 'کہیں بھی']))).toBe(true);
  });
});

describe('notation helpers', () => {
  test('richNotation turns ^ and _ and formula digits into sup/sub HTML', () => {
    expect(Card.richNotation('x^2 + y_1')).toBe('x<sup>2</sup> + y<sub>1</sub>');
    expect(Card.richNotation('H2O and CO2')).toBe('H<sub>2</sub>O and CO<sub>2</sub>');
    expect(Card.richNotation('a^{10}')).toBe('a<sup>10</sup>');
    expect(Card.richNotation('Grade 4 class')).toBe('Grade 4 class');
  });
  test('unicodeNotation gives WhatsApp text real superscript/subscript digits', () => {
    expect(Card.unicodeNotation('x^2')).toBe('x²');
    expect(Card.unicodeNotation('H2O')).toBe('H₂O');
    expect(Card.unicodeNotation('3/4')).toBe('3/4');
  });
});

describe('renderQuestionCardHtml', () => {
  test('the card shows the figure, then the stem, then the options in DISPLAY order with letter handles', () => {
    const html = Card.renderQuestionCardHtml({
      stem: 'تصویر میں کتنا حصہ رنگا ہوا ہے؟', options: ['3/4', '1/4', '4/1'], displayOrder: [1, 2, 0],
      figureSvg: '<svg viewBox="0 0 10 10"></svg>', language: 'ur', questionNumber: 6, total: 8,
    });
    const iFig = html.indexOf('<svg'); const iStem = html.indexOf('تصویر میں'); const iA = html.indexOf('>A<');
    expect(iFig).toBeGreaterThan(-1); expect(iStem).toBeGreaterThan(iFig); expect(iA).toBeGreaterThan(iStem);
    // A = options[1] = 1/4, B = 4/1, C = 3/4
    const rows = [...html.matchAll(/data-letter="([ABC])"[^>]*>[\s\S]*?class="opt-text"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]);
    expect(rows).toEqual([['A', '1/4'], ['B', '4/1'], ['C', '3/4']]);
    expect(html).toMatch(/dir="rtl"/);
    expect(html).toMatch(/NastaliqUrdu|Noto Nastaliq/);
    expect(html).toMatch(/#47BA7D/i);
  });
});

describe('every text on the card has Urdu glyphs available (the Railway container has no system fonts)', () => {
  test('the counter and the footer line carry a Nastaliq family in their font stack', () => {
    const html = Card.renderQuestionCardHtml({ stem: 'x', options: ['a', 'b', 'c'], displayOrder: [0, 1, 2], language: 'ur', questionNumber: 5, total: 8 });
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const counter = css.match(/\.counter\{([^}]*)\}/)[1];
    const foot = css.match(/\.foot\{([^}]*)\}/)[1];
    expect(counter).toMatch(/Nastaliq/);
    expect(foot).toMatch(/Nastaliq/);
  });
});
