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

function lessonScreen(language, classes) {
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
  const names = ['Ayesha', 'Bilal', 'Hamza', 'Zara'];
  const children = classes.map((c, i) => ({
    id: `qs-${i}`, quiz_id: 'q-1', user_id: null, invited_by_student_id: null,
    student_name: names[i % names.length], student_class: c, status: 'completed',
    total_questions_answered: 8, correct_answers: 6 - i, mastery_percentage: Math.round(((6 - i) / 8) * 100),
  }));
  const tables = {
    users: [{ id: TEACHER, phone_number: '920000000000', preferred_language: language }],
    coaching_sessions: [session], quizzes: [quiz], quiz_sessions: children,
  };
  supabase.from.mockImplementation((t) => makeChain(tables[t] || []));
  return endpoint.handleTranscriptQuizDataExchange(TOKEN, 'LESSONS', { step: 'lesson', session_id: 's-1' });
}

/** The children's lines: "• Name (class) — score", isolates removed. */
const childLines = (results) => results.replace(/[⁦-⁩]/g, '').split('\n').filter((l) => l.startsWith('•'));

beforeEach(() => jest.clearAllMocks());

describe('/quiz lesson screen: the class, however it was typed, is written one way', () => {
  test('one class typed four ways is named once, not after every child', async () => {
    const out = await lessonScreen('en', ['4', 'Class 4', 'grade 4', '۴']);
    const results = out.data.results.replace(/[⁦-⁩]/g, '');
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
