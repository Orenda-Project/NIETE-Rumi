/**
 * The Trail page v2's stop intro: the passage's title line (#wqc-ptitle, drawn by wq-trail.js under the bubble) reads
 * as the screen's heading, not as a caption: the same font-weight and colour as the page's heading (h1/h2), in English,
 * in Urdu and under the Urdu polish (wq-ur2); Urdu Nastaliq never under 20 px.
 *
 * The page runs whole in the harness's vm (wq-trail.js + wq-challenge.js). The styles it ships are read as shipped:
 * wq.css (linked by the page shell first) followed by every <style> the page's scripts add to <head> (captured as they
 * are appended). A small cascade (specificity, then order, !important first) resolves each property for the title as
 * drawn on the intro and for an h1/h2 on the same screen. Selectors with pseudo-classes or child/sibling combinators
 * are left out of the resolver (none of them targets a <p> title or a heading here).
 * Golden: a listen stop with no title (a counted listen) still shows no line; the intro's other markup is unchanged.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY } = H;

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TRAIL_SRC = fs.readFileSync(path.join(WQ, 'wq-trail.js'), 'utf8');
const WQ_CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'trail-intro-v2.golden.json'), 'utf8'));
// runs first on the page's window: keeps the text of every <style> a script appends to <head>, and gives the page's
// root (#wq) a class list, so the class a script puts on it (wq-trail.js: wqt-v2) is the one the cascade sees
const CAPTURE = 'document.__styles = []; document.__rootClasses = [];'
  + ' (function (a) { document.head.appendChild = function (el) { if (el && el.tag === "style") document.__styles.push(String(el.textContent || "")); return a.call(this, el); }; })(document.head.appendChild);'
  + ' (function (g) { document.getElementById = function (id) { var r = g(id); if (id === "wq" && r && !r.classList) { var c = document.__rootClasses;'
  + ' r.classList = { add: function (x) { if (c.indexOf(x) < 0) c.push(x); }, contains: function (x) { return c.indexOf(x) >= 0; } }; } return r; }; })(document.getElementById);';

const TC = { practice: 'Play as much as you like!', stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const EXS = [
  { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true },
  { id: 'listen', name: 'Listen', mins: 2, done: false, last: null, badge: false },
  { id: 'bigger', name: 'Which is bigger?', mins: 2, done: false, last: null, badge: false },
];
const V2 = { pool: true, story: false, consent: true };
const MENU = (lang) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, v2: V2 });
const CL = { ...CLIPS, intro: { text: 'Intro line', url: 'https://r2.test/intro.ogg' } };
const READ = (extra = {}) => ({ ex: 'read', name: 'Read aloud', ct: 'CTR', secs: 60, clips: CL, story: STORY, record: true, trail: true, trail_copy: TC, v2: V2, ...extra });
const LISTEN = (extra = {}) => ({ ex: 'listen', name: 'Listen', ct: 'CTL', clips: CL, read_times: 2, story_clip: { url: 'https://r2.test/story.ogg' }, record: true, trail: true, trail_copy: TC, v2: V2, ...extra });
const TITLE = { en: 'The Pink Kite', ur: 'لال پتنگ' };

async function introOf(payload, { lang = 'en', htmlClass = '' } = {}) {
  const p = H.page({ lang, htmlClass, menu: MENU(lang), freshEls: true, pre: [CAPTURE, TRAIL_SRC], routes: { [`ch/HUB.TOKEN/${payload.ex}`]: ok(payload) } });
  p.w.open(payload.ex);
  await p.flush();
  if (p.screen() === 'help-ask') await p.click('wqc-help-no');
  expect(p.screen()).toBe('intro');
  return p;
}

// ── a small cascade over the shipped CSS ─────────────────────────────────────────────────────────────
function rulesOf(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    const head = s.slice(i, open).trim();
    if (head.startsWith('@')) { // an at-rule block: skipped whole (media, keyframes, font-face)
      let depth = 1; let j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth += 1; else if (s[j] === '}') depth -= 1; j += 1; }
      i = j; continue;
    }
    const close = s.indexOf('}', open);
    const body = s.slice(open + 1, close);
    const decls = body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const k = d.indexOf(':');
      const v = d.slice(k + 1).trim();
      return { prop: d.slice(0, k).trim().toLowerCase(), value: v.replace(/\s*!important$/, ''), important: /!important$/.test(v) };
    });
    head.split(',').map((x) => x.trim()).filter(Boolean).forEach((sel) => out.push({ sel, decls }));
    i = close + 1;
  }
  return out;
}
function compound(c) {
  const m = /^([a-z][a-z0-9]*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[\w-]+))?\])*)$/i.exec(c);
  if (!m) return null;
  const parts = { tag: m[1] ? m[1].toLowerCase() : null, ids: [], classes: [], attrs: [] };
  (m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []).forEach((t) => {
    if (t[0] === '#') parts.ids.push(t.slice(1));
    else if (t[0] === '.') parts.classes.push(t.slice(1));
    else { const [k, v] = t.slice(1, -1).split('='); parts.attrs.push([k, v == null ? null : v.replace(/^["']|["']$/g, '')]); }
  });
  return parts;
}
function parseSel(sel) {
  if (/[:>+~*]/.test(sel)) return null;
  const cs = sel.split(/\s+/).map(compound);
  return cs.some((c) => !c) ? null : cs;
}
const fits = (c, el) => (!c.tag || c.tag === el.tag) && c.ids.every((x) => el.id === x) && c.classes.every((x) => el.classes.includes(x))
  && c.attrs.every(([k, v]) => (v == null ? k in el.attrs : el.attrs[k] === v));
function matches(cs, chain) { // chain: [html, ..., el]
  if (!fits(cs[cs.length - 1], chain[chain.length - 1])) return false;
  let a = chain.length - 2;
  for (let k = cs.length - 2; k >= 0; k -= 1) {
    while (a >= 0 && !fits(cs[k], chain[a])) a -= 1;
    if (a < 0) return false;
    a -= 1;
  }
  return true;
}
const spec = (cs) => cs.reduce((s, c) => [s[0] + c.ids.length, s[1] + c.classes.length + c.attrs.length, s[2] + (c.tag ? 1 : 0)], [0, 0, 0]);
const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
function resolve(rules, chain, prop) {
  let best = null;
  rules.forEach((r, order) => {
    const cs = parseSel(r.sel);
    if (!cs || !matches(cs, chain)) return;
    r.decls.filter((d) => d.prop === prop).forEach((d) => {
      const key = { imp: d.important ? 1 : 0, sp: spec(cs), order, value: d.value };
      if (!best || key.imp > best.imp || (key.imp === best.imp && (cmp(key.sp, best.sp) > 0 || (cmp(key.sp, best.sp) === 0 && key.order >= best.order)))) best = key;
    });
  });
  return best ? best.value : undefined;
}
// the element as the page drew it: its tag, id and classes read from the intro's own markup
function drawnTitle(html) {
  const m = /<(\w+) class="([^"]*)" id="wqc-ptitle">/.exec(html);
  return m ? { tag: m[1].toLowerCase(), id: 'wqc-ptitle', classes: m[2].split(/\s+/), attrs: {} } : null;
}
function chainFor(el, lang, htmlClass, rootClasses) {
  return [
    { tag: 'html', id: null, classes: htmlClass ? htmlClass.split(/\s+/) : [], attrs: { lang } },
    { tag: 'body', id: null, classes: [], attrs: {} },
    { tag: 'div', id: 'wq', classes: rootClasses.slice(), attrs: {} },
    { tag: 'section', id: null, classes: ['wq-screen', 'wqc'], attrs: { 'data-screen': 'intro' } },
    el,
  ];
}
async function styled(lang, htmlClass) {
  const p = await introOf(READ({ title: TITLE }), { lang, htmlClass });
  const html = p.root.innerHTML;
  const el = drawnTitle(html);
  expect(el).not.toBeNull();
  const shipped = rulesOf([WQ_CSS, ...p.ctx.document.__styles].join('\n'));
  const at = (e, prop) => resolve(shipped, chainFor(e, lang, htmlClass, p.ctx.document.__rootClasses), prop);
  const head = (tag) => ({ tag, id: null, classes: [], attrs: {} });
  return { p, html, el, injected: p.ctx.document.__styles.length, rootClasses: p.ctx.document.__rootClasses, at, head };
}

const MODES = [['English', 'en', ''], ['Urdu', 'ur', ''], ['Urdu, polish on (wq-ur2)', 'ur', 'wq-ur2']];

describe('the intro\'s passage title carries the page heading\'s weight and colour', () => {
  test.each(MODES)('%s: same font-weight and colour as h1 and h2', async (_n, lang, htmlClass) => {
    const s = await styled(lang, htmlClass);
    expect(s.injected).toBeGreaterThan(0); // the page's own style block was read, not only wq.css
    expect(s.rootClasses).toContain('wqt-v2'); // the Trail page's root class, as wq-trail.js set it
    expect(s.html).toContain(`id="wqc-ptitle">${lang === 'ur' ? TITLE.ur : TITLE.en}</p>`);
    ['h1', 'h2'].forEach((tag) => {
      expect(s.at(s.el, 'font-weight')).toBe(s.at(s.head(tag), 'font-weight'));
      expect(s.at(s.el, 'color')).toBe(s.at(s.head(tag), 'color'));
    });
    expect(s.at(s.el, 'color')).toBe('var(--navy)');
    expect(s.at(s.el, 'color')).not.toBe('var(--muted)');
  });
  test.each(MODES.filter((m) => m[1] === 'ur'))('%s: the Nastaliq title is at least 20px', async (_n, lang, htmlClass) => {
    const s = await styled(lang, htmlClass);
    expect(parseFloat(s.at(s.el, 'font-size'))).toBeGreaterThanOrEqual(20);
  });
  test('English: the title is no smaller than the line it used to be (16px), no larger than the h2', async () => {
    const s = await styled('en', '');
    const px = parseFloat(s.at(s.el, 'font-size'));
    expect(px).toBeGreaterThanOrEqual(16);
    expect(px).toBeLessThanOrEqual(parseFloat(s.at(s.head('h2'), 'font-size')));
  });
  test('another sub line on the page (.wq-sub without the title id) keeps its caption look', async () => {
    const s = await styled('en', '');
    const sub = { tag: 'p', id: 'wqc-next', classes: ['wq-sub'], attrs: {} };
    expect(s.at(sub, 'color')).toBe('var(--muted)');
    expect(s.at(sub, 'font-weight')).toBe('700');
  });
});

describe('golden: the intro\'s markup is unchanged', () => {
  test('a listen stop with no title (a counted listen) shows no title line, English and Urdu', async () => {
    const en = (await introOf(LISTEN())).html();
    expect(en).not.toContain('wqc-ptitle');
    expect(en).toBe(GOLDEN.listenEn);
    const ur = (await introOf(LISTEN({ title: null }), { lang: 'ur' })).html();
    expect(ur).not.toContain('wqc-ptitle');
  });
  test('a read stop with no title: the intro is the captured one, English and Urdu', async () => {
    expect((await introOf(READ())).html()).toBe(GOLDEN.readEn);
    expect((await introOf(READ(), { lang: 'ur' })).html()).toBe(GOLDEN.readUr);
  });
  test('a read stop with a title: the line\'s markup is the shipped one, English and Urdu', async () => {
    expect((await introOf(READ({ title: TITLE }))).html()).toContain('<p class="wq-sub" id="wqc-ptitle">The Pink Kite</p>');
    expect((await introOf(READ({ title: TITLE }), { lang: 'ur' })).html()).toContain('<p class="wq-sub" id="wqc-ptitle">لال پتنگ</p>');
  });
});
