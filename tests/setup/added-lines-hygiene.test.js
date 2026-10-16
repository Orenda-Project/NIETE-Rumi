/**
 * Added-lines hygiene: no private work-tracking names in the public repo (added-lines-hygiene-lib.js has the
 * patterns and why the tokens are assembled from parts).
 *
 * The tree: every tracked file under bot/, dashboard/, scripts/, tests/ and docs/ that held such lines when this gate
 * landed is in added-lines-hygiene.allowlist.json, by FILE, with its line count and its tokens (ROT13). Shrink-only,
 * warn-on-less: a new file, a higher count or a new token fails; a lower count, a file at 0 or a file not in the tree
 * prints a DOWN:/CLEAN:/GONE: warning and passes (the entry is lowered on the branch that owns the list). Regenerate
 * the list with `node tests/setup/added-lines-hygiene-lib.js measure`.
 *
 * The branch: when `git merge-base HEAD origin/sandbox` resolves, every ADDED line of HEAD's diff against it is read,
 * and any hit fails, printed as file:line:token. A line already on origin/sandbox's copy of the same file is carried,
 * not added (the tree half counts it). With no git or no origin/sandbox: a `NOT CHECKED: no merge-base` warning.
 */
const L = require('./added-lines-hygiene-lib');
const { report } = require('./ratchet-verdict-lib');
const ALLOW = require('./added-lines-hygiene.allowlist.json');

// Seeded-bad tokens, assembled so this file is not a hit.
const j = (...p) => p.join('');
const DECISION = j('RUL', 'ING #', '12');
const TRACKER = j('b', 'd-', 'abc12');
const REVIEWER = j('lead', '-', 'review-3');
const GROUP = j('r5', '-', 'panel');
const ORG = j('jug', 'nu', '-org');
const WORKER = j('m-', 'play', '-4');
const QA = j('qa', '-', 'child', '-2');

describe('the patterns, on in-memory lines', () => {
  test('each kind of private name is a hit, any case for the numbered decision', () => {
    expect(L.tokensIn(`// see ${DECISION}`)).toEqual([DECISION]);
    expect(L.tokensIn(`// see ${DECISION.toLowerCase().replace(' #', ' ')}`)).toEqual([j('rul', 'ing 12')]);
    for (const t of [TRACKER, REVIEWER.replace(/-3$/, ''), GROUP, ORG, WORKER, QA]) expect(L.tokensIn(`x ${t} y`)).toEqual([t]);
  });

  test('the storage bucket name and ordinary words are not hits', () => {
    expect(L.tokensIn("const bucket = 'r2-default';")).toEqual([]);
    expect(L.tokensIn(`the for${'m-c'}ontent and tea${'m-p'}lay blocks; a qa-check; ${j('b', 'd-', 'x1')}`)).toEqual([]);
  });

  test('a text: lines with a hit counted once, distinct tokens sorted', () => {
    expect(L.scanText(`a ${TRACKER} ${TRACKER}\nb\nc ${GROUP}`)).toEqual({ count: 2, tokens: [TRACKER, GROUP].sort() });
    expect(L.scanText('clean\ntext')).toBeNull();
  });

  test('the allowlist round-trips through ROT13, a path that names a token too', () => {
    const found = { 'a/x.js': { count: 2, tokens: [TRACKER] }, [`a/${TRACKER}.test.js`]: { count: 1, tokens: [GROUP] } };
    const text = L.encodeAllowlist(found, 'why');
    expect(L.tokensIn(text)).toEqual([]);
    expect(L.decodeAllowlist(JSON.parse(text))).toEqual(found);
  });
});

