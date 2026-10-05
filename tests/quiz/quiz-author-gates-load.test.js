'use strict';
/**
 * The quiz validator is required by offline callers with no database at all: the
 * KaTeX typesetting suite, the eval and measurement scripts. quiz-author-gates.js
 * sits under the validator, so it must not reach config/supabase at require time
 * (that module exits the process with 78 when SUPABASE_URL is unset). The flag is
 * read through config/feature-flags only when a quiz asks for it.
 */
const DB_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

describe('quiz-author-gates loads with no database config', () => {
  const saved = {};
  let exit;
  beforeEach(() => {
    DB_VARS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    exit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`process.exit(${code})`); });
  });
  afterEach(() => {
    DB_VARS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    exit.mockRestore();
  });

  test('the gates module and the validator require without touching the DB client', () => {
    jest.isolateModules(() => {
      expect(() => require('../../bot/shared/services/quiz/quiz-author-gates')).not.toThrow();
      expect(() => require('../../bot/shared/services/quiz/transcript-quiz-validator')).not.toThrow();
    });
    expect(exit).not.toHaveBeenCalled();
  });

  test('isQuizAuthorGatesV2 still reads the one flag reader in config/feature-flags', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/config/feature-flags', () => ({
      QUIZ_AUTHOR_GATES_V2_KEY: 'quiz_author_gates_v2',
      isQuizAuthorGatesV2: jest.fn().mockResolvedValue(true),
    }));
    const Gates = require('../../bot/shared/services/quiz/quiz-author-gates');
    const Flags = require('../../bot/shared/config/feature-flags');
    expect(Gates.QUIZ_AUTHOR_GATES_V2_KEY).toBe('quiz_author_gates_v2');
    await expect(Gates.isQuizAuthorGatesV2()).resolves.toBe(true);
    expect(Flags.isQuizAuthorGatesV2).toHaveBeenCalledTimes(1);
    jest.dontMock('../../bot/shared/config/feature-flags');
  });
});
