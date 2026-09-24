'use strict';
/**
 * Read a rendered page back as LINES OF INK, so a test can say whether two
 * lines of text touch — not whether their CSS boxes overlap.
 *
 * Nastaliq is why this exists. A line of Noto Nastaliq Urdu inks from about
 * 1.5-2.0 em above its baseline down to about 0.4-0.7 em below it, and the
 * tall letters (ک گ ل ٹ) and the long tails (ے ی ں) sit at different places
 * in every sentence, so neither the line-height nor the font's own metrics say
 * whether a given pair of lines collides. What the reader sees is ink, so the
 * test measures ink:
 *
 *   1. Every word of the chosen elements becomes a DOM Range; words are grouped
 *      into rendered lines by where they sit on the page.
 *   2. For each line, everything on the page is made invisible except that
 *      line's own words, and that strip of the page is screenshotted. Each word
 *      is wrapped in its own span AT WHITESPACE, so shaping and line breaking
 *      are untouched; text colour, backgrounds, borders, pseudo-elements,
 *      images and SVG are hidden without moving anything. (A CSS Custom
 *      Highlight would be simpler and is wrong: Chromium clips highlighted text
 *      to the selection rectangle, which cuts off exactly the tall strokes of
 *      ک and گ this measures.)
 *   3. Per pixel column: the lowest ink of a line and the highest ink of the
 *      next. The gap between two lines is the smallest vertical distance
 *      between them over every column (with a small sideways reach, so a
 *      diagonal near-touch counts), in em of the element's font size.
 *      Negative = the lines overlap; ~0 = they touch.
 *
 * It also reports each element's ink against the box it is drawn in (a bordered
 * option row, a chip, a clipped one-line label), so "the descender touches the
 * border" and "overflow:hidden cuts the top of the letter" are measurable too.
 *
 * Needs the Chromium the bot's postinstall downloads (see pdf-layout.js).
 */

const INK_PROBE_CSS = `
html.__ink, html.__ink body{background:#fff !important}
html.__ink *, html.__ink *::before, html.__ink *::after{
  color:transparent !important;
  background:transparent !important; border-color:transparent !important; outline-color:transparent !important;
  box-shadow:none !important; text-shadow:none !important; filter:none !important;
  text-decoration-color:transparent !important}
html.__ink svg, html.__ink img, html.__ink canvas{visibility:hidden !important}
html.__ink .__w.__on, html.__ink .__w.__on *{color:#000 !important}
html.__ink .__unclip{overflow:visible !important}
`;

/**
 * Group the words of every element matching `selector` (inside `root`, or the
 * document) into rendered lines. Runs in the page.
 * @returns {Array<{index:number, fontSize:number, lines:Array<{top:number,bottom:number,words:number}>, box:object|null, clips:boolean}>}
 */
