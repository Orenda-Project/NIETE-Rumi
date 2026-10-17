'use strict';
/**
 * The portal half of bot/tests/quiz/web-quiz/switch-seeds-are-booleans.test.js: no test seeds a child or stories
 * switch as the string "true" (those switches read ON only for the JSON boolean, so such a test runs with the switch
 * OFF). The keys are the bot's readers-agree list, which holds the portal's stories keys too. A row that checks the
 * string reads OFF says so in its name ("the string ...").
 */
const path = require('path');
const { KEYS } = require('../../bot/tests/helpers/child-switch-keys');
const { findStringTrueSeeds, scanTrees } = require('../../bot/tests/helpers/string-true-seeds');

const CHILD_KEYS = Object.keys(KEYS);
const REPO = path.resolve(__dirname, '../..');

test('the portal stories switches are in the list', () => {
  expect(CHILD_KEYS).toEqual(expect.arrayContaining(['web_quiz_stories', 'web_quiz_stories_teacher']));
});

test('the scan sees a portal-style seed, and leaves a row named "the string" alone', () => {
  const seeded = "test('story files on', async () => {\n  mockFrom = settings([{ key: 'web_quiz_stories', value: 'true' }]);\n});";
  const named = "test('the string \"true\" keeps the story files off', async () => {\n"
    + "  mockFrom = settings([{ key: 'web_quiz_stories', value: 'true' }]);\n});";
  expect(findStringTrueSeeds(seeded, CHILD_KEYS)).toEqual([{ line: 2, key: 'web_quiz_stories' }]);
  expect(findStringTrueSeeds(named, CHILD_KEYS)).toEqual([]);
});

test('no test under dashboard/tests or bot/tests seeds a child switch as the string "true"', () => {
  const seeds = scanTrees([path.join(REPO, 'dashboard', 'tests'), path.join(REPO, 'bot', 'tests')], CHILD_KEYS);
  expect(seeds.map((s) => `${path.relative(REPO, s.file)}:${s.line} ${s.key}`)).toEqual([]);
});
