/* The child page's item renderer (dashboard/public/wq/wq.js, WQI): every question type a child
 * meets on the web quiz, maths typesetting, figures, read-aloud parts and grading. */
const WQI = require('../public/wq/wq.js');

const T = { check: 'Check', done: 'Done', pickAll: 'Tap every right answer, then Check.', orderHelp: 'Tap the steps in order.', matchHelp: 'Tap a word, then its partner.',
  labelHelp: 'Tap the part on the picture.', listenBig: 'Listen', yes: 'True', no: 'False', zoom: 'Make the picture bigger', close: 'Close', undo: 'Undo' };

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100" fill="#fff"/><text x="10" y="20">Leaf</text></svg>';
const opts = (arr) => arr.map((t, k) => ({ slot: 'ABCD'[k], text: t }));

describe('WQI.kind: which renderer a question gets', () => {
  it('keeps today\'s payload working: no type = single, multi:true = multi', () => {
    expect(WQI.kind({ options: opts(['a', 'b']) })).toBe('single');
    expect(WQI.kind({ multi: true, options: opts(['a', 'b']) })).toBe('multi');
  });
  it('reads SCHEMA_v2 type names, and turns all-picture options into a picture grid', () => {
    ['tf', 'order', 'match', 'label', 'listen'].forEach((t) => expect(WQI.kind({ type: t, options: [] })).toBe(t));
    expect(WQI.kind({ options: [{ slot: 'A', text: '', img: '/x' }, { slot: 'B', text: '', img: '/y' }] })).toBe('picture');
    expect(WQI.kind({ type: 'mystery', options: [] })).toBe('single');
  });
  it('accepts the long SCHEMA_v2 spellings too', () => {
    expect(WQI.kind({ type: 'true_false', options: [] })).toBe('tf');
    expect(WQI.kind({ type: 'multi_select', options: [] })).toBe('multi');
    expect(WQI.kind({ type: 'picture_choice', options: [] })).toBe('picture');
    expect(WQI.kind({ type: 'label_diagram', options: [] })).toBe('label');
    expect(WQI.kind({ type: 'match_pairs', options: [] })).toBe('match');
    expect(WQI.kind({ type: 'order_steps', options: [] })).toBe('order');
    expect(WQI.kind({ type: 'listen_choose', options: [] })).toBe('listen');
  });
});

describe('WQI.grade', () => {
  it('order and match compare the ORDER, multi compares the set, single compares the slot', () => {
    expect(WQI.grade({ type: 'order', correct_slot: 'C,A,B' }, 'C,A,B')).toBe(true);
    expect(WQI.grade({ type: 'order', correct_slot: 'C,A,B' }, 'A,B,C')).toBe(false);
    expect(WQI.grade({ type: 'match', correct_slot: 'B,A' }, 'A,B')).toBe(false);
    expect(WQI.grade({ multi: true, correct_slot: 'A,C' }, 'C,A')).toBe(true);
    expect(WQI.grade({ correct_slot: 'B' }, 'B')).toBe(true);
    expect(WQI.grade({ correct_slot: 'B' }, 'A')).toBe(false);
  });
});

describe('WQI.tex: maths typeset as MathML, no external renderer', () => {
  it('turns $\\frac{3}{4}$ into a real fraction and keeps the text around it', () => {
    const h = WQI.tex('Shade $\\frac{3}{4}$ of the bar');
    expect(h).toContain('<math');
    expect(h).toContain('<mfrac><mrow><mn>3</mn></mrow><mrow><mn>4</mn></mrow></mfrac>');
    expect(h.startsWith('Shade ')).toBe(true);
  });
  it('handles powers, times, divide and units', () => {
    const h = WQI.tex('$5 \\times 2^{3} \\div 4\\,\\text{cm}$');
    expect(h).toContain('<mo>×</mo>');
    expect(h).toContain('<msup><mn>2</mn><mrow><mn>3</mn></mrow></msup>');
    expect(h).toContain('<mo>÷</mo>');
    expect(h).toContain('<mtext>cm</mtext>');
  });
  it('escapes everything: no markup gets through, inside or outside the maths', () => {
    const h = WQI.tex('<img src=x onerror=1> $<script>$');
    expect(h).not.toMatch(/<img|<script/);
  });
  it('plain text with no $ is just escaped text', () => {
    expect(WQI.tex('Rs 5 & 6')).toBe('Rs 5 &amp; 6');
  });
  it('speech form reads a fraction as "3 over 4" in English and "4 میں سے 3" in Urdu', () => {
    expect(WQI.say('Shade $\\frac{3}{4}$', 'en')).toBe('Shade 3 over 4');
    expect(WQI.say('$\\frac{3}{4}$', 'ur')).toBe('4 میں سے 3');
  });
});

