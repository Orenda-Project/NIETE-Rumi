import { describe, it, expect } from 'vitest';
import { STEPS, TOPIC_STEPS, newPicks, stepWhy, toSpec, fromSpec, type Picks } from './model';
import {
  type OfferedType, chooseTopics, chooseWhole, clearTopics, groupForScreen, setTicked, suggestTypes, tickedOf, topicDefaults, topicsApply,
} from './topics';

/**
 * Task 8 — the Topics step's rules (spec §4, §6): whole chapter or chosen topics, grouped headings for English and
 * Urdu, a flat list for Maths and Science, all ticked = the chapter paper, a strict subset = a topic paper with
 * 10 marks and types suggested by heading.
 */

const t = (topicId: string, name: string, heading: string | null, headingOrder: number | null, sortOrder: number) => (
  { topicId, name, heading, headingOrder, sortOrder });

// G1 English Ch1 (spec §4.1), served in book order: the headings come in their own order on screen.
const ENGLISH = [
  t('e1', 'Meet Pinky', 'Reading', 2, 1),
  t('e2', 'Key Words', 'Vocabulary & grammar', 3, 2),
  t('e3', 'Rhyming Words', 'Vocabulary & grammar', 3, 3),
  t('e4', 'Introducing Myself', 'Writing', 5, 4),
  t('e5', 'Speaking Up & Showing Feelings', 'Oral communication', 4, 5),
];
const MATHS = [t('m2', 'Addition facts to 20', null, null, 2), t('m1', 'How many more?', null, null, 1), t('m7', 'Word problems', null, null, 7)];

const ENG_TYPES = ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Rewrite Sentences', 'Listening', 'Speaking']
  .map((id): OfferedType => ({ id, category: 'objective' }))
  .concat(['Comprehension Passage', 'Simple Writing'].map((id): OfferedType => ({ id, category: 'subjective' })));
const MATHS_TYPES = [
  { id: 'MCQs', category: 'objective' as const }, { id: 'Fill in the Blanks', category: 'objective' as const },
  { id: 'Short Questions', category: 'subjective' as const }, { id: 'Word Problems', category: 'subjective' as const },
];

const ONE = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 1, subject: 'english', subjectName: 'English', chapters: [1], ...over,
});

describe('the steps', () => {
  it('today\'s four steps stay STEPS; a chapter with topics walks five, Topics after Chapters', () => {
    expect([...STEPS]).toEqual(['class', 'cover', 'questions', 'check']);
    expect([...TOPIC_STEPS]).toEqual(['class', 'cover', 'topics', 'questions', 'check']);
  });

  it('Topics applies only to exactly one chapter, never pages or several chapters', () => {
    expect(topicsApply(ONE())).toBe(true);
    expect(topicsApply(ONE({ chapters: [1, 2] }))).toBe(false);
    expect(topicsApply(ONE({ chapters: [] }))).toBe(false);
    expect(topicsApply(ONE({ coverBy: 'pages', ranges: [[1, 4]] }))).toBe(false);
    expect(topicsApply(ONE({ coverBy: 'fde', style: 'fde', pattern: 'p' }))).toBe(false);
  });
});

describe('groupForScreen', () => {
  it('English: grouped under the headings, in heading order, topics in book order', () => {
    const g = groupForScreen(ENGLISH);
    expect(g.grouped).toBe(true);
    expect(g.groups.map((x) => x.heading)).toEqual(['Reading', 'Vocabulary & grammar', 'Oral communication', 'Writing']);
    expect(g.groups[1].topics.map((x) => x.name)).toEqual(['Key Words', 'Rhyming Words']);
  });

  it('Maths: one flat list in book order', () => {
    const g = groupForScreen(MATHS);
    expect(g.grouped).toBe(false);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].heading).toBeNull();
    expect(g.groups[0].topics.map((x) => x.topicId)).toEqual(['m1', 'm2', 'm7']);
  });

  it('nothing in, nothing out', () => {
    expect(groupForScreen([])).toEqual({ grouped: false, groups: [] });
  });
});

