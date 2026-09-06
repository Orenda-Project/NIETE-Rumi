'use strict';
/**
 * The PEDAGOGY rules (PLAN_R5 D3).
 *
 * The operator took the quiz himself and hit three shapes of bad question:
 * a count of how many things the teacher mentioned, a stem whose subject is
 * the teacher rather than the concept, and a question only the child who was
 * given that particular task could answer. The round-4 author prompt already
 * banned the third in words and the model wrote it anyway — so these are
 * deterministic rules, not prompt lines (root rule 24c).
 *
 * Every fixture below is SYNTHETIC: the shapes are the ones seen in the field,
 * the words are written here. No transcript text ever enters this repo.
 */
const P = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');

const DIGEST = {
  slos: [
    { id: 'S1', statement: 'name the three states of matter', taught_level: 'recall' },
    { id: 'S2', statement: 'explain how a solid differs from a liquid', taught_level: 'understand' },
  ],
};

/** A well-formed question; override what the test is about. */
function q(over = {}) {
  return {
    slo_id: 'S2', level: 'understand',
    question: 'Which of these is a type of matter?',
    options: ['gas', 'speed', 'weight'], correct_index: 0,
    explanation: 'Gas is one of the three states of matter.',
    ...over,
  };
}

const defectsFor = (question, ctx = {}) => P.pedagogyDefects([q(question)], { language: 'en', digest: DIGEST, ...ctx });
const codesFor = (question, ctx) => defectsFor(question, ctx).map((d) => d.code);

// ── COUNT_RECALL ────────────────────────────────────────────────────────────
describe('COUNT_RECALL — counting how many things were mentioned', () => {
  test('the operator\'s "how many types did the teacher mention" with bare-number options', () => {
    expect(codesFor({
      question: 'How many types of matter did the teacher mention?',
      options: ['3', '2', '4'], correct_index: 0,
    })).toContain('PEDAGOGY_COUNT_RECALL');
  });

  test('the same shape with "talk about" and with "name"', () => {
    expect(codesFor({
      question: 'How many civilizations did the teacher talk about today?',
      options: ['4', '3', '5'], correct_index: 0,
    })).toContain('PEDAGOGY_COUNT_RECALL');
    expect(codesFor({
      question: 'How many states of matter were named in the lesson?',
      options: ['three', 'two', 'four'], correct_index: 0,
    })).toContain('PEDAGOGY_COUNT_RECALL');
  });

  test('Urdu: کتنی … بتائیں with bare-number options', () => {
    expect(codesFor({
      question: 'استاد نے matter کی کتنی قسمیں بتائیں؟',
      options: ['۳', '۲', '۴'], correct_index: 0,
    }, { language: 'ur' })).toContain('PEDAGOGY_COUNT_RECALL');
    expect(codesFor({
      question: 'سبق میں کتنی civilizations کا ذکر کیا گیا؟',
      options: ['تین', 'دو', 'چار'], correct_index: 0,
    }, { language: 'ur' })).toContain('PEDAGOGY_COUNT_RECALL');
  });

  test('the message tells the author HOW to rewrite it, naming the question', () => {
    const [d] = defectsFor({
      question: 'How many types of matter did the teacher mention?',
      options: ['3', '2', '4'], correct_index: 0,
    });
    expect(d.index).toBe(0);
    expect(d.message).toMatch(/Which of these/);
    expect(d.message.length).toBeGreaterThan(60);
  });

  // The counter-examples. A quiz that cannot count anything is not the goal.
  test('a real counting question about the CONTENT is fine', () => {
    expect(codesFor({ question: 'How many squares are shaded in the picture?', options: ['12', '8', '20'], correct_index: 0 })).toEqual([]);
    expect(codesFor({ question: 'How many legs does an insect have?', options: ['6', '8', '4'], correct_index: 0 })).toEqual([]);
    expect(codesFor({ question: 'تصویر میں کتنے خانے رنگے ہوئے ہیں؟', options: ['۱۲', '۸', '۲۰'], correct_index: 0 }, { language: 'ur' })).toEqual([]);
  });

  test('"how many did the teacher mention" is fine when the options are NOT bare numbers', () => {
    // "Which of these did she use as an example?" is a content question that
    // happens to carry a mention verb; only bare-number options make it ratta.
    expect(codesFor({
      question: 'How many types of matter did the teacher mention, and which was the heaviest?',
      options: ['solid', 'liquid', 'gas'], correct_index: 0,
    })).not.toContain('PEDAGOGY_COUNT_RECALL');
  });
});

