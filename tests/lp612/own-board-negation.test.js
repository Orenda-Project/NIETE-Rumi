/**
 * bd-snkn32.47 — the G1-5 board gate (no board in her resources) fired on every mention of a board, including the
 * plan saying the right thing: "ایک جملہ بورڈ کی بجائے کتاب کے صفحہ ۱۵۱ سے دیکھ کر" (use the book INSTEAD of the board),
 * seen in the bd-snkn32.44 re-measure (grade_3_urdu_ch15_seg4, round 1). Negated mentions are skipped; any real
 * use of a board on the same line still refuses.
 */
const { checkK5Rewrite } = require('../../bot/shared/services/lp-k5-own');

const script = (say) => ({
  goal: 'Name the parts of a plant.',
  meta: { day: 1 },
  hook: { warmUp: { teacherAsks: 'What do plants need?' } },
  iDo: { steps: [{ n: 1, say }] },
  weDo: { action: 'Point to each part on page 4.' },
  youDo: { action: 'Each child labels page 5 alone.' },
  wrap: { exitOptions: [{ prompt: 'Name one part.' }] },
});
const reasons = (say, resources = ['textbook']) =>
  checkK5Rewrite(script('Look at page 4.'), script(say), { resources }).join('; ');

const NEGATED = [
  'ایک جملہ بورڈ کی بجائے کتاب کے صفحہ ۱۵۱ سے دیکھ کر سب مل کر پڑھیں۔',
  'بورڈ کے بجائے کتاب دیکھیں۔',
  'بورڈ کی جگہ کتاب کی تصویر دکھائیں۔',
  'بغیر بورڈ کے، کتاب سے پڑھائیں۔',
  'تختہ سیاہ کی بجائے کتاب کا صفحہ دکھائیں۔',
  'بورڈ استعمال نہ کریں، کتاب دیکھیں۔',
  'Instead of the board, point to page 4.',
  'Use the book instead of the board.',
  'No board needed.',
  'Teach it without a board.',
  "Don't use the board; hold up the book.",
];
const REAL = [
  'بورڈ پر لکھیں۔',
  'تختہ سیاہ پر سوال لکھیں۔',
  'Write the word on the board.',
  'Call three children to the blackboard.',
  'بورڈ کی بجائے کتاب دیکھیں، پھر بورڈ پر لکھیں۔',
  'Instead of the book, use the board.',
];

describe('board gate, no board: negated mentions pass', () => {
  it.each(NEGATED)('passes "%s"', (say) => expect(reasons(say)).toBe(''));
});

describe('board gate, no board: real board use still refuses', () => {
  it.each(REAL)('refuses "%s"', (say) => expect(reasons(say)).toMatch(/uses a board she does not have/));
});

describe('board gate, she has a board: nothing refuses', () => {
  it.each([...NEGATED, ...REAL])('passes "%s"', (say) => expect(reasons(say, ['textbook', 'board'])).toBe(''));
});
