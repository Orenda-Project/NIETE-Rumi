'use strict';
/**
 * The child's-language resolver (web-quiz-child-lang.js childLang()/ownOf()) against the REAL child-language.repo:
 * with app_settings `web_quiz_return_lang` on (JSON true), a child with no class quiz resolves to the language kept on
 * their child_language row ('chosen' first, else the 'join' row), read from the table through the repo's stored().
 * Off: the table is never touched and every answer is null, the same as for a child with no row. Real: the resolver,
 * its ladder, student-quiz's history read, the repo and the switch reader. Faked: the supabase transport
 * (./fake-supabase) and the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const Repo = require('../../../shared/services/quiz/child-language.repo');
const CL = require('../../../shared/services/quiz/web-quiz-child-lang');

const KID = '44444444-4444-4444-8444-0000000000e3';

let fake;
function seed(ret, kept = null) {
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_return_lang', value: ret }],
    students: [{ id: KID, student_name: 'Sara Testwala', self_reported_class: '2', list_id: null, is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], class_enrollments: [], student_lists: [],
    child_language: kept ? [{ canonical_id: KID, ...kept }] : [],
  }, { uniques: { child_language: ['canonical_id'] } });
  Object.assign(supabase, { from: (t) => fake.from(t), rpc: fake.rpc });
  Ret._resetCache();
}
const langCalls = () => fake.calls.filter((c) => c.table === Repo.TABLE);

beforeEach(() => jest.clearAllMocks());

describe('switch on: the resolver reads the child\'s row through the real repo', () => {
  test('a stored "chosen" row "ur", no class quiz → childLang() "ur", ownOf() the row; child_language read', async () => {
    seed(true, { language: 'ur', source: 'chosen' });
    expect(await CL.childLang(KID)).toBe('ur');
    expect(await CL.ownOf(KID)).toEqual({ language: 'ur', source: 'chosen' });
    expect(langCalls().filter((c) => c.op === 'select').length).toBeGreaterThanOrEqual(1);
    expect(langCalls().filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('a stored "join" row "ur", no class quiz → childLang() "ur" (the ladder\'s join rung)', async () => {
    seed(true, { language: 'ur', source: 'join' });
    expect(await CL.childLang(KID)).toBe('ur');
  });
});

describe('switch off: child_language is never touched', () => {
  test('the same chosen row: childLang()/ownOf() null, as with no row; 0 child_language calls', async () => {
    seed(false, { language: 'ur', source: 'chosen' });
    const withRow = [await CL.childLang(KID), await CL.ownOf(KID)];
    expect(langCalls()).toEqual([]);
    seed(false);
    expect(withRow).toEqual([await CL.childLang(KID), await CL.ownOf(KID)]);
    expect(withRow).toEqual([null, null]);
  });
});
