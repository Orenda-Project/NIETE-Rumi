/**
 * The Next tile's round button in Urdu (wq-home.js + wq-home.css): a media play triangle (M8 5v14l11-7z) is never
 * mirrored, a forward arrow is. The server's tile says which it draws (data-icon="play|go"); the stylesheet mirrors
 * only the arrow, with no :has() (older Android WebViews). English mirrors neither. The fallback tile (no `next`,
 * web_quiz_next_offer off) is today's markup, untouched.
 * The page runs in a vm; the cascade is checked by matching wq-home.css's own selectors (postcss) against the drawn
 * button and its page (html[dir]). Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const postcss = require('postcss');
const parser = require('postcss-selector-parser');

const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const CSS_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.css');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [],
  challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false, home_v3: 1,
  doors: { stories: [{ kind: 'listen', id: 'ur.listen.1.story01', title: 'Testwala Doll' }], games: [], videos: null }, head: { dots: 1, today: false },
};
const LISTEN = { kind: 'story', id: 'ur.listen.1.story01', href: '/c/t?kid=c&room=story&pid=ur.listen.1.story01&ex=listen', title: 'Listen to a story', title_ur: 'کہانی سنیں', sub: 'Testwala Doll', minutes: 2, offer: 'AbCdEfGhIj', arm: 'rank', rank_src: 'prior', source: 'ranked' };
const VIDEO = { ...LISTEN, kind: 'video', id: 'vid-1', href: '/h/t?kid=c#watch/vid-1', title: 'Watch a video', title_ur: 'ویڈیو دیکھیں' };

function loadHome() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  return win.WQHOME;
}
const H = loadHome();

// The round button the home drew: its attributes and the path of its icon.
function button(html) {
  const m = /<span class="wq-ngo"([^>]*)>([\s\S]*?)<\/span>/.exec(html);
  if (!m) return null;
  const attrs = { class: 'wq-ngo' };
  m[1].replace(/([a-z-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
  return { attrs, d: (/ d="([^"]+)"/.exec(m[2]) || [])[1] };
}

// One compound selector against one element ({ tag, attrs }): tag, class, [attr], [attr=value], :not(...).
function compoundMatches(nodes, el) {
  return nodes.every((n) => {
    if (n.type === 'tag') return n.value === el.tag;
    if (n.type === 'class') return String(el.attrs.class || '').split(/\s+/).includes(n.value);
    if (n.type === 'attribute') {
      if (!(n.attribute in el.attrs)) return false;
      return n.operator ? n.operator === '=' && el.attrs[n.attribute] === String(n.value).replace(/^["']|["']$/g, '') : true;
    }
    if (n.type === 'pseudo' && n.value === ':not') return !n.nodes.some((sel) => compoundMatches(sel.nodes, el));
    throw new Error(`selector part not supported on old WebViews / by this check: ${n.toString()}`);
  });
}
// A selector "html[...] .x[...]" (descendant combinators only) against the button inside the page's <html>.
function selectorMatches(sel, button, page) {
  const parts = [[]];
  sel.nodes.forEach((n) => { if (n.type === 'combinator') { if (n.value.trim() !== '') throw new Error(`combinator ${n.value}`); parts.push([]); } else parts[parts.length - 1].push(n); });
  const last = parts.pop();
  if (!compoundMatches(last, { tag: 'span', attrs: button.attrs })) return false;
  return parts.every((p) => compoundMatches(p, page));
}
// Is the button mirrored (transform: scaleX(-1)) by wq-home.css on this page?
function mirrored(button, page) {
  const css = postcss.parse(fs.readFileSync(CSS_SRC, 'utf8'));
  let on = false;
  css.walkRules((rule) => {
    if (rule.parent && rule.parent.type === 'atrule') return;
    if (!rule.nodes.some((d) => d.prop === 'transform' && /scaleX\(-1\)/.test(d.value))) return;
    parser((root) => { root.each((sel) => { if (selectorMatches(sel, button, page)) on = true; }); }).processSync(rule.selector);
  });
  return on;
}
const pageOf = (lang) => ({ tag: 'html', attrs: lang === 'ur' ? { lang: 'ur', dir: 'rtl' } : { lang: 'en' } });
const draw = (next, lang) => button(H.html(next ? { ...HOME, lang, next } : { ...HOME, lang }, { token: TOKEN, lang }));

describe('the play triangle is never mirrored; the forward arrow is, in Urdu only', () => {
  test.each([['listen', LISTEN], ['video', VIDEO]])('UR, a %s tile: the play triangle, data-icon="play", no scaleX(-1)', (_, next) => {
    const b = draw(next, 'ur');
    expect(b.d).toBe('M8 5v14l11-7z');
    expect(b.attrs['data-icon']).toBe('play');
    expect(mirrored(b, pageOf('ur'))).toBe(false);
  });
  test('UR, a tile the server marks as a forward step (icon "go"): the arrow, data-icon="go", mirrored', () => {
    const b = draw({ ...LISTEN, kind: 'quiz', icon: 'go' }, 'ur');
    expect(b.attrs['data-icon']).toBe('go');
    expect(b.d).not.toBe('M8 5v14l11-7z');
    expect(mirrored(b, pageOf('ur'))).toBe(true);
  });
  test.each([['play', LISTEN], ['go', { ...LISTEN, icon: 'go' }]])('EN, a %s tile: never mirrored', (_, next) => {
    expect(mirrored(draw(next, 'en'), pageOf('en'))).toBe(false);
  });
  test('an unknown icon from the server is the play triangle (never mirrored)', () => {
    const b = draw({ ...LISTEN, icon: '"><b>' }, 'ur');
    expect(b.attrs['data-icon']).toBe('play');
    expect(mirrored(b, pageOf('ur'))).toBe(false);
  });
  test('the stylesheet uses no :has() (older Android WebViews)', () => {
    expect(fs.readFileSync(CSS_SRC, 'utf8')).not.toMatch(/:has\(/);
  });
});

describe('no `next` (web_quiz_next_offer off): the fallback tile is today\'s', () => {
  test('UR: the button carries no data-icon and is drawn exactly as before (mirrored as before)', () => {
    const b = draw(null, 'ur');
    expect(b.attrs).not.toHaveProperty('data-icon');
    expect(b.d).toBe('M8 5v14l11-7z');
    expect(mirrored(b, pageOf('ur'))).toBe(true);
  });
});