function collectLinesInPage({ selector, boxSelector }) {
  const els = Array.from(document.querySelectorAll(selector));
  window.__inkLines = [];
  const out = [];
  els.forEach((el, index) => {
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || fontSize * 1.5;
    const words = [];
    // A typeset expression is one unit: its own spans are KaTeX's, not ours.
    const unitOf = (node) => {
      const r = node.getClientRects ? Array.from(node.getClientRects()).filter((x) => x.width > 0 && x.height > 0) : [];
      if (!r.length) return null;
      const top = Math.min(...r.map((x) => x.top)) + window.scrollY;
      const bottom = Math.max(...r.map((x) => x.bottom)) + window.scrollY;
      return { node, mid: (top + bottom) / 2, top, bottom };
    };
    const texts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (n.matches('.katex')) return NodeFilter.FILTER_ACCEPT;
          if (n.matches('svg, style, script, .katex-mathml')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        if (n.parentElement && n.parentElement.closest('.katex')) return NodeFilter.FILTER_REJECT;
        return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
    for (const n of texts) {
      if (n.nodeType === 1) {
        n.classList.add('__w');
        const u = unitOf(n);
        if (u) words.push(u);
        continue;
      }
      if (n.parentElement && n.parentElement.classList.contains('__w')) {
        const u = unitOf(n.parentElement);
        if (u) words.push(u);
        continue;
      }
      // Split at whitespace only, so no word is cut and joining is untouched.
      const parts = n.nodeValue.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      const made = [];
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
        const sp = document.createElement('span');
        sp.className = '__w';
        sp.textContent = part;
        frag.appendChild(sp);
        made.push(sp);
      }
      n.parentNode.replaceChild(frag, n);
      for (const sp of made) { const u = unitOf(sp); if (u) words.push(u); }
    }
    // Lines progress downward in document order even when a line mixes
    // directions; a word starts a new line when its middle sits more than half
    // a line pitch below the current line's.
    const lines = [];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur && w.mid - cur.mid < lh * 0.5) {
        cur.units.push(w.node);
        cur.top = Math.min(cur.top, w.top);
        cur.bottom = Math.max(cur.bottom, w.bottom);
        cur.mids.push(w.mid);
        cur.mid = cur.mids.reduce((s, x) => s + x, 0) / cur.mids.length;
      } else {
        lines.push({ units: [w.node], top: w.top, bottom: w.bottom, mids: [w.mid], mid: w.mid });
      }
    }
    window.__inkLines.push(lines.map((l) => l.units));
    const boxEl = boxSelector ? el.closest(boxSelector) : null;
    let box = null;
    if (boxEl) {
      const b = boxEl.getBoundingClientRect();
      const bcs = getComputedStyle(boxEl);
      box = {
        top: b.top + window.scrollY + parseFloat(bcs.borderTopWidth),
        bottom: b.bottom + window.scrollY - parseFloat(bcs.borderBottomWidth),
        clips: bcs.overflowY !== 'visible',
      };
    }
    // A box that clips cuts the ink that leaves it, so the ink it cuts is never
    // painted and cannot be seen by reading pixels. The measured element and
    // every clipping ancestor (and descendant — a label's own ellipsis span) are
    // therefore un-clipped while the probe runs (their size is fixed by their
    // own line box, so nothing moves), and the ink is compared against the
    // tightest clip edge instead. Vertically only overflow-y cuts (overflow-x:
    // clip with overflow-y visible is the sideways-only clip a one-line label is
    // meant to use); sideways any overflow-x cuts — which is how a word-initial
    // ک lost the stroke that overhangs the start of its line.
    const clipsY = (n) => getComputedStyle(n).overflowY !== 'visible';
    const clipsX = (n) => getComputedStyle(n).overflowX !== 'visible';
    const rectOf = (n) => {
      const b = n.getBoundingClientRect();
      return { top: b.top + window.scrollY, bottom: b.bottom + window.scrollY, left: b.left + window.scrollX, right: b.right + window.scrollX };
    };
    const clippers = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) if (clipsY(n) || clipsX(n)) clippers.push(n);
    el.querySelectorAll('*').forEach((n) => { if ((clipsY(n) || clipsX(n)) && !n.closest('.katex')) clippers.push(n); });
    let clip = null;
    for (const n of clippers) {
      const r = rectOf(n);
      const c = clip || { top: null, bottom: null, left: null, right: null };
      const tighter = (cur, v, pick) => (cur === null ? v : pick(cur, v));
      clip = {
        top: clipsY(n) ? tighter(c.top, r.top, Math.max) : c.top,
        bottom: clipsY(n) ? tighter(c.bottom, r.bottom, Math.min) : c.bottom,
        left: clipsX(n) ? tighter(c.left, r.left, Math.max) : c.left,
        right: clipsX(n) ? tighter(c.right, r.right, Math.min) : c.right,
      };
      n.classList.add('__unclip');
    }
    const self = { ...rectOf(el), clips: clipsY(el) };
    out.push({
      rtl: cs.direction === 'rtl',
      index, fontSize, lineHeight: lh, text: el.textContent.trim().slice(0, 40),
      lines: lines.map((l) => ({ top: l.top, bottom: l.bottom, words: l.units.length })), box, self, clip,
    });
  });
  return out;
}