describe('the tree verdict, on a seeded tree and allowlist', () => {
  const allow = {
    'same.js': { count: 2, tokens: [DECISION] },
    'below.js': { count: 3, tokens: [TRACKER] },
    'clean.js': { count: 1, tokens: [GROUP] },
    'absent.js': { count: 4, tokens: [ORG] },
    'above.js': { count: 1, tokens: [WORKER] },
    'newtok.js': { count: 2, tokens: [TRACKER] },
  };
  const found = {
    'same.js': { count: 2, tokens: [DECISION] },
    'below.js': { count: 1, tokens: [TRACKER] },
    'above.js': { count: 2, tokens: [WORKER] },
    'newtok.js': { count: 2, tokens: [QA, TRACKER] },
    'fresh.js': { count: 1, tokens: [REVIEWER] },
  };
  const v = L.treeVerdict(found, allow, (f) => f !== 'absent.js');

  test('a new file, a count above its entry and a new token fail', () => {
    expect(v.failures).toEqual([
      'UP: above.js has 2 such line(s), added-lines-hygiene.allowlist.json allows 1. Reword the new one(s).',
      `NEW: fresh.js has 1 line(s) naming private work items (${REVIEWER}). Reword them in product words.`,
      `NEW TOKEN: newtok.js names ${QA}, not on its entry. Reword it.`,
    ]);
  });

  test('below its entry, at 0, or not in the tree: a warning, and it passes', () => {
    expect(v.warnings).toEqual([
      'GONE: absent.js is not in this tree. Remove its entry from added-lines-hygiene.allowlist.json.',
      'DOWN: below.js has 1, added-lines-hygiene.allowlist.json says 3. Lower it to 1.',
      'CLEAN: clean.js has none now. Remove its entry from added-lines-hygiene.allowlist.json.',
    ]);
  });

  test('a tree that matches its list exactly: no line at all', () => {
    expect(L.treeVerdict({ 'same.js': found['same.js'] }, { 'same.js': allow['same.js'] }, () => true)).toEqual({ failures: [], warnings: [] });
  });
});

describe('the branch verdict, on a seeded diff', () => {
  const diff = [
    'diff --git a/bot/x.js b/bot/x.js',
    '--- a/bot/x.js',
    '+++ b/bot/x.js',
    '@@ -10,0 +11,3 @@ function f() {',
    `+  // per ${DECISION}`,
    '+  const ok = 1;',
    `+  // carried ${TRACKER}`,
    '@@ -40,1 +43,1 @@',
    `-  // old ${GROUP}`,
    '+  // reworded',
    'diff --git a/docs/n.md b/docs/n.md',
    '--- /dev/null',
    '+++ b/docs/n.md',
    '@@ -0,0 +1,2 @@',
    '+# Notes',
    `+${ORG} and ${WORKER}`,
  ].join('\n');

  test('the added lines with their new line numbers; removed lines are not read', () => {
    expect(L.addedLines(diff).map((a) => `${a.file}:${a.line}`)).toEqual(['bot/x.js:11', 'bot/x.js:12', 'bot/x.js:13', 'bot/x.js:43', 'docs/n.md:1', 'docs/n.md:2']);
  });

  test('every hit on an added line fails as file:line:token; a line already on the base is carried', () => {
    const onBase = (file, text) => file === 'bot/x.js' && text.includes('carried');
    expect(L.diffVerdict(L.addedLines(diff), onBase)).toEqual([`bot/x.js:11:${DECISION}`, `docs/n.md:2:${ORG}`, `docs/n.md:2:${WORKER}`]);
  });

  test('a clean diff passes', () => {
    expect(L.diffVerdict(L.addedLines('+++ b/a.js\n@@ -0,0 +1 @@\n+const a = 1;'))).toEqual([]);
  });
});

describe('this tree', () => {
  test('no file above its entry, no new file, no new token (below or gone: a warning)', () => {
    expect(report(L.treeVerdict(L.scanTree(), L.decodeAllowlist(ALLOW)))).toEqual([]);
  });

  test("this branch's added lines name no private work item", () => {
    const base = L.mergeBase();
    if (!base) {
      console.warn('NOT CHECKED: no merge-base (git or origin/sandbox unavailable)');
      return;
    }
    const { added, onBase } = L.branchAdded(base);
    expect(L.diffVerdict(added, onBase)).toEqual([]);
  });
});
