/**
 * bd-5jmnfj.38.31 — the deterministic checks a G6-12 free paper is held to before it is kept:
 * marking points (A7c), stem length (A2d), the longest-option key and absolute words (A7a), one item
 * answering another (A5b), and the minutes the paper really takes (A5g).
 */
const C = require('../../bot/shared/services/assessment/free-secondary-checks');

const mcq = (question, options, answer) => ({ question, options, answer, marks: 1, lines: 0 });
const srq = (question, answer, extra = {}) => ({ question, answer, marks: 3, lines: 4, ...extra });
const points = (...m) => m.map((marks, i) => ({ point: `point ${i + 1}`, marks }));
const paper = (objective, subjective = []) => ({
  unseen: { objective: { 'Multiple Choice Questions': objective }, subjective: { 'Short Answers': subjective } },
});
const checks = (exam, grade = 7) => C.paperIssues(exam, { grade }).map((i) => `${i.n}:${i.check}`);

describe('items', () => {
  it('numbers every item in paper order, objective first, with its kind', () => {
    const exam = paper([mcq('Q?', ['a) x', 'b) y', 'c) z', 'd) w'], 'a')], [srq('Why?', 'Because.')]);
    expect(C.items(exam).map((e) => [e.n, e.isMcq])).toEqual([[1, true], [2, false]]);
  });
});

describe('paperIssues', () => {
  const OPTS = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt'];

  it('passes a clean paper', () => {
    const exam = paper([mcq('Which one dissolves in water?', OPTS, 'd) Salt')],
      [srq('Why does ice float?', 'Ice is less dense than water.', { marking_points: points(1, 2) })]);
    expect(checks(exam)).toEqual([]);
  });

  it('flags a constructed item with no marking points, or points that do not sum to its marks', () => {
    const exam = paper([], [srq('Why?', 'Because.'), srq('How?', 'So.', { marking_points: points(1, 1) })]);
    expect(checks(exam)).toEqual(['1:marking-points', '2:marking-points']);
  });

  it('flags an MCQ stem over the band limit and a sentence over the band limit', () => {
    const longStem = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
    const longSentence = `${Array.from({ length: 16 }, (_, i) => `w${i}`).join(' ')}.`;
    const exam = paper([mcq(longStem, OPTS, 'a')], [srq(longSentence, 'x', { marking_points: points(3) })]);
    expect(checks(exam)).toEqual(['1:long-stem', '2:long-sentence']);
    expect(checks(exam, 11)).toEqual([]);
  });

  it('flags a key that is clearly the longest option', () => {
    const exam = paper([mcq('Which?', ['a) Sand', 'b) Water that is warmed by the sun', 'c) Wood', 'd) Salt'], 'b')]);
    expect(checks(exam)).toEqual(['1:longest-key']);
  });

  it('flags absolute words and all/none of the above in options', () => {
    const exam = paper([
      mcq('Which?', ['a) It always sinks', 'b) Water', 'c) Wood', 'd) Salt'], 'b'),
      mcq('Which?', ['a) Sand', 'b) Water', 'c) None of the above', 'd) Salt'], 'b'),
      mcq('کون سا؟', ['الف) ہمیشہ ڈوبتا ہے', 'ب) پانی', 'ج) لکڑی', 'د) نمک'], 'ب'),
    ]);
    expect(checks(exam)).toEqual(['1:absolute-option', '2:absolute-option', '3:absolute-option']);
  });

  it('flags an MCQ whose key gives away a short answer on the same idea', () => {
    const exam = paper(
      [mcq('Which gas do plants take in for photosynthesis?', ['a) Oxygen gas', 'b) Carbon dioxide', 'c) Nitrogen gas', 'd) Water vapour'], 'b')],
      [srq('Name the gas plants take in during photosynthesis.', 'Carbon dioxide.', { marking_points: points(3) })],
    );
    // The MCQ is the item to rewrite: it gives the written answer away.
    expect(checks(exam)).toEqual(['1:cross-leak']);
    expect(C.paperIssues(exam, { grade: 7 })[0].avoid).toEqual([2]);
  });

  it('flags a stem that prints the answer to another item', () => {
    const exam = paper(
      [mcq('Who founded the trust in Karachi?', ['a) Bilal Ahmed', 'b) Hira Saleem', 'c) Sara Khan', 'd) Kamran Qadri'], 'd')],
      [srq('Why did Kamran Qadri open a free clinic?', 'To help the poor.', { marking_points: points(3) })],
    );
    expect(checks(exam)).toEqual(['2:cross-leak']);
  });
});

