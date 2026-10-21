/**
 * The big flight's words (dashboard/sa-game/game.js): the first effort star says the child reached every stone (a
 * skipped stone reads "Next time", so the star never says "finished"); in the flight a title that repeats carries its
 * language ("Letters · Urdu"); a stone with a time limit shows ⏱; the Urdu map writes the Numbers island in Urdu digits.
 * Run in a vm with a stand-in document, store and fetch. Invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sa-game', 'game.js'), 'utf8');

const BATTERY = {
  battery_id: 'g3.en',
  tower: ['ur.letters', 'en.letters', 'ma.add1', 'ma.add2'],
  tasks: [
    { id: 'ur.letters', title: { en: 'Letters', ur: 'حروف' }, time_limit_s: 60 },
    { id: 'en.letters', title: { en: 'Letters', ur: 'حروف' }, time_limit_s: 60 },
    { id: 'ma.add1', title: { en: 'Addition, quick', ur: 'جمع، فوری' }, time_limit_s: 60 },
    { id: 'ma.add2', title: { en: 'Addition, harder', ur: 'جمع، مشکل' } },
  ],
};

function el() {
  return { innerHTML: '', textContent: '', style: {}, appendChild(c) { if (c.onload) setImmediate(() => c.onload()); return c; } };
}
function page(lang, search, results) {
  const root = el();
  const boot = { token: 'tok', kid: 'k1', lang, form: 'g3', bank: ['/bank.json'], engine: [] };
  const kept = { 'sg.k1.g3': JSON.stringify({ done: { maths: true, english: true, urdu: true }, runs: {} }) };
  const W = {
    document: {
      head: el(),
      getElementById: (id) => (id === 'boot' ? { textContent: JSON.stringify(boot) } : id === 'sg' ? root : null),
      createElement: () => el(),
      addEventListener: () => {},
    },
    location: { search },
    history: { replaceState: () => {} },
    localStorage: { getItem: (k) => (k in kept ? kept[k] : null), setItem: () => {} },
    scrollTo: () => {},
    SAE: { store: { open: () => Promise.resolve({ results: async () => results || [], events: async () => [] }) } },
  };
  const fetch = async () => ({ ok: true, json: async () => BATTERY });
  vm.runInNewContext(SRC, { window: W, fetch, Promise, JSON, String, Object, Array, Math, Date, encodeURIComponent, decodeURIComponent });
  return { root, W };
}
const settle = async (root, mark) => { for (let i = 0; i < 20 && root.innerHTML.indexOf(mark) < 0; i++) await new Promise((r) => setImmediate(r)); return root.innerHTML; };
const rows = (html) => [...html.matchAll(/<span>(.*?)<\/span><em>/g)].map((r) => r[1]);
const stones = (html) => [...html.matchAll(/<div class="sg-stone(?: [^"]*)?">(.*?)<\/div>/g)].map((r) => r[1]);

test('star 1 says the child reached every stone (EN and UR)', async () => {
  const done = [{ task_id: 'ma.add1', stop_reason: 'complete' }, { task_id: 'ma.add2', stop_reason: 'skipped_level2' }];
  let p = page('en', '?done=maths&s=sess-123456', done);
  let html = await settle(p.root, 'sg-card');
  expect(html).toContain('★ You reached every stone');
  expect(html).not.toContain('finished every stone');
  p = page('ur', '?done=maths&s=sess-123456', done);
  html = await settle(p.root, 'sg-card');
  expect(html).toContain('★ آپ ہر پتھر تک پہنچے');
});

test('the flight\'s card: a repeated title carries its language; a single one does not', async () => {
  const done = BATTERY.tower.map((id) => ({ task_id: id, stop_reason: 'complete' }));
  let p = page('en', '?done=tower&s=sess-123456', done);
  expect(rows(await settle(p.root, 'sg-card'))).toEqual(['Letters · Urdu', 'Letters · English', 'Addition, quick', 'Addition, harder']);
  p = page('ur', '?done=tower&s=sess-123456', done);
  expect(rows(await settle(p.root, 'sg-card'))).toEqual(['حروف · اردو', 'حروف · انگریزی', 'جمع، فوری', 'جمع، مشکل']);
});

test('the flight\'s grid: the language mark, and ⏱ on every stone with a time limit', async () => {
  const p = page('en', '', []);
  p.W.SG.intro('tower');
  const html = await settle(p.root, 'sg-stones');
  expect(stones(html)).toEqual(['<b>⏱</b>Letters · Urdu', '<b>⏱</b>Letters · English', '<b>⏱</b>Addition, quick', 'Addition, harder']);
});

test('an island keeps its plain titles (no language mark)', async () => {
  const p = page('en', '', []);
  p.W.SG.intro('english');
  const html = await settle(p.root, 'sg-stones');
  expect(stones(html)).toEqual(['<b>⏱</b>Letters']);
});

test('the Urdu map writes the Numbers island as ۱ ۲ ۳; the English map as 1 2 3', async () => {
  let p = page('ur', '', []);
  expect(p.root.innerHTML).toContain('>۱ ۲ ۳</i>');
  expect(p.root.innerHTML).not.toContain('>1 2 3</i>');
  p = page('en', '', []);
  expect(p.root.innerHTML).toContain('>1 2 3</i>');
});
