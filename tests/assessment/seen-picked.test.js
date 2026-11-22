/**
 * AG row 21 (Amena 21 Nov) — the book questions she ticked, one by one, from a chapter's exercises.
 *
 * `seenPicked: [{ chapter, ref, text, type }]` is checked here (pure), turned into the per-type Seen counts the
 * paper already understands (seenTypes), and written into the prompt as the exact questions to copy.
 */
const SeenPicked = require('../../bot/shared/services/assessment/seen-picked');

const ALLOWED = ['MCQs', 'True/False', 'Brief Answers', 'Fill in the Blanks'];
const categoryOf = (id) => (id === 'Brief Answers' ? 'subjective' : 'objective');
const pick = (over = {}) => ({ chapter: 3, ref: 'Exercise 3.1 · Q1', text: 'What do plants need to grow?', type: 'Brief Answers', ...over });

describe('clean', () => {
  test('keeps good picks, trimmed, in her order', () => {
    const out = SeenPicked.clean([pick({ text: '  What do plants need?  ' }), pick({ ref: 'Q2', type: 'MCQs', text: 'Pick one' })],
      { allowed: ALLOWED, chapters: [3] });
    expect(out.error).toBeUndefined();
    expect(out.picks).toEqual([
      { chapter: 3, ref: 'Exercise 3.1 · Q1', text: 'What do plants need?', type: 'Brief Answers' },
      { chapter: 3, ref: 'Q2', text: 'Pick one', type: 'MCQs' },
    ]);
  });

  test('a type the subject does not have is refused', () => {
    expect(SeenPicked.clean([pick({ type: 'Word Problems' })], { allowed: ALLOWED, chapters: [3] }).error).toMatch(/type/i);
  });

  test('a question from a chapter she did not pick is refused', () => {
    expect(SeenPicked.clean([pick({ chapter: 4 })], { allowed: ALLOWED, chapters: [3] }).error).toMatch(/chapter/i);
  });

  test('empty text, or text too long, is refused', () => {
    expect(SeenPicked.clean([pick({ text: '   ' })], { allowed: ALLOWED, chapters: [3] }).error).toBeTruthy();
    expect(SeenPicked.clean([pick({ text: 'x'.repeat(SeenPicked.MAX_TEXT + 1) })], { allowed: ALLOWED, chapters: [3] }).error).toBeTruthy();
  });

  test('the same question ticked twice is kept once', () => {
    const out = SeenPicked.clean([pick(), pick()], { allowed: ALLOWED, chapters: [3] });
    expect(out.picks).toHaveLength(1);
  });

  test('more than MAX_PICKS is refused; none is not a list', () => {
    const many = Array.from({ length: SeenPicked.MAX_PICKS + 1 }, (_, i) => pick({ ref: `Q${i}`, text: `Question ${i}` }));
    expect(SeenPicked.clean(many, { allowed: ALLOWED, chapters: [3] }).error).toBeTruthy();
    expect(SeenPicked.clean([], { allowed: ALLOWED, chapters: [3] })).toEqual({ picks: null });
    expect(SeenPicked.clean(undefined, { allowed: ALLOWED, chapters: [3] })).toEqual({ picks: null });
  });
});

describe('toTypes', () => {
  test('counts her picks per type, first-seen order, each with its category', () => {
    const picks = [pick({ type: 'MCQs', ref: 'a' }), pick({ type: 'Brief Answers', ref: 'b' }), pick({ type: 'MCQs', ref: 'c' })];
    expect(SeenPicked.toTypes(picks, categoryOf)).toEqual([
      { id: 'MCQs', count: 2, category: 'objective' },
      { id: 'Brief Answers', count: 1, category: 'subjective' },
    ]);
  });
});

describe('promptItems', () => {
  test('lists every ticked question word for word under its type, and says copy them, no others', () => {
    const picks = [pick({ type: 'MCQs', ref: 'Q1', text: 'Which is a mammal?' }), pick({ ref: 'Q5', text: 'Name two parts of a plant.' })];
    const items = SeenPicked.promptItems(picks);
    const text = items.join('\n');
    expect(text).toContain('Which is a mammal?');
    expect(text).toContain('Name two parts of a plant.');
    expect(text).toMatch(/MCQs/);
    expect(text).toMatch(/Brief Answers/);
    expect(text).toMatch(/exactly these 2/i);
    expect(text).toMatch(/word for word/i);
  });
});
