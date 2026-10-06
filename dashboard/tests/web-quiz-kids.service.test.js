/**
 * Web quiz page: the names remembered on this phone (public/wq/wq.js rememberKid).
 *
 * A remembered child who plays the teacher's NEXT quiz comes back from the
 * server under that quiz's chip. The phone must then hold the child once, with
 * the newest chip — not twice ("Play as Zara" shown two times on M4).
 * Runs the page's own storage block, cut from the shipped file, in a vm with
 * localStorage faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  /* ---------------- storage that survives being blocked');
const END = SRC.indexOf('  var SOUND = ');

function page() {
  const store = new Map();
  const ctx = {
    localStorage: {
      setItem: (k, v) => store.set(k, String(v)), getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => store.delete(k),
    },
    CODE: 'TEST',
  };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.rememberKid = rememberKid; this.kids = kids;`, ctx);
  return ctx;
}

test('the storage block is still where this test cuts it from', () => {
  expect(START).toBeGreaterThan(0);
  expect(END).toBeGreaterThan(START);
});

test('the same child back under the next quiz\'s chip is kept once, with the new chip, first in the list', () => {
  const p = page();
  p.rememberKid({ chip: 'old-chip', first: 'Zara', animal: 'owl' });
  p.rememberKid({ chip: 'sib-chip', first: 'Omar', animal: 'cat' });
  p.rememberKid({ chip: 'new-chip', first: 'Zara', animal: 'owl' });
  expect(JSON.parse(JSON.stringify(p.kids()))).toEqual([
    { chip: 'new-chip', first: 'Zara', animal: 'owl' },
    { chip: 'sib-chip', first: 'Omar', animal: 'cat' },
  ]);
});

test('two different children stay two names', () => {
  const p = page();
  p.rememberKid({ chip: 'a', first: 'Zara', animal: 'owl' });
  p.rememberKid({ chip: 'b', first: 'Zara', animal: 'cat' });
  p.rememberKid({ chip: 'c', first: 'Omar', animal: 'owl' });
  expect(p.kids().map((k) => k.chip)).toEqual(['c', 'b', 'a']);
});
