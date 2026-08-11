/**
 * The language-cache flush must delete language keys and NOTHING else.
 *
 * Step 1.8 exists because fixing the writer only makes FUTURE writes invalidate
 * correctly — every value cached before the fix survives its 24-hour TTL,
 * including values the old Settings path wrote and never invalidated. Without a
 * one-shot flush, day one after cutover still serves stale languages and looks
 * like the fix failed.
 *
 * The risk this file guards is not "does it delete" — it is "does it delete too
 * much". This Redis holds sessions, rate-limit counters, webhook dedup markers
 * and distributed locks on the same instance. A glob typo (`user:*`) or a reach
 * for flushAll() would take out live traffic state on a production instance, and
 * the failure would look like an unrelated outage. So the patterns and the
 * refusal to use flushAll are asserted directly.
 */

const flush = require('../../bot/scripts/ops/flush-language-cache');

describe('flush-language-cache — scope', () => {
  it('targets exactly the two language key patterns', () => {
    expect(flush.PATTERNS).toEqual(['user:language:*', 'user:language_locked:*']);
  });

  it('every pattern is anchored under user:language — never a broader prefix', () => {
    for (const p of flush.PATTERNS) {
      expect(p.startsWith('user:language')).toBe(true);
      // A pattern whose wildcard sits earlier than the language segment would
      // match sessions, rate limits and locks too.
      expect(p.indexOf('*')).toBe(p.length - 1);
    }
  });

  it('does not match the neighbouring key families that share this Redis', () => {
    const foreign = [
      'session:abc',
      'ratelimit:923001234567',
      'dedup:wamid.HBgM',
      'lock:coaching:123',
      'user:profile:abc',
    ];
    for (const key of foreign) {
      expect(flush.PATTERNS.some((p) => matches(p, key))).toBe(false);
    }
  });

  it('matches the keys it is meant to clear', () => {
    const own = [
      'user:language:0f0f-1111',
      'user:language_locked:0f0f-1111',
    ];
    for (const key of own) {
      expect(flush.PATTERNS.some((p) => matches(p, key))).toBe(true);
    }
  });
});

describe('flush-language-cache — blast radius', () => {
  // Comments are stripped before these assertions run. The invariant is that the
  // script must not CALL these, not that it must never name them — the source
  // deliberately documents why flushAll and KEYS are the wrong tools, and a
  // guard that punished the explanation would push that reasoning out of the file.
  const code = stripComments(
    require('fs').readFileSync(
      require.resolve('../../bot/scripts/ops/flush-language-cache'),
      'utf8'
    )
  );

  it('never calls flushAll', () => {
    // flushAll() exists on the redis service and would clear sessions,
    // rate limits and dedup markers along with the language keys.
    expect(code).not.toMatch(/flushAll\s*\(/);
  });

  it('scans rather than calling KEYS, which blocks the server', () => {
    expect(code).toMatch(/scanStream|\bscan\(/);
    expect(code).not.toMatch(/\.keys\s*\(/);
  });
});

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Minimal glob matcher for the trailing-star patterns this script uses.
function matches(pattern, key) {
  if (!pattern.endsWith('*')) return pattern === key;
  return key.startsWith(pattern.slice(0, -1));
}
