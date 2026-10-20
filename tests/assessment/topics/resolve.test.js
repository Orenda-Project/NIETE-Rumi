/**
 * Task 5 — resolveTopics(all, ids): the ticked topics of one chapter -> the pages and SLOs a paper is written from.
 *
 * G1 Maths Ch3 below is groupChapter's real output for the live matrix (CSV export 2026-10-20), trimmed to the
 * fields the resolver reads. Days 31-33 are "How many more?" (pp 58-63), days 46-47 "Subtraction" (pp 90-95).
 */
const { resolveTopics, TopicNotFound } = require('../../../bot/shared/services/assessment/topics/resolve');

const t = (topicId, name, sortOrder, pages, sloCodes, sloDescriptions, days) => ({
  topicId, grade: 1, subject: 'maths', chapterNumber: 3, name, heading: null, headingOrder: null,
  sortOrder, pages, sloCodes, sloDescriptions, days,
});
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

const G1_MATHS_CH3 = [
  t('1-maths-3-m-01-as-01', 'How many more?', 1, range(58, 63), ['M-01-AS-01'],
    ['I can compare numbers to find how many more.'], [31, 32, 33]),
  t('1-maths-3-m-01-as-02', 'Addition Facts to 20', 2, range(64, 70), ['M-01-AS-02'],
    ['I can find, recall and use addition facts to 20.'], [34, 35, 36, 37]),
  t('1-maths-3-m-01-as-03', 'Add 2-digit numbers mentally', 3, range(71, 77), ['M-01-AS-03'],
    ['I can add 2-digit numbers mentally and in written form.'], [38, 39]),
  t('1-maths-3-m-01-as-04', 'How many Less?', 4, range(77, 83), ['M-01-AS-04'],
    ['I can compare numbers to find how many less.'], [40, 41, 42]),
  t('1-maths-3-m-01-as-06', 'Subtraction Facts to 20', 5, range(84, 89), ['M-01-AS-06', 'M-01-AS-05'],
    ['I can find, recall and use subtraction facts to 20.', 'I know addition and subtraction fact families to 20.'],
    [43, 44, 45]),
  t('1-maths-3-m-01-as-07', 'Subtraction', 6, range(90, 95), ['M-01-AS-07'],
    ['I can subtract 2-digit numbers mentally and in written form.'], [46, 47]),
  t('1-maths-3-word-problems', 'Word problems', 7, [...range(96, 103), 105, 106], ['M-01-AS-08'],
    ['I can solve real-world word problems with addition and subtraction using concrete objects and pictorial representations.'],
    [48, 49, 50, 51]),
];
const ids = (...xs) => xs.map((i) => G1_MATHS_CH3[i].topicId);

describe('pageRanges', () => {
  test('Maths days 31-33 + 46-47 give "58-63, 90-95", never one merged "58-95"', () => {
    const out = resolveTopics(G1_MATHS_CH3, ids(0, 5));
    expect(out.pageRanges).toBe('58-63, 90-95');
  });

  test('sorted whatever order the ids come in', () => {
    expect(resolveTopics(G1_MATHS_CH3, ids(5, 0)).pageRanges).toBe('58-63, 90-95');
  });

  test('a page two topics share counts once, and touching topics run on', () => {
    // as-03 ends on 77, as-04 starts on 77.
    expect(resolveTopics(G1_MATHS_CH3, ids(2, 3)).pageRanges).toBe('71-83');
  });

  test('adjacent pages collapse; a gap stays a gap; a lone page stands alone', () => {
    expect(resolveTopics(G1_MATHS_CH3, ids(6)).pageRanges).toBe('96-103, 105-106');
    const lone = [t('x', 'X', 1, [12, 9, 10, 14], ['C'], ['d'], [1])];
    expect(resolveTopics(lone, ['x']).pageRanges).toBe('9-10, 12, 14');
  });

  test('topics with no pages give an empty string', () => {
    const none = [t('x', 'X', 1, [], ['C'], ['d'], [1]), t('y', 'Y', 2, null, [], [], [2])];
    expect(resolveTopics(none, ['x', 'y']).pageRanges).toBe('');
  });
});

describe('isAll', () => {
  test('every id gives isAll: true', () => {
    expect(resolveTopics(G1_MATHS_CH3, G1_MATHS_CH3.map((x) => x.topicId)).isAll).toBe(true);
  });

  test('every id, in any order and with a repeat, is still all', () => {
    const all = G1_MATHS_CH3.map((x) => x.topicId).reverse();
    expect(resolveTopics(G1_MATHS_CH3, [...all, all[0]]).isAll).toBe(true);
  });

  test('one fewer is not all', () => {
    expect(resolveTopics(G1_MATHS_CH3, ids(0, 1, 2, 3, 4, 5)).isAll).toBe(false);
  });
});

