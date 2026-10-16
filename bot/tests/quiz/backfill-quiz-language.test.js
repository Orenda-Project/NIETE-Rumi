'use strict';
/**
 * The one-off backfill that marks each video-bank quiz with the language its questions are written in.
 *
 * Rule: a quiz is 'ur' when at least half of its question texts contain an Arabic-script letter, else 'en';
 * a quiz with no question text is left alone. Only quizzes with language IS NULL and quiz_source = 'video'
 * are read or written. Dry run is the default; --apply writes. The database is an in-memory fake that
 * applies every filter it is given, so a query that forgets one goes red.
 */
jest.mock('../../shared/config/supabase', () => ({}));

const Backfill = require('../../scripts/quiz/backfill-quiz-language');
const { makeFake } = require('./web-quiz/fake-supabase');

const EN = [
  'What is 3 + 4?',
  'Which animal says moo?',
  'How many sides does a triangle have?',
  'Pick the noun in the sentence.',
  'What colour is the sky on a clear day?',
];
const UR = [
  'تین جمع چار کتنے ہوتے ہیں؟',
  'کون سا جانور دودھ دیتا ہے؟',
  'مثلث کے کتنے کنارے ہوتے ہیں؟',
  'اس جملے میں اسم کون سا ہے؟',
  'صاف دن میں آسمان کا رنگ کیا ہوتا ہے؟',
];
const mix = (urdu, total) => Array.from({ length: total }, (_, i) => (i < urdu ? UR[i % UR.length] : EN[i % EN.length]));

// Fixed, sortable ids so keyset paging is deterministic.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function quiz(n, extra = {}) {
  return { id: id(n), quiz_source: 'video', status: 'ready', language: null, topic: `T${n}`, grade: '4', subject: 'Maths', ...extra };
}

function questionsFor(quizId, texts) {
  return texts.map((t, i) => ({ id: `${quizId}-q${i}`, quiz_id: quizId, question_text: t, sort_order: i }));
}

function seed() {
  const quizzes = [
    quiz(1),                                          // English → en
    quiz(2),                                          // Urdu → ur
    quiz(3),                                          // 5 of 10 Urdu → ur
    quiz(4),                                          // 4 of 10 Urdu → en
    quiz(5),                                          // no question text → untouched
    quiz(6, { language: 'en' }),                      // already marked → untouched, even with Urdu questions
    quiz(7, { quiz_source: 'lesson_plan' }),          // not a video quiz → untouched
  ];
  const questions = [
    ...questionsFor(id(1), EN),
    ...questionsFor(id(2), UR),
    ...questionsFor(id(3), mix(5, 10)),
    ...questionsFor(id(4), mix(4, 10)),
    ...questionsFor(id(6), UR),
    ...questionsFor(id(7), UR),
  ];
  return makeFake({ quizzes, quiz_questions: questions });
}

const langOf = (fake, n) => fake.db.quizzes.find((q) => q.id === id(n)).language;
const updates = (fake) => fake.calls.filter((c) => c.op === 'update');

describe('decideLanguage — the rule', () => {
  test('a known-English quiz → en', () => {
    expect(Backfill.decideLanguage(EN)).toBe('en');
  });

  test('a known-Urdu quiz → ur', () => {
    expect(Backfill.decideLanguage(UR)).toBe('ur');
  });

  test('5 of 10 questions in Urdu → ur (half is enough)', () => {
    expect(Backfill.decideLanguage(mix(5, 10))).toBe('ur');
  });

  test('4 of 10 questions in Urdu → en', () => {
    expect(Backfill.decideLanguage(mix(4, 10))).toBe('en');
  });

  test('no texts, or only empty texts → null (left alone)', () => {
    expect(Backfill.decideLanguage([])).toBeNull();
    expect(Backfill.decideLanguage(undefined)).toBeNull();
    expect(Backfill.decideLanguage(['', '   ', null])).toBeNull();
  });

  test('every Arabic-script block counts (basic, supplement, presentation forms A and B)', () => {
    for (const ch of ['\u0627', '\u0750', '\uFB50', '\uFE70']) {
      expect(Backfill.decideLanguage([`x ${ch} y`])).toBe('ur');
    }
  });

  test('a letter just outside the blocks (Thaana U+0780) is not Urdu', () => {
    expect(Backfill.decideLanguage(['x \u0780 y'])).toBe('en');
  });

  test('digits and Latin punctuation alone are English', () => {
    expect(Backfill.decideLanguage(['12 + 7 = ?', '(a) 3/4'])).toBe('en');
  });
});

describe('voiceLanguage — the read-aloud voice is never changed', () => {
  test("today's voice rule: ANY Arabic letter in a question or first option → ur", () => {
    expect(Backfill.voiceLanguage([{ question_text: EN[0], option_a: 'تین' }])).toBe('ur');
    expect(Backfill.voiceLanguage([{ question_text: EN[0], option_a: '7' }])).toBe('en');
  });

  test('a quiz whose decided language differs from its voice language is left NULL', async () => {
    const fake = makeFake({
      quizzes: [quiz(1)],
      quiz_questions: questionsFor(id(1), EN).map((q, i) => (i === 0 ? { ...q, option_a: 'سات' } : q)),
    });
    const out = await Backfill.run({ supabase: fake, dryRun: false, log: () => {} });
    expect(out.decided).toEqual({ en: 0, ur: 0, untouched: 0, disagree: 1 });
    expect(langOf(fake, 1)).toBeNull();
    expect(updates(fake)).toHaveLength(0);
  });
});

