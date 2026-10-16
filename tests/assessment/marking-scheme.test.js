/**
 * The marking-scheme check.
 *
 * The model writes a scheme for every written item: points that should add to
 * the item's marks, accepted alternatives, the common error. It gets the sums
 * wrong, invents kinds, attaches schemes to MCQs and lists comprehension words
 * that are not in the passage. normaliseScheme keeps only what a teacher can
 * mark with, against the pattern slot each question was set for.
 *
 * Pure functions, no I/O. Fixtures are small and fictional.
 */

const {
  normaliseScheme,
  canonicalBlooms,
  capCodePoints,
} = require('../../bot/shared/services/assessment/marking-scheme');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');

function layoutOf(subject) {
  return { v: 2, subject, sections: P.subjects[subject].sections };
}

// One question in today's tree, with the subject's real slots in `_layout`.
function paper(subject, questions, { type = 'short', category = 'subjective' } = {}) {
  return {
    _layout: layoutOf(subject),
    unseen: { [category]: { [type]: questions } },
  };
}

function first(result, { type = 'short', category = 'subjective' } = {}) {
  return result.examJson.unseen[category][type][0];
}

function wordProblem(points, extra = {}) {
  return {
    slot: 'maths.B.Q2',
    question: 'A shop sold goods worth Rs. 500,000 and spent Rs. 172,250. How much is left?',
    answer: 'Rs. 327,750',
    marks: 5,
    blooms: 'Apply',
    scheme: { points, accept: ['subtracting one amount at a time'], common_error: '422,250 as the answer' },
    ...extra,
  };
}

const URDU_PASSAGE = 'منا اور منی اتوار کو لاہور کے بڑے باغ گئے۔ باغ میں سرخ پھول کھلے تھے۔ منی نے ٹھنڈا پانی پیا اور منا نے گیند پھینکی۔ شام کو دونوں خوش خوش گھر لوٹے۔';

function urduComprehension(pick) {
  return {
    slot: 'urdu.B.Q2',
    question: 'درج ذیل پیراگراف کو غور سے پڑھیں',
    passage: URDU_PASSAGE,
    marks: 20,
    blooms: 'Understand',
    parts: [
      { key: 'questions', questions: [{ question: 'بچے کہاں گئے؟', answer: 'باغ' }] },
      { key: 'pick', pick },
      { key: 'antonyms', antonyms: [['خوش', 'اداس']] },
    ],
  };
}

const ENGLISH_PASSAGE = 'The farmer walked to the river. He carried a basket and sang a song. A small dog followed him home.';

function englishComprehension(pick, questions = [{ question: 'Where did the farmer go?', answer: 'To the river.' }]) {
  return {
    slot: 'english.B.Q2',
    question: 'Read the following passage and answer the questions given at the end.',
    passage: ENGLISH_PASSAGE,
    marks: 20,
    blooms: 'Understand',
    parts: [
      { key: 'questions', questions },
      { key: 'do_as_directed', questions: [] },
      { key: 'pick', pick },
    ],
  };
}

