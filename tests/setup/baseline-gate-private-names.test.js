'use strict';
/**
 * The snapshot is committed and printed in CI logs, and this repo is public. added-lines-hygiene exists so
 * no file names a private work item; the snapshot that ACCEPTS that guard's offenders must not then copy
 * every one of those names into a new file (bd-nij2nd: the first re-cut that accepted it wrote 103 such
 * lines into tests/baseline.snapshot.json and the guard failed on the snapshot itself).
 *
 * A key that names one is withheld exactly like a secret or a phone number: `[withheld <hash>]`, stable
 * for the same text. The private names below are assembled from parts so this file is not a hit itself.
 */
const { keyOffenders } = require('../baseline-gate');
const { tokensIn } = require('./added-lines-hygiene-lib');

const D = (...parts) => parts.join('');
const DECISION = D('RUL', 'ING #', '12');
const lineAt = (files) => (file, n) => {
  const text = files[file];
  return text === undefined ? null : (text.split('\n')[n - 1] ?? null);
};

describe('baseline keys never copy a private work-item name', () => {
  it('the names used here are ones the hygiene guard flags (guards a vacuous pass)', () => {
    expect(tokensIn(`see ${DECISION}`)).not.toEqual([]);
  });

  it('a guard message with no line (added-lines-hygiene) is withheld when it names one', () => {
    const raw = `NEW: bot/x.json has 1 line(s) naming private work items (${DECISION}). Reword them in product words.`;
    const [k] = keyOffenders([raw], lineAt({}));
    expect(k.key).toMatch(/^\[withheld [0-9a-f]{12}\]$/);
    expect(tokensIn(k.key)).toEqual([]);
    expect(keyOffenders([raw], lineAt({}))[0].key).toBe(k.key); // stable for the same text
  });

  it('a `path:line` whose line names one is keyed by a hash of the line', () => {
    const [k] = keyOffenders(['bot/y.js:2'], lineAt({ 'bot/y.js': `x\n// per ${DECISION}` }));
    expect(k.key).toMatch(/^bot\/y\.js :: \[withheld [0-9a-f]{12}\]$/);
    expect(tokensIn(k.key)).toEqual([]);
  });

  it('an ordinary key is untouched', () => {
    expect(keyOffenders(['users.ok'], lineAt({}))[0].key).toBe('users.ok');
    expect(keyOffenders(['NEW: bot/z.js has 2 thing(s).'], lineAt({}))[0].key).toBe('NEW: bot/z.js has 2 thing(s).');
  });
});