describe('run — dry run (the default)', () => {
  test('writes nothing and reports the before / would-be counts', async () => {
    const fake = seed();
    const lines = [];
    const out = await Backfill.run({ supabase: fake, log: (l) => lines.push(l) });

    expect(updates(fake)).toHaveLength(0);
    expect(out.dryRun).toBe(true);
    expect(out.decided).toEqual({ en: 1, ur: 2, untouched: 1, disagree: 1 });
    // before: every video quiz by language (quiz 7 is not a video quiz)
    expect(out.before).toEqual({ en: 1, ur: 0, untouched: 5 });
    expect(out.after).toEqual({ en: 2, ur: 2, untouched: 2 });
    expect(out.written).toBe(0);
    expect(lines.join('\n')).toMatch(/DRY RUN/);
    expect(lines.join('\n')).toMatch(/before/);
    expect(lines.join('\n')).toMatch(/after/);
    [1, 2, 3, 4, 5, 7].forEach((n) => expect(langOf(fake, n)).toBeNull());
    expect(langOf(fake, 6)).toBe('en');
  });

  test('never prints a question text', async () => {
    const fake = seed();
    const lines = [];
    await Backfill.run({ supabase: fake, log: (l) => lines.push(l) });
    const all = lines.join('\n');
    for (const t of [...EN, ...UR]) expect(all).not.toContain(t);
  });
});

describe('run — apply', () => {
  test('writes exactly the decided rows, and nothing else', async () => {
    const fake = seed();
    const out = await Backfill.run({ supabase: fake, dryRun: false, log: () => {} });

    expect(out.written).toBe(3);
    expect(langOf(fake, 1)).toBe('en');
    expect(langOf(fake, 2)).toBe('ur');
    expect(langOf(fake, 3)).toBe('ur');
    expect(langOf(fake, 4)).toBeNull();     // 4 of 10 Urdu: decided en, but today's voice reads it as ur → left alone
    expect(langOf(fake, 5)).toBeNull();     // no question text
    expect(langOf(fake, 6)).toBe('en');     // already set: not overwritten with 'ur'
    expect(langOf(fake, 7)).toBeNull();     // not a video quiz
    expect(out.after).toEqual({ en: 2, ur: 2, untouched: 2 });

    // Every write is guarded by the same filter as the read (no blind update by id).
    for (const u of updates(fake)) {
      expect(u.table).toBe('quizzes');
      expect(Object.keys(u.payload)).toEqual(['language']);
    }
    // quiz_questions is never written
    expect(fake.calls.filter((c) => c.table === 'quiz_questions' && c.op !== 'select')).toHaveLength(0);
  });

  test('a second apply writes nothing (idempotent)', async () => {
    const fake = seed();
    await Backfill.run({ supabase: fake, dryRun: false, log: () => {} });
    const before = updates(fake).length;
    const again = await Backfill.run({ supabase: fake, dryRun: false, log: () => {} });
    expect(again.decided).toEqual({ en: 0, ur: 0, untouched: 1, disagree: 1 });
    expect(again.written).toBe(0);
    expect(updates(fake).length).toBe(before);
  });

  test('pages through a bank bigger than one page without an oversize .in() list', async () => {
    const quizzes = [];
    const questions = [];
    for (let n = 1; n <= 450; n += 1) {
      quizzes.push(quiz(n));
      questions.push(...questionsFor(id(n), n % 3 === 0 ? UR : EN));
    }
    const fake = makeFake({ quizzes, quiz_questions: questions });
    const out = await Backfill.run({ supabase: fake, dryRun: false, log: () => {}, page: 100 });
    expect(fake.calls.filter((c) => c.overflow)).toHaveLength(0);
    expect(out.decided).toEqual({ en: 300, ur: 150, untouched: 0, disagree: 0 });
    expect(out.written).toBe(450);
    expect(fake.db.quizzes.filter((q) => q.language === null)).toHaveLength(0);
  });

  test('a read error stops the run before any write', async () => {
    const fake = seed();
    const realFrom = fake.from;
    fake.from = (t) => {
      const b = realFrom(t);
      if (t !== 'quiz_questions') return b;
      const then = b.then;
      b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
      void then;
      return b;
    };
    await expect(Backfill.run({ supabase: fake, dryRun: false, log: () => {} })).rejects.toThrow(/boom/);
    expect(updates(fake)).toHaveLength(0);
  });
});

describe('main — the CLI', () => {
  const REF = 'sandboxrefabc';
  const ENV = { SUPABASE_URL: `https://${REF}.supabase.co` };

  test('no flag → dry run', async () => {
    const fake = seed();
    const out = await Backfill.main([], { db: fake, env: ENV, print: () => {} });
    expect(out.dryRun).toBe(true);
    expect(updates(fake)).toHaveLength(0);
  });

  test('--apply without the matching --expect-ref is refused, nothing read or written', async () => {
    const fake = seed();
    const lines = [];
    const out = await Backfill.main(['--apply'], { db: fake, env: ENV, print: (l) => lines.push(l) });
    expect(out.refused).toBe(true);
    expect(fake.calls).toHaveLength(0);
    const wrong = await Backfill.main(['--apply', '--expect-ref', 'otherref'], { db: fake, env: ENV, print: (l) => lines.push(l) });
    expect(wrong.refused).toBe(true);
    expect(lines.join('\n')).not.toContain(REF);
  });

  test('--apply --expect-ref <the ref> writes', async () => {
    const fake = seed();
    const out = await Backfill.main(['--apply', '--expect-ref', REF], { db: fake, env: ENV, print: () => {} });
    expect(out.written).toBe(3);
  });

  test('an unknown argument is an error', () => {
    expect(() => Backfill.parseArgs(['--aply'])).toThrow(/unknown argument/);
  });
});
