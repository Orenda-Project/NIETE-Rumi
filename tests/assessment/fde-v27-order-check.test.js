/**
 * Story order: the task is printed, one answer line, a "Finally" sentence keyed last
 * (bd-5jmnfj.4.58.2, v26 finding 4).
 *
 * v26 g2-english-exam.json Q16: `main_question` says "Write the letters in order." but only
 * `question` printed; itemBody gave each of the six sentences its own 12mm write-box
 * (eachBox, renderer itemBody); and the sentence "Finally, the seeds grew into tall sunflowers." (b)
 * was keyed fifth in the answer "c, e, a, d, b, f".
 */

const fs = require('fs');
const path = require('path');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { finallyNotLast, lastSentence } = require('../../bot/shared/services/assessment/fde-order-check');

const exam = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v26', 'g2-english-trimmed.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const story = () => exam.unseen.subjective['Story Order'][0];
const E = Patterns.subjectOf('fde_g2_2026', 'english');
const FDE = { kind: 'fde', chapters: null, pages: null };
const block = (html) => {
  const at = html.indexOf('data-slot="g2.english.C.Q16"');
  return html.slice(at, at + 6000);
};

describe('the printed story-order item', () => {
  const html = R.renderPaper({ examJson: exam, grade: 2, subject: 'english' });
  const b = block(html);
  test('prints "Write the letters in order."', () => {
    expect(b).toContain('Write the letters in order.');
  });
  test('gives one answer box, not one under each of the six sentences', () => {
    expect(b.match(/class="write-box"/g) || []).toHaveLength(1);
  });
  test('the six sentences stay lettered (a) to (f)', () => {
    expect(b.match(/class="sub"/g)).toHaveLength(6);
  });
});

describe('finallyNotLast', () => {
  test('is true when the Finally sentence is not the keyed last (v26 Q16)', () => {
    expect(finallyNotLast(story())).toBe(true);
  });
  test('is false once the Finally sentence is keyed last', () => {
    const q = clone(story());
    q.answer = 'c, e, a, d, f, b';
    q.scheme.accept = [q.answer];
    expect(finallyNotLast(q)).toBe(false);
  });
  test('reads a numeric key too, and catches "At last"', () => {
    const q = clone(story());
    q.questions[1] = 'At last, the seeds grew into tall sunflowers.';
    q.answer = '3, 5, 1, 4, 2, 6';
    q.scheme.accept = [q.answer];
    expect(finallyNotLast(q)).toBe(true);
    q.answer = '3, 5, 1, 4, 6, 2';
    q.scheme.accept = [q.answer];
    expect(finallyNotLast(q)).toBe(false);
  });
  test('is false with no closing word, or an unreadable key', () => {
    const q = clone(story());
    q.questions[1] = 'The seeds grew into tall sunflowers.';
    expect(finallyNotLast(q)).toBe(false);
    expect(finallyNotLast({ ...clone(story()), answer: 'see key', scheme: { accept: [] } })).toBe(false);
  });
  test('lastSentence is the index of the keyed last sentence', () => {
    expect(lastSentence(story())).toBe(5);
  });
});

describe('the layout holds a story whose Finally sentence is not keyed last', () => {
  test('Q16 is reported short and the item is not placed', () => {
    const out = applyLayout(clone({ unseen: { subjective: { 'Story Order': [story()] } } }), E, FDE, {});
    expect(out.examJson.unseen.subjective['Story Order'] || []).toHaveLength(0);
    expect(out.shortfall).toContainEqual({ slot: 'g2.english.C.Q16', missing: 1 });
  });
  test('the same story keyed right is placed', () => {
    const q = clone(story());
    q.answer = 'c, e, a, d, f, b';
    q.scheme.accept = ['c, e, a, d, f, b'];
    const out = applyLayout({ unseen: { subjective: { 'Story Order': [q] } } }, E, FDE, {});
    expect(out.examJson.unseen.subjective['Story Order']).toHaveLength(1);
  });
});