// Both blocks below were written after sweeping the rules over 1,156
// previously generated questions: the Urdu rule over-fired on a teacher clause
// that only sets the scene, and the shape reported from the field ("how many
// types of matter") slipped through whenever the model dropped the word
// "mention".
describe('COUNT_RECALL — the taxonomy tally', () => {
  test('"how many types/kinds/states of X" with bare numbers is ratta even without a mention verb', () => {
    expect(codesFor({ question: 'How many types of matter are there?', options: ['3', '2', '4'], correct_index: 0 }))
      .toContain('PEDAGOGY_COUNT_RECALL');
    expect(codesFor({ question: 'How many states of matter do we have?', options: ['three', 'two', 'four'], correct_index: 0 }))
      .toContain('PEDAGOGY_COUNT_RECALL');
    expect(codesFor({ question: 'فورس کی کتنی اقسام ہوتی ہیں؟', options: ['2', '3', '4'], correct_index: 0 }, { language: 'ur' }))
      .toContain('PEDAGOGY_COUNT_RECALL');
    expect(codesFor({ question: 'matter کی کتنی قسمیں ہوتی ہیں؟', options: ['۳', '۲', '۴'], correct_index: 0 }, { language: 'ur' }))
      .toContain('PEDAGOGY_COUNT_RECALL');
  });

  test('a picture question is never a count-recall question', () => {
    // "How many parts of the bar are shaded?" is the fraction_bar worked
    // example in the author's own figure contract. A rule that threw it away
    // would fail every maths lesson that draws one.
    expect(codesFor({
      question: 'How many parts of the bar are shaded?', options: ['3', '1', '4'], correct_index: 0,
      figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] },
    })).toEqual([]);
    expect(codesFor({
      question: 'How many types of shape are shown in the picture?', options: ['3', '2', '4'], correct_index: 0,
    })).toEqual([]);
    expect(codesFor({
      question: 'تصویر میں matter کی کتنی قسمیں دکھائی گئی ہیں؟', options: ['۳', '۲', '۴'], correct_index: 0,
    }, { language: 'ur' })).toEqual([]);
  });
});

