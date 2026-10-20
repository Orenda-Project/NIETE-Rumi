/**
 * The big flight's result card (dashboard/sa-game/game.js): back from a run, each stone reads as the engine ended it.
 * A stone the engine skipped (skipped_*, or no working microphone) reads "Next time", never "Finished"; the effort
 * stars are unchanged. Run in a vm with a stand-in document, store and fetch. Invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sa-game', 'game.js'), 'utf8');

const BATTERY = {
  battery_id: 'g3.en',
  tasks: [
    { id: 'ma.add1', title: { en: 'Adding', ur: 'جمع' } },
    { id: 'ma.add2', title: { en: 'Adding more', ur: 'مزید جمع' } },
    { id: 'ma.story', title: { en: 'Word problems', ur: 'سوال' } },
  ],
};

function el() {
  return { innerHTML: '', textContent: '', style: {}, appendChild(c) { if (c.onload) setImmediate(() => c.onload()); return c; } };
}
async function card(lang, results) {
  const root = el();
  const boot = { token: 'tok', kid: 'k1', lang, form: 'g3', bank: ['/bank.json'], engine: [] };
  const D = {
    head: el(),
    getElementById: (id) => (id === 'boot' ? { textContent: JSON.stringify(boot) } : id === 'sg' ? root : null),
    createElement: () => el(),
    addEventListener: () => {},
  };
  const W = {
    document: D,
    location: { search: '?done=maths&s=sess-123456' },
    history: { replaceState: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    scrollTo: () => {},
    SAE: { store: { open: () => Promise.resolve({ results: async () => results, events: async () => [{ type: 'practice_answer' }] }) } },
  };
  const fetch = async () => ({ ok: true, json: async () => BATTERY });
  vm.runInNewContext(SRC, { window: W, fetch, Promise, JSON, String, Object, Array, Math, Date, encodeURIComponent, decodeURIComponent });
  for (let i = 0; i < 20 && root.innerHTML.indexOf('sg-card') < 0; i++) await new Promise((r) => setImmediate(r));
  return root.innerHTML;
}
function rows(html) {
  const m = html.match(/<div class="sg-rows">([\s\S]*?)<\/div><div class="sg-sync">/);
  return [...m[1].matchAll(/<span>(.*?)<\/span><em>(.*?)<\/em>/g)].map((r) => [r[1], r[2]]);
}

test('a skipped stone reads "Next time", a played one "Finished", an unreached one "Not yet" (EN)', async () => {
  const html = await card('en', [
    { task_id: 'ma.add1', stop_reason: 'complete' },
    { task_id: 'ma.add2', stop_reason: 'skipped_level2' },
  ]);
  expect(rows(html)).toEqual([['Adding', '✓ Finished'], ['Adding more', 'Next time'], ['Word problems', 'Not yet']]);
});

test('Urdu: «اگلی بار» for a skipped stone and for a stone with no microphone', async () => {
  const html = await card('ur', [
    { task_id: 'ma.add1', stop_reason: 'skipped_no_first_line' },
    { task_id: 'ma.add2', stop_reason: 'time_up' },
    { task_id: 'ma.story', stop_reason: 'mic_unavailable' },
  ]);
  expect(rows(html)).toEqual([['جمع', 'اگلی بار'], ['مزید جمع', '✓ پورا کیا'], ['سوال', 'اگلی بار']]);
});

test('the effort stars are unchanged by a skip: every stone ended still earns the first star', async () => {
  const html = await card('en', [
    { task_id: 'ma.add1', stop_reason: 'complete' },
    { task_id: 'ma.add2', stop_reason: 'skipped_level2' },
    { task_id: 'ma.story', stop_reason: 'complete' },
  ]);
  expect(html).toContain('★ You finished every stone');
  expect(html).not.toContain('<s>★</s>');
});
