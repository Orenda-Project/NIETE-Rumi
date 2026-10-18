/**
 * The portal's read of app_settings web_quiz_closed_way_back (dashboard/lib/closed-way-back-switch.js; default OFF),
 * fail closed and STRICT: only the
 * JSON boolean true is on; every string (the string "true" too), number, object, no row, no client and a failed read
 * are OFF. 30 s cache; `peek` never waits (a cold cache answers OFF and starts the read); `on` waits at most its timeout.
 */
const Switch = require('../lib/closed-way-back-switch');

function client(row, { counter = { n: 0 }, delayMs = 0 } = {}) {
  return {
    counter,
    from: (table) => ({
      select: () => ({
        eq: (col, key) => ({
          maybeSingle: async () => {
            counter.n += 1;
            if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
            if (row === 'throw') throw new Error('down');
            if (row === 'error') return { data: null, error: { message: 'down' } };
            return { data: table === 'app_settings' && key === 'web_quiz_closed_way_back' && row !== undefined ? { value: row } : null, error: null };
          },
        }),
      }),
    }),
  };
}

beforeEach(() => Switch._reset());

test.each([
  [true, true],
  ['true', false], ['"true"', false], [' TRUE ', false], ['True', false],
  [false, false], ['false', false], ['yes', false], ['yes please', false], [1, false], ['1', false], [{}, false], [null, false],
  [undefined, false], ['throw', false], ['error', false],
])('web_quiz_closed_way_back = %j → %s', async (value, want) => {
  expect(await Switch.on(client(value))).toBe(want);
});

test('no client → OFF, never throws', async () => {
  expect(await Switch.on(null)).toBe(false);
  expect(await Switch.on(undefined)).toBe(false);
  expect(Switch.peek(null)).toBe(false);
});

test('one read per 30 s (cached), then read again', async () => {
  let t = 1000;
  const s = Switch.createWayBackSwitch({ now: () => t });
  const c = client(true);
  expect(await s.on(c)).toBe(true);
  expect(await s.on(c)).toBe(true);
  expect(c.counter.n).toBe(1);
  t += 30 * 1000;
  expect(await s.on(c)).toBe(true);
  expect(c.counter.n).toBe(2);
});

test('peek never waits: a cold cache is OFF and starts ONE read; the next peek has the answer', async () => {
  const s = Switch.createWayBackSwitch();
  const c = client(true, { delayMs: 5 });
  expect(s.peek(c)).toBe(false);
  expect(s.peek(c)).toBe(false);
  await new Promise((r) => setTimeout(r, 30));
  expect(s.peek(c)).toBe(true);
  expect(c.counter.n).toBe(1);
});

test('a slow read never holds a page past the timeout: OFF', async () => {
  const s = Switch.createWayBackSwitch({ timeoutMs: 10 });
  expect(await s.on(client(true, { delayMs: 200 }))).toBe(false);
});

test('only its own key: quiz_one_door true with no web_quiz_closed_way_back row → OFF', async () => {
  const keys = [];
  const c = { from: () => ({ select: () => ({ eq: (col, key) => ({ maybeSingle: async () => { keys.push(key); return { data: key === 'quiz_one_door' ? { value: true } : null, error: null }; } }) }) }) };
  expect(await Switch.on(c)).toBe(false);
  expect(keys).toEqual(['web_quiz_closed_way_back']);
});
