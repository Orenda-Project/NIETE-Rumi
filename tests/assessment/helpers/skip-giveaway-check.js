'use strict';
/**
 * For suites that replay recorded model replies to test something else (reader, Urdu rounds, SST, layout):
 * those replies hold real answer give-aways, and the give-away re-ask (bd-5jmnfj.4.51.3) would spend the
 * next recorded reply. Require this BEFORE the generation service; fde-v23-repeats.test.js covers the check.
 */
jest.doMock('../../../bot/shared/services/assessment/fde-answer-repeats', () => ({
  ...jest.requireActual('../../../bot/shared/services/assessment/fde-answer-repeats'),
  answerRepeats: () => [],
  stillGivenAway: () => [],
}));