describe('normaliseScheme', () => {
  test('drops scheme on an MCQ', () => {
    const mcq = {
      slot: 'maths.A.Q1a', question: 'Which is the greatest?', options: ['1', '2', '3', '4'], answer: 'd', marks: 1,
      blooms: 'Remember', scheme: { points: [{ text: 'd', marks: 1, kind: 'A' }] },
    };
    const out = first(normaliseScheme(paper('maths', [mcq], { type: 'mcqs', category: 'objective' })), { type: 'mcqs', category: 'objective' });
    expect(out.scheme).toBeUndefined();
    expect(out.answer).toBe('d');

    // An objective slot whose shape is not mcq (English do-as-directed) carries none either.
    const rewrite = { slot: 'english.A.Q1b', question: 'The baby is sleeping. (Change into simple past)', answer: 'The baby slept.', marks: 1, blooms: 'Apply', scheme: { points: [{ text: 'slept', marks: 1, kind: 'A' }] } };
    const out2 = first(normaliseScheme(paper('english', [rewrite], { type: 'rewrite', category: 'objective' })), { type: 'rewrite', category: 'objective' });
    expect(out2.scheme).toBeUndefined();
  });

  test('points that do not sum to the marks are dropped and accept is kept', () => {
    const q = wordProblem([{ text: 'a correct method', marks: 2, kind: 'M' }, { text: '327,750', marks: 2, kind: 'A' }]);
    const result = normaliseScheme(paper('maths', [q]));
    const s = first(result).scheme;
    expect(s.points).toBeUndefined();
    expect(s.accept).toEqual(['subtracting one amount at a time']);
    expect(s.common_error).toBe('422,250 as the answer');
    expect(first(result).answer).toBe('Rs. 327,750');
    expect(result.log.some((l) => l.includes('maths.B.Q2'))).toBe(true);
  });

  test('halves are kept and 0.3 rounds to 0.5', () => {
    const q = wordProblem([
      { text: 'a correct method', marks: 2.5, kind: 'M' },
      { text: 'working', marks: '2', kind: 'm' },
      { text: '327,750', marks: 0.3, kind: 'a' },
    ]);
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect(s.points.map((p) => p.marks)).toEqual([2.5, 2, 0.5]);
    expect(s.points.map((p) => p.kind)).toEqual(['M', 'M', 'A']);
  });

  test('kinds outside M/A/U/K/L become K', () => {
    const q = { slot: 'science.C.Q3a', question: 'Why do we boil water?', answer: 'To kill germs.', marks: 5, blooms: 'Understand',
      scheme: { points: [{ text: 'kills germs', marks: 3, kind: 'X' }, { text: 'safe to drink', marks: 2 }] } };
    const s = first(normaliseScheme(paper('science', [q]))).scheme;
    expect(s.points.map((p) => p.kind)).toEqual(['K', 'K']);
  });

  test('U folded when unit not a choice', () => {
    const q = wordProblem([
      { text: 'a correct method', marks: 2, kind: 'M' },
      { text: 'Rs.', marks: 1, kind: 'U' },
      { text: '327,750', marks: 2, kind: 'A' },
    ]);
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect(s.points).toEqual([
      { text: 'a correct method', marks: 2, kind: 'M' },
      { text: '327,750 (Rs.)', marks: 3, kind: 'A' },
    ]);

    // No A to fold into: the unit becomes the answer point.
    const q2 = wordProblem([{ text: 'a correct method', marks: 4, kind: 'M' }, { text: 'Rs.', marks: 1, kind: 'U' }]);
    const s2 = first(normaliseScheme(paper('maths', [q2]))).scheme;
    expect(s2.points).toEqual([
      { text: 'a correct method', marks: 4, kind: 'M' },
      { text: 'Rs.', marks: 1, kind: 'A' },
    ]);
  });

  test('U kept when the unit is the child\'s choice', () => {
    const q = {
      slot: 'maths.C.Q4-8', question: 'A rectangle is 8 cm long and 5 cm wide. Find its perimeter.', answer: '26 cm', marks: 5, blooms: 'Apply',
      scheme: { points: [{ text: '2 × (8 + 5)', marks: 2, kind: 'M' }, { text: '26', marks: 2, kind: 'A' }, { text: 'cm', marks: 1, kind: 'U' }] },
    };
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect(s.points.map((p) => p.kind)).toEqual(['M', 'A', 'U']);
  });

  test('words slot turns M into A', () => {
    const q = {
      slot: 'english.C.Q4', question: 'Use any five of the following words in meaningful sentences.', answer: 'model sentences', marks: 10, blooms: 'Apply',
      scheme: { points: [{ text: 'meaning shown', marks: 5, kind: 'M' }, { text: 'correct sentence', marks: 5, kind: 'A' }] },
    };
    const s = first(normaliseScheme(paper('english', [q]))).scheme;
    expect(s.points.map((p) => p.kind)).toEqual(['A', 'A']);
    expect(s.points.map((p) => p.marks)).toEqual([5, 5]);
  });

  test('expanded form question turns M into A', () => {
    const q = {
      slot: 'maths.A.Q1b', question: 'Write 52,307 in Expanded Form.', answer: '50,000 + 2,000 + 300 + 7', marks: 2, blooms: 'Understand',
      scheme: { points: [{ text: 'place values', marks: 1, kind: 'M' }, { text: 'the sum', marks: 1, kind: 'A' }] },
    };
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect(s.points.map((p) => p.kind)).toEqual(['A', 'A']);

    // The same slot, not expanded form: M stays M.
    const q2 = { ...q, question: 'Find the HCF of 12 and 18.', answer: '6' };
    const s2 = first(normaliseScheme(paper('maths', [q2]))).scheme;
    expect(s2.points.map((p) => p.kind)).toEqual(['M', 'A']);
  });

  test('blooms outside R/U/A normalised', () => {
    const qs = ['r', 'APPLY', ' understand ', 'Analyse', 'Create', undefined].map((blooms) => ({
      slot: 'science.C.Q3a', question: 'Name two diseases spread by flies.', answer: 'cholera, typhoid', marks: 5, blooms,
    }));
    const result = normaliseScheme(paper('science', qs));
    expect(result.examJson.unseen.subjective.short.map((q) => q.blooms))
      .toEqual(['Remember', 'Apply', 'Understand', 'Understand', 'Understand', 'Understand']);
    expect(result.log.filter((l) => /blooms/i.test(l))).toHaveLength(3);

    expect(canonicalBlooms('a')).toBe('Apply');
    expect(canonicalBlooms('Remember')).toBe('Remember');
    expect(canonicalBlooms('Evaluate')).toBeNull();
    expect(canonicalBlooms(7)).toBeNull();
  });

  test('caps accept at six and 80 code points (Urdu counted in code points)', () => {
    const urdu81 = 'ب'.repeat(81);
    const urdu80 = 'ب'.repeat(80);
    const astral80 = '𝟙'.repeat(80); // 80 code points, 160 UTF-16 units
    const accept = [urdu81, urdu80, astral80, 'four', 'five', 'six', 'seven', 'eight'];
    const q = { slot: 'urdu.C.Q3', question: 'معنی لکھیں', answer: 'معنی', marks: 5, blooms: 'Remember', scheme: { accept } };
    const s = first(normaliseScheme(paper('urdu', [q]))).scheme;
    expect(s.accept).toHaveLength(6);
    expect([...s.accept[0]]).toHaveLength(80);
    expect(s.accept[0].endsWith('…')).toBe(true);
    expect(s.accept[1]).toBe(urdu80);
    expect(s.accept[2]).toBe(astral80);
    expect(s.accept.slice(3)).toEqual(['four', 'five', 'six']);

    // A string becomes a list of one.
    const q2 = { ...q, scheme: { accept: 'معنی درست' } };
    expect(first(normaliseScheme(paper('urdu', [q2]))).scheme.accept).toEqual(['معنی درست']);

    expect(capCodePoints('abc', 80)).toBe('abc');
    expect([...capCodePoints('ب'.repeat(200), 160)]).toHaveLength(160);
  });

  test('point text capped at 160 code points', () => {
    const q = wordProblem([{ text: 'm'.repeat(300), marks: 3, kind: 'M' }, { text: '327,750', marks: 2, kind: 'A' }]);
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect([...s.points[0].text]).toHaveLength(160);
    expect(s.points[0].text.endsWith('…')).toBe(true);
  });

  test('common_error capped at 160', () => {
    const q = wordProblem([{ text: 'method', marks: 3, kind: 'M' }, { text: '327,750', marks: 2, kind: 'A' }]);
    q.scheme.common_error = 'غ'.repeat(200);
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect([...s.common_error]).toHaveLength(160);
    expect(s.common_error.endsWith('…')).toBe(true);

    const q2 = wordProblem([{ text: 'method', marks: 3, kind: 'M' }, { text: '327,750', marks: 2, kind: 'A' }]);
    q2.scheme.common_error = 42;
    expect('common_error' in first(normaliseScheme(paper('maths', [q2]))).scheme).toBe(false);
  });

  test('checked defaults to null and is never set to ok', () => {
    const q = wordProblem([{ text: 'a correct method', marks: 3, kind: 'M' }, { text: '327,750', marks: 2, kind: 'A' }]);
    const s = first(normaliseScheme(paper('maths', [q]))).scheme;
    expect(s.points).toHaveLength(2);
    expect(s.checked).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/"ok"/);
  });

  test('an unknown slot is left untouched', () => {
    const q = wordProblem([{ text: 'm', marks: 1, kind: 'X' }], { slot: 'maths.Z.Q99', blooms: 'Create' });
    const before = JSON.parse(JSON.stringify(q));
    const result = normaliseScheme(paper('maths', [q]));
    expect(first(result)).toEqual(before);
    expect(result.log.some((l) => l.includes('maths.Z.Q99'))).toBe(true);
  });

  test('a comprehension sub-question is checked against its part\'s marks', () => {
    const questions = [
      { question: 'Where did the farmer go?', answer: 'To the river.', scheme: { points: [{ text: 'the river', marks: 1, kind: 'K' }, { text: 'a full sentence', marks: 1, kind: 'K' }] } },
      { question: 'What did he carry?', answer: 'A basket.', scheme: { points: [{ text: 'a basket', marks: 3, kind: 'K' }] } },
    ];
    const pick = { Nouns: ['farmer', 'river', 'basket'], Verbs: ['walked', 'carried', 'sang'] };
    const result = normaliseScheme(paper('english', [englishComprehension(pick, questions)], { type: 'comprehension' }));
    const parts = first(result, { type: 'comprehension' }).parts;
    expect(parts[0].questions[0].scheme.points).toHaveLength(2);
    expect(parts[0].questions[1].scheme.points).toBeUndefined();
    expect(parts[0].questions[1].scheme.checked).toBeNull();
  });

  test('urdu (ب) words not in the passage are dropped', () => {
    const pick = {
      'اسم معرفہ': ['منا', 'لاہور', 'کراچی'],
      'اسم نکرہ': [' باغ ', 'پھول', ''],
      'اسم صفت': ['سرخ', 'ٹھنڈا'],
      'فعل': ['پیا', 'پھینکی'],
    };
    const result = normaliseScheme(paper('urdu', [urduComprehension(pick)], { type: 'comprehension' }));
    const kept = first(result, { type: 'comprehension' }).parts[1].pick;
    expect(kept['اسم معرفہ']).toEqual(['منا', 'لاہور']);
    expect(kept['اسم نکرہ']).toEqual(['باغ', 'پھول']);
    expect(kept['اسم صفت']).toEqual(['سرخ', 'ٹھنڈا']);
    expect(kept['فعل']).toEqual(['پیا', 'پھینکی']);
    expect(result.log.some((l) => l.includes('کراچی'))).toBe(true);
    expect(result.shortfall).toEqual([]);
  });

  test('fewer than two of a kind is a shortfall', () => {
    const pick = {
      'اسم معرفہ': ['منا', 'لاہور'],
      'اسم نکرہ': ['باغ', 'پھول'],
      'اسم صفت': ['سرخ', 'ٹھنڈا'],
      'فعل': ['پیا', 'دوڑا', 'پیا'],
    };
    const result = normaliseScheme(paper('urdu', [urduComprehension(pick)], { type: 'comprehension' }));
    expect(result.shortfall).toEqual([{ slot: 'urdu.B.Q2', kind: 'فعل', have: 1, need: 2 }]);
    expect(result.log.some((l) => l.includes('دوڑا'))).toBe(true);
  });

  test('english picks need three nouns and three verbs', () => {
    const short = normaliseScheme(paper('english', [englishComprehension({
      Nouns: ['farmer', 'river', 'basket'], Verbs: ['walked', 'carried', 'jumped'],
    })], { type: 'comprehension' }));
    expect(short.shortfall).toEqual([{ slot: 'english.B.Q2', kind: 'Verbs', have: 2, need: 3 }]);

    const full = normaliseScheme(paper('english', [englishComprehension({
      Nouns: ['farmer', 'river', 'basket'], Verbs: ['walked', 'carried', 'sang'],
    })], { type: 'comprehension' }));
    expect(full.shortfall).toEqual([]);

    // A missing kind is a shortfall of all it needs.
    const none = normaliseScheme(paper('english', [englishComprehension({ Nouns: ['farmer', 'river', 'basket'] })], { type: 'comprehension' }));
    expect(none.shortfall).toEqual([{ slot: 'english.B.Q2', kind: 'Verbs', have: 0, need: 3 }]);
  });

  test('never throws on garbage', () => {
    const garbage = [
      null, undefined, 42, 'paper', [], {},
      { _layout: 'x', unseen: 5 },
      { _layout: { sections: [null, { slots: 'x' }, { slots: [null, 7] }] }, unseen: { subjective: { short: 'x' } } },
      paper('maths', [null, 5, 'x', { slot: 7 }, { slot: 'maths.B.Q2', scheme: 'junk', blooms: 7 }]),
      paper('maths', [{ slot: 'maths.B.Q2', marks: 'five', scheme: { points: [null, 'x', { marks: {} }], accept: { a: 1 }, common_error: [], checked: 'yes' } }]),
      paper('urdu', [{ slot: 'urdu.B.Q2', parts: 'x', passage: 9 }], { type: 'comprehension' }),
      paper('urdu', [{ slot: 'urdu.B.Q2', parts: [null, { key: 'pick', pick: 'x' }, { key: 'questions', questions: [null, { scheme: 3 }] }] }], { type: 'comprehension' }),
    ];
    for (const g of garbage) {
      expect(() => normaliseScheme(g)).not.toThrow();
      const r = normaliseScheme(g);
      expect(Array.isArray(r.log)).toBe(true);
      expect(Array.isArray(r.shortfall)).toBe(true);
    }

    const bad = normaliseScheme(paper('maths', [{ slot: 'maths.B.Q2', marks: 5, scheme: 'junk', blooms: 'Apply' }]));
    expect('scheme' in first(bad)).toBe(false);
    expect(bad.log.some((l) => l.includes('maths.B.Q2'))).toBe(true);
  });

  test('the input object is not mutated', () => {
    const input = paper('maths', [
      wordProblem([{ text: 'a correct method', marks: 2, kind: 'm' }, { text: 'Rs.', marks: 1, kind: 'U' }, { text: '327,750', marks: 2.2, kind: 'A' }], { blooms: 'analyse' }),
      { slot: 'maths.A.Q1a', question: 'Pick one', answer: 'a', marks: 1, scheme: { points: [] } },
    ]);
    const before = JSON.stringify(input);
    const result = normaliseScheme(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.examJson).not.toBe(input);
    expect(first(result).blooms).toBe('Understand');
  });
});

describe('normaliseScheme — the manager\'s follow-ups', () => {
  it('quarter marks are kept when the item is worth a quarter (Urdu Q4, 1.25)', () => {
    const q = { slot: 'urdu.C.Q4', question: 'ارکان سازی کریں۔', answer: 'راہ + گیر', marks: 1.25,
      scheme: { points: [{ text: 'دونوں رکن', marks: 1.25, kind: 'A' }] } };
    const out = first(normaliseScheme(paper('urdu', [q])));
    expect(out.scheme.points).toEqual([{ text: 'دونوں رکن', marks: 1.25, kind: 'A' }]);
  });

  it('a model-written checked is reset to null (only mathsCheck may set it)', () => {
    const q = { slot: 'science.C.Q3a', question: 'Why do we need a compass?', answer: 'It shows north.', marks: 5,
      scheme: { points: [{ text: 'north', marks: 5, kind: 'K' }], checked: 'ok' } };
    const out = first(normaliseScheme(paper('science', [q])));
    expect(out.scheme.checked).toBeNull();
  });
});
