'use strict';
/**
 * Golden rows for the link language (web-quiz-child-lang.js childLang()) under every value of app_settings
 * `web_quiz_return_lang`: only JSON true turns it on; no row, false and the string 'true' are off and every answer is
 * null. On: a grown-up's choice → the newest class quiz → the join row → null (a link never carries a library
 * lesson's language). Real: the resolver, its order, the repo and the switch reader. Faked: the supabase transport and
 * the loggers.
 * Then every answer of the order itself (ladder) and of the quiz service's two history readers, over every mix of
 * kept row, ?lang=, history, link language and `lessons`, as one fingerprint: the same before and after the order
 * moved to its own file.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));

const crypto = require('crypto');

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const CL = require('../../../shared/services/quiz/web-quiz-child-lang');

const KID = '44444444-4444-4444-8444-0000000000e7';
const NO_ROW = Symbol('no row');

function seed(ret, kept) {
  const fake = makeFake({
    app_settings: ret === NO_ROW ? [] : [{ key: 'web_quiz_return_lang', value: ret }],
    child_language: kept ? [{ canonical_id: KID, ...kept }] : [],
  }, { uniques: { child_language: ['canonical_id'] } });
  Object.assign(supabase, { from: (t) => fake.from(t), rpc: fake.rpc });
  Ret._resetCache();
}

const cls = (language) => ({ language, lessonCode: false });
const lesson = (language) => ({ language, lessonCode: true });

// [case, kept row, history, answer with the switch on]
const ROWS = [
  ['a choice beats the class quiz', { language: 'en', source: 'chosen' }, [cls('ur')], 'en'],
  ['the class quiz beats the join', { language: 'en', source: 'join' }, [cls('ur')], 'ur'],
  ['library lessons only: the join', { language: 'en', source: 'join' }, [lesson('ur')], 'en'],
  ['library lessons only, no row: none', null, [lesson('ur')], null],
  ['no quiz, no row: none', null, [], null],
];

describe.each([
  ['absent', NO_ROW, true],
  ['false', false, true],
  ["the string 'true'", 'true', true],
  ['true', true, false],
])('switch %s', (_, ret, off) => {
  test.each(ROWS)('%s', async (__, kept, history, onAnswer) => {
    seed(ret, kept);
    expect(await CL.childLang(KID, { history })).toBe(off ? null : onAnswer);
  });
});

describe('every answer of the order, one fingerprint', () => {
  const OWN = [null, { language: 'en', source: 'chosen' }, { language: 'ur', source: 'chosen' },
    { language: 'en', source: 'join' }, { language: 'ur', source: 'join' }];
  const LANG = [null, 'en', 'ur'];
  const HISTORY = [null, [], [cls('en')], [cls('ur')], [lesson('ur')], [lesson('en')], [lesson('ur'), cls('en')],
    [lesson('en'), cls('ur')], [cls('ur'), lesson('en')], [lesson('ur'), lesson('en')], [cls('fr')], [lesson('fr')]];

  test('ladder / classLanguage / childLanguage: 1,104 answers, unchanged', () => {
    const SQ = require('../../../shared/services/quiz/student-quiz.service');
    const out = [];
    for (const own of OWN) for (const asked of LANG) for (const history of HISTORY) for (const linked of LANG) {
      for (const lessons of [true, false]) out.push(CL.ladder({ own, asked, history, linked, lessons }));
    }
    for (const history of HISTORY) out.push(SQ.classLanguage(history), SQ.childLanguage(history));
    expect(out).toHaveLength(OWN.length * 3 * HISTORY.length * 3 * 2 + HISTORY.length * 2);
    expect(crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex')).toBe('9be37f2fbe67c9f14c746fdb72f8f78bf35179b6ff293f354e4c9d72e1241470');
  });
});
