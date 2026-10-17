/**
 * The portal's cached read of `web_quiz_link_known_child` (lib/link-known-child-switch.js): strict (JSON `true` only),
 * fail closed, never waits (peek answers what it knew and reads in the background), one read per 30 s.
 */
const { createLinkKnownSwitch, KEY } = require('../lib/link-known-child-switch');

function client(value, { fail = false, error = null } = {}) {
  const reads = [];
  return {
    reads,
    from: (t) => ({ select: () => ({ eq: (k, v) => ({ maybeSingle: async () => {
      reads.push([t, k, v]);
      if (fail) throw new Error('down');
      return error ? { data: null, error } : { data: value === undefined ? null : { value }, error: null };
    } }) }) }),
  };
}
const settle = () => new Promise((r) => setImmediate(r));

test('cold: OFF now, then the row\'s answer; it reads its own key', async () => {
  const sw = createLinkKnownSwitch();
  const db = client(true);
  expect(sw.peek(db)).toBe(false);
  await settle();
  expect(sw.peek(db)).toBe(true);
  expect(db.reads).toEqual([['app_settings', 'key', KEY]]);
});

for (const [name, value, opts] of [['the string "true"', 'true'], ['the quoted string', '"true"'], ['a number', 1], ['false', false], ['no row', undefined], ['a read error', undefined, { error: { message: 'x' } }], ['a read that throws', undefined, { fail: true }]]) {
  test(`${name}: OFF`, async () => {
    const sw = createLinkKnownSwitch();
    const db = client(value, opts);
    sw.peek(db);
    await settle();
    expect(sw.peek(db)).toBe(false);
  });
}

test('no client: OFF, nothing read', () => {
  expect(createLinkKnownSwitch().peek(null)).toBe(false);
});

test('one read per 30 s, however often it is asked', async () => {
  let t = 0;
  const sw = createLinkKnownSwitch({ now: () => t });
  const db = client(true);
  for (let i = 0; i < 5; i += 1) { sw.peek(db); await settle(); }
  expect(db.reads).toHaveLength(1);
  t = 30 * 1000;
  sw.peek(db); await settle();
  expect(db.reads).toHaveLength(2);
});