/** Show exactly one line's words. Runs in the page. */
function showLineInPage({ el, line }) {
  document.documentElement.classList.add('__ink');
  document.querySelectorAll('.__w.__on').forEach((n) => n.classList.remove('__on'));
  ((window.__inkLines[el] && window.__inkLines[el][line]) || []).forEach((n) => n.classList.add('__on'));
}

function clearInPage() {
  document.documentElement.classList.remove('__ink');
  document.querySelectorAll('.__unclip').forEach((n) => n.classList.remove('__unclip'));
  document.querySelectorAll('.__w.__on').forEach((n) => n.classList.remove('__on'));
}

/** Per-column highest/lowest ink of a PNG (white ground, dark ink). Runs in the page. */
async function columnsInPage({ b64, threshold }) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const top = new Array(c.width).fill(-1);
  const bottom = new Array(c.width).fill(-1);
  for (let x = 0; x < c.width; x += 1) {
    for (let y = 0; y < c.height; y += 1) {
      const i = (y * c.width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < threshold) { if (top[x] < 0) top[x] = y; bottom[x] = y; }
    }
  }
  return { width: c.width, height: c.height, top, bottom };
}

async function ensureProbeCss(page) {
  const has = await page.evaluate(() => Boolean(document.getElementById('__ink-probe')));
  if (!has) {
    await page.evaluate((css) => {
      const st = document.createElement('style');
      st.id = '__ink-probe';
      st.textContent = css;
      document.head.appendChild(st);
    }, INK_PROBE_CSS);
  }
}

/** The ink of one rendered line, per pixel column, in document CSS px. */
async function lineInk(page, dsf, e, li) {
  const L = e.lines[li];
  const pad = Math.ceil(e.fontSize * 2.4);
  const y0 = Math.max(0, Math.floor(L.top - pad));
  const y1 = Math.ceil(L.bottom + pad);
  await page.evaluate(showLineInPage, { el: e.index, line: li });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: y0, width, height: y1 - y0 }, animations: 'disabled' });
  const col = await page.evaluate(columnsInPage, { b64: png.toString('base64'), threshold: 160 });
  return {
    top: col.top.map((v) => (v < 0 ? null : y0 + v / dsf)),
    bottom: col.bottom.map((v) => (v < 0 ? null : y0 + v / dsf)),
  };
}

/** Smallest vertical distance from `upper`'s lowest ink to `lower`'s highest, over every column (± reach px). */
function minGap(upper, lower, reachPx) {
  let min = Infinity;
  for (let x = 0; x < upper.bottom.length; x += 1) {
    if (upper.bottom[x] === null) continue;
    for (let dx = -reachPx; dx <= reachPx; dx += 1) {
      const v = lower.top[x + dx];
      if (v === null || v === undefined) continue;
      min = Math.min(min, v - upper.bottom[x]);
    }
  }
  return min;
}

const toEm = (v, em) => (v === Infinity ? Infinity : Math.round((v / em) * 1000) / 1000);

/**
 * Measure every element matching `selector` on an open Playwright page.
 *
 * @param {import('playwright-core').Page} page  content already set, fonts loaded
 * @param {string} selector   the text blocks to read (e.g. '.stem', '.opt .otext')
 * @param {object} [o]
 * @param {string} [o.boxSelector]  the ancestor whose inner border edge the ink must stay inside
 * @param {number} [o.reach=0.04]   sideways reach of the gap search, em
 * @returns {Promise<Array<{index, text, fontSize, lines:number, gaps:number[],
 *   boxClearTop:number|null, boxClearBottom:number|null, selfClearTop:number, selfClearBottom:number, clips:boolean,
 *   clipClearTop:number|null, clipClearBottom:number|null, clipClearStart:number|null}>>}
 *   gaps: line i -> i+1, in em (negative = overlap). *Clear*: distance from the ink to the box edge, em
 *   (negative = the ink crosses it). clipClear*: against the tightest box that clips it (the element, an
 *   ancestor or a descendant) — negative = that much of the letter is cut off in the real render.
 *   clipClearStart is the side a line begins on (right in Urdu); the end side is an ellipsis's to cut.
 */
