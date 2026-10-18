/**
 * The adventure look's kit (public/wq/wq-adv.js, window.WQA): run in a vm with the browser's boundaries faked
 * (document, matchMedia, localStorage). Checks the parts every screen calls: the icons, the emoji they replace (every
 * emoji the child screens draw today has an icon), the progress bar, motion under reduced motion, and that a muted
 * page never fetches the sound kit for a cue.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const SRC = fs.readFileSync(path.join(PUB, 'wq-adv.js'), 'utf8');

function load({ reduced = false, store = {}, adv = true, audio = null, blocked = false } = {}) {
  const added = [];
  const classes = new Set(adv ? ['wq-adv'] : []);
  const el = (tag) => ({ tag, nodeName: tag.toUpperCase(), attrs: {}, set rel(v) { this.attrs.rel = v; }, set href(v) { this.attrs.href = v; }, set src(v) { this.attrs.src = v; } });
  const document = {
    readyState: 'complete', currentScript: { src: '/wq/wq-adv.js?v=0123456789' },
    documentElement: { classList: { contains: (c) => classes.has(c) } }, body: null,
    head: { appendChild: (n) => { added.push(n); return n; } },
    createElement: el, addEventListener() {}, querySelectorAll: () => [],
  };
  const window = {
    document, navigator: { userAgent: 'test', connection: {} },
    matchMedia: (q) => ({ matches: reduced && /reduce/.test(q) }),
    localStorage: blocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener() {},
  };
  if (audio) window.AudioContext = audio;
  window.window = window;
  vm.runInNewContext(SRC, { window, document, navigator: window.navigator, RegExp, Math, Date, Object, Array, String, Number });
  return { WQA: window.WQA, added, store };
}

describe('icons', () => {
  const { WQA } = load();
  it('each is one inline SVG in the shared stroke style, hidden from screen readers unless labelled', () => {
    const h = WQA.icon('home');
    expect(h).toMatch(/^<svg class="wqa-i wqa-i-home" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"/);
    expect(h).toMatch(/aria-hidden="true"/);
    expect(WQA.icon('home', 'Home <x>')).toMatch(/role="img" aria-label="Home &lt;x&gt;"/);
  });
  it('an unknown name, animal or subject falls back to the star; the known ones map', () => {
    expect(WQA.icon('nope')).toMatch(/wqa-i-star/);
    expect(WQA.animal('owl')).toMatch(/wqa-i-owl/);
    expect(WQA.animal('dragon')).toMatch(/wqa-i-star/);
    expect(WQA.subject('Islamic Studies')).toMatch(/wqa-i-islamic/);
  });
  it('every emoji drawn by a child screen today has an icon (the census of public/wq/*.js)', () => {
    const rx = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2194}-\u{21AA}]/gu;
    const seen = new Set();
    for (const f of fs.readdirSync(PUB).filter((x) => /\.js$/.test(x) && x !== 'wq-adv.js')) {
      fs.readFileSync(path.join(PUB, f), 'utf8').split('\n').forEach((l) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(l)) return;
        (l.match(rx) || []).forEach((e) => seen.add(e));
      });
    }
    // drawing marks that are not pictures: the pause bars and the warning sign
    const notPictures = new Set(['❚', '⚠']);
    const missing = [...seen].filter((e) => !notPictures.has(e) && !WQA.EMO[e]);
    expect(missing).toEqual([]);
    for (const name of Object.values(WQA.EMO)) expect(WQA.P[name]).toBeTruthy();
  });
});

describe('small parts', () => {
  const { WQA } = load();
  it('the bar is a progressbar with its numbers, clamped', () => {
    expect(WQA.bar(3, 5, 'Pages')).toBe('<div class="wqa-bar" role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="3" aria-label="Pages"><i style="width:60%"></i></div>');
    expect(WQA.bar(9, 5)).toMatch(/aria-valuenow="5".*width:100%/);
    expect(WQA.bar(1, 0)).toMatch(/aria-valuemax="1"/);
  });
  it('the badge is a sticker with an icon and escaped words', () => {
    expect(WQA.badge('Star <reader>')).toMatch(/^<span class="wqa-badge"><svg class="wqa-i wqa-i-star".*<b>Star &lt;reader&gt;<\/b><\/span>$/);
  });
});

describe('motion and sound', () => {
  function fakeTarget() {
    const cl = new Set();
    return { cl, classList: { add: (c) => cl.add(c), remove: (c) => cl.delete(c) }, offsetWidth: 1, addEventListener() {}, removeEventListener() {} };
  }
  it('a move is the named one, and a 150 ms fade under reduced motion', () => {
    const t = fakeTarget();
    load().WQA.move(t, 'pop');
    expect([...t.cl]).toEqual(['wqa-m-pop']);
    const r = fakeTarget();
    load({ reduced: true }).WQA.move(r, 'pop');
    expect([...r.cl]).toEqual(['wqa-m-fade']);
  });
  it('muted (either key): a cue fetches nothing; on: the sound kit is fetched once at the look\'s version', () => {
    for (const store of [{ wq_sound: 'false' }, { wq_snd: '0' }]) {
      const m = load({ store });
      expect(m.WQA.muted()).toBe(true);
      m.WQA.cue('correct');
      expect(m.added).toEqual([]);
    }
    const on = load();
    on.WQA.cue('correct');
    on.WQA.cue('sentence');
    expect(on.added.map((n) => n.attrs.href || n.attrs.src)).toEqual(['/wq/wq-juice.css?v=0123456789', '/wq/wq-juice.js?v=0123456789']);
  });
  it('mute writes both keys the pages read', () => {
    const k = load();
    k.WQA.mute(true);
    expect(k.store).toEqual({ wq_sound: 'false', wq_snd: '0' });
  });
});

// A WebAudio stand-in that records each tone's frequency and type.
function fakeAudio() {
  const tones = [];
  function Ctx() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  Ctx.prototype.createOscillator = function () {
    const o = { type: 'sine', frequency: { value: 0, setValueAtTime(v) { o.frequency.value = v; } }, connect() {}, start() { tones.push([o.type, o.frequency.value]); }, stop() {} };
    return o;
  };
  Ctx.prototype.createGain = function () { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; };
  Ctx.prototype.resume = function () {};
  return { Ctx, tones };
}

describe('stamp: the one "you finished something" hook', () => {
  it('records the deed in its land, returns the share card centre element, and blips 784 + 1175 Hz', () => {
    const a = fakeAudio();
    const { WQA, store } = load({ audio: a.Ctx });
    const s = WQA.stamp('story');
    expect(s).toMatchObject({ kind: 'story', land: 'stories' });
    expect(s.svg).toMatch(/^<svg class="wqa-stamp wqa-stamp-stories"/);
    expect(JSON.parse(store.wqa_stamps).stories.kind).toBe('story');
    expect(a.tones).toEqual([['sine', 784], ['sine', 1175]]);
  });
  it('each deed has its land: games for a game or quiz, videos for a video, stories for a story or a reading', () => {
    const { WQA } = load();
    expect(['story', 'read', 'game', 'quiz', 'video'].map((k) => WQA.stamp(k).land)).toEqual(['stories', 'stories', 'games', 'games', 'videos']);
    expect(WQA.stamp('nope')).toBe(null);
  });
  it('muted: still stamped, no sound; the not-yet tone is a soft 220 Hz triangle', () => {
    const a = fakeAudio();
    const m = load({ audio: a.Ctx, store: { wq_sound: 'false' } });
    expect(m.WQA.stamp('game').land).toBe('games');
    expect(a.tones).toEqual([]);
    const b = fakeAudio();
    load({ audio: b.Ctx }).WQA.tone('notyet');
    expect(b.tones).toEqual([['triangle', 220]]);
  });
  it('a phone with storage blocked still gets its stamp (nothing throws)', () => {
    const { WQA } = load({ blocked: true });
    expect(WQA.stamps()).toEqual({});
    expect(WQA.stamp('video').land).toBe('videos');
  });
});

describe('award: the stamp on a finish card', () => {
  const card = (sel) => {
    const at = {}, ins = [];
    return { ins, getAttribute: (k) => (k in at ? at[k] : null), setAttribute: (k, v) => { at[k] = v; },
      querySelector: (q) => (q.split(',').some((x) => sel.includes(x.trim())) ? { insertAdjacentHTML: (w, h) => ins.push(h) } : null),
      insertAdjacentHTML: (w, h) => ins.push(h) };
  };
  it('a finished story or quiz gets its stamp under the deed, once per card', () => {
    const { WQA } = load();
    const c = card(['.wqfc-share', '.wqfc-cov', 'h2']);
    WQA.award(c); WQA.award(c);
    expect(c.ins.length).toBe(1);
    expect(c.ins[0]).toMatch(/class="wqa-got"/);
  });
  it('a try that read nothing (the card with no Share) gets no stamp: effort is answered, not the lack of it', () => {
    const { WQA, store } = load();
    const c = card(['.wqfc-cov', 'h2']);
    WQA.award(c);
    expect(c.ins).toEqual([]);
    expect(store.wqa_stamps).toBeUndefined();
  });
  it('the reading moment: a heard read is stamped, a 0-word read (its "try" badge) is not', () => {
    const { WQA } = load();
    const heard = card(['.wq-moment-deed']);
    const zero = card(['.wq-moment-deed', '[data-badge=try]']);
    WQA.award(heard); WQA.award(zero);
    expect([heard.ins.length, zero.ins.length]).toEqual([1, 0]);
  });
});

describe('the trail of three land stops (Home)', () => {
  it('one stop per land, in order, the stamped land filled and the next stop glowing', () => {
    const { WQA } = load({ store: { wqa_stamps: JSON.stringify({ stories: { kind: 'story', at: 1 } }) } });
    const h = WQA.trail({ stories: 'Stories', games: 'Games', videos: 'Videos' }, 'games');
    expect((h.match(/class="wqa-stop[^"]*"/g) || [])).toEqual(['class="wqa-stop wqa-l1 on"', 'class="wqa-stop wqa-l2 next"', 'class="wqa-stop wqa-l3"']);
    expect(h).toMatch(/href="#stories"[\s\S]*href="#games"[\s\S]*href="#videos"/);
    expect(h).toMatch(/<nav class="wqa-trail" aria-label="Stories · Games · Videos">/);
  });
});

describe('the sheet (wq-adventure.css)', () => {
  const CSS = fs.readFileSync(path.join(PUB, 'wq-adventure.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const root = (CSS.match(/html\.wq-adv\{([^}]*)\}/) || [])[1] || '';
  it('carries the ruled token values and never overrides the deployment brand', () => {
    const want = { '--ground': '#fbf3dc', '--card': '#fffdf6', '--line': '#e6d6ae', '--tint': '#fff1c9', '--muted': '#6d6450',
      '--gold': '#ffc83a', '--gold-d': '#b28c29', '--star': '#ffb000', '--glow': 'rgba(255,200,58,.55)',
      '--land-st': '#e97f2e', '--land-st-bg': '#ffe7cf', '--land-st-edge': '#a35920', '--land-gm': '#3a9d4f', '--land-gm-bg': '#dff3d9', '--land-gm-edge': '#296e37',
      '--land-vd': '#2a86de', '--land-vd-bg': '#dcefff', '--land-vd-edge': '#1d5e9b', '--land-sp': '#8e5bd8', '--land-sp-edge': '#634097',
      '--gutter': '16px', '--r-btn': '999px', '--r-card': '22px', '--r-chip': '14px',
      '--dur-tap': '90ms', '--dur-pop': '220ms', '--dur-celebrate': '900ms', '--ease-pop': 'cubic-bezier(.34,1.56,.64,1)' };
    for (const [k, v] of Object.entries(want)) expect([k, ((root.match(new RegExp(k.replace(/-/g, '\\-') + ':([^;]+)')) || [])[1] || '').trim()]).toEqual([k, v]);
    expect(CSS).not.toMatch(/--brand(-[a-z]+)?\s*:/);
  });
  it('never redefines the quiz colours: the answer options, right / not yet, or the ink (a recoloured option hints at the answer)', () => {
    expect(CSS).not.toMatch(/(^|[;{\s])--(s[1-4]|right|notyet|ink)(-[a-z]+)?\s*:/);
    expect(CSS).not.toMatch(/var\(--s[1-4](-[a-z]+)?\)/);
  });
  // the one button system (wq.css under wq-1b) owns every button's size, radius, padding, press and shadow shape
  const BUTTONS = /\.(wq-btn|wq-go|wq-navy|wq-soft|wq-ghost|wq-homebtn|wq-home|wq-snd|wq-jar|wq-dspk|wqs-ic|wqs-arr|wqs-main|wqs-sec|wqs-again|wqfc-share)\b[^\s>+~]*$/;
  it('re-colours the buttons and never re-shapes them: no button rule of its own sets size, radius, padding, margin, shadow or press', () => {
    const rules = (CSS.replace(/@media[^{]*\{([^{}]*\{[^}]*\})*\s*\}/g, '').match(/[^{}]*\{[^}]*\}/g) || []);
    const shaped = [];
    for (const r of rules) {
      const sels = r.split('{')[0].split(',').map((x) => x.trim().replace(/:[a-z-]+(\([^)]*\))?$/, ''));
      if (!sels.some((x) => BUTTONS.test(x) && !/section\.wq-home/.test(x))) continue;
      const props = r.split('{')[1].replace('}', '').split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);
      const bad = props.filter((d) => !/^(--|background$|background-color$|color$|border-color$)/.test(d));
      if (bad.length) shaped.push(`${r.split('{')[0].trim()} → ${bad.join(',')}`);
    }
    expect(shaped).toEqual([]);
  });
  it('never sets the one button system\'s size tokens (one owner for every height)', () => {
    expect(root).not.toMatch(/--(tap|btn-h|btn-h2|btn-h-2l|btn-icon|btn-d|btn-d2|btn-fs[a-z0-9-]*|press-[a-z]+)\s*:/);
  });
  it('the story reader and its questions keep the 16 px page gutter on both sides (nothing touches the screen edge)', () => {
    const r = (CSS.match(/^html\.wq-adv \.wqs\{[^}]*\}/m) || [''])[0];
    expect(r).toMatch(/padding-inline:var\(--gutter\)/);
  });
  it('no shadow reads a root-level edge: a token built from var(--edge) at :root freezes the root colour for every land', () => {
    expect(CSS).not.toMatch(/var\(--sh-(btn|press)\)/);
    expect(root.replace(/--edge:var\(--land-edge\);/, '')).not.toMatch(/var\(--edge\)/);
    expect(CSS).not.toMatch(/--sh-btn\s*:/);
  });
  it('every button variant sets its own --edge (a darker shade of its own fill), so no edge falls back to another colour', () => {
    const rules = CSS.match(/[^{}]*\{[^}]*\}/g) || [];
    const variants = rules.filter((r) => /\.(wq-go|wq-navy|wq-soft|wq-btn--[a-z]+)\b[^,]*$/.test(r.split('{')[0].split(',').pop().trim()) && /background|--fill/.test(r));
    expect(variants.length).toBeGreaterThanOrEqual(4);
    for (const r of variants) expect([r.split('{')[0].trim(), /--edge:/.test(r)]).toEqual([r.split('{')[0].trim(), true]);
  });
  it('the sheet and the kit each stay inside 8 KB gzipped', () => {
    const zlib = require('zlib');
    const gz = zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq-adventure.css'))).length + zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq-adv.js'))).length;
    expect(gz).toBeLessThanOrEqual(16 * 1024);
    expect(zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq-adventure.css'))).length).toBeLessThanOrEqual(8 * 1024);
    expect(zlib.gzipSync(fs.readFileSync(path.join(PUB, 'wq-adv.js'))).length).toBeLessThanOrEqual(8 * 1024);
  });
  it('motion is off under reduced motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\s*html\.wq-adv\{--dur-tap:0ms;--dur-pop:0ms;--dur-celebrate:0ms/);
  });
});