describe('WQI.figure: crisp inline SVG, tap to zoom, hotspots', () => {
  it('SCHEMA_v2 figure {kind:svg} is drawn INLINE (page fonts reach Urdu labels), sized by w/h, inside a zoom button', () => {
    const h = WQI.figureHtml({ figure: { kind: 'svg', svg: SVG, w: 200, h: 100, alt: 'A leaf', type: 'fraction_bar' } }, T);
    expect(h).toContain('<svg');
    expect(h).not.toContain('data:image/svg');
    expect(h).toContain('aria-label="A leaf"');
    expect(h).toContain('aspect-ratio:200/100');
    expect(h).toContain('wq-zoom');
  });
  it('strips script, event handlers, links and url() styles, but keeps foreignObject (Urdu labels)', () => {
    const s = WQI.cleanSvg('<svg viewBox="0 0 10 10" onload="x()"><script>x()</script><a href="javascript:x()"><text>t</text></a><foreignObject><div dir="rtl">جڑ</div></foreignObject><rect style="fill:url(http://x)"/></svg>');
    expect(s).not.toMatch(/script|onload|javascript:|url\(/i);
    expect(s).toContain('<text>t</text>');
    expect(s).toContain('<foreignObject><div dir="rtl">جڑ</div></foreignObject>');
  });
  it('figure {kind:img, url} shows as an image', () => {
    expect(WQI.figureHtml({ figure: { kind: 'img', url: '/api/wq/media/AB/q1?k=f', w: 10, h: 5 } }, T)).toContain('src="/api/wq/media/AB/q1?k=f"');
  });
  it('today\'s q.img still shows as the figure', () => {
    expect(WQI.figureHtml({ img: '/api/wq/media/AB/q1?k=q' }, T)).toContain('src="/api/wq/media/AB/q1?k=q"');
  });
  it('label hotspots sit at the part, in % of the viewBox, one tappable button per slot', () => {
    const q = { type: 'label', figure: { svg: SVG, hotspots: [{ slot: 'A', x: 50, y: 25, r: 10 }, { slot: 'B', x: 150, y: 75, r: 4 }] }, options: opts(['Leaf', 'Root']) };
    const h = WQI.figureHtml(q, T);
    expect((h.match(/class="wq-hot"/g) || []).length).toBe(2);
    expect(h).toContain('left:25%;top:25%');
    expect(h).toContain('left:75%;top:75%');
    expect(h).toContain('data-slot="A"');
  });
});

describe('WQI.itemHtml: every type renders its own controls', () => {
  const base = (type, extra) => Object.assign({ qid: 'q1', type, text: 'Q?', options: opts(['One', 'Two', 'Three']), correct_slot: 'A' }, extra || {});
  it('single: colour + shape options', () => {
    const h = WQI.itemHtml(base('single'), T, 'en');
    expect((h.match(/class="wq-opt wq-s\d"/g) || []).length).toBe(3);
    expect(h).toContain('<svg viewBox');
  });
  it('picture: a 2-wide grid of big picture tiles with the name under each', () => {
    const q = base('picture', { options: [{ slot: 'A', text: '', img: '/a', name: 'Flower' }, { slot: 'B', text: '', img: '/b', name: 'Leaf' }] });
    const q2 = base(undefined, { options: [{ slot: 'A', text: 'apple', pic: { svg: '<svg viewBox="0 0 72 72"><circle r="9"/></svg>', name: 'apple', alt: 'apple' } }, { slot: 'B', text: 'cup', pic: { svg: '<svg viewBox="0 0 72 72"/>', name: 'cup' } }] });
    expect(WQI.kind(q2)).toBe('picture');
    const h2 = WQI.itemHtml(q2, T, 'en');
    expect(h2).toContain('<circle r="9"/>');
    expect(h2).toContain('>apple<');
    const h = WQI.itemHtml(q, T, 'en');
    expect(h).toContain('wq-pgrid');
    expect(h).toContain('>Flower<');
    expect(h).toContain('alt="Flower"');
  });
  it('multi: toggles plus a Check button that starts disabled', () => {
    const h = WQI.itemHtml(base('multi', { multi: true, correct_slot: 'A,B' }), T, 'en');
    expect(h).toContain('aria-pressed="false"');
    expect(h).toMatch(/id="wq-check"[^>]*disabled/);
  });
  it('tf: two big buttons, tick and cross', () => {
    const h = WQI.itemHtml(base('tf', { options: opts(['True', 'False']) }), T, 'en');
    expect(h).toContain('wq-tf');
    expect(h).toContain('✓');
    expect(h).toContain('✗');
  });
  it('order: a numbered row of empty places and a pool of steps', () => {
    const h = WQI.itemHtml(base('order', { correct_slot: 'C,A,B' }), T, 'en');
    expect((h.match(/class="wq-place"/g) || []).length).toBe(3);
    expect(h).toContain('wq-pool');
  });
  it('match: left items in order, right options to pair', () => {
    const q = base('match', { left: [{ text: 'Cow' }, { text: 'Hen' }], options: opts(['Milk', 'Egg']), correct_slot: 'A,B' });
    const h = WQI.itemHtml(q, T, 'en');
    expect((h.match(/class="wq-ml"/g) || []).length).toBe(2);
    expect((h.match(/class="wq-mr"/g) || []).length).toBe(2);
  });
  it('listen: a big Listen button and the words shown small', () => {
    const h = WQI.itemHtml(base('listen'), T, 'en');
    expect(h).toContain('wq-listen');
  });
  it('maths in the stem and options is typeset', () => {
    const h = WQI.itemHtml(base('single', { text: 'What is $\\frac{1}{2}$ of 8?', options: opts(['$4$', '$2$']) }), T, 'en');
    expect((h.match(/<math/g) || []).length).toBe(3);
  });
});

describe('WQI.readParts: what the voice says', () => {
  it('a picture option says its name; a stem with maths is said in words; clips map by slot', () => {
    const q = { text: 'Which is $\\frac{1}{2}$?', options: [{ slot: 'A', text: '', img: '/a', name: 'Half a roti' }, { slot: 'B', text: '🌸' }],
      audio: { q: '/clip/q', opts: [null, '/clip/b'] } };
    const p = WQI.readParts(q, 'en');
    expect(p[0]).toEqual({ text: 'Which is 1 over 2?', url: '/clip/q' });
    expect(p[1]).toEqual({ text: 'Half a roti', url: null });
    expect(p[2]).toEqual({ text: '🌸', url: '/clip/b' });
  });
  it('an emoji-only option with no clip and no name is not spoken', () => {
    const p = WQI.readParts({ text: 'Q', options: [{ slot: 'A', text: '🌸' }] }, 'en');
    expect(p.length).toBe(1);
  });
  it('read.stem overrides what is said', () => {
    expect(WQI.readParts({ text: 'Tap the root', read: { stem: 'Find the root' }, options: [] }, 'en')[0].text).toBe('Find the root');
  });
});

describe('WQI.rightText: the "not yet" line names the right answer for every type', () => {
  it('order lists the steps in order; match lists the pairs; label names the part', () => {
    const o = opts(['Plant', 'Water', 'Dig']);
    expect(WQI.rightText({ type: 'order', options: o, correct_slot: 'C,A,B' }, 'en')).toBe('Dig → Plant → Water');
    expect(WQI.rightText({ type: 'order', options: o, correct_slot: 'C,A,B' }, 'ur')).toBe('Dig ← Plant ← Water');
    expect(WQI.rightText({ type: 'match', left: [{ text: 'Cow' }, { text: 'Hen' }], options: opts(['Egg', 'Milk']), correct_slot: 'B,A' }, 'en')).toBe('Cow – Milk, Hen – Egg');
    expect(WQI.rightText({ type: 'label', options: [{ slot: 'A', text: 'Root' }, { slot: 'B', text: 'Leaf' }], correct_slot: 'B' }, 'en')).toBe('Leaf');
    expect(WQI.rightText({ type: 'picture', options: [{ slot: 'A', text: '', name: 'Cat' }], correct_slot: 'A' }, 'en')).toBe('Cat');
  });
});

describe('W32d fixes after the first headless run', () => {
  it('a label item says only the instruction, not the part names (the hotspots are numbered)', () => {
    const q = { type: 'label', text: 'Tap the root.', options: opts(['Flower', 'Root']) };
    expect(WQI.readParts(q, 'en').map((p) => p.text)).toEqual(['Tap the root.']);
  });
  it('joinSay never says ".." between a line that already ends a sentence and the next', () => {
    expect(WQI.joinSay(['Yes! You found it.', 'Roots drink water.'])).toBe('Yes! You found it. Roots drink water.');
    expect(WQI.joinSay(['Not yet', '', 'Why'])).toBe('Not yet. Why');
    expect(WQI.joinSay(['ابھی نہیں۔', 'جڑیں پانی لیتی ہیں۔'])).toBe('ابھی نہیں۔ جڑیں پانی لیتی ہیں۔');
  });
});

describe('SCHEMA_v2 extras', () => {
  it('figure.say is spoken before the stem', () => {
    const p = WQI.readParts({ text: 'How much is coloured?', figure: { kind: 'svg', svg: SVG, say: 'Look at the bar.' }, options: [] }, 'en');
    expect(p.map((x) => x.text)).toEqual(['Look at the bar.', 'How much is coloured?']);
  });
  it('label hotspots use figure.w/h when given', () => {
    const q = { type: 'label', figure: { kind: 'svg', svg: '<svg viewBox="0 0 400 200"></svg>', w: 400, h: 200, hotspots: [{ slot: 'A', x: 100, y: 50 }] }, options: opts(['x']) };
    expect(WQI.figureHtml(q, T)).toContain('left:25%;top:25%');
  });
});

describe('listen = pre-readers: a picture grid with no printed words', () => {
  it('renders big picture tiles without name captions', () => {
    const q = { type: 'listen', text: 'Which is a flower?', options: [{ slot: 'A', text: '', name: 'Sun', pic: { svg: '<svg viewBox="0 0 1 1"/>', name: 'Sun' } }, { slot: 'B', text: '', name: 'Flower', pic: { svg: '<svg viewBox="0 0 1 1"/>', name: 'Flower' } }] };
    const h = WQI.itemHtml(q, T, 'en');
    expect(h).toContain('wq-pgrid');
    expect(h).not.toContain('wq-pname');
    expect(WQI.readParts(q, 'en').map((p) => p.text)).toEqual(['Which is a flower?', 'Sun', 'Flower']);
  });
});

describe('W32r/W31a review fixes', () => {
  it('a label hotspot is a see-through ring sized to the part (r), never a disc over it; its number sits beside it', () => {
    const q = { type: 'label', figure: { kind: 'svg', svg: '<svg viewBox="0 0 200 100"></svg>', w: 200, h: 100, hotspots: [{ slot: 'A', x: 100, y: 50, r: 20 }] }, options: opts(['Root']) };
    const h = WQI.figureHtml(q, T);
    expect(h).toContain('width:20%');
    expect(h).toContain('class="wq-hotn"');
    expect(h).not.toContain('<span>1</span></button>');
  });
  it('options carry their letter, so a why that says "answer is B" matches what the child sees', () => {
    const h = WQI.itemHtml({ text: 'Q', options: opts(['x', 'y']), correct_slot: 'A' }, T, 'en');
    expect(h).toContain('<b class="wq-let">A</b>');
    expect(h).toContain('<b class="wq-let">B</b>');
  });
});

describe('letters in feedback follow the letters on screen', () => {
  it('remaps a stored letter to the shown letter (options arrive in display order), only where it names an option', () => {
    const q = { options: [{ slot: 'C', text: 'x' }, { slot: 'A', text: 'y' }, { slot: 'B', text: 'z' }] };
    expect(WQI.letters(q, 'The answer is A, not option C. A plant needs (B).')).toBe('The answer is B, not option A. A plant needs (C).');
    expect(WQI.letters(q, 'درست جواب A ہے')).toBe('درست جواب B ہے');
  });
});