describe('topics', () => {
  test('the ticked topics in the chapter\'s order, each once', () => {
    const out = resolveTopics(G1_MATHS_CH3, ids(5, 0, 5));
    expect(out.topics.map((x) => x.topicId)).toEqual(ids(0, 5));
  });

  test('sorted by sortOrder, not by where they sit in the input', () => {
    const shuffled = [G1_MATHS_CH3[5], G1_MATHS_CH3[0]];
    expect(resolveTopics(shuffled, ids(0, 5)).topics.map((x) => x.sortOrder)).toEqual([1, 6]);
  });
});

describe('slos', () => {
  test('each ticked topic\'s SLO, with its description and topic', () => {
    expect(resolveTopics(G1_MATHS_CH3, ids(0, 5)).slos).toEqual([
      { code: 'M-01-AS-01', description: 'I can compare numbers to find how many more.',
        topicId: '1-maths-3-m-01-as-01', topicName: 'How many more?' },
      { code: 'M-01-AS-07', description: 'I can subtract 2-digit numbers mentally and in written form.',
        topicId: '1-maths-3-m-01-as-07', topicName: 'Subtraction' },
    ]);
  });

  test('an SLO shared by two ticked topics appears once, under the first topic', () => {
    const shared = [
      t('a', 'A', 1, [1], ['S-1', 'S-2'], ['one', 'two'], [1]),
      t('b', 'B', 2, [2], ['S-2', 'S-3'], ['two', 'three'], [2]),
    ];
    const out = resolveTopics(shared, ['b', 'a']);
    expect(out.slos.map((s) => s.code)).toEqual(['S-1', 'S-2', 'S-3']);
    expect(out.slos.find((s) => s.code === 'S-2').topicId).toBe('a');
  });

  test('descriptions are a set: a several-code topic gives every code the whole set, never one by position', () => {
    const out = resolveTopics(G1_MATHS_CH3, ids(4));
    const both = 'I can find, recall and use subtraction facts to 20. / I know addition and subtraction fact families to 20.';
    expect(out.slos).toEqual([
      { code: 'M-01-AS-06', description: both, topicId: '1-maths-3-m-01-as-06', topicName: 'Subtraction Facts to 20' },
      { code: 'M-01-AS-05', description: both, topicId: '1-maths-3-m-01-as-06', topicName: 'Subtraction Facts to 20' },
    ]);
  });

  test('more descriptions than codes stay together on the one code', () => {
    const out = resolveTopics([t('x', 'X', 1, [1], ['C-1'], ['part one', 'part two'], [1])], ['x']);
    expect(out.slos[0].description).toBe('part one / part two');
  });

  test('a topic with no codes adds no SLO; missing descriptions are an empty string', () => {
    const out = resolveTopics([t('x', 'X', 1, [1], null, null, [1]), t('y', 'Y', 2, [2], ['C'], null, [2])], ['x', 'y']);
    expect(out.slos).toEqual([{ code: 'C', description: '', topicId: 'y', topicName: 'Y' }]);
  });
});

describe('refusals', () => {
  test('an unknown id throws TopicNotFound naming it', () => {
    let err;
    try { resolveTopics(G1_MATHS_CH3, [ids(0)[0], 'nope', 'nada']); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TopicNotFound);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TopicNotFound');
    expect(err.code).toBe('TOPIC_NOT_FOUND');
    expect(err.ids).toEqual(['nope', 'nada']);
    expect(err.message).toBe('Unknown topic id(s): nope, nada');
  });

  test('an id from another chapter is unknown here', () => {
    expect(() => resolveTopics(G1_MATHS_CH3.slice(0, 3), ids(5))).toThrow(TopicNotFound);
  });

  test('no ids is refused, not read as "the whole chapter"', () => {
    expect(() => resolveTopics(G1_MATHS_CH3, [])).toThrow('pick at least one topic');
    expect(() => resolveTopics(G1_MATHS_CH3, undefined)).toThrow('pick at least one topic');
  });

  test('inputs are not changed', () => {
    const before = JSON.stringify(G1_MATHS_CH3);
    const picked = ids(5, 0);
    resolveTopics(G1_MATHS_CH3, picked);
    expect(JSON.stringify(G1_MATHS_CH3)).toBe(before);
    expect(picked).toEqual(ids(5, 0));
  });
});