// ── TEACHER_AS_SUBJECT ──────────────────────────────────────────────────────
describe('TEACHER_AS_SUBJECT — the stem is about the teacher, not the concept', () => {
  test('the operator\'s "which atom did the teacher ask your group to draw"', () => {
    expect(codesFor({
      question: 'Which atom did the teacher ask your group to draw?',
      options: ['Oxygen', 'Carbon', 'Boron'], correct_index: 0,
    })).toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
  });

  test('"what did madam call it" and "according to the teacher"', () => {
    expect(codesFor({ question: 'What did madam call the middle part of the atom?', options: ['nucleus', 'shell', 'orbit'], correct_index: 0 }))
      .toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
    expect(codesFor({ question: 'According to the teacher, which state has a fixed shape?', options: ['solid', 'liquid', 'gas'], correct_index: 0 }))
      .toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
  });

  test('Urdu: the ergative "استاد نے" with a question word and a speech verb', () => {
    expect(codesFor({
      question: 'استاد نے آپ کے گروپ کو کون سا atom بنانے کو کہا؟',
      options: ['Oxygen', 'Carbon', 'Boron'], correct_index: 0,
    }, { language: 'ur' })).toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
    expect(codesFor({
      question: 'میڈم نے nucleus کو کیا کہا؟',
      options: ['مرکز', 'خول', 'مدار'], correct_index: 0,
    }, { language: 'ur' })).toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
  });

  test('a stem that only SETS THE SCENE with the teacher is fine', () => {
    // "Use the lesson's own examples" is still the contract — the teacher may
    // appear in the setup as long as the question is about the concept.
    expect(codesFor({
      question: 'The teacher showed a circuit with two bulbs. Which bulb glows brighter?',
      options: ['the one nearer the cell', 'both the same', 'neither'], correct_index: 1,
    })).toEqual([]);
    expect(codesFor({
      question: 'کلاس میں دکھائے گئے circuit میں bulb کیوں روشن ہوا؟',
      options: ['circuit مکمل تھا', 'circuit ٹوٹا تھا', 'switch بند تھا'], correct_index: 0,
    }, { language: 'ur' })).toEqual([]);
  });

  test('an Urdu teacher clause that only SETS THE SCENE does not fire', () => {
    // Real shapes from the cached corpus: "the teacher told us X. Which of
    // these is Y?" — the کہ-clause is the setup, the question is about the
    // concept, and it is answerable by any child who understood.
    expect(codesFor({
      question: 'ٹیچر نے بتایا کہ کچھ ذرائع تیز رفتار ہوتے ہیں۔ ان میں سے کون سا تیز رفتار ہے؟',
      options: ['کار', 'تانگا', 'رکشہ'], correct_index: 0,
    }, { language: 'ur' })).toEqual([]);
    expect(codesFor({
      question: 'ٹیچر نے بتایا کہ ہوائی جہاز کے لیے ایک خاص جگہ ہوتی ہے۔ وہ جگہ کیا کہلاتی ہے؟',
      options: ['ہوائی اڈا', 'ریلوے اسٹیشن', 'بس اسٹاپ'], correct_index: 0,
    }, { language: 'ur' })).toEqual([]);
  });

  test('"gave an example" is a speech act too (مثال دی)', () => {
    // Missed by the first cut of the rule, and rejected by the offline eval's
    // LLM judge in the same run for exactly this reason.
    expect(codesFor({
      question: "استاد نے 'ت' کی آواز سے بننے والے کون سے لفظ کی مثال دی تھی؟",
      options: ['تتلی', 'بلی', 'سیب'], correct_index: 0,
    }, { language: 'ur' })).toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
    expect(codesFor({
      question: 'میڈم نے کون سی مثال دی تھی؟', options: ['روٹی', 'سیب', 'کیلا'], correct_index: 0,
    }, { language: 'ur' })).toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
  });

  test('but a question ABOUT what the teacher said still fires, in one sentence', () => {
    expect(codesFor({ question: "ٹیچر نے 'honest' کا مطلب کیا بتایا تھا؟", options: ['ایماندار', 'بہادر', 'خوش'], correct_index: 0 }, { language: 'ur' }))
      .toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
    expect(codesFor({ question: 'کون سا ملک پٹرول کی وجہ سے ترقی کر رہا ہے جس کا ذکر استاد نے کیا تھا؟', options: ['سعودی عرب', 'پاکستان', 'چین'], correct_index: 0 }, { language: 'ur' }))
      .toContain('PEDAGOGY_TEACHER_AS_SUBJECT');
  });
});

// ── UNANSWERABLE ────────────────────────────────────────────────────────────
describe('UNANSWERABLE — depends on which child, group or turn', () => {
  test('"your group", "you were asked", "the student who"', () => {
    expect(codesFor({ question: 'Which shape was your group given to cut out?', options: ['square', 'circle', 'triangle'], correct_index: 0 }))
      .toContain('PEDAGOGY_UNANSWERABLE');
    expect(codesFor({ question: 'You were asked to draw which element?', options: ['Oxygen', 'Carbon', 'Boron'], correct_index: 0 }))
      .toContain('PEDAGOGY_UNANSWERABLE');
    expect(codesFor({ question: 'The student who came to the board wrote which word?', options: ['noun', 'verb', 'adjective'], correct_index: 0 }))
      .toContain('PEDAGOGY_UNANSWERABLE');
  });

  test('homework, page numbers and who was called up', () => {
    expect(codesFor({ question: 'Which page did the class read from?', options: ['12', '14', '16'], correct_index: 0 }))
      .toContain('PEDAGOGY_UNANSWERABLE');
    expect(codesFor({ question: 'What homework was set for tomorrow?', options: ['exercise 3', 'exercise 4', 'nothing'], correct_index: 0 }))
      .toContain('PEDAGOGY_UNANSWERABLE');
  });

  test('Urdu: آپ کے گروپ / جس بچے / کس صفحے', () => {
    expect(codesFor({ question: 'آپ کے گروپ کو کون سی شکل کاٹنے کے لیے دی گئی؟', options: ['مربع', 'دائرہ', 'مثلث'], correct_index: 0 }, { language: 'ur' }))
      .toContain('PEDAGOGY_UNANSWERABLE');
    expect(codesFor({ question: 'جس بچے نے بورڈ پر لکھا اُس نے کون سا لفظ لکھا؟', options: ['اسم', 'فعل', 'صفت'], correct_index: 0 }, { language: 'ur' }))
      .toContain('PEDAGOGY_UNANSWERABLE');
  });

  test('a question about the lesson\'s own example is NOT unanswerable', () => {
    expect(codesFor({ question: 'The class shared 12 sweets among 3 children. How many did each get?', options: ['4', '3', '6'], correct_index: 0 }))
      .toEqual([]);
  });
});

