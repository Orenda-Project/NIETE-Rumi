/**
 * The adventure look's second part (public/wq/wq-adv-more.js, window.WQAD), asked for by the kit (wq-adv.js) as soon as
 * the look is on, so it is there before a child finishes anything:
 *  - a finish card (WQFC's .wqfc) gets Jugnu answering it (cheering; waving on a try), ONE next step (the Next tile
 *    leads, Share and Home sit under it as a pair) and, on a try that read nothing, the "Brave try" badge (no stamp);
 *  - Home's trail stops show the last thing finished in each land (kept on this phone when it was finished; no read),
 *    the Next tile's title keeps its own direction, and an Urdu Home button says «گھر».
 * Run in a vm with a small fake DOM (the browser is the boundary). Invented content only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const MORE = path.join(PUB, 'wq-adv-more.js');
const KIT_SRC = fs.readFileSync(path.join(PUB, 'wq-adv.js'), 'utf8');

// ── a small DOM: elements with classes, attributes, children and text; selectors: .a.b, [x], [x=y], tag, tag.a, comma lists
class Node {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.attrs = {}; this.childNodes = []; this.parentNode = null; this.ownerDocument = doc; this._html = null; }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; this.appendChild(text(String(v))); }
  set innerHTML(h) { this.childNodes = []; this._html = h; }
  get innerHTML() { return this._html != null ? this._html : this.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : `<${n.tagName.toLowerCase()}>`)).join(''); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  set src(v) { this.attrs.src = v; }
  get src() { return this.attrs.src; }
  set alt(v) { this.attrs.alt = v; }
  set width(v) { this.attrs.width = String(v); }
  set height(v) { this.attrs.height = String(v); }
  set rel(v) { this.attrs.rel = v; }
  set href(v) { this.attrs.href = v; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n;
  }
  // the kit's own rows (its stamp line): kept as one element holding the markup
  insertAdjacentHTML(where, h) {
    const n = new Node('x-html', this.ownerDocument); n._html = h;
    if (where === 'afterend') this.parentNode.insertBefore(n, this.nextSibling);
    else if (where === 'beforebegin') this.parentNode.insertBefore(n, this);
    else if (where === 'afterbegin') this.insertBefore(n, this.firstChild);
    else this.appendChild(n);
  }
  removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; return n; }
  matches(sel) { return sel.split(',').some((s) => one(this, s.trim())); }
  closest(sel) { let e = this; while (e && e.nodeType === 1) { if (e.matches(sel)) return e; e = e.parentNode; } return null; }
  querySelectorAll(sel) { const out = []; const walk = (e) => e.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function text(v) { return { nodeType: 3, nodeValue: v, get textContent() { return this.nodeValue; }, parentNode: null }; }
function one(e, s) {
  const m = s.match(/^([a-z0-9]*)((?:\.[A-Za-z0-9_-]+)*)((?:\[[^\]]+\])*)$/);
  if (!m) return false;
  if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
  const cls = ` ${e.className} `;
  if (m[2] && !m[2].split('.').filter(Boolean).every((c) => cls.includes(` ${c} `))) return false;
  return (m[3].match(/\[[^\]]+\]/g) || []).every((a) => {
    const [k, v] = a.slice(1, -1).split('=');
    return v === undefined ? e.hasAttribute(k) : e.getAttribute(k) === v.replace(/^"|"$/g, '');
  });
}
function el(doc, tag, cls, attrs = {}, kids = []) {
  const e = new Node(tag, doc);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  kids.forEach((k) => e.appendChild(typeof k === 'string' ? text(k) : k));
  return e;
}

function page({ lang = 'en', adv = true, store = {}, src = '/wq/wq-adv.js?v=0123456789' } = {}) {
  const doc = {};
  const classes = new Set(adv ? ['wq-adv'] : []);
  const head = new Node('head', doc);
  const body = new Node('body', doc);
  Object.assign(doc, {
    readyState: 'complete', currentScript: { src }, head, body,
    documentElement: { lang, classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c) } },
    createElement: (t) => new Node(t, doc), createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener() {},
    querySelector: (s) => body.querySelector(s), querySelectorAll: (s) => body.querySelectorAll(s),
  });
  const window = {
    document: doc, navigator: { userAgent: 'test', connection: {} }, location: { pathname: '/h/x' },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    addEventListener() {},
  };
  window.window = window;
  const ctx = { window, document: doc, navigator: window.navigator, RegExp, Math, Date, Object, Array, String, Number, JSON };
  vm.createContext(ctx);
  return { window, doc, body, head, store, ctx, el: (...a) => el(doc, ...a),
    kit() { vm.runInContext(KIT_SRC, ctx); return window.WQA; },
    more() { vm.runInContext(fs.readFileSync(MORE, 'utf8'), ctx); return window.WQAD; } };
}

// WQFC's card, as html() draws it (wq-finish-card.js): the top (cover, head), sound, Share (the primary unless a tile
// leads), the Next tile, Home
function card(p, { lang = 'en', cover = true, share = true, next = true, home = true, lead = false } = {}) {
  const kids = [];
  if (cover) kids.push(p.el('img', 'wqfc-cov', { src: '/s/b1/cover.webp', alt: 'A book' }));
  kids.push(p.el('h2', 'wqfc-head', {}, [share ? 'You finished the story!' : "Let's read it together"]));
  kids.push(p.el('button', 'wqfc-snd', { id: 'wqfc-snd' }));
  const nx = next ? p.el('a', `wqfc-next${lead ? ' wqfc-lead' : ''}`, { id: 'wqfc-next', href: '/h/x#videos', ...(lead ? { 'data-primary': '' } : {}) }) : null;
  if (lead && nx) kids.push(nx);
  if (share) kids.push(p.el('a', `wq-btn ${lead ? 'wq-soft' : 'wq-go'} wqfc-share`, { id: 'wqfc-share', ...(lead ? {} : { 'data-primary': '' }) }, ['Share to class group']));
  if (!lead && nx) kids.push(nx);
  if (home) kids.push(p.el('a', 'wq-btn wq-soft wqfc-home', { id: 'wqfc-home', 'data-home': '', href: '/h/x#' }, [lang === 'ur' ? 'واپس جائیں' : 'Home']));
  const c = p.el('div', 'wqfc', { 'data-screen': 'card', lang }, kids);
  p.body.appendChild(c);
  return c;
}
const order = (c) => c.children.map((e) => (e.className.match(/wqfc-[a-z]+|wqa-[a-z]+/) || [e.tagName])[0]);

describe('the kit asks for its second part as soon as the look is on (never with it off)', () => {
  it('one script, at the kit\'s own version', () => {
    const p = page();
    p.kit();
    const s = p.head.children.filter((n) => n.tagName === 'SCRIPT');
    expect(s.map((n) => n.attrs.src)).toEqual(['/wq/wq-adv-more.js?v=0123456789']);
  });
  it('look off: nothing asked for', () => {
    const p = page({ adv: false });
    p.kit();
    expect(p.head.children).toEqual([]);
  });
  it('the second part is served from /wq and stays small (≤ 3 KB gzipped)', () => {
    expect(fs.existsSync(MORE)).toBe(true);
    expect(zlib.gzipSync(fs.readFileSync(MORE)).length).toBeLessThanOrEqual(3 * 1024);
  });
  it('the look\'s version covers it, so a change to it is never served stale', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'routes', 'web-quiz.routes.js'), 'utf8')).toMatch(/\['wq-adventure\.css', 'wq-adv\.js', 'wq-adv-more\.js'/);
  });
});

describe('a finish card: Jugnu answers, and ONE next step leads', () => {
  it('Share was the primary and a Next tile is there: Next leads, Share and Home become the pair under it', () => {
    const p = page();
    const D = p.more();
    const c = card(p);
    D.card(c);
    expect(order(c)).toEqual(['wqfc-cov', 'wqa-jug', 'wqfc-head', 'wqfc-snd', 'wqfc-next', 'wqa-pair']);
    const nx = c.querySelector('.wqfc-next');
    expect(nx.hasAttribute('data-primary')).toBe(true);
    expect(nx.className).toMatch(/\bwqfc-lead\b/);
    const pair = c.querySelector('.wqa-pair');
    expect(pair.children.map((e) => e.attrs.id)).toEqual(['wqfc-share', 'wqfc-home']);
    expect(pair.children[0].hasAttribute('data-primary')).toBe(false);
    expect(pair.children[0].className).toBe('wq-btn wq-soft wqfc-share');
    expect(c.querySelectorAll('[data-primary]')).toHaveLength(1);
  });
  it('Jugnu cheers on a finish (beside the cover; at the top without one), once', () => {
    const p = page();
    const D = p.more();
    const c = card(p, { cover: false });
    D.card(c); D.card(c);
    const j = c.querySelectorAll('.wqa-jug');
    expect(j).toHaveLength(1);
    expect(j[0].attrs.src).toBe('/wq/jugnu/celebrate.webp');
    expect(j[0].attrs.alt).toBe('');
    expect(c.children[0]).toBe(j[0]);
  });
  it('a host that already leads with Next (a storybook, a video): the order stays, Share and Home still pair', () => {
    const p = page();
    const D = p.more();
    const c = card(p, { lead: true });
    D.card(c);
    expect(order(c)).toEqual(['wqfc-cov', 'wqa-jug', 'wqfc-head', 'wqfc-snd', 'wqfc-next', 'wqa-pair']);
    expect(c.querySelectorAll('[data-primary]').map((e) => e.attrs.id)).toEqual(['wqfc-next']);
  });
  it('no Next tile: Share stays the one primary, alone on its row (no pair)', () => {
    const p = page();
    const D = p.more();
    const c = card(p, { next: false });
    D.card(c);
    expect(c.querySelector('.wqa-pair')).toBeNull();
    expect(c.querySelectorAll('[data-primary]').map((e) => e.attrs.id)).toEqual(['wqfc-share']);
  });
  it('a screen that already shows Jugnu (the quiz page, the reading moment) gets no second one', () => {
    const p = page();
    p.body.appendChild(p.el('img', 'wq-jimg'));
    const D = p.more();
    const c = card(p);
    D.card(c);
    expect(c.querySelector('.wqa-jug')).toBeNull();
  });
  it.each([['en', 'Brave try!'], ['ur', 'ہمت والی کوشش!']])('a try that read nothing (%s): Jugnu waves, the Brave try badge under the words, no stamp', (lang, words) => {
    const p = page({ lang });
    const D = p.more();
    const c = card(p, { lang, share: false, lead: true });
    D.card(c);
    expect(c.querySelector('.wqa-jug').attrs.src).toBe('/wq/jugnu/hello.webp');
    const b = c.querySelector('.wqa-brave');
    expect(order(c).slice(0, 4)).toEqual(['wqfc-cov', 'wqa-jug', 'wqfc-head', 'wqa-got']);
    expect(b.getAttribute('role')).toBe('status');
    expect(b.innerHTML).toContain(`<b>${words}</b>`);
    expect(b.innerHTML).not.toMatch(/wqa-stamp/);
    expect(p.store.wqa_stamps).toBeUndefined();
  });
  it('the kit\'s award hands the card over, and keeps the finished book\'s cover for its land\'s trail stop', () => {
    const p = page();
    const A = p.kit();
    const D = p.more();
    const c = card(p);
    A.award(c);
    expect(c.querySelector('.wqa-jug')).not.toBeNull();
    expect(JSON.parse(p.store.wqa_art)).toEqual({ stories: '/s/b1/cover.webp' });
    void D;
  });
  it('a try keeps no art (nothing was finished)', () => {
    const p = page();
    const A = p.kit();
    p.more();
    A.award(card(p, { share: false, lead: true }));
    expect(p.store.wqa_art).toBeUndefined();
  });
});

describe('Home', () => {
  function home(p, { lang = 'en', art = '/s/b2/cover.webp' } = {}) {
    const small = p.el('small', '', {}, [p.el('bdi', '', {}, ['Nouns']), lang === 'ur' ? '، ' : ' · ', p.el('span', 'wq-nmin', {}, ['3 min'])]);
    const nx = p.el('a', 'wq-next', { 'data-kind': 'story', href: '/s/b2' }, [p.el('img', 'wq-nart', { src: art }), p.el('span', 'wq-ntext', {}, [p.el('b', '', {}, ['Words That Describe Nouns']), small])]);
    const stops = ['stories', 'games', 'videos'].map((l, i) => p.el('a', `wqa-stop wqa-l${i + 1}`, { 'data-door': l }, [p.el('i', '', {}, []), p.el('span', '', {}, [l])]));
    const h = p.el('section', 'wq-screen wq-home', { 'data-screen': 'home' }, [nx, p.el('nav', 'wqa-trail', {}, stops)]);
    p.body.appendChild(h);
    return h;
  }
  it('each land\'s stop shows the last thing finished there; a land with nothing yet stays an empty ring; the next stop shows what is next', () => {
    const p = page({ store: { wqa_art: JSON.stringify({ games: '/wq/art/sun.webp' }) } });
    const D = p.more();
    const h = home(p);
    D.home(h);
    const imgs = h.querySelectorAll('.wqa-stop').map((s) => (s.querySelector('img') || { attrs: {} }).attrs.src);
    expect(imgs).toEqual(['/s/b2/cover.webp', '/wq/art/sun.webp', undefined]);
    expect(h.querySelector('.wqa-stop[data-door=games]').className).toMatch(/\bwqa-pic\b/);
  });
  it('only a same-site picture path or an https picture is ever drawn in a stop', () => {
    const p = page({ store: { wqa_art: JSON.stringify({ games: 'javascript:alert(1)', videos: '//evil.example/x.png' }) } });
    const D = p.more();
    const h = home(p, { art: '/wq/jugnu/hello.webp' }); // Jugnu's own pose is not a thing to show
    D.home(h);
    expect(h.querySelectorAll('.wqa-stop').map((x) => x.querySelector('img'))).toEqual([null, null, null]);
  });
  it('the Next tile\'s title keeps its own direction, and the minutes sit on their own line without a stray comma', () => {
    const p = page({ lang: 'ur' });
    const D = p.more();
    const h = home(p, { lang: 'ur' });
    D.home(h);
    expect(h.querySelector('.wq-ntext').children[0].getAttribute('dir')).toBe('auto');
    expect(h.querySelector('small').childNodes.filter((n) => n.nodeType === 3)).toEqual([]);
  });
  it.each([['واپس جائیں'], ['ہوم']])('Urdu: a Home button that says «%s» says «گھر» (the app\'s one word)', (w) => {
    const p = page({ lang: 'ur' });
    const D = p.more();
    const b = p.el('a', 'wq-btn wq-soft', { 'data-home': '' }, [p.el('span', '', {}, [w])]);
    const c = p.el('button', 'wqs-sec', { 'data-home': '' }, [w]);
    p.body.appendChild(b); p.body.appendChild(c);
    D.scan(p.body);
    expect([b.textContent, c.textContent]).toEqual(['گھر', 'گھر']);
  });
  it('English Home buttons are left as they are', () => {
    const p = page({ lang: 'en' });
    const D = p.more();
    const b = p.el('a', 'wq-btn', { 'data-home': '' }, ['Home']);
    p.body.appendChild(b);
    D.scan(p.body);
    expect(b.textContent).toBe('Home');
  });
  it('arriving after the page drew: it dresses the cards and the Home already there', () => {
    const p = page({ store: { wqa_art: JSON.stringify({ games: '/wq/art/sun.webp' }) } });
    const c = card(p);
    const h = home(p);
    p.more();
    expect(c.querySelector('.wqa-jug')).not.toBeNull();
    expect(h.querySelector('.wqa-stop[data-door=games]').querySelector('img')).not.toBeNull();
  });
});