describe('suggestTypes (spec §6 table), only types the subject offers', () => {
  it('Vocabulary & grammar → MCQs, Fill in the Blanks, Rewrite Sentences, Matching', () => {
    expect(suggestTypes('english', [ENGLISH[1]], ENG_TYPES)).toEqual(['MCQs', 'Fill in the Blanks', 'Rewrite Sentences', 'Match the Column']);
  });
  it('Reading → a passage with questions; Writing → a short writing task; Oral → Listening, Speaking', () => {
    expect(suggestTypes('english', [ENGLISH[0]], ENG_TYPES)).toEqual(['Comprehension Passage']);
    expect(suggestTypes('english', [ENGLISH[3]], ENG_TYPES)).toEqual(['Simple Writing']);
    expect(suggestTypes('english', [ENGLISH[4]], ENG_TYPES)).toEqual(['Listening', 'Speaking']);
  });
  it('Phonics → Matching, Fill in the Blanks', () => {
    expect(suggestTypes('english', [t('p', 'Sounds', 'Phonics', 1, 1)], ENG_TYPES)).toEqual(['Match the Column', 'Fill in the Blanks']);
  });
  it('Urdu headings: قواعد and الفاظ و معانی as grammar, تفہیم as reading, بلند خوانی as oral, تخلیقی لکھائی as writing', () => {
    const u = (h: string) => suggestTypes('urdu', [t('u', 'x', h, 1, 1)], ENG_TYPES);
    expect(u('قواعد')).toEqual(['MCQs', 'Fill in the Blanks', 'Rewrite Sentences', 'Match the Column']);
    expect(u('الفاظ و معانی')).toEqual(u('قواعد'));
    expect(u('تفہیم')).toEqual(['Comprehension Passage']);
    expect(u('بلند خوانی')).toEqual(['Listening', 'Speaking']);
    expect(u('تخلیقی لکھائی')).toEqual(['Simple Writing']);
    expect(u('ارکان سازی')).toEqual(['Match the Column', 'Fill in the Blanks']);
  });
  it('several headings: their types once each, in heading order', () => {
    expect(suggestTypes('english', [ENGLISH[4], ENGLISH[1]], ENG_TYPES))
      .toEqual(['MCQs', 'Fill in the Blanks', 'Rewrite Sentences', 'Match the Column', 'Listening', 'Speaking']);
  });
  it('Maths: objective + short calculation; word problems only for the word-problem topic', () => {
    expect(suggestTypes('maths', [MATHS[1]], MATHS_TYPES)).toEqual(['MCQs', 'Fill in the Blanks', 'Short Questions']);
    expect(suggestTypes('maths', [MATHS[2]], MATHS_TYPES)).toEqual(['MCQs', 'Fill in the Blanks', 'Short Questions', 'Word Problems']);
  });
  it('Science: MCQs, Fill in the Blanks, short answer (the diagram type is not offered)', () => {
    const sci = [{ id: 'MCQs', category: 'objective' as const }, { id: 'Fill in the Blanks', category: 'objective' as const },
      { id: 'Brief Answers', category: 'subjective' as const }];
    expect(suggestTypes('science', [t('s', 'Plants', null, null, 1)], sci)).toEqual(['MCQs', 'Fill in the Blanks', 'Brief Answers']);
  });
});

describe('topicDefaults', () => {
  it('10 marks, no book questions, 2 of each objective type and 1 of each written one', () => {
    expect(topicDefaults('english', [ENGLISH[1], ENGLISH[0]], ENG_TYPES)).toEqual({
      marks: 10, seen: 0, typesSeeded: true,
      typeCounts: { MCQs: 2, 'Fill in the Blanks': 2, 'Rewrite Sentences': 2, 'Match the Column': 2, 'Comprehension Passage': 1 },
    });
  });
  it('never more questions than the 10 marks: objective types drop to 1 from the end', () => {
    const d = topicDefaults('english', ENGLISH.slice(1), ENG_TYPES);
    const total = Object.values(d.typeCounts).reduce((s, n) => s + n, 0);
    expect(total).toBeLessThanOrEqual(10);
    expect(d.typeCounts.MCQs).toBe(2);
    expect(d.typeCounts.Speaking).toBe(1);
  });
  it('no suggestion offered: the default mix over 5 questions', () => {
    expect(topicDefaults('english', [ENGLISH[1]], [{ id: 'True/False', category: 'objective' }]).typeCounts).toEqual({ 'True/False': 5 });
  });
});

