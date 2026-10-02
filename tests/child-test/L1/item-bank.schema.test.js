/**
 * bd-s1oo0.1 — runs the item-bank validator (item-bank.schema.mjs, node:test, zero deps) against the
 * committed bank, so any edit to item-bank.v1.json is checked for shape, counts, unique ids, tokens
 * without punctuation, story lengths, numeric and correct maths answers, and Urdu text sanity.
 */
const { spawnSync } = require('child_process');
const path = require('path');

test('item-bank.v1.json passes the content validator', () => {
  const validator = path.join(__dirname, 'item-bank.schema.mjs');
  const bankPath = path.join(__dirname, '../../../bot/shared/data/child-test/item-bank.v1.json');
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', validator], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', ITEM_BANK_PATH: bankPath },
  });
  const out = `${r.stdout}\n${r.stderr}`;
  expect({ status: r.status, failing: out.split('\n').filter((l) => /^not ok/.test(l)) })
    .toEqual({ status: 0, failing: [] });
  expect(out).toMatch(/# pass 8/);
});
