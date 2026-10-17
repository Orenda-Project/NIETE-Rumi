/**
 * The portal's read of app_settings quiz_one_door (dashboard/lib/one-door-switch.js), fail closed and STRICT: only the
 * JSON boolean true is on; every string (the string "true" too), number, object, no row, no client and a failed read
 * are OFF. 30 s cache; `peek` never waits (a cold cache answers OFF and starts the read); `on` waits at most its timeout.
 */
const Switch = require('../lib/one-door-switch');

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
            return { data: table === 'app_settings' && key === 'quiz_one_door' && row !== undefined ? { value: row } : null, error: null };
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
  [false, false], ['false', false], ['yes please', false], [1, false], ['1', false], [{}, false], [null, false],
  [undefined, false], ['throw', false], ['error', false],
])('quiz_one_door = %j → %s', async (value, want) => {
  expect(await Switch.on(client(value))).toBe(want);
});

test('no client → OFF, never throws', async () => {
  expect(await Switch.on(null)).toBe(false);
  expect(await Switch.on(undefined)).toBe(false);
  expect(Switch.peek(null)).toBe(false);
});

test('one read per 30 s (cached), then read again', async () => {
  let t = 1000;
  const s = Switch.createOneDoorSwitch({ now: () => t });
  const c = client(true);
  expect(await s.on(c)).toBe(true);
  expect(await s.on(c)).toBe(true);
  expect(c.counter.n).toBe(1);
  t += 30 * 1000;
  expect(await s.on(c)).toBe(true);
  expect(c.counter.n).toBe(2);
});

test('peek never waits: a cold cache is OFF and starts ONE read; the next peek has the answer', async () => {
  const s = Switch.createOneDoorSwitch();
  const c = client(true, { delayMs: 5 });
  expect(s.peek(c)).toBe(false);
  expect(s.peek(c)).toBe(false);
  await new Promise((r) => setTimeout(r, 30));
  expect(s.peek(c)).toBe(true);
  expect(c.counter.n).toBe(1);
});

test('a slow read never holds a page past the timeout: OFF', async () => {
  const s = Switch.createOneDoorSwitch({ timeoutMs: 10 });
  expect(await s.on(client(true, { delayMs: 200 }))).toBe(false);
});