async function measureLines(page, selector, { boxSelector = null, reach = 0.04 } = {}) {
  await ensureProbeCss(page);
  const dsf = await page.evaluate(() => window.devicePixelRatio || 1);
  const els = await page.evaluate(collectLinesInPage, { selector, boxSelector });
  const results = [];
  try {
    for (const e of els) {
      const em = e.fontSize;
      const inks = [];
      for (let li = 0; li < e.lines.length; li += 1) inks.push(await lineInk(page, dsf, e, li));
      const r = Math.max(1, Math.round(reach * em * dsf));
      const gaps = [];
      for (let i = 0; i + 1 < inks.length; i += 1) gaps.push(toEm(minGap(inks[i], inks[i + 1], r), em));
      const tops = inks.flatMap((k) => k.top.filter((v) => v !== null));
      const bottoms = inks.flatMap((k) => k.bottom.filter((v) => v !== null));
      // Sideways extent of the ink, in document CSS px (columns are device px from x=0).
      const cols = inks.flatMap((k) => k.top.map((v, x) => (v === null ? null : x))).filter((x) => x !== null);
      const inkLeft = cols.length ? Math.min(...cols) / dsf : null;
      const inkRight = cols.length ? (Math.max(...cols) + 1) / dsf : null;
      // The START edge is where a line begins (right in Urdu). The end edge is
      // not checked: an ellipsis cuts the end on purpose.
      const startEdge = e.clip ? (e.rtl ? e.clip.right : e.clip.left) : null;
      const startClear = startEdge === null || inkLeft === null ? null
        : (e.rtl ? startEdge - inkRight : inkLeft - startEdge);
      const inkTop = tops.length ? Math.min(...tops) : null;
      const inkBottom = bottoms.length ? Math.max(...bottoms) : null;
      results.push({
        index: e.index, text: e.text, fontSize: em, lineHeight: e.lineHeight, lines: e.lines.length, gaps,
        boxClearTop: e.box && inkTop !== null ? toEm(inkTop - e.box.top, em) : null,
        boxClearBottom: e.box && inkBottom !== null ? toEm(e.box.bottom - inkBottom, em) : null,
        boxClips: e.box ? e.box.clips : false,
        selfClearTop: inkTop !== null ? toEm(inkTop - e.self.top, em) : null,
        selfClearBottom: inkBottom !== null ? toEm(e.self.bottom - inkBottom, em) : null,
        clips: e.self.clips,
        clipClearTop: e.clip && e.clip.top !== null && inkTop !== null ? toEm(inkTop - e.clip.top, em) : null,
        clipClearBottom: e.clip && e.clip.bottom !== null && inkBottom !== null ? toEm(e.clip.bottom - inkBottom, em) : null,
        clipClearStart: startClear === null ? null : toEm(startClear, em),
      });
    }
  } finally {
    await page.evaluate(clearInPage).catch(() => {});
  }
  return results;
}

/**
 * Ink of the LAST line of each `upperSelector` element against the FIRST line
 * of the matching `lowerSelector` element (a[i] over b[i]) — an eyebrow over a
 * stem, a stem over its first option. Gap in em of the LOWER element's size.
 */
async function measureStack(page, upperSelector, lowerSelector, { reach = 0.04 } = {}) {
  await ensureProbeCss(page);
  const dsf = await page.evaluate(() => window.devicePixelRatio || 1);
  try {
    const up = await page.evaluate(collectLinesInPage, { selector: upperSelector });
    const upper = [];
    for (const e of up) upper.push(e.lines.length ? await lineInk(page, dsf, e, e.lines.length - 1) : null);
    const low = await page.evaluate(collectLinesInPage, { selector: lowerSelector });
    const out = [];
    for (let i = 0; i < Math.min(up.length, low.length); i += 1) {
      const e = low[i];
      if (!upper[i] || !e.lines.length) { out.push(null); continue; }
      const lower = await lineInk(page, dsf, e, 0);
      out.push(toEm(minGap(upper[i], lower, Math.max(1, Math.round(reach * e.fontSize * dsf))), e.fontSize));
    }
    return out;
  } finally {
    await page.evaluate(clearInPage).catch(() => {});
  }
}

module.exports = { measureLines, measureStack };
