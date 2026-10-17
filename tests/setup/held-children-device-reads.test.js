/**
 * "May this phone name this child?" is asked with ONE read for all the children a phone holds.
 *
 * deviceMayName (bot/shared/services/quiz/web-quiz-hub-device.js) costs a quiz_sessions read per call, so a caller that
 * asks it once per held child makes N reads per page open (eight children, nine reads). deviceMayNameEach answers the
 * same question for every child with one read. This guard keeps the per-child call to the callers that ask about ONE
 * child, and ties every caller that holds several children to a test that counts its reads.
 *
 *   - Code that calls deviceMayName (any shape: a loop, a map, an alias) must be in SINGLE below. A file that is not
 *     listed fails here; if it asks about several children it moves to deviceMayNameEach and gets a read-count row.
 *   - Every caller of deviceMayNameEach is in MANY, with the test file and test name that counts its quiz_sessions
 *     reads on a phone holding eight children; the guard checks that row still exists.
 *
 * Allowed on purpose: the module itself, tests, and comments.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HOME = 'bot/shared/services/quiz/web-quiz-hub-device.js';
const ONE = /\bdeviceMayName\b(?!Each)/;
const EACH = /\bdeviceMayNameEach\b/;

// the callers that ask about one child (the child being started or offered), with what they ask about
const SINGLE = {
  'bot/shared/services/quiz/web-quiz-hub.js': 'passes the function on to the hub routes',
  'bot/shared/services/quiz/web-quiz-next-offer-result.js': 'the one child who just finished',
  'bot/shared/services/quiz/web-quiz.service.js': 'the one child a start names',
};

// the callers that ask about every child a phone holds, and the row that counts their reads
const MANY = {
  'bot/shared/services/quiz/web-quiz-link-known.js': {
    test: 'bot/tests/quiz/web-quiz/web-quiz-link-known.test.js',
    row: 'the "may this phone name them" checks cost ONE quiz_sessions read however many children the phone holds',
  },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function callers(rx) {
  const found = new Set();
  for (const top of ['bot', 'dashboard', 'scripts']) {
    for (const file of walk(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === HOME) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (rx.test(line.replace(/\/\/.*$/, ''))) found.add(rel);
      });
    }
  }
  return [...found].sort();
}

test('only the one-child callers call deviceMayName', () => {
  expect(callers(ONE).filter((f) => !SINGLE[f])).toEqual([]);
});

test('every caller of deviceMayNameEach is listed with the row that counts its reads', () => {
  expect(callers(EACH).filter((f) => !MANY[f])).toEqual([]);
});

test('each listed read-count row still exists in its test file', () => {
  for (const [file, { test: t, row }] of Object.entries(MANY)) {
    const src = fs.readFileSync(path.join(ROOT, t), 'utf8');
    expect({ file, has: src.includes(row) }).toEqual({ file, has: true });
  }
});

test('the lists are not stale: each listed file still calls what it is listed for (the guard is not vacuous)', () => {
  expect(callers(ONE)).toEqual(Object.keys(SINGLE).sort());
  expect(callers(EACH)).toEqual(Object.keys(MANY).sort());
  expect(ONE.test(fs.readFileSync(path.join(ROOT, HOME), 'utf8'))).toBe(true);
});