describe('the choices', () => {
  const all = ENGLISH;
  const offered = ENG_TYPES;

  it('Whole chapter: topicIds null, and the request is today\'s, byte for byte', () => {
    const before = ONE({ typesSeeded: true, typeCounts: { MCQs: 10 } });
    const after = { ...before, ...chooseWhole(before) };
    expect(after).toMatchObject({ topicScope: 'chapter', topicIds: null });
    expect(toSpec(after)).toEqual(toSpec(before));
    expect('topicIds' in toSpec(after)).toBe(false);
  });

  it('Select topics opens with nothing ticked, and Topics will not go on until one is', () => {
    const p = { ...ONE(), ...chooseTopics(ONE()) };
    expect(p).toMatchObject({ topicScope: 'topics', topicIds: [] });
    expect(tickedOf(p, all)).toEqual([]);
    expect(stepWhy('topics', p, 50)).toEqual({ code: 'topics' });
    expect(stepWhy('check', p, 50)).toEqual({ code: 'earlier', step: 'topics' });
    const one = { ...p, ...setTicked(p, ['e2'], all, offered) };
    expect(stepWhy('topics', one, 50)).toBeNull();
  });

  it('a strict subset is a topic paper: its ids sent in book order, 10 marks, types by heading', () => {
    const p = { ...ONE(), ...chooseTopics(ONE()) };
    const sub = { ...p, ...setTicked(p, ['e3', 'e2'], all, offered) };
    expect(sub.topicIds).toEqual(['e2', 'e3']);
    expect(sub.marks).toBe(10);
    expect(Object.keys(sub.typeCounts)).toEqual(['MCQs', 'Fill in the Blanks', 'Rewrite Sentences', 'Match the Column']);
    expect(toSpec(sub)).toMatchObject({ topicIds: ['e2', 'e3'], chapterNumbers: [1], totalMarks: 10, contentSource: 'unseen' });
  });

  it('ticking every topic is the whole chapter: topicIds null, today\'s request, the defaults undone', () => {
    const start = ONE();
    const p = { ...start, ...chooseTopics(start) };
    const sub = { ...p, ...setTicked(p, ['e2'], all, offered) };
    const every = { ...sub, ...setTicked(sub, all.map((x) => x.topicId), all, offered) };
    expect(every.topicIds).toBeNull();
    expect(tickedOf(every, all)).toEqual(all.map((x) => x.topicId));
    expect(stepWhy('topics', every, 50)).toBeNull();
    expect(every).toMatchObject({ marks: null, typeCounts: {}, typesSeeded: false, seen: start.seen });
    expect(toSpec(every)).toEqual(toSpec(start));
  });

  it('unticking one from all makes the subset defaults; the teacher can still change marks and types after', () => {
    const p = { ...ONE(), ...chooseTopics(ONE()) };
    const every = { ...p, ...setTicked(p, all.map((x) => x.topicId), all, offered) };
    const less = { ...every, ...setTicked(every, ['e1', 'e2', 'e3', 'e4'], all, offered) };
    expect(less.marks).toBe(10);
    const hers = { ...less, marks: 20, typeCounts: { MCQs: 3 } };
    expect(toSpec(hers)).toMatchObject({ totalMarks: 20, questionTypes: [{ id: 'MCQs', count: 3 }], topicIds: ['e1', 'e2', 'e3', 'e4'] });
  });

  it('a topic paper sends topicIds only for one chapter', () => {
    const sub = ONE({ topicScope: 'topics', topicIds: ['e2'], chapters: [1, 2] });
    expect('topicIds' in toSpec(sub)).toBe(false);
  });

  it('clearTopics (a new chapter or class): back to no choice, and a subset\'s defaults undone', () => {
    const sub = ONE({ topicScope: 'topics', topicIds: ['e2'], marks: 10, seen: 0, typeCounts: { MCQs: 2 }, typesSeeded: true });
    expect(clearTopics(sub)).toEqual({ topicScope: null, topicIds: null, marks: null, seen: newPicks(15).seen, typeCounts: {}, typesSeeded: false });
    expect(clearTopics(ONE({ topicScope: 'chapter', marks: 30 }))).toEqual({ topicScope: null, topicIds: null });
  });

  it('Topics never blocks a paper that skipped it', () => {
    expect(stepWhy('topics', ONE(), 50)).toBeNull();
    expect(stepWhy('topics', ONE({ topicScope: 'chapter' }), 50)).toBeNull();
  });

  it('Change choices on a topic paper that failed brings the ticks back', () => {
    const spec = toSpec(ONE({ topicScope: 'topics', topicIds: ['e2'], typesSeeded: true, seen: 0, typeCounts: { MCQs: 2 }, marks: 10 }));
    expect(fromSpec(spec as Parameters<typeof fromSpec>[0], 'English')).toMatchObject({ topicScope: 'topics', topicIds: ['e2'] });
    expect(fromSpec(toSpec(ONE()) as Parameters<typeof fromSpec>[0], 'English')).toMatchObject({ topicScope: null, topicIds: null });
  });
});

