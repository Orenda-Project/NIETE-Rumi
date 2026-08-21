/**
 * Meta-tests for the logger-level scanner itself.
 *
 * The ratchet in `logger-level-consistency.test.js` was keyed on `file:line`,
 * so ANY edit that shifted a line made an already-allowlisted callsite look
 * brand new. On develop that produced 224 "new" violations of which 148 were
 * the same file+snippet at a moved line, plus 205 "stale" entries — so both
 * assertions failed permanently, the gate stopped meaning anything, and 76
 * genuinely-new untagged callsites slipped in behind the noise.
 *
 * These tests pin the properties the key must have:
 *   - moving a callsite must NOT report it as new
 *   - a genuinely new callsite MUST be reported
 *   - deleting an allowlisted callsite MUST report it stale
 *   - duplicate identical callsites in one file stay individually addressable
 *
 * They run against synthetic fixture trees in tmp, so they never depend on the
 * real bot/ tree (whose violation count changes every week).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  scanViolations,
  keyOf,
  diffAgainstAllowlist,
  findSeverityInData,
} = require('./logger-level-lib');

/** Build a throwaway source tree; returns its root. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loglevel-fx-'));
  for (const [rel, contents] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents);
  }
  return root;
}

const pad = (n) => '\n'.repeat(n);

describe('scanViolations', () => {
  it('flags a bare logToFile(❌ ...) with no level argument', () => {
    const root = fixture({
      'a.js': `logToFile('❌ boom', { userId: 1 });\n`,
    });
    const v = scanViolations(root);
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe('a.js');
    expect(v[0].snippet).toContain('❌ boom');
  });

  it('does NOT flag a callsite that passes level=error or level=warn', () => {
    const root = fixture({
      'a.js': `logToFile('❌ tagged', { a: 1 }, 'error');\n`,
      'b.js': `logToFile('❌ degraded', { a: 1 }, 'warn');\n`,
    });
    expect(scanViolations(root)).toEqual([]);
  });

  it('parses a multi-line call with nested object/array literals', () => {
    const root = fixture({
      'a.js': [
        `logToFile('❌ nested', {`,
        `  meta: { deep: [1, 2, (3)] },`,
        `  other: fn(a, b),`,
        `});`,
        ``,
      ].join('\n'),
    });
    const v = scanViolations(root);
    expect(v).toHaveLength(1);
  });

  it('treats the 3rd positional arg as the level, not a nested comma', () => {
    const root = fixture({
      // the comma inside the object must not be mistaken for the arg separator
      'a.js': `logToFile('❌ ok', { a: 1, b: 2 }, 'error');\n`,
    });
    expect(scanViolations(root)).toEqual([]);
  });

  it('skips node_modules and test directories', () => {
    const root = fixture({
      'node_modules/x/a.js': `logToFile('❌ vendor', {});\n`,
      'tests/a.js': `logToFile('❌ test', {});\n`,
      '__mocks__/a.js': `logToFile('❌ mock', {});\n`,
      'real.js': `logToFile('❌ real', {});\n`,
    });
    const v = scanViolations(root);
    expect(v.map((x) => x.file)).toEqual(['real.js']);
  });

  it('numbers duplicate identical callsites in one file so each stays addressable', () => {
    const root = fixture({
      'a.js': `logToFile('❌ dupe', {});\nlogToFile('❌ dupe', {});\n`,
    });
    const v = scanViolations(root);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.occurrence)).toEqual([0, 1]);
    expect(new Set(v.map(keyOf)).size).toBe(2);
  });

  it('reports paths relative to `relativeTo` when given', () => {
    const root = fixture({ 'bot/shared/a.js': `logToFile('❌ x', {});\n` });
    const v = scanViolations(path.join(root, 'bot'), { relativeTo: root });
    expect(v[0].file).toBe('bot/shared/a.js');
  });
});

describe('keyOf', () => {
  it('ignores the line number entirely', () => {
    const a = { file: 'a.js', line: 5, snippet: "logToFile('❌ x', {", occurrence: 0 };
    const b = { file: 'a.js', line: 999, snippet: "logToFile('❌ x', {", occurrence: 0 };
    expect(keyOf(a)).toBe(keyOf(b));
  });

  it('defaults a legacy entry with no `occurrence` to the first occurrence', () => {
    const legacy = { file: 'a.js', line: 5, snippet: "logToFile('❌ x', {" };
    const modern = { file: 'a.js', line: 5, snippet: "logToFile('❌ x', {", occurrence: 0 };
    expect(keyOf(legacy)).toBe(keyOf(modern));
  });

  it('is insensitive to surrounding whitespace in the snippet', () => {
    const a = { file: 'a.js', snippet: "logToFile('❌ x', {", occurrence: 0 };
    const b = { file: 'a.js', snippet: "   logToFile('❌ x', {   ", occurrence: 0 };
    expect(keyOf(a)).toBe(keyOf(b));
  });
});

describe('diffAgainstAllowlist — the property the old file:line key got wrong', () => {
  const snippet = "logToFile('❌ moved', {});";

  it('does NOT report a new violation when an allowlisted callsite merely moves', () => {
    const root = fixture({ 'a.js': `${pad(40)}${snippet}\n` });
    const live = scanViolations(root);
    expect(live[0].line).toBeGreaterThan(1); // it really did move

    // allowlist recorded it back when it sat on line 3
    const allowlist = [{ file: 'a.js', line: 3, snippet, occurrence: 0 }];
    const { newOnes, stale } = diffAgainstAllowlist(live, allowlist);
    expect(newOnes).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('DOES report a genuinely new callsite', () => {
    const root = fixture({
      'a.js': `${snippet}\nlogToFile('❌ brand new', {});\n`,
    });
    const allowlist = [{ file: 'a.js', line: 1, snippet, occurrence: 0 }];
    const { newOnes, stale } = diffAgainstAllowlist(scanViolations(root), allowlist);
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].snippet).toContain('brand new');
    expect(stale).toEqual([]);
  });

  it('DOES report a stale entry once the callsite is fixed', () => {
    const root = fixture({ 'a.js': `logToFile('❌ moved', {}, 'error');\n` });
    const allowlist = [{ file: 'a.js', line: 1, snippet, occurrence: 0 }];
    const { newOnes, stale } = diffAgainstAllowlist(scanViolations(root), allowlist);
    expect(newOnes).toEqual([]);
    expect(stale).toHaveLength(1);
    expect(stale[0].file).toBe('a.js');
  });

  it('reports a stale entry when the whole file is deleted', () => {
    const root = fixture({ 'other.js': '// nothing\n' });
    const allowlist = [{ file: 'gone.js', line: 1, snippet, occurrence: 0 }];
    const { stale } = diffAgainstAllowlist(scanViolations(root), allowlist);
    expect(stale).toHaveLength(1);
  });
});

describe('findSeverityInData — severity passed as a data key instead of the 3rd argument', () => {
  // `logToFile(msg, { level: 'error' })` does NOT set severity. The level is the
  // THIRD POSITIONAL argument; a `level` key in the data object is just another
  // field. Worse, `level` is a reserved pino/base field, so the emitted line
  // carries TWO "level" keys and which one a consumer honours is parser-
  // dependent (JSON.parse takes the last, a first-wins parser takes pino's).
  // The author's intent is unambiguous, so this is always a mistake — no
  // allowlist.
  it('flags a severity string passed as a data key', () => {
    const root = fixture({ 'a.js': `logToFile('boom', { userId: 1, level: 'error' });\n` });
    const v = findSeverityInData(root);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: 'a.js', severity: 'error' });
  });

  it('flags warn as well as error', () => {
    const root = fixture({ 'a.js': `logToFile('degraded', { level: 'warn' });\n` });
    expect(findSeverityInData(root).map((x) => x.severity)).toEqual(['warn']);
  });

  it('does NOT flag a domain "level" — a training level, grade or mastery level', () => {
    const root = fixture({
      'a.js': `logToFile('module done', { userId: 1, level: 3 });\n`,
      'b.js': `logToFile('passage picked', { level: currentLevel });\n`,
      'c.js': `logToFile('cpd', { level: lv.cpd_level });\n`,
      'd.js': `logToFile('grade', { level: passageConfig.grade });\n`,
    });
    expect(findSeverityInData(root)).toEqual([]);
  });

  it('does NOT flag the correct form (severity as the 3rd positional arg)', () => {
    const root = fixture({ 'a.js': `logToFile('boom', { userId: 1 }, 'error');\n` });
    expect(findSeverityInData(root)).toEqual([]);
  });

  it('flags it even when the message carries no ❌ sentinel', () => {
    // This is the blind spot: the ❌ ratchet cannot see these at all.
    const root = fixture({ 'a.js': `logToFile('language_drift: chat reply', { level: 'error' });\n` });
    expect(findSeverityInData(root)).toHaveLength(1);
  });

  it('handles a multi-line data object', () => {
    const root = fixture({
      'a.js': [`logToFile('drift', {`, `  surface: 'chat_text',`, `  userId: u?.id,`, `  level: 'error'`, `});`, ``].join('\n'),
    });
    expect(findSeverityInData(root)).toHaveLength(1);
  });

  it('covers logError/logWarn and console.* callers too', () => {
    const root = fixture({
      'a.js': `logError('x', { level: 'error' });\n`,
      'b.js': `console.warn('y', { level: 'warn' });\n`,
    });
    expect(findSeverityInData(root)).toHaveLength(2);
  });

  it('does not flag a level key nested deeper than the data object', () => {
    const root = fixture({ 'a.js': `logToFile('x', { meta: { level: 'error' } });\n` });
    expect(findSeverityInData(root)).toEqual([]);
  });
});