describe('estimateMinutes and printedMinutes', () => {
  it('uses the panel floors: a minute per MCQ, two per short answer, ten per extended answer, five to review', () => {
    const OPTS = ['a) x', 'b) y', 'c) z', 'd) w'];
    const exam = paper(Array.from({ length: 10 }, () => mcq('Which?', OPTS, 'a')),
      [srq('Why?', 'Yes.'), srq('How?', 'So.')]);
    exam.unseen.subjective['Extended Answers'] = [{ question: 'Explain.', answer: 'Long.', marks: 6, lines: 10 }];
    expect(C.estimateMinutes(exam, { grade: 7 })).toBe(10 + 4 + 10 + 5);
  });
  it('adds reading and writing time when the words take longer than the floor', () => {
    const essay = Array.from({ length: 160 }, () => 'word').join(' ');
    const exam = paper([], [srq('Why?', essay)]);
    // 160 words written at 8 wpm = 20 minutes, plus the 5-minute review.
    expect(C.estimateMinutes(exam, { grade: 7 })).toBeCloseTo(25, 0);
  });
  it('prints a time the load fills to at most 85%, rounded up to 5 minutes', () => {
    expect(C.printedMinutes(51)).toBe(60);
    expect(C.printedMinutes(52)).toBe(65);
  });
});

describe('the lesson subject and short Urdu answers', () => {
  const OPTS = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt'];
  const clean = (q) => paper([mcq(q, OPTS, 'd) Salt')]);
  const lesson = (exam, title) => C.paperIssues(exam, { grade: 8, lessonTitle: title }).map((i) => `${i.n}:${i.check}`);

  it('flags a paper where no item names the lesson', () => {
    expect(lesson(clean('Which one dissolves in water?'), 'Edhi Trust')).toEqual(['0:lesson-subject']);
  });
  it('passes a paper with an item naming the lesson, in either script', () => {
    expect(lesson(clean('What did the Edhi ambulance carry?'), 'Edhi Trust')).toEqual([]);
    expect(lesson(clean('ایدھی صاحب نے کیا کیا؟'), 'عبدالستار ایدھی')).toEqual([]);
  });
  it('checks nothing about the lesson when no title is given', () => {
    expect(lesson(clean('Which one dissolves in water?'), undefined)).toEqual([]);
  });
  it('flags a short Urdu key printed whole in another stem', () => {
    const exam = paper(
      [mcq('کون سا لفظ صفتِ ضمیری ہے؟', ['الف) نیک', 'ب) سندھی', 'ج) طویل', 'د) ہمارا'], 'د')],
      [srq('ہمارا باغ بہت خوب صورت ہے۔', 'ہمارا', { marking_points: points(3) })],
    );
    expect(checks(exam, 8)).toEqual(['2:cross-leak']);
  });
  it('does not flag a short Urdu key that is only part of a longer word', () => {
    const exam = paper(
      [mcq('کون سا لفظ صفتِ ضمیری ہے؟', ['الف) نیک', 'ب) سندھی', 'ج) طویل', 'د) ہمارا'], 'د')],
      [srq('ہماراپن باغ ہے۔', 'x', { marking_points: points(3) })],
    );
    expect(checks(exam, 8)).toEqual([]);
  });
});