/**
 * Task 10 — Maths and Science on. The Topics step holds no subject list: it applies to any one chapter and shows what the
 * server returns (bot GET /assessment/topics), so the subject gate is the data (Science topics exist for G4-5 only).
 */
describe('Maths and Science topics (spec §4.2, §4.3)', () => {
  // G1 Maths Ch3 "Sum and Difference Detectives", as the API serves it (spec §4.2 table), shuffled to prove book order.
  const CH3 = [
    ['m5', 'Subtraction facts + fact families', 5], ['m1', 'How many more?', 1], ['m7', 'Word problems', 7],
    ['m3', 'Adding 2-digit numbers', 3], ['m2', 'Addition facts to 20', 2], ['m6', 'Subtracting 2-digit numbers', 6],
    ['m4', 'How many less?', 4],
  ].map(([id, name, order]) => t(id as string, name as string, null, null, order as number));

  it('Maths G1 Ch3: the seven topics, one flat list in book order, no headings', () => {
    const g = groupForScreen(CH3);
    expect(g.grouped).toBe(false);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].heading).toBeNull();
    expect(g.groups[0].topics.map((x) => x.name)).toEqual([
      'How many more?', 'Addition facts to 20', 'Adding 2-digit numbers', 'How many less?',
      'Subtraction facts + fact families', 'Subtracting 2-digit numbers', 'Word problems',
    ]);
  });

  it('Topics applies to a Maths chapter and a Science chapter as it does to English', () => {
    expect(topicsApply(ONE({ subject: 'maths', subjectName: 'Maths' }))).toBe(true);
    expect(topicsApply(ONE({ grade: 4, subject: 'science', subjectName: 'Science', chapters: [2] }))).toBe(true);
  });

  it('Science G4: the book topics are one flat list, in book order', () => {
    const g = groupForScreen([t('s2', 'Parts of a flower', null, null, 2), t('s1', 'Seeds and germination', null, null, 1)]);
    expect(g.grouped).toBe(false);
    expect(g.groups[0].topics.map((x) => x.name)).toEqual(['Seeds and germination', 'Parts of a flower']);
  });

  it('a Maths subset is a topic paper: 10 marks and the Maths types, 2 of each objective and 1 short', () => {
    expect(topicDefaults('maths', [CH3[1]], MATHS_TYPES)).toMatchObject({
      marks: 10, typeCounts: { MCQs: 2, 'Fill in the Blanks': 2, 'Short Questions': 1 },
    });
  });
});
