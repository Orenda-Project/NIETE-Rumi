/**
 * The teacher's keyed reference in logs and events: HMAC-SHA256(WEB_QUIZ_KID_KEY, 't|' + users.id), 16 hex, null
 * under a 32-byte key. Until one shared helper exports it, a few modules carry their own copy, and the copies must
 * give the same value or a log line stops joining its events.
 *
 *   1. The copies are counted per file against teacher-reference-copies.allowlist.json, shrink-only: a new copy
 *      fails; a file that moves to the shared helper drops to 0 and passes with a CLEAN warning.
 *   2. Every file that still holds a copy should have a test that asserts the agreed value: a 32-byte key and the
 *      id a0000000-0000-4000-8000-000000000001 give e815e81977411f12. A listed copy without one prints a WARN line
 *      for now; once the shared helper lands the copies go, and this rule becomes "no copies".
 *
 * The listed copies: bot/shared/services/quiz/teacher-report-list.service.js (PR #2662),
 * bot/shared/services/first-touch/teacher-home.routes.js (PR #2655), bot/shared/services/quiz/web-quiz-join-queue.js
 * (PR #2653).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { countVerdict } = require('./ratchet-verdict-lib');
const ALLOW = require('./teacher-reference-copies.allowlist.json');

const REPO = path.resolve(__dirname, '../..');
const PINNED = 'e815e81977411f12';
const COPY = /\.update\(\s*(?:`t\|\$\{|'t\|'\s*\+)/g;
const tracked = (...dirs) => execFileSync('git', ['ls-files', '-z', '--', ...dirs], { cwd: REPO })
  .toString('utf8').split('\0').filter((f) => f.endsWith('.js'));
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const isTest = (f) => /(^|\/)tests\//.test(f);

function copies() {
  const hits = {};
  for (const f of tracked('bot', 'dashboard').filter((x) => !isTest(x) && !x.includes('node_modules'))) {
    const n = (read(f).match(COPY) || []).length;
    if (n) hits[f] = n;
  }
  return hits;
}

describe('the teacher reference copies', () => {
  test('the pattern: the two ways a copy is written, and nothing else', () => {
    const src = "h.update(`t|${id}`); h.update('t|' + id); h.update(`k|${id}`); h.update(`${d}|${v}`);";
    expect(src.match(COPY)).toHaveLength(2);
  });

  test('no new copy of the reference', () => {
    const { failures, warnings } = countVerdict(copies(), ALLOW, {
      what: 'inline teacher reference(s)', list: 'teacher-reference-copies.allowlist.json', exists: (f) => fs.existsSync(path.join(REPO, f)),
    });
    for (const line of warnings) console.warn(line);
    expect(failures).toEqual([]);
  });

  test('every copy is pinned to the agreed value by a test of its module (a listed copy without one: WARN)', () => {
    const tests = tracked('bot/tests', 'dashboard/tests').map((f) => [f, read(f)]).filter(([, s]) => s.includes(PINNED));
    const unpinned = Object.keys(copies()).filter((f) => {
      const mod = path.basename(f, '.js');
      return !tests.some(([, s]) => s.includes(`/${mod}'`) || s.includes(`/${mod}.js'`));
    });
    for (const f of unpinned.filter((x) => Object.prototype.hasOwnProperty.call(ALLOW, x))) {
      console.warn(`WARN: ${f} has no test asserting ${PINNED}. Add one beside its emitted reference.`);
    }
    expect(unpinned.filter((x) => !Object.prototype.hasOwnProperty.call(ALLOW, x))).toEqual([]);
  });
});
