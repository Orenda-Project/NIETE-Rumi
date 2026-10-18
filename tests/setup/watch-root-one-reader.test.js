/**
 * The watch root's VALUE key is spelled in ONE module, so it has one parser and one read policy.
 *
 * The VALUE names the code a class-less child's own quiz codes hang under; every reader that keeps those children out
 * of a teacher's class (the join queue, the teacher report, the quiz page's chips and roster, the school league) and
 * the videos module that mints under it must read it the same way. Three spellings of the key once meant three
 * parsers, so a padded or quoted value could be a root to one reader and not to another. This guard fails when code
 * outside bot/shared/services/quiz/watch-root.js spells the key; the others import WATCH_ROOT_KEY / rootOf from it.
 *
 * Allowed on purpose: the module itself, tests, and SQL migrations (comments may name the key anywhere).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HOME = 'bot/shared/services/quiz/watch-root.js';
const KEY = /['"`]web_quiz_watch_root['"`]/;

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

test('only watch-root.js spells the watch root\'s VALUE key in code', () => {
  const offenders = [];
  for (const top of ['bot', 'dashboard', 'scripts']) {
    for (const file of walk(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === HOME) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (KEY.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  }
  expect(offenders).toEqual([]);
});

test('the module that owns the key still spells it (the guard is not vacuous)', () => {
  expect(KEY.test(fs.readFileSync(path.join(ROOT, HOME), 'utf8'))).toBe(true);
});