describe('key terms that cue another item (A5b, widened)', () => {
  const mcqs = [
    mcq('The loss of water vapour from a leaf is called:', ['a) Photosynthesis', 'b) Respiration', 'c) Transpiration', 'd) Germination'], 'c'),
    mcq('Which weather condition increases the transpiration rate the most?', ['a) Hot windy weather', 'b) Cold moist weather', 'c) Dark damp weather', 'd) Cool calm weather'], 'a'),
  ];
  const wilting = srq('A farmer sees his crop wilting on a hot, windy day. Explain why the leaves wilt.',
    'Hot, windy weather increases the rate of transpiration. The leaves lose water faster than roots replace it.',
    { marking_points: points(3) });

  it('flags MCQ keys whose terms are the expected answer of a later item, and a stem printing a key', () => {
    const issues = C.paperIssues(paper(mcqs.map((q) => ({ ...q })), [{ ...wilting }]), { grade: 7 });
    expect(issues.map((i) => `${i.n}:${i.check}`)).toEqual(['1:cross-leak', '2:cross-leak']);
    expect(issues[0].avoid).toEqual([3]);
    expect(issues[1].avoid).toEqual([1, 3]);
  });

  it('does not flag one shared word with nothing else in common', () => {
    const exam = paper(
      [mcq('Many chloroplasts in leaf cells mainly help the leaf to:', ['a) Store water', 'b) Absorb sunlight', 'c) Reduce water loss', 'd) Grow roots'], 'b')],
      [srq('A green plant sits in a sealed jar with sunlight by day. Name the gas it releases.', 'Oxygen.', { marking_points: points(3) })],
    );
    expect(checks(exam)).toEqual([]);
  });
});


describe('word lists and option lists that print another item\'s key (A5b, a3 G8 Urdu Q7/Q16)', () => {
  // Q7 and Q16 exactly as the a3 G8 Urdu paper printed them; the items between are left out.
  const Q7 = { main_question: 'صحیح جواب کا انتخاب کریں', question: 'درج ذیل الفاظ میں سے صفتِ ضمیری کون سی ہے؟',
    options: ['الف) کنجوس', 'ب) تمھارا', 'ج) ملتانی', 'د) بدنما'], marks: 1, lines: 0, answer: 'ب) تمھارا' };
  const Q16 = { main_question: 'درج ذیل الفاظ میں سے صفتِ ضمیری کے الفاظ چن کر لکھیں', question: 'تمھارا، سخی، اپنا، میرا، بدنما، چینی',
    marks: 3, lines: 2, answer: 'تمھارا، اپنا، میرا', marking_points: points(1, 1, 1) };
  const exam = (q16) => ({ unseen: { objective: { MCQs: [Q7] }, subjective: { Grammar: [q16] } } });
  const leak = (e) => C.paperIssues(e, { grade: 8 }).filter((i) => i.check === 'cross-leak').map((i) => [i.n, i.avoid]);

  it('flags the grammar item whose word list prints the MCQ key', () => {
    expect(leak(exam(Q16))).toEqual([[2, [1]]]);
  });

  it('sees the list when it is printed as words, not in the stem', () => {
    const q = { ...Q16, question: 'ان الفاظ میں سے اسم چن کر لکھیں', words: ['تمھارا', 'سخی', 'اپنا', 'میرا', 'بدنما', 'چینی'], answer: 'سخی، چینی' };
    expect(leak(exam(q))).toEqual([[2, [1]]]);
  });

  it('sees the list when it is printed as a list of options', () => {
    const q = { ...Q16, question: 'ان الفاظ میں سے اسم چن کر لکھیں', options: ['تمھارا', 'سخی', 'اپنا', 'میرا', 'بدنما', 'چینی'], answer: 'سخی، چینی' };
    expect(leak(exam(q))).toEqual([[2, [1]]]);
  });
});
