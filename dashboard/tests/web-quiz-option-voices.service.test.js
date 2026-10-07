/* The child page (public/wq/wq.js, WQI): each option's own recorded voice.
 *
 * Library questions carry a clip per option (q.audio.opts, by stored slot). The page read the stem
 * and every option in one run and gave no option a voice of its own; on a listen-and-identify item
 * it also played every option before the child answered. Now an option with a clip has its own 🔊,
 * keyed by the option's slot (its content), which plays that clip and is never an answer; and a
 * listen item reads only the instruction and the sound. */
const WQI = require('../public/wq/wq.js');

const T = { listen: 'Listen again', hearOption: 'Hear this one', check: 'Check', pickAll: 'Tap every right answer, then Check.' };
const clip = (n) => `https://clips.example/${n}.ogg`;
// Shown in a shuffled order: D, A, C, B.
const q = () => ({ qid: 'q1', text: 'Which month comes after January?', correct_slot: 'A',
  options: [{ slot: 'D', text: 'June' }, { slot: 'A', text: 'February' }, { slot: 'C', text: 'March' }, { slot: 'B', text: 'May' }],
  audio: { q: clip('q'), opts: [clip('february'), clip('may'), clip('march'), clip('june')] } });

function fakeRoot(html) {
  const els = [];
  const re = /<(button|span)([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = {}; m[2].replace(/([a-z-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; });
    els.push({ tag: m[1], attrs, cls: (attrs.class || '').split(' '), listeners: {},
      getAttribute(k) { return this.attrs[k]; }, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } });
  }
  return {
    els,
    querySelector(sel) { return sel === '#wq-check' ? null : null; },
    querySelectorAll(sel) { const c = sel.replace(/^\./, ''); return els.filter((e) => e.cls.includes(c)); },
  };
}

describe('an option with its own clip gets its own 🔊', () => {
  test('each 🔊 sits on its option and names that option\'s slot, whatever the shuffle', () => {
    const html = WQI.itemHtml(q(), T, 'en');
    const buttons = html.split('<button class="wq-opt').slice(1);
    expect(buttons).toHaveLength(4);
    buttons.forEach((b) => {
      const slot = /data-slot="([A-D])"/.exec(b)[1];
      expect(b).toContain(`data-hear="${slot}"`);
      expect(b).toContain('aria-label="Hear this one"');
    });
  });

  test('tapping it plays THAT option\'s clip and never answers', () => {
    const item = q();
    const root = fakeRoot(WQI.itemHtml(item, T, 'en'));
    const answered = []; const heard = [];
    WQI.wire(root, item, (a) => answered.push(a), (url, slot) => heard.push([slot, url]));
    const hearD = root.els.find((e) => e.attrs['data-hear'] === 'D');
    let stopped = false;
    hearD.listeners.click.forEach((fn) => fn({ stopPropagation() { stopped = true; }, preventDefault() {} }));
    expect(heard).toEqual([['D', clip('june')]]);
    expect(stopped).toBe(true);
    expect(answered).toEqual([]);
  });

  test('no clip for an option: no 🔊 (the stem\'s read-aloud still names it)', () => {
    const item = { ...q(), audio: { q: clip('q'), opts: [null, null, null, null] } };
    expect(WQI.itemHtml(item, T, 'en')).not.toContain('wq-ohear');
    expect(WQI.readParts(item, 'en').map((p) => p.text)).toEqual(['Which month comes after January?', 'June', 'February', 'March', 'May']);
  });

  test('the read-aloud still reads each option in its own clip, by slot', () => {
    const parts = WQI.readParts(q(), 'en');
    expect(parts.slice(1).map((p) => [p.text, p.url])).toEqual([['June', clip('june')], ['February', clip('february')], ['March', clip('march')], ['May', clip('may')]]);
  });
});

describe('a listen-and-identify item never plays its options before the child answers', () => {
  test('the read is the instruction and the sound only; each option is heard on its own 🔊', () => {
    const item = { qid: 'q2', text: 'Listen and tap.', correct_slot: 'A', options: [{ slot: 'B', text: 'p' }, { slot: 'A', text: 's' }],
      audio: { q: clip('listen'), stim: clip('sss'), opts: [clip('s'), clip('p'), null, null] } };
    const parts = WQI.readParts(item, 'en');
    expect(parts.map((p) => p.url)).toEqual([clip('listen'), clip('sss')]);
    expect(WQI.itemHtml(item, T, 'en')).toContain('data-hear="A"');
  });
});