// ── LEVEL_MIX ───────────────────────────────────────────────────────────────
describe('LEVEL_MIX — at least half the set above bare recall', () => {
  const set = (levels, sloIds) => levels.map((lv, i) => q({ level: lv, slo_id: (sloIds && sloIds[i]) || 'S2', question: `q${i}` }));

  test('8 questions with only 2 at understand/apply is rejected', () => {
    const d = P.pedagogyDefects(set(['recall', 'recall', 'recall', 'recall', 'recall', 'recall', 'understand', 'apply']), { language: 'en', digest: DIGEST });
    expect(d.map((x) => x.code)).toContain('PEDAGOGY_LEVEL_MIX');
    expect(d.find((x) => x.code === 'PEDAGOGY_LEVEL_MIX').index).toBeNull();
  });

  test('8 questions with 4 at understand/apply passes', () => {
    const d = P.pedagogyDefects(set(['recall', 'recall', 'recall', 'recall', 'understand', 'understand', 'understand', 'apply']), { language: 'en', digest: DIGEST });
    expect(d.map((x) => x.code)).not.toContain('PEDAGOGY_LEVEL_MIX');
  });

  test('a lesson taught wholly at recall is not asked for the impossible', () => {
    // The validator also demands >=60% at-or-below the taught level. If every
    // SLO was taught at "recall", at most 40% of the set can sit above it —
    // demanding half would fail every attempt of every such lesson forever.
    const recallOnly = { slos: [{ id: 'S1', statement: 'name the letters', taught_level: 'recall' }] };
    const qs = set(['recall', 'recall', 'recall', 'recall', 'recall', 'understand', 'understand', 'understand'], Array(8).fill('S1'));
    expect(P.pedagogyDefects(qs, { language: 'en', digest: recallOnly }).map((x) => x.code)).not.toContain('PEDAGOGY_LEVEL_MIX');
    const tooFlat = set(['recall', 'recall', 'recall', 'recall', 'recall', 'recall', 'recall', 'understand'], Array(8).fill('S1'));
    expect(P.pedagogyDefects(tooFlat, { language: 'en', digest: recallOnly }).map((x) => x.code)).toContain('PEDAGOGY_LEVEL_MIX');
  });

  test('no digest, no level rule — a caller without SLOs is left alone', () => {
    const qs = set(['recall', 'recall', 'recall', 'recall', 'recall', 'recall', 'recall', 'recall']);
    expect(P.pedagogyDefects(qs, { language: 'en' }).map((x) => x.code)).not.toContain('PEDAGOGY_LEVEL_MIX');
  });
});

