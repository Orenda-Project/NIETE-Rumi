/**
 * The switch-off matrix: every `app_settings` value that must read as OFF, shared by the switch goldens.
 *
 * A switch is ON only for JSON `true` (or the string "true"). Each golden runs these values and one failed read
 * (`throwOn`), and asserts today's output for all of them, so a reader that drifts to truthiness fails a test.
 */

/** [label, value] — `null` means the row is absent (the test does not write it). */
const OFF_VALUES = Object.freeze([
  ['false', false],
  ['absent', null],
  ['"yes"', 'yes'],
  ['1', 1],
  ['{}', {}],
].map(Object.freeze));

/**
 * Wrap a supabase-like `from(table)` so that reading `key` from `app_settings` throws, by `.eq('key', key)` or
 * `.in('key', [..key..])`; every other table and key reads as before.
 */
function throwOn(from, key, message = 'settings down') {
  return (table) => {
    const b = from(table);
    if (table !== 'app_settings') return b;
    const { eq, in: within } = b;
    if (typeof eq === 'function') {
      b.eq = (col, v) => { if (col === 'key' && v === key) throw new Error(message); return eq.call(b, col, v); };
    }
    if (typeof within === 'function') {
      b.in = (col, vs) => { if (col === 'key' && [].concat(vs).includes(key)) throw new Error(message); return within.call(b, col, vs); };
    }
    return b;
  };
}

module.exports = { OFF_VALUES, throwOn };
