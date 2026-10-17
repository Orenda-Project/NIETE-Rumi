'use strict';
/**
 * A quiz the teacher starts from the teacher home ("Quiz this", via 'home') is credited to the home: its row's
 * meta.source is 'home', its funnel channel 'teacher_home', and a start failure gets the copy for a teacher who asked
 * on their own ("Send /quiz to pick another lesson"), as a /quiz tap does. The list and the Flow are unchanged.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const Funnel = require('../../shared/services/quiz/quiz-funnel');
const Sources = require('../../shared/services/quiz/quiz-sources');

test('the meta source of a start: home and flow as they are, anything else the list', () => {
  expect(Funnel.metaSourceOf('home')).toBe('home');
  expect(Funnel.metaSourceOf('flow')).toBe('flow');
  expect(Funnel.metaSourceOf('list')).toBe('list');
  expect(Funnel.metaSourceOf(undefined)).toBe('list');
  expect(Funnel.metaSourceOf('menu')).toBe('list');
});

test('the funnel channel: home → teacher_home; the list and the Flow stay quiz_menu', () => {
  expect(Funnel.channelOf('home')).toBe('teacher_home');
  expect(Funnel.channelOf('list')).toBe('quiz_menu');
  expect(Funnel.channelOf('flow')).toBe('quiz_menu');
});

test('a start that fails for a quiz asked from the home gets the "asked on their own" copy', () => {
  const copy = (source) => Sources.failureCopyKey('queue_failed', Sources.LP_V8, { meta: { source } });
  expect(copy('home')).toBe('lpQuizCouldNotStartMenu');
  expect(copy('list')).toBe('lpQuizCouldNotStartMenu');
  expect(copy('lp_offer')).toBe('lpQuizCouldNotStart');
});
