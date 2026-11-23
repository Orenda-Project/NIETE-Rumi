'use strict';
/**
 * A child reads the evening round's title (the tile, the hub card, the quiz page, the report). It comes from the lesson
 * plan's heading, which often ends in a bracket listing answer formats for the teacher: «… (MCQ، مختصر، تفصیلی، زبانی)»,
 * "(MCQ, short, long)". The round drops that ONE trailing bracket when every part of it is a format word, before the
 * share code copies the title (mintCode reads quizzes.topic); a bracket that names content stays.
 * Faked boundaries: Supabase (in memory), Redis off, the loggers, the two model calls, the share-code mint.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');
const { dropFormatBracket } = require('../../shared/services/quiz/quiz-child-title');

const C1 = 'c1a55000-0000-4000-8000-0000000000f1';
const T1 = '7e000000-0000-4000-8000-0000000000f1';
const QID = 'q-round-title';

function seed(topic, language = 'ur') {
  const db = {
    quizzes: [{ id: QID, teacher_id: T1, topic, subject: 'urdu', grade: '4', language, status: 'generating',
      meta: { source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRAB', recall_src: [] } }],
    quiz_share_codes: [],
    classes: [{ id: C1, grade_code: 'grade_4', section: 'A' }],
    quiz_questions: [1, 2, 3, 4, 5].map((n) => ({ id: `l${n}`, quiz_id: QID, external_id: `tq:x:S1:${n}`, sort_order: n, question_text: `L${n}`, correct_option: 'A', media: {} })),
  };
  Object.assign(supabase, { from: makeFake(db).from });
  // The real mint copies quizzes.topic onto the code; this one records what it would copy.
  const mintCode = jest.fn(async () => {
    db.quiz_share_codes.push({ id: 'sc-t', code: 'RNDT42', quiz_id: QID, class_id: C1, topic: db.quizzes[0].topic });
    return { id: 'sc-t', code: 'RNDT42' };
  });
  return { db, mintCode };
}
const deps = (mintCode) => ({ mintCode, complete: jest.fn(), verify: jest.fn() });

test.each([
  ['Urdu, a bracket of format words', 'ur', 'تفہیم — گہرائی تک پہنچنا (MCQ، مختصر، تفصیلی، زبانی)', 'تفہیم — گہرائی تک پہنچنا'],
  ['English, a bracket of format words', 'en', 'Finding the main idea (MCQ, short, long)', 'Finding the main idea'],
])('%s: the round and its share code carry the title without it', async (_name, lang, topic, want) => {
  const { db, mintCode } = seed(topic, lang);
  const out = await Round.afterGenerate({ quizId: QID }, deps(mintCode));
  expect(out).toMatchObject({ ok: true, round: true });
  expect(db.quizzes[0].topic).toBe(want);
  expect(db.quiz_share_codes[0].topic).toBe(want);
  expect(db.quizzes[0].status).toBe('ready');
});

test.each([
  ['a bracket that names content', 'Fractions (halves and quarters)'],
  ['a mixed bracket (content and a format word)', 'Plants (roots, MCQ)'],
  ['no bracket', 'Identifying the main purpose of a text'],
  ['a bracket that is not at the end', 'Nouns (people) and verbs'],
])('%s stays as written', async (_name, topic) => {
  const { db, mintCode } = seed(topic, 'en');
  await Round.afterGenerate({ quizId: QID }, deps(mintCode));
  expect(db.quizzes[0].topic).toBe(topic);
  expect(db.quiz_share_codes[0].topic).toBe(topic);
});

test('dropFormatBracket: the rule on its own (either script; parts split on «،» , / «و» and &; a dash before it goes too)', () => {
  expect(dropFormatBracket('Reading — (oral)')).toBe('Reading');
  expect(dropFormatBracket('ضمیر (MCQ، مختصر و تفصیلی)')).toBe('ضمیر');
  expect(dropFormatBracket('جمع (کثیر الانتخابی, معروضی)')).toBe('جمع');
  expect(dropFormatBracket('Verbs (true/false & fill in the blanks)')).toBe('Verbs');
  expect(dropFormatBracket('Plants (short and long answer)')).toBe('Plants');
  expect(dropFormatBracket('ضمیر (pronouns)')).toBe('ضمیر (pronouns)');
  expect(dropFormatBracket('Plants (roots and stems)')).toBe('Plants (roots and stems)');
  expect(dropFormatBracket('(MCQ)')).toBe('(MCQ)'); // nothing would be left: kept
  expect(dropFormatBracket('')).toBe('');
  expect(dropFormatBracket(null)).toBe('');
});
