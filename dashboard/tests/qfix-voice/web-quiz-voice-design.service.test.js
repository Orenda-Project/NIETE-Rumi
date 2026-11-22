/**
 * Web quiz page voice, the screen a lost clip leaves behind (public/wq/wq.js + wq.css, web_quiz_voice_v2).
 *
 * The walk on sandbox (Nov 2026) found three things the voice fix still got wrong on a 360 px phone:
 * - "big words" were 24 px against the normal 23 px, and the answer words did not change at all;
 * - every answer's speaker was 44 px, under the 48 px a child's thumb needs;
 * - an iPhone that cannot play Ogg Opus still downloaded every Ogg clip the lookahead warmed, then the mp3 too.
 *
 * The lookahead test runs the page's OWN voice block and lookahead block, cut from the shipped file, in a vm with
 * fetch and timers faked, so it executes the real warmClips().
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', '..', 'public', 'wq');
const SRC = fs.readFileSync(path.join(WQ, 'wq.js'), 'utf8');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // comments are not selectors
const VOICE = SRC.slice(SRC.indexOf('  var player = null;'), SRC.indexOf('  /* ---------------- tiny DOM helpers'));
const WARM = SRC.slice(SRC.indexOf('  var warmed = {};'), SRC.indexOf('  /* Late clips:'));

const KEY = 'quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f';
const ogg = (name) => `https://acct0123.r2.cloudflarestorage.com/digital-coach-audio/${KEY}/${name}.ogg?X-Amz-Signature=abc`;
const QS = [0, 1, 2].map((i) => ({ qid: `q${i}aaaaaaaa`, audio: { q: ogg(`q${i}`), opts: [ogg(`o${i}a`), ogg(`o${i}b`)] } }));

function lookahead({ v2, safari }) {
  const fetched = [];
  const timers = [];
  const canPlay = (t) => (safari && /ogg/.test(t) ? '' : 'probably');
  const ctx = {
    LANG: 'en', VLANG: 'en', SOUND: true, ONE_VOICE: true, GAP_PHONE: true, GAP_SLOW: true, QS,
    B: { voice_v2: v2 },
    ROOT: { classList: { add() {}, remove() {} } },
    speakable: () => true,
    ev() {},
    jv: (p) => p, JUG_DIR: '/wq/',
    WQI: { imageUrls: () => [] },
    Image: function Image() {},
    document: { visibilityState: 'visible', createElement: () => ({ canPlayType: canPlay }), addEventListener() {}, removeEventListener() {} },
    location: { origin: 'https://quiz.example.test' },
    navigator: { connection: { effectiveType: '4g', saveData: false } },
    Date, URL,
    Audio: function Audio() {},
    speechSynthesis: { speak() {}, cancel() {}, getVoices: () => [] },
    fetch: (u) => { fetched.push(u); return Promise.resolve(); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${VOICE}\n${WARM}\nthis.ahead = ahead;`, ctx);
  ctx.ahead(0);
  timers.filter((t) => t.ms === 1500).forEach((t) => t.fn());
  return fetched.slice().sort(); // the next two questions first, then the rest on 4G: the order is not the point
}
const STORED = QS.flatMap((q) => [q.audio.q, ...q.audio.opts]).sort();

describe('web_quiz_voice_v2 on: the lookahead warms the clip the phone will actually play', () => {
  test('a phone that cannot play Ogg Opus warms the mp3 twins from our origin, and no Ogg at all', () => {
    const fetched = lookahead({ v2: true, safari: true });
    expect(fetched.length).toBe(9);
    expect(fetched.filter((u) => /\.ogg(\?|$)/.test(u))).toEqual([]);
    expect(fetched).toContain(`/wq/clip/${KEY}/q1.mp3`);
  });

  test('a phone that plays Ogg Opus warms the stored clips, untouched', () => {
    expect(lookahead({ v2: true, safari: false })).toEqual(STORED);
  });

  test('off: today\'s lookahead (the stored clips, whatever the phone)', () => {
    expect(lookahead({ v2: false, safari: true })).toEqual(STORED);
  });
});

// The declarations of the last rule in wq.css whose selector list contains exactly `sel` (later rules win at equal
// specificity, and every selector checked here is the most specific one for its element).
function rule(sel) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let out = null;
  while ((m = re.exec(CSS))) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) out = m[2];
  }
  return out;
}
const px = (decl, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(?:var\\(--tap\\)|(\\d+)px)`).exec(decl || '');
  if (!m) return null;
  return m[1] ? Number(m[1]) : 48; // --tap is 48px (wq.css :root)
};

describe('a clip the child did not hear leaves words big enough to read alone (wq-novoice)', () => {
  test('the --tap token is still 48px', () => {
    expect(/--tap:48px/.test(CSS)).toBe(true);
  });

  test('English: the question is at least 30 px and each answer at least 26 px (normal: 23 and 21)', () => {
    expect(px(rule('.wq-novoice .wq-qtext'), 'font-size')).toBeGreaterThanOrEqual(30);
    expect(px(rule('.wq-novoice .wq-opt'), 'font-size')).toBeGreaterThanOrEqual(26);
  });

  test('Urdu (the polished look outranks the plain rule): question at least 30 px, answers at least 26 px', () => {
    expect(px(rule('html.wq-ur2[lang=ur] .wq-novoice .wq-qtext'), 'font-size')).toBeGreaterThanOrEqual(30);
    expect(px(rule('html.wq-ur2[lang=ur] .wq-novoice .wq-opt'), 'font-size')).toBeGreaterThanOrEqual(26);
  });
});

describe('every answer\'s own speaker is a full 48 px tap target', () => {
  test('.wq-opt .wq-ohear is 48 × 48', () => {
    const d = rule('.wq-opt .wq-ohear');
    expect(px(d, 'width')).toBeGreaterThanOrEqual(48);
    expect(px(d, 'height')).toBeGreaterThanOrEqual(48);
  });
});

describe('a small text button (.wq-linkbtn) is still a 48 px tap target', () => {
  test('English rule: min-height 48', () => {
    expect(px(rule('.wq-linkbtn'), 'min-height')).toBeGreaterThanOrEqual(48);
  });

  test('Urdu rule (outranks the plain one): min-height 48', () => {
    expect(px(rule('html.wq-ur2[lang=ur] .wq-linkbtn'), 'min-height')).toBeGreaterThanOrEqual(48);
  });
});

// The cascade itself, not one rule: every rule in wq.css whose selector matches the element (descendant and child
// combinators, classes, ids, [attr=value]), ranked by !important, specificity, then source order, the way the browser
// ranks them. @media rules count when they hold on a 360 × 740 phone.
const postcss = require('postcss');
const selParser = require('postcss-selector-parser');

const CSS_ROOT = postcss.parse(CSS);
const VIEW = { width: 360, height: 740 };
function mediaHolds(params) {
  return params.split(/\s+and\s+/).every((cond) => {
    const m = /\(\s*(min|max)-(width|height)\s*:\s*(\d+)px\s*\)/.exec(cond);
    if (!m) return false; // reduced motion, print, hover: not this phone
    const v = VIEW[m[2]];
    return m[1] === 'min' ? v >= Number(m[3]) : v <= Number(m[3]);
  });
}
function compoundMatches(nodes, el) {
  return nodes.every((n) => {
    if (n.type === 'tag') return n.value.toLowerCase() === el.tag;
    if (n.type === 'class') return el.classes.includes(n.value);
    if (n.type === 'id') return el.id === n.value;
    if (n.type === 'attribute') {
      const have = el.attrs[n.attribute];
      return n.operator ? n.operator === '=' && have === n.value : have !== undefined;
    }
    if (n.type === 'universal') return true;
    return false; // pseudo-classes and pseudo-elements: never the element at rest
  });
}
function selectorMatches(sel, path) {
  const parts = [[]];
  const combs = [];
  sel.nodes.forEach((n) => {
    if (n.type === 'combinator') { combs.push(n.value.trim() || ' '); parts.push([]); } else parts[parts.length - 1].push(n);
  });
  let at = path.length - 1;
  if (!compoundMatches(parts[parts.length - 1], path[at])) return false;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const comb = combs[i];
    if (comb === '>') {
      at -= 1;
      if (at < 0 || !compoundMatches(parts[i], path[at])) return false;
    } else if (comb === ' ') {
      do { at -= 1; } while (at >= 0 && !compoundMatches(parts[i], path[at]));
      if (at < 0) return false;
    } else return false;
  }
  return true;
}
function specificity(sel) {
  let a = 0; let b = 0; let c = 0;
  sel.walk((n) => {
    if (n.type === 'id') a += 1;
    else if (n.type === 'class' || n.type === 'attribute' || (n.type === 'pseudo' && !n.value.startsWith('::'))) b += 1;
    else if (n.type === 'tag' || (n.type === 'pseudo' && n.value.startsWith('::'))) c += 1;
  });
  return a * 1e6 + b * 1e3 + c;
}
// The size or the family out of a `font` shorthand: [style] [weight] size[/line-height] family.
function fromFont(value, prop) {
  const m = /(\d+(?:\.\d+)?px)(?:\/\S+)?\s+(.+)$/.exec(value);
  if (!m) return null;
  return prop === 'font-size' ? m[1] : m[2].trim();
}
function computed(path, prop) {
  let best = null;
  let order = 0;
  CSS_ROOT.walkRules((rule) => {
    const p = rule.parent;
    if (p.type === 'atrule' && !(p.name === 'media' && mediaHolds(p.params))) return;
    if (p.type !== 'root' && p.type !== 'atrule') return;
    // `font: 700 52px/1.7 var(--fu)` sets the size and the family too
    const decls = rule.nodes.filter((d) => d.type === 'decl' && (d.prop === prop || (d.prop === 'font' && /^font-(size|family)$/.test(prop))));
    if (!decls.length) return;
    selParser((sels) => {
      sels.each((sel) => {
        if (!selectorMatches(sel, path)) return;
        decls.forEach((d) => {
          order += 1;
          const rank = [d.important ? 1 : 0, specificity(sel), order];
          if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] || (rank[1] === best.rank[1] && rank[2] > best.rank[2])))) {
            best = { rank, value: d.prop === 'font' ? fromFont(d.value, prop) : d.value, selector: String(sel).trim() };
          }
        });
      });
    }).processSync(rule.selector);
  });
  return best;
}
const node = (tag, classes = [], attrs = {}, id) => ({ tag, classes, attrs, id });
// html > body > #wq (the page ROOT, which carries wq-novoice: wq.js `ROOT.classList.add('wq-novoice')`) > card > the words
function stemPath({ lang, ur2, novoice, listen }) {
  return [
    node('html', ur2 ? ['wq-ur2'] : [], { lang }),
    node('body'),
    node('div', novoice ? ['wq-novoice'] : [], {}, 'wq'),
    node('div', listen ? ['wq-qcard', 'wq-listen'] : ['wq-qcard']),
    node('p', listen ? ['wq-qtext', 'wq-qsmall'] : ['wq-qtext']),
  ];
}
const fontPx = (opts) => {
  const r = computed(stemPath(opts), 'font-size');
  return r && /^\d+px$/.test(r.value) ? Number.parseInt(r.value, 10) : r && r.value;
};

describe('a long Urdu "listen" question with no voice still leaves its answers on a 360 × 740 screen', () => {
  // qa-design walk, sandbox Nov 2026: at 30 px a 106-character Urdu listen stem took 462 px and the first answer started
  // at 684 px of 740, so the child saw only its top edge. Urdu Nastaliq needs ~2.15× line height; 26 px brings it back.
  test.each([
    ['the polished Urdu look (wq-ur2)', true],
    ['the plain Urdu look', false],
  ])('%s: the listen question\'s words are 26 px when the voice is lost', (_, ur2) => {
    expect(fontPx({ lang: 'ur', ur2, novoice: true, listen: true })).toBe(26);
  });

  // The plain look must hold too: the big words are the no-silence fallback, and they must not depend on another
  // team's switch (web_quiz_ur_polish, on in production since 10 Oct) staying on. In the plain look the Urdu rules
  // (html[lang=ur] .wq-qtext 21 px, .wq-opt 20 px) outranked the big words until the plain-look rule.
  test.each([
    ['polished', true],
    ['plain', false],
  ])('Urdu (%s): an ordinary question with no voice is 30 px and each answer 26 px', (_, ur2) => {
    expect(fontPx({ lang: 'ur', ur2, novoice: true, listen: false })).toBe(30);
    const opt = computed([node('html', ur2 ? ['wq-ur2'] : [], { lang: 'ur' }), node('body'), node('div', ['wq-novoice'], {}, 'wq'),
      node('div', ['wq-opts']), node('button', ['wq-opt', 'wq-s1'])], 'font-size');
    expect(opt && opt.value).toBe('26px');
  });

  test('English: the listen question with no voice keeps its 30 px (longest English stem in the bank is 39 characters)', () => {
    expect(fontPx({ lang: 'en', ur2: false, novoice: true, listen: true })).toBe(30);
  });

  test.each([
    ['polished', true, 17],
    ['plain', false, 21],
  ])('Urdu (%s): with the voice working, the listen question keeps today\'s size', (_, ur2, size) => {
    expect(fontPx({ lang: 'ur', ur2, novoice: false, listen: true })).toBe(size);
  });
});

