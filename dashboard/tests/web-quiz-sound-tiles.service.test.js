/* The child page (public/wq/wq.js, WQI): phonics sound tiles.
 *
 * A listen-and-identify item (the sound to find plays first) whose options each have their own recorded clip, and the
 * bank's audio-only items ("Sound 1", "Sound 2"), show each option as a big sound tile: the tile plays that option's
 * clip and is never an answer; a separate "This one" button under it answers. Keyed by the option's slot (its content). */
const WQI = require('../public/wq/wq.js');

const T = { listen: 'Listen again', hearOption: 'Hear this one', thisOne: 'This one', playSound: 'Play the sound' };
const clip = (n) => `https://clips.example/${n}.ogg`;
const listen = () => ({ qid: 'q1', text: 'Listen and tap.', correct_slot: 'A',
  options: [{ slot: 'B', text: 'p' }, { slot: 'A', text: 's' }],
  audio: { q: clip('listen'), stim: clip('sss'), opts: [clip('s'), clip('p'), null, null] } });

function fakeRoot(html) {
  const els = [];
  const re = /<(button|span|div)([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = {}; m[2].replace(/([a-z-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; });
    els.push({ attrs, cls: (attrs.class || '').split(' '), listeners: {},
      getAttribute(k) { return this.attrs[k]; }, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } });
  }
  return { els, querySelector: () => null, querySelectorAll(sel) { return els.filter((e) => sel.split(',').some((s) => e.cls.includes(s.trim().replace(/^\./, '')))); } };
}
const tap = (el) => (el.listeners.click || []).forEach((fn) => fn({ stopPropagation() {}, preventDefault() {} }));

test('a listen item with a clip on every option shows one sound tile per option, each with its own "This one"', () => {
  const html = WQI.itemHtml(listen(), T, 'en');
  expect(html).toContain('wq-stiles');
  const tiles = html.split('class="wq-stile ').slice(1);
  expect(tiles).toHaveLength(2);
  tiles.forEach((t) => {
    const slot = /data-hear="([A-D])"/.exec(t)[1];
    expect(t).toContain(`data-slot="${slot}"`);
    expect(t).toContain('>This one<');
  });
});

test('tapping a tile plays THAT option\'s clip and never answers; "This one" answers with its slot', () => {
  const q = listen();
  const root = fakeRoot(WQI.itemHtml(q, T, 'en'));
  const answered = []; const heard = [];
  WQI.wire(root, q, (a) => answered.push(a), (url, slot) => heard.push([slot, url]));
  tap(root.els.find((e) => e.cls.includes('wq-shear') && e.attrs['data-hear'] === 'B'));
  expect(heard).toEqual([['B', clip('p')]]);
  expect(answered).toEqual([]);
  tap(root.els.find((e) => e.cls.includes('wq-sthis') && e.attrs['data-slot'] === 'A'));
  expect(answered).toEqual(['A']);
});

test('the bank\'s audio-only options ("Sound 1", "Sound 2") become sound tiles numbered 1 and 2', () => {
  const q = { qid: 'q2', text: 'کھ + ے + ل کیسے بولتے ہیں؟', correct_slot: 'A', options: [{ slot: 'A', text: 'Sound 1' }, { slot: 'B', text: 'Sound 2' }],
    audio: { q: null, opts: [clip('khel'), clip('jheel'), null, null] } };
  const html = WQI.itemHtml(q, { ...T, thisOne: 'یہ والا' }, 'ur');
  expect(html).toContain('wq-stiles');
  expect(html).toMatch(/data-hear="A"[^]*?>1</);
  expect(html).not.toContain('Sound 1');
});

test('an option with no clip: the item keeps its ordinary buttons (a tile with nothing to hear would be a dead tap)', () => {
  const q = { ...listen(), audio: { q: clip('listen'), stim: clip('sss'), opts: [clip('s'), null, null, null] } };
  const html = WQI.itemHtml(q, T, 'en');
  expect(html).not.toContain('wq-stiles');
  expect(html).toContain('class="wq-opt');
});

test('an ordinary question with option clips keeps its option buttons (tiles are for sounds only)', () => {
  const q = { qid: 'q3', text: 'Which month comes after January?', correct_slot: 'A', options: [{ slot: 'A', text: 'February' }, { slot: 'B', text: 'May' }],
    audio: { q: clip('q'), opts: [clip('feb'), clip('may'), null, null] } };
  expect(WQI.itemHtml(q, T, 'en')).not.toContain('wq-stiles');
});
