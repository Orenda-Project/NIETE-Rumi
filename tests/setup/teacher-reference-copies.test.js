/**
 * The teacher's keyed reference in logs, events and the first-open mark: HMAC-SHA256(WEB_QUIZ_KID_KEY, 't|' + users.id),
 * 16 hex, null under a 32-byte key. One helper computes it: tk() in bot/shared/services/quiz/web-quiz-kid.js. The
 * modules that once carried their own copy (teacher-report-list.service.js, maker.fallback.js, web-quiz-join-queue.js,
 * teacher-home.routes.js) call it.
 *
 *   1. No copies: an inline `.update('t|' + id)` outside the helper fails (teacher-reference-copies.allowlist.json is
 *      empty and shrink-only — a new entry needs a reason in review).
 *   2. The helper is pinned: a test asserts that a 32-byte key and the id a0000000-0000-4000-8000-000000000001 give
 *      e815e81977411f12 through web-quiz-kid, so a change to the helper's value cannot pass unnoticed.
 */const fs = require('fs');
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

  test('no copies: the list is empty and the tree holds none', () => {
    expect(ALLOW).toEqual({});
    expect(copies()).toEqual({});
  });

  test('the shared helper is pinned to the agreed value by a test', () => {
    const pins = tracked('bot/tests', 'dashboard/tests').filter((f) => {
      const src = read(f);
      return src.includes(PINNED) && /\/web-quiz-kid['.]/.test(src);
    });
    expect(pins.length).toBeGreaterThan(0);
  });
});
