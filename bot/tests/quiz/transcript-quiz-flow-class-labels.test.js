'use strict';
/**
 * The /quiz Flow's lesson screen lists how each child did. It printed each
 * child's class exactly as the child typed it into the join form, so one class
 * read "(4)", "(Class 4)", "(grade 4)", "(۴)" line by line — the same defect
 * the class report had. It now follows the report's rule, from the same helper:
 * the grade is read out of what was typed; one class is named once, above the
 * list; several classes are named on each child's line, written one way, in the
 * teacher's language.
 *
 * Driven through the real Flow endpoint; only supabase and the services it
 * calls out to over the network are replaced.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/transcript-quiz-handoff.service', () => ({ resend: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({ generate: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const endpoint = require('../../shared/routes/transcript-quiz-flow-endpoint');

const TEACHER = 'teacher-1';
const TOKEN = `${TEACHER}:transcript-quiz:1757100000000`;

/** A chain that filters like PostgREST would, enough for the lesson screen. */
function makeChain(rows) {
  let data = [...(rows || [])];
  const chain = {
    select: () => chain,
    eq: (f, v) => { data = data.filter((r) => r[f] === v); return chain; },
    neq: (f, v) => { data = data.filter((r) => r[f] !== v); return chain; },
    is: (f, v) => { data = data.filter((r) => (v === null ? r[f] == null : r[f] === v)); return chain; },
    in: (f, vs) => { data = data.filter((r) => vs.includes(r[f])); return chain; },
    order: () => chain,
    range: () => chain,
    limit: (n) => { data = data.slice(0, n); return chain; },
    update: () => chain,
    insert: () => chain,
    single: async () => ({ data: data[0] || null, error: null }),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}

function lessonScreen(language, classes, { names: longNames = null, stillGoing = 0 } = {}) {
  const session = {
    id: 's-1', user_id: TEACHER, status: 'completed', observation_type: null,
    created_at: '2026-09-20T06:00:00Z', transcript_text: 'x'.repeat(4000),
    analysis_data: { topic: 'Fractions', subject: 'maths' },
  };
  const quiz = {
    id: 'q-1', coaching_session_id: 's-1', teacher_id: TEACHER, quiz_source: 'transcript',
    status: 'sent', topic: 'Fractions', subject: 'maths', language,
    meta: { share_code_id: 'sc-1', student_message: 'forward me' },
  };
  // A Latin name and an Urdu one in every list, whatever the teacher's language.
  const names = longNames || ['Ayesha', 'نور', 'Hamza', 'زارا'];
  const children = classes.map((c, i) => ({
    id: `qs-${i}`, quiz_id: 'q-1', user_id: null, invited_by_student_id: null,
    student_name: `${names[i % names.length]}${longNames ? ` ${i + 1}` : ''}`, student_class: c, status: 'completed',
    total_questions_answered: 8, correct_answers: 6 - i, mastery_percentage: Math.round(((6 - i) / 8) * 100),
  })).concat(Array.from({ length: stillGoing }, (_, j) => ({
    id: `qg-${j}`, quiz_id: 'q-1', user_id: null, invited_by_student_id: null,
    student_name: `${names[j % names.length]} ${j + 100}`, student_class: '4', status: 'active',
    total_questions_answered: 2, correct_answers: 1, mastery_percentage: null,
  })));
  const tables = {
    users: [{ id: TEACHER, phone_number: '920000000000', preferred_language: language }],
    coaching_sessions: [session], quizzes: [quiz], quiz_sessions: children,
  };
  supabase.from.mockImplementation((t) => makeChain(tables[t] || []));
  return endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
}

/** The children's lines: "• Name (class) — score", isolates and direction marks removed. */
const childLines = (results) => results.replace(/[\u2066-\u2069\u200E\u200F]/g, '').split('\n').filter((l) => l.startsWith('•'));

beforeEach(() => jest.clearAllMocks());

describe('/quiz lesson screen: the class, however it was typed, is written one way', () => {
  test('one class typed four ways is named once, not after every child', async () => {
    const out = await lessonScreen('en', ['4', 'Class 4', 'grade 4', '۴']);
    const results = out.data.results.replace(/[\u2066-\u2069]/g, '');
    expect(results.match(/Class 4/g) || []).toHaveLength(1);
    const lines = childLines(results);
    expect(lines).toHaveLength(4);
    lines.forEach((l) => expect(l).toMatch(/^• \S+ — /));
    ['grade 4', '۴'].forEach((typed) => expect(results).not.toContain(typed));
  });

  test('several classes: each child\'s line names their class the same way', async () => {
    const out = await lessonScreen('en', ['Grade 5', 'class 4', '۵', '4th']);
    const lines = childLines(out.data.results);
    expect(lines).toHaveLength(4);
    lines.forEach((l) => expect(l).toMatch(/^• \S+ \(Class [45]\) — /));
    ['Grade 5', 'class 4', '۵', '4th'].forEach((typed) => expect(out.data.results).not.toContain(`(${typed})`));
  });

  test('an Urdu teacher reads "جماعت 5", never the English word or the typed spelling', async () => {
    const out = await lessonScreen('ur', ['Grade 5', 'class 4']);
    const lines = childLines(out.data.results);
    expect(lines).toHaveLength(2);
    lines.forEach((l) => expect(l).toMatch(/\(جماعت [45]\)/));
    expect(out.data.results).not.toMatch(/Grade|class 4/);
  });
});

/**
 * Every line of the results block carries the paragraph direction of the
 * teacher's language. A child's line is "• \u2068name\u2069 — \u2066score\u2069": its only strong
 * characters sit inside isolates, so a phone that resolves each line by its
 * first strong character found none and fell back to left-to-right — one Latin
 * name in an Urdu list sat flush left while every other line sat flush right.
 * In an English list an Urdu name's line is decided by how the platform treats
 * isolates, which Android and iOS do differently. An explicit mark — U+200F in
 * Urdu, U+200E in English — at the start of every line settles it everywhere.
 */
describe('/quiz lesson screen: every results line states its own direction', () => {
  const RLM = '\u200F';
  const LRM = '\u200E';
  const cases = [
    ['ur', 'one class, a Latin name in the list', ['4', 'Class 4', 'grade 4', '۴'], RLM],
    ['ur', 'several classes', ['Grade 5', 'class 4', '۵', '4th'], RLM],
    ['en', 'one class, an Urdu name in the list', ['4', 'Class 4'], LRM],
    ['en', 'several classes', ['Grade 5', 'class 4'], LRM],
  ];
  test.each(cases)('%s, %s', async (language, _label, classes, mark) => {
    // An Urdu name in an English list and a Latin one in an Urdu list, both.
    const out = await lessonScreen(language, classes.map((c) => c));
    const lines = out.data.results.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(3);
    const unmarked = lines.filter((l) => !l.startsWith(mark));
    expect(unmarked).toEqual([]);
    // One mark, never two, and never the other language's.
    lines.forEach((l) => expect(l.slice(1)).not.toMatch(/^[\u200E\u200F]/));
    expect(out.data.results).not.toContain(language === 'ur' ? LRM : RLM);
  });
});

describe('/quiz lesson screen: the marked results block stays inside its Flow field', () => {
  // `results` is one TextBody: 4096 characters (Meta's Flow component
  // reference). The marks add one code point per line; the list itself is
  // capped at 40 children plus a "…and N more" line. The longest block a class
  // can produce — 44 finished with long names in two classes, 6 still going —
  // must still fit, in both languages.
  test.each(['en', 'ur'])('%s: worst case fits in 4096 code points, every line marked', async (language) => {
    const out = await lessonScreen(language, Array.from({ length: 44 }, (_, i) => (i % 2 ? 'Grade 5' : 'class 4')), {
      names: ['Muhammad Abdullah Khan', 'عائشہ صدیقہ بنت احمد'], stillGoing: 6,
    });
    const results = out.data.results;
    expect([...results].length).toBeLessThanOrEqual(4096);
    const mark = language === 'ur' ? '\u200F' : '\u200E';
    results.split('\n').filter((l) => l.trim() !== '').forEach((l) => expect(l.startsWith(mark)).toBe(true));
  });
});

/**
 * A class the CHILD typed in the other script. Seen on staging before this
 * rule reached it: an English teacher's line read "• Test Child R9 (4 جماعت) —
 * 6/8 (75%)" — the child typed "جماعت 4", it was printed as typed, and its
 * Urdu isolate ran right to left inside the English line. The class is now
 * read out of what was typed and written in the TEACHER's language, so the
 * other script never reaches the line; Persian ordinals ("پنجم", "چہارم"),
 * which is how many Urdu speakers write a class, are read as numbers too.
 * A class with no number at all keeps its word inside one isolate.
 */
describe('/quiz lesson screen: a class typed in the other script', () => {
  const FSI = String.fromCharCode(0x2068);
  const PDI = String.fromCharCode(0x2069);
  const labelsOf = (results) => childLines(results).map((l) => (l.match(/\(([^)]*)\)/) || [])[1]);

  test('English teacher: "جماعت 4", "جماعت ۵" and "جماعت پنجم" read "Class 4" / "Class 5"', async () => {
    const out = await lessonScreen('en', ['جماعت 4', 'جماعت ۵', 'جماعت پنجم', 'Class 4']);
    expect(labelsOf(out.data.results)).toEqual(['Class 4', 'Class 5', 'Class 5', 'Class 4']);
  });

  test('Urdu teacher: "Class 4", "Grade 5" and "چہارم" read "جماعت 4" / "جماعت 5"', async () => {
    const out = await lessonScreen('ur', ['Class 4', 'Grade 5', 'چہارم']);
    expect(labelsOf(out.data.results)).toEqual(['جماعت 4', 'جماعت 5', 'جماعت 4']);
  });

  test('a class with no number in the other script is one isolate inside the English line', async () => {
    const out = await lessonScreen('en', ['کچی', '4']);
    const line = out.data.results.split('\n').find((l) => l.includes('•') && l.includes('کچی'));
    expect(line).toContain(`(${FSI}Class کچی${PDI})`);
  });
});
