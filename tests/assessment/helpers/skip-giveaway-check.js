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
// Same for the Science give-away flags (bd-5jmnfj.4.58 v37 round 8): recorded science replies overlap topically, and a flag
// would add a re-ask. fde-v37-science-r3.test.js covers the flags.
jest.doMock('../../../bot/shared/services/assessment/fde-science-giveaway-drop', () => ({
  ...jest.requireActual('../../../bot/shared/services/assessment/fde-science-giveaway-drop'),
  scienceGiverFlags: () => [],
}));
// And the lone Section A re-ask (bd-5jmnfj.4.58 v37r4): recorded replies are not spent on it; the drop itself still runs.
jest.doMock('../../../bot/shared/services/assessment/fde-science-mcq-reask', () => {
  const actual = jest.requireActual('../../../bot/shared/services/assessment/fde-science-mcq-reask');
  return { ...actual, settleScienceGivers: (exam, opts) => actual.settleScienceGivers(exam, { ...opts, ask: null }) };
});
// And the restated-stem key flags (bd-5jmnfj.4.58 v37r4): recorded science keys restate their stems; fde-science-key-stem.test.js covers them.
jest.doMock('../../../bot/shared/services/assessment/fde-science-key-stem', () => ({
  ...jest.requireActual('../../../bot/shared/services/assessment/fde-science-key-stem'),
  keyStemFlags: () => [],
}));
