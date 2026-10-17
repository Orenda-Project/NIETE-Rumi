'use strict';
/**
 * A test seeds a child or stories switch as the JSON boolean `true`, never as the string "true". These switches read
 * ON only for the boolean, so a test that seeds the string runs with the switch OFF and its "on" rows prove nothing.
 *
 * The keys are the readers-agree list (tests/helpers/child-switch-keys.js). A row that checks that the string reads
 * OFF says so in its name: its test, its describe or its table row label contains "the string".
 * The portal half of this check is dashboard/tests/web-quiz-switch-seeds-are-booleans.service.test.js.
 */
const path = require('path');
const { KEYS } = require('../../helpers/child-switch-keys');
const { findStringTrueSeeds, scanTrees } = require('../../helpers/string-true-seeds');

const CHILD_KEYS = Object.keys(KEYS);
const REPO = path.resolve(__dirname, '../../../..');
const found = (src) => findStringTrueSeeds(src, CHILD_KEYS).map((s) => [s.line, s.key]);

describe('the scan finds a child switch seeded as the string "true"', () => {
  test.each([
    ['an object row', "test('hub on', () => {\n  seed([{ key: 'web_quiz_hub', value: 'true' }]);\n});", [[2, 'web_quiz_hub']]],
    ['double quotes', 'test("hub on", () => {\n  seed([{ key: "web_quiz_hub", value: "true" }]);\n});', [[2, 'web_quiz_hub']]],
    ['a JSON string with quotes', "it('on', () => { seed([{ key: 'web_quiz_library', value: '\"true\"' }]); });", [[1, 'web_quiz_library']]],
    ['a map over a key list', "const ON_KEYS = ['web_quiz_hub', 'quiz_one_door'];\n"
      + "test('on', () => { seed(ON_KEYS.map((key) => ({ key, value: 'true' }))); });", [[2, 'web_quiz_hub']]],
    ['a map over a key list with a spread', "const A = ['web_quiz_stories'];\nconst B = [...A, 'web_quiz_x'];\n"
      + "test('on', () => { B.forEach((k) => rows.push({ key: k, value: 'true' })); });", [[3, 'web_quiz_stories']]],
    ['a settings map', "test('on', () => {\n  const s = { web_quiz_library: 'true', other: true };\n});", [[2, 'web_quiz_library']]],
    ['a key/value pair', "test('on', () => { pairs([['web_quiz_challenge_realtime', 'true']]); });", [[1, 'web_quiz_challenge_realtime']]],
    ['a mock reader', "const get = (k) => (k === 'web_quiz_challenge' ? 'true' : null);", [[1, 'web_quiz_challenge']]],
    ['a key constant', "const K = 'web_quiz_class_wall';\ntest('on', () => { seed([{ key: K, value: 'true' }]); });", [[2, 'web_quiz_class_wall']]],
    ['a row helper, at the call', "const STR = (k) => ({ key: k, value: 'true' });\n\n"
      + "test('stories on', () => { seed([STR('web_quiz_stories')]); });", [[3, 'web_quiz_stories']]],
    ['a list chain', "const ON = ['web_quiz_class_week', 'quiz_one_door'];\n"
      + "const rows = (off = []) => ON.filter((k) => !off.includes(k)).map((key) => ({ key, value: 'true' }));", [[2, 'web_quiz_class_week']]],
    ['a row helper over a list, at the call', "const settings = (keys) => keys.map((key) => ({ key, value: 'true' }));\n"
      + "const ON = ['web_quiz_hub'];\ntest('on', () => { seed(settings(ON)); });", [[3, 'web_quiz_hub']]],
    ['a row helper passed to map', "const ON = (key) => ({ key, value: 'true' });\n"
      + "test('on', () => { seed(['web_quiz_library'].map(ON)); });", [[2, 'web_quiz_library']]],
    ['a module key map', "const ON = (key) => ({ key, value: 'true' });\n"
      + "test('on', () => { seed([ON(Play.KEYS.hub), ON(Play.KEYS.v2), ON(Door.KEYS.oneDoor)]); });",
    [[2, 'web_quiz_challenge_v2'], [2, 'web_quiz_hub']]],
    ['a row under a name that does not say "the string"', "describe('golden', () => {\n"
      + "  test.each([['on', [{ key: 'web_quiz_book', value: false }, { key: 'web_quiz_challenge_book', value: 'true' }]]])('%s', () => {});\n});",
    [[2, 'web_quiz_challenge_book']]],
  ])('%s', (_, src, want) => {
    expect(found(src)).toEqual(want);
  });
});

describe('the scan leaves other rows alone', () => {
  test.each([
    ['the JSON boolean', "test('on', () => { seed([{ key: 'web_quiz_hub', value: true }]); });"],
    ['a door switch (keeps its reading)', "test('on', () => { seed([{ key: 'quiz_one_door', value: 'true' }]); });"],
    ['a test named "the string"', "test('the string \"true\" is off', () => { seed([{ key: 'web_quiz_hub', value: 'true' }]); });"],
    ['a describe named "the string"', "describe('the string true', () => {\n  test('off', () => { seed([{ key: 'web_quiz_hub', value: 'true' }]); });\n});"],
    ['a table row labelled "the string"', "test.each([\n  ['the string \"true\"', [{ key: 'web_quiz_stories', value: 'true' }], false],\n"
      + "])('Stories %s: off', () => {});"],
    ['a table under a "the string" title', "test.each([[{ key: 'web_quiz_stories', value: 'true' }]])('the string %p is off', () => {});"],
    ['a row helper used under a "the string" name', "const STR = (k) => ({ key: k, value: 'true' });\n"
      + "test('the string \\'true\\' is OFF', () => { seed([STR('web_quiz_stories')]); });"],
    ['a comparison, not a seed', "const on = (rows, k) => rows.some((r) => r.key === 'web_quiz_hub' && r.value === 'true');"],
    ['a comment', "// seed([{ key: 'web_quiz_hub', value: 'true' }]);\n/* { web_quiz_hub: 'true' } */"],
    ['text in a string', "const note = \"{ key: 'web_quiz_hub', value: 'true' }\";"],
    ['a string "true" with no child key near it', "test('rows', () => { for (const v of [undefined, false, 'true']) use(v); });"],
  ])('%s', (_, src) => {
    expect(found(src)).toEqual([]);
  });
});

test('the key list is the readers-agree list, without the first-touch door and teacher switches', () => {
  expect(CHILD_KEYS).toEqual(expect.arrayContaining(['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_library', 'web_quiz_stories']));
  for (const door of ['quiz_maker_page', 'quiz_first_door', 'quiz_student_join', 'quiz_one_door', 'quiz_teacher_home',
    'quiz_test_personas', 'web_quiz_bind_way_back']) expect(CHILD_KEYS).not.toContain(door);
});

test('no test under bot/tests or dashboard/tests seeds a child switch as the string "true"', () => {
  const seeds = scanTrees([path.join(REPO, 'bot', 'tests'), path.join(REPO, 'dashboard', 'tests')], CHILD_KEYS);
  expect(seeds.map((s) => `${path.relative(REPO, s.file)}:${s.line} ${s.key}`)).toEqual([]);
});