// ── the shape the validator consumes ────────────────────────────────────────
describe('pedagogyDefects — contract', () => {
  test('every defect carries a code, an index (or null) and an instructional message', () => {
    const qs = [
      q({ question: 'How many types of matter did the teacher mention?', options: ['3', '2', '4'], level: 'recall' }),
      q({ question: 'Which atom did the teacher ask your group to draw?', options: ['Oxygen', 'Carbon', 'Boron'], level: 'recall' }),
      ...Array.from({ length: 6 }, (_, i) => q({ question: `ok ${i}`, options: [`a${i}`, `b${i}`, `c${i}`], level: 'recall' })),
    ];
    const d = P.pedagogyDefects(qs, { language: 'en', digest: DIGEST });
    expect(d.length).toBeGreaterThanOrEqual(3);
    d.forEach((x) => {
      expect(x.code).toMatch(/^PEDAGOGY_/);
      expect(typeof x.message).toBe('string');
      expect(x.message.length).toBeGreaterThan(40);
      expect(x.index === null || Number.isInteger(x.index)).toBe(true);
    });
  });

  test('a clean set produces nothing', () => {
    const qs = [
      q({ question: 'Which of these is a type of matter?', options: ['gas', 'speed', 'weight'], level: 'understand' }),
      q({ question: 'Which of these is NOT a liquid?', options: ['ice', 'milk', 'water'], level: 'understand' }),
      q({ question: 'What happens to water when it is heated for a long time?', options: ['it turns to steam', 'it turns to ice', 'it stays the same'], level: 'apply' }),
      q({ question: 'Why does a stone keep its shape?', options: ['it is a solid', 'it is a liquid', 'it is a gas'], level: 'understand' }),
      q({ slo_id: 'S1', level: 'recall', question: 'Which of these is a solid?', options: ['stone', 'milk', 'air'] }),
      q({ slo_id: 'S1', level: 'recall', question: 'Which of these is a gas?', options: ['air', 'stone', 'milk'] }),
      q({ slo_id: 'S1', level: 'recall', question: 'Which of these is a liquid?', options: ['milk', 'stone', 'air'] }),
      q({ question: 'A balloon is squeezed and gets smaller. What is inside it?', options: ['gas', 'a solid', 'nothing'], level: 'apply' }),
    ];
    expect(P.pedagogyDefects(qs, { language: 'en', digest: DIGEST })).toEqual([]);
  });
});

// ── the number the prompt must quote ────────────────────────────────────────
describe('requiredHigherOrder — the target the author is given', () => {
  const slos = (levels) => ({ slos: levels.map((l, i) => ({ id: `S${i + 1}`, taught_level: l })) });

  test('a lesson with an understand-level SLO can carry half the set', () => {
    expect(P.requiredHigherOrder(8, slos(['recall', 'recall', 'recall', 'understand']))).toBe(4);
    expect(P.requiredHigherOrder(8, slos(['recall', 'understand', 'recall', 'apply', 'apply']))).toBe(4);
  });

  test('a lesson taught wholly at recall is asked for what the 60% rule leaves, not half', () => {
    // Five recall SLOs, eight questions: coverage forces five onto recall SLOs
    // and only the 40% budget can sit above the taught level. Asking for four
    // is asking the model to break the other rule — which is what it did.
    expect(P.requiredHigherOrder(8, slos(['recall', 'recall', 'recall', 'recall', 'recall']))).toBe(3);
  });

  test('coverage of many recall SLOs eats the room for higher-order questions', () => {
    expect(P.requiredHigherOrder(8, slos(['recall', 'recall', 'recall', 'recall', 'recall', 'understand']))).toBe(4);
    expect(P.requiredHigherOrder(6, slos(['recall', 'recall', 'recall', 'recall', 'recall', 'recall']))).toBe(2);
  });

  test('no digest — half the set, the plain reading of D3', () => {
    expect(P.requiredHigherOrder(8, null)).toBe(4);
    expect(P.requiredHigherOrder(8, { slos: [] })).toBe(4);
  });

  test('it is never stricter than the rule that judges the finished quiz', () => {
    // levelMixDefect measures the author's ACTUAL slo assignment, which can
    // only ever have less headroom than the best assignment this function
    // assumes. A prompt asking for more than the validator demands is fine; a
    // prompt asking for more than the validator ALLOWS is the bug.
    const digest = slos(['recall', 'recall', 'recall', 'recall', 'recall']);
    const target = P.requiredHigherOrder(8, digest);
    const qs = Array.from({ length: 8 }, (_, i) => ({
      slo_id: `S${(i % 5) + 1}`, level: i < target ? 'understand' : 'recall',
      question: `q${i}`, options: ['a', 'b', 'c'],
    }));
    expect(P.pedagogyDefects(qs, { language: 'en', digest }).map((d) => d.code)).not.toContain('PEDAGOGY_LEVEL_MIX');
  });
});
