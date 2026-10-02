/**
 * Child-test stimulus — HTML for the child's cards, the printable card and the coach sheet
 * (bd-s1oo0.2). Pure: item-bank form in, HTML string out. The browser does the rest.
 *
 * What a CHILD sees carries no item numbers, no ids and no answers (design review §2b): the story
 * is connected text with its punctuation on the words (§2c), the made-up words, letters and
 * numbers are large items with nothing beside them. Questions and first sounds are oral — the
 * coach says them — so they are only on the coach sheet.
 *
 * Every story word is a <span class="w"> so the chat card can be split by rendered line in the
 * browser (window.__beforeCapture, below) and so a test can prove every token survives, in order.
 */

const { fontFaceCss, LATIN_STACK, URDU_STACK } = require('./fonts');
const S = require('./sizing');

const BLOCKS = ['urdu', 'english', 'maths'];
const ACCENT = { urdu: '#1E7A4E', english: '#2C5AA0', maths: '#B85A1B' };
const INK = '#111111';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function assertBlock(block) {
  if (!BLOCKS.includes(block)) throw new Error(`child-test render: unknown block "${block}" (expected ${BLOCKS.join('/')})`);
}

/** How a sum is PRINTED: a true minus (−) and times (×) sign, never a hyphen or an x. */
function mathsDisplay(prompt) {
  return String(prompt).replace(/(\d)\s*-\s*(?=\d)/g, '$1 − ').replace(/(\d)\s*[x*]\s*(?=\d)/g, '$1 × ');
}

function words(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

function storySpans(text) {
  return words(text).map((w) => `<span class="w">${esc(w)}</span>`).join(' ');
}

/** `G3-A`: the code printed on every card and read off the strip photo. */
function formCode(grade, code) {
  return `G${grade}-${code}`;
}

function need(form, block) {
  const b = form && form[block];
  if (!b) throw new Error(`child-test render: the form has no ${block} block`);
  return b;
}

/* ------------------------------------------------------------------ inline (WhatsApp) cards -- */

/**
 * Split items into cards by how many rows fit under the bubble-safe height. Rows are a fixed
 * height, so this is pure arithmetic; only the story needs the browser.
 */
function itemCards(items, { cols, fontPx, lineHeight, rowGap }) {
  const rowPx = fontPx * lineHeight + rowGap;
  const chrome = 12 + 26 + 30 + 34 + 24; // accent band + top pad + bottom pad + dots + dot gap
  const maxRows = Math.max(1, Math.floor((S.CARD_CSS_WIDTH * S.MAX_ASPECT - chrome) / rowPx));
  const rows = Math.ceil(items.length / cols);
  const nCards = Math.ceil(rows / maxRows);
  // balanced by rows: the first (rows % nCards) cards take one row more, never a lonely last row
  const base = Math.floor(rows / nCards);
  const extra = rows % nCards;
  const out = [];
  let at = 0;
  for (let c = 0; c < nCards; c++) {
    const take = (base + (c < extra ? 1 : 0)) * cols;
    out.push(items.slice(at, at + take));
    at += take;
  }
  return out.filter((x) => x.length);
}

function gridCard(part, items, { cols, fontPx, lineHeight, rowGap, script }) {
  const fam = script === 'urdu' ? URDU_STACK : LATIN_STACK;
  const cells = items.map((t) => `<div class="it">${esc(t)}</div>`).join('');
  return `<div class="card" data-part="${part}"><div class="band"></div>`
    + `<div class="grid" style="grid-template-columns:repeat(${cols},1fr);font-family:${fam};font-size:${fontPx}px;line-height:${lineHeight};row-gap:${rowGap}px">${cells}</div>`
    + '<div class="dots"></div></div>';
}

function inlineParts({ grade, block, form, variant }) {
  const b = need(form, block);
  const parts = []; // { part, items, layout } — the story is handled separately
  const urdu = block === 'urdu';
  const script = urdu ? 'urdu' : 'latin';
  const lh = urdu ? 1.9 : 1.35;
  if (variant === 'fallback') {
    if (!b.fallback) throw new Error(`child-test render: ${block} has no fallback lists`);
    parts.push({ part: 'fallback_letters', items: b.fallback.letters, layout: { cols: 5, fontPx: S.fontPx(grade, block, 'letters'), lineHeight: lh, rowGap: 18, script } });
    parts.push({ part: 'fallback_words', items: b.fallback.words, layout: { cols: 2, fontPx: S.fontPx(grade, block, 'words'), lineHeight: lh, rowGap: 14, script } });
    return parts;
  }
  if (block === 'maths') {
    parts.push({ part: 'numbers', items: b.numbers.map((n) => String(n.value)), layout: { cols: 3, fontPx: S.fontPx(grade, block, 'numbers'), lineHeight: 1.3, rowGap: 24, script: 'latin' } });
    parts.push({ part: 'quick_sums', items: b.quick_sums.map((q) => mathsDisplay(q.prompt)), layout: { cols: 2, fontPx: S.fontPx(grade, block, 'sums'), lineHeight: 1.3, rowGap: 22, script: 'latin' } });
    return parts;
  }
  if (b.nonwords && b.nonwords.length) {
    parts.push({ part: 'nonwords', items: b.nonwords.map((n) => n.text), layout: { cols: urdu ? 3 : 2, fontPx: S.fontPx(grade, block, 'words'), lineHeight: lh, rowGap: 16, script } });
  }
  return parts;
}

const INLINE_CSS = (urdu) => `
html,body{margin:0;padding:0;background:#fff}
body{width:${S.CARD_CSS_WIDTH}px}
.card{width:${S.CARD_CSS_WIDTH}px;box-sizing:border-box;background:#fff;color:${INK};padding:0 26px 0;margin:0 0 16px;position:relative}
.band{height:12px;margin:0 -26px 26px;background:var(--accent)}
.t{font-family:${urdu ? URDU_STACK : LATIN_STACK};text-align:${urdu ? 'right' : 'left'};word-spacing:${urdu ? '0.12em' : '0.06em'};margin:0;${urdu ? 'padding:0 16px 0 8px;' : ''}}
.grid{display:grid;column-gap:${urdu ? '40px' : '18px'};text-align:center;align-items:center}
.it{white-space:nowrap;direction:${urdu ? 'rtl' : 'ltr'};min-width:0}
.grid .it{unicode-bidi:isolate}
.dots{height:34px;padding:${urdu ? '34px' : '18px'} 0 30px;font:22px/34px ${LATIN_STACK};color:#9AA0A6;text-align:center;letter-spacing:6px;direction:ltr}
.dots b{color:var(--accent);font-weight:400}
#src{position:absolute;left:0;top:0;visibility:hidden}
`;

/**
 * In-page: split the story source into chat cards by RENDERED line (balanced so the last card is
 * not a single line), then fill every card's progress dots. Runs after the fonts are loaded.
 */
const CHUNK_SCRIPT = `
window.__beforeCapture = async function () {
  var src = document.getElementById('src');
  var out = { storyCards: 0, storyLines: 0 };
  if (src) {
    var maxLines = Number(src.getAttribute('data-max-lines')) || 4;
    var lh = parseFloat(getComputedStyle(src).lineHeight);
    var spans = Array.prototype.slice.call(src.querySelectorAll('span.w'));
    var lines = [], top = null;
    spans.forEach(function (s) {
      var t = s.getBoundingClientRect().top;
      if (top === null || t > top + lh / 2) { lines.push([]); top = t; }
      lines[lines.length - 1].push(s.textContent);
    });
    // balanced: n cards, the first (lines % n) of them one line longer
    var n = Math.ceil(lines.length / maxLines);
    var base = Math.floor(lines.length / n), extra = lines.length % n, at = 0;
    var anchor = document.getElementById('story-anchor');
    for (var c = 0; c < n; c++) {
      var take = base + (c < extra ? 1 : 0);
      var chunk = lines.slice(at, at + take);
      at += take;
      var text = chunk.map(function (l) { return l.join(' '); }).join(' ');
      var card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('data-part', 'story');
      card.setAttribute('data-lines', String(chunk.length));
      card.setAttribute('data-text', text);
      var p = document.createElement('p');
      p.className = 't';
      p.setAttribute('style', src.getAttribute('style'));
      p.innerHTML = chunk.map(function (l) {
        return l.map(function (w) { var e = document.createElement('span'); e.className = 'w'; e.textContent = w; return e.outerHTML; }).join(' ');
      }).join(' ');
      card.innerHTML = '<div class="band"></div>';
      card.appendChild(p);
      var d = document.createElement('div'); d.className = 'dots'; card.appendChild(d);
      anchor.parentNode.insertBefore(card, anchor);
      out.storyCards++;
    }
    out.storyLines = lines.length;
    src.parentNode.removeChild(src);
  }
  // an item wider than its column would be cut off at the card edge: shrink that part's type
  // (every card of the part by the same factor, so they stay one size) until all items fit
  var parts = {};
  document.querySelectorAll('.card .grid').forEach(function (g) {
    var part = g.parentNode.getAttribute('data-part');
    (parts[part] = parts[part] || []).push(g);
  });
  out.shrunk = {};
  Object.keys(parts).forEach(function (part) {
    var grids = parts[part], scale = 1;
    var base = parseFloat(grids[0].style.fontSize);
    function fits() {
      return grids.every(function (g) {
        return Array.prototype.every.call(g.children, function (it) { return it.scrollWidth <= it.clientWidth + 1; });
      });
    }
    while (!fits() && scale > 0.5) {
      scale = Math.round((scale - 0.04) * 100) / 100;
      grids.forEach(function (g) { g.style.fontSize = (base * scale) + 'px'; });
    }
    if (scale < 1) out.shrunk[part] = scale;
  });
  var cards = document.querySelectorAll('.card');
  cards.forEach(function (c, i) {
    var dots = c.querySelector('.dots');
    if (!dots) return;
    var h = '';
    for (var k = 0; k < cards.length; k++) h += k === i ? '<b>\\u25CF</b>' : '\\u25CB';
    dots.innerHTML = h;
  });
  return out;
};
`;

/**
 * The chat cards for one block, as one HTML page: the story source (split in the browser), then
 * the item cards.
 * @param {{grade:number, formCode:string, block:'urdu'|'english'|'maths', form:object, variant?:'main'|'fallback'}} a
 */
function buildInlineHtml({ grade, formCode: code, block, form, variant = 'main' }) {
  assertBlock(block);
  const urdu = block === 'urdu';
  const lang = urdu ? 'ur' : 'en';
  let story = '';
  if (variant === 'main' && block !== 'maths') {
    const b = need(form, block);
    if (!b.story || !b.story.text) throw new Error(`child-test render: ${block} story text missing`);
    const px = S.fontPx(grade, block, 'story');
    const lh = urdu ? S.LINE_HEIGHT.urdu : S.LINE_HEIGHT.latin;
    // Nastaliq swashes (گ ک) reach past the line box at the line start: Urdu gets a side gutter
    const width = S.CARD_CSS_WIDTH - 52 - (urdu ? 24 : 0);
    story = `<p id="src" class="t" data-max-lines="${S.STORY_LINES[grade][block]}" style="font-size:${px}px;line-height:${lh};width:${width}px">${storySpans(b.story.text)}</p>`;
  }
  const cards = inlineParts({ grade, block, form, variant })
    .flatMap((p) => itemCards(p.items, p.layout).map((items) => gridCard(p.part, items, p.layout)))
    .join('');
  return `<!doctype html><html dir="${urdu ? 'rtl' : 'ltr'}" lang="${lang}"><head><meta charset="utf-8">`
    + `<style>${fontFaceCss({ latin: true, urdu })}${INLINE_CSS(urdu)}:root{--accent:${ACCENT[block]}}</style></head>`
    + `<body data-form="${esc(formCode(grade, code))}" data-block="${block}" data-variant="${variant}">${story}<div id="story-anchor"></div>${cards}`
    + `<script>${CHUNK_SCRIPT}</script></body></html>`;
}

/* ------------------------------------------------------------------------ printable A4 card -- */

const PRINT_TYPE = { // pt, before auto-fit
  3: { story: { english: 24, urdu: 25 }, words: { english: 30, urdu: 30 }, letters: 34, numbers: 40, sums: 24 },
  5: { story: { english: 19, urdu: 20 }, words: { english: 26, urdu: 26 }, letters: 30, numbers: 36, sums: 22 },
};

const PRINT_CSS = `
@page{size:A4;margin:0}
html,body{margin:0;padding:0;background:#fff;color:${INK}}
.page{width:210mm;height:297mm;box-sizing:border-box;padding:16mm 16mm 14mm;position:relative;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column;--s:1}
.page:last-child{page-break-after:auto;break-after:auto}
.edge{position:absolute;top:0;bottom:0;width:5mm;background:var(--accent)}
.page[dir=rtl] .edge{right:0}.page[dir=ltr] .edge{left:0}
.fit{flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column;gap:calc(var(--s)*9mm)}
.story{margin:0;text-align:start}
.story.ur{font-family:${URDU_STACK};line-height:2.05;word-spacing:.1em}
.story.en{font-family:${LATIN_STACK};line-height:1.55;word-spacing:.05em}
.rule{border:0;border-top:.6mm dashed #C9CDD2;margin:0}
.grid{display:grid;column-gap:8mm;row-gap:calc(var(--s)*5mm);text-align:center;align-items:center}
.grid .it{white-space:nowrap;unicode-bidi:isolate}
.ur{font-family:${URDU_STACK}}.en{font-family:${LATIN_STACK}}
.foot{position:absolute;bottom:6mm;font:9pt/1 ${LATIN_STACK};color:#9AA0A6;direction:ltr}
.page[dir=rtl] .foot{left:16mm}.page[dir=ltr] .foot{right:16mm}
.sub{font:11pt/1.4 ${LATIN_STACK};color:#9AA0A6}
.sub.ur{font-family:${URDU_STACK};line-height:2}
/* maths strip */
.strip{padding:14mm 18mm}
.fid{position:absolute;width:9mm;height:9mm;background:#000}
.fid.tl{top:6mm;left:6mm}.fid.tr{top:6mm;right:6mm}.fid.bl{bottom:6mm;left:6mm}.fid.br{bottom:6mm;right:6mm}
.code{position:absolute;top:6mm;right:20mm;font:700 26pt/1 ${LATIN_STACK};border:.8mm solid #000;padding:2mm 4mm;direction:ltr;letter-spacing:.04em}
.roll{display:flex;gap:4mm;align-items:center;font:14pt/1 ${LATIN_STACK};margin:12mm 0 8mm;direction:ltr}
.roll .ur{font-size:14pt;line-height:1.6}
.roll .blank{flex:0 0 55mm;height:11mm;border:.5mm solid #000;border-radius:2mm}
.sums{display:grid;grid-template-columns:1fr 1fr;gap:8mm;direction:ltr}
.sum{border:.5mm solid #6B7280;border-radius:3mm;height:52mm;padding:5mm 6mm;box-sizing:border-box;font:32pt/1.2 ${LATIN_STACK}}
.wp{margin-top:9mm;border:.5mm solid #6B7280;border-radius:3mm;padding:5mm 6mm;display:flex;flex-direction:column;gap:3mm}
.wp .ur{font-size:19pt;line-height:2;text-align:right;direction:rtl}
.wp .en{font-size:15pt;line-height:1.45;direction:ltr}
.ans{display:flex;gap:4mm;align-items:center;justify-content:flex-end;direction:ltr;margin-top:2mm}
.ans .box{width:42mm;height:20mm;border:.6mm solid #000;border-radius:2mm}
.work{flex:1;min-height:40mm}
`;

/** In-page: size each page's type (CSS --s) from 1.6x down until nothing overflows, floor 0.7. */
const FIT_SCRIPT = `
window.__beforeCapture = async function () {
  var overflow = [], scales = {};
  document.querySelectorAll('.page').forEach(function (pg) {
    var fit = pg.querySelector('.fit');
    var s = 1;
    if (fit) {
      // start large and come down: large print is the point of a printed card
      s = 1.6; pg.style.setProperty('--s', s);
      while (fit.scrollHeight > fit.clientHeight + 1 && s > 0.7) { s = Math.round((s - 0.03) * 100) / 100; pg.style.setProperty('--s', s); }
      if (fit.scrollHeight > fit.clientHeight + 1) overflow.push(pg.getAttribute('data-page'));
    }
    scales[pg.getAttribute('data-page')] = s;
  });
  return { overflow: overflow, scales: scales, pages: document.querySelectorAll('.page').length };
};
`;

const pt = (n) => `calc(var(--s)*${n}pt)`;

function printGrid(items, { cols, size, cls }) {
  return `<div class="grid ${cls}" style="grid-template-columns:repeat(${cols},1fr);font-size:${pt(size)}">`
    + items.map((t) => `<div class="it">${esc(t)}</div>`).join('') + '</div>';
}

function langPage(grade, code, block, form) {
  const b = need(form, block);
  const urdu = block === 'urdu';
  const T = PRINT_TYPE[grade];
  const cls = urdu ? 'ur' : 'en';
  const nw = b.nonwords && b.nonwords.length
    ? `<hr class="rule">${printGrid(b.nonwords.map((n) => n.text), { cols: urdu ? 3 : 4, size: T.words[block], cls })}`
    : '';
  return `<section class="page" data-page="${block}" dir="${urdu ? 'rtl' : 'ltr'}" lang="${urdu ? 'ur' : 'en'}" style="--accent:${ACCENT[block]}">`
    + '<div class="edge"></div><div class="fit">'
    + `<p class="story ${cls}" style="font-size:${pt(T.story[block])}">${storySpans(b.story.text)}</p>${nw}</div>`
    + `<div class="foot">${esc(formCode(grade, code))} · ${urdu ? 'Urdu' : 'English'}</div></section>`;
}

function mathsPage(grade, code, form) {
  const m = need(form, 'maths');
  const T = PRINT_TYPE[grade];
  return `<section class="page" data-page="maths" dir="ltr" lang="en" style="--accent:${ACCENT.maths}">`
    + '<div class="edge"></div><div class="fit">'
    + printGrid(m.numbers.map((n) => String(n.value)), { cols: 4, size: T.numbers, cls: 'en' })
    + '<hr class="rule">'
    + printGrid(m.quick_sums.map((q) => mathsDisplay(q.prompt)), { cols: 4, size: T.sums, cls: 'en' })
    + `</div><div class="foot">${esc(formCode(grade, code))} · Maths</div></section>`;
}

function fallbackPage(grade, code, form) {
  const T = PRINT_TYPE[grade];
  const u = need(form, 'urdu').fallback;
  const e = need(form, 'english').fallback;
  if (!u || !e) throw new Error('child-test render: fallback lists missing');
  return `<section class="page" data-page="fallback" dir="ltr" lang="en" style="--accent:#6B7280">`
    + '<div class="edge"></div><div class="fit">'
    + `<div dir="rtl">${printGrid(u.letters, { cols: 5, size: T.letters, cls: 'ur' })}</div>`
    + `<div dir="rtl">${printGrid(u.words, { cols: 5, size: T.words.urdu - 4, cls: 'ur' })}</div>`
    + '<hr class="rule">'
    + printGrid(e.letters, { cols: 5, size: T.letters, cls: 'en' })
    + printGrid(e.words, { cols: 5, size: T.words.english - 6, cls: 'en' })
    + `</div><div class="foot">${esc(formCode(grade, code))} · Letters / Words</div></section>`;
}

/**
 * The page the child writes on and the coach photographs. Four black corner squares let the
 * vision model square the photo up; the form code in the corner says which answer key applies.
 * A roll-number blank, not a name blank: the photo goes to a vision model, and no child's name
 * may go into a model prompt (PLAN §8).
 */
function stripPage(grade, code, form) {
  const m = need(form, 'maths');
  if (!m.written || m.written.length !== 4) throw new Error('child-test render: the maths strip needs exactly 4 written sums');
  const wp = m.word_problem;
  if (!wp) throw new Error('child-test render: the maths strip needs a word problem');
  const sums = m.written.map((w) => `<div class="sum"><div>${esc(mathsDisplay(w.prompt))}</div></div>`).join('');
  return `<section class="page strip" data-page="maths-strip" dir="ltr" lang="ur" data-code="${esc(formCode(grade, code))}">`
    + '<div class="fid tl"></div><div class="fid tr"></div><div class="fid bl"></div><div class="fid br"></div>'
    + `<div class="code">${esc(formCode(grade, code))}</div>`
    + '<div class="roll"><span class="ur" dir="rtl">رول نمبر</span><span>Roll no.</span><span class="blank" data-field="roll"></span></div>'
    + `<div class="sums">${sums}</div>`
    + '<div class="wp">'
    + `<div class="ur" dir="rtl">${esc(wp.prompt_ur)}</div>`
    + `<div class="en">${esc(wp.prompt_en)}</div>`
    + '<div class="work"></div>'
    + '<div class="ans"><span class="ur" dir="rtl" style="font-size:16pt;line-height:1.8">جواب</span><span class="box" data-field="wp-answer"></span></div>'
    + '</div></section>';
}

/** Five A4 pages: Urdu, English, Maths, the fallback letters/words, the maths strip. */
function buildPrintableHtml({ grade, formCode: code, form }) {
  if (!PRINT_TYPE[grade]) throw new Error(`child-test render: no print scale for grade ${grade}`);
  const pages = [
    langPage(grade, code, 'urdu', form),
    langPage(grade, code, 'english', form),
    mathsPage(grade, code, form),
    fallbackPage(grade, code, form),
    stripPage(grade, code, form),
  ].join('');
  return `<!doctype html><html lang="ur"><head><meta charset="utf-8"><style>${fontFaceCss({ latin: true, urdu: true, bold: true })}${PRINT_CSS}</style></head>`
    + `<body data-form="${esc(formCode(grade, code))}" data-audience="child">${pages}<script>${FIT_SCRIPT}</script></body></html>`;
}

/* ------------------------------------------------------------------------------ coach sheet -- */

const CHROME = {
  en: {
    title: 'Coach copy — do not show the child',
    urdu: 'Urdu', english: 'English', maths: 'Maths',
    story: 'Story — word numbers', questions: 'Questions (say aloud)', accept: 'accept', reject: 'do not accept',
    firstSounds: 'First sounds (say the word; the child says its first sound)', nonwords: 'Made-up words',
    fallback: 'If the child cannot read the first line: letters, then words',
    numbers: 'Numbers (stop after 4 wrong in a row)', quickSums: 'Quick sums (60 seconds)', written: 'Written strip', wordProblem: 'Word problem',
    answer: 'answer', words: 'words',
  },
  ur: {
    title: 'کوچ کی کاپی — بچے کو نہ دکھائیں',
    urdu: 'اردو', english: 'انگریزی', maths: 'ریاضی',
    story: 'کہانی — الفاظ کے نمبر', questions: 'سوالات (زبانی پوچھیں)', accept: 'درست', reject: 'درست نہیں',
    firstSounds: 'پہلی آواز (لفظ آپ بولیں، بچہ پہلی آواز بتائے)', nonwords: 'بنائے ہوئے الفاظ',
    fallback: 'اگر بچہ پہلی سطر نہ پڑھ سکے: پہلے حروف، پھر الفاظ',
    numbers: 'اعداد (لگاتار 4 غلط پر رک جائیں)', quickSums: 'فوری جمع تفریق (60 سیکنڈ)', written: 'لکھنے والی پٹی', wordProblem: 'عبارتی سوال',
    answer: 'جواب', words: 'الفاظ',
  },
};

const COACH_CSS = `
@page{size:A4;margin:12mm}
html,body{margin:0;background:#fff;color:${INK};font:10.5pt/1.45 ${LATIN_STACK}}
body[dir=rtl]{font-family:${URDU_STACK};line-height:1.9}
h1{font-size:15pt;margin:0 0 4mm;padding:2mm 3mm;background:#FDECEC;border-inline-start:2mm solid #B42318}
h2{font-size:12.5pt;margin:5mm 0 2mm;border-bottom:.4mm solid #D0D5DD;padding-bottom:1mm}
h3{font-size:10.5pt;margin:3mm 0 1mm;color:#475467}
.ur{font-family:${URDU_STACK};line-height:1.9;direction:rtl}.en{font-family:${LATIN_STACK};line-height:1.45;direction:ltr}
.ltr{direction:ltr;unicode-bidi:isolate}
.nums{display:grid;grid-template-columns:repeat(auto-fill,minmax(24mm,1fr));gap:1mm 2mm;margin:1mm 0}
.nums.sums{grid-template-columns:repeat(auto-fill,minmax(30mm,1fr))}
.nums div{border:.3mm solid #E4E7EC;padding:.5mm 1mm;white-space:nowrap}
.nums i{font-style:normal;color:#98A2B3;font-family:${LATIN_STACK};font-size:7.5pt;margin-inline-end:1mm;direction:ltr;unicode-bidi:isolate}
table{border-collapse:collapse;width:100%;margin:1mm 0}
td,th{border:.3mm solid #E4E7EC;padding:.8mm 1.6mm;vertical-align:top;text-align:start}
th{background:#F9FAFB;font-weight:700}
.k{color:#067647;font-weight:700}.x{color:#B42318}
`;

function coachNumbered(tokens, cls, dir) {
  return `<div class="nums ${cls}" dir="${dir}">` + tokens.map((t, i) => `<div><i>${i + 1}</i>${esc(t)}</div>`).join('') + '</div>';
}

function coachLang(block, b, C) {
  const urdu = block === 'urdu';
  const cls = urdu ? 'ur' : 'en';
  const dir = urdu ? 'rtl' : 'ltr';
  const rows = (b.questions || []).map((q, i) => `<tr><td class="ltr">${i + 1}</td><td class="${cls}" dir="${dir}">${esc(q.prompt)}</td>`
    + `<td class="${cls}" dir="${dir}"><span class="k">${esc((q.accept || []).join(' / '))}</span>${q.reject && q.reject.length ? ` · <span class="x">${C.reject}: ${esc(q.reject.join(' / '))}</span>` : ''}</td></tr>`).join('');
  const fs = (b.first_sounds || []).map((f, i) => `<tr><td class="ltr">${i + 1}</td><td class="${cls}" dir="${dir}">${esc(f.word)}</td><td class="${cls} k" dir="${dir}">${esc(f.sound)}</td></tr>`).join('');
  const nw = (b.nonwords || []).map((n, i) => `<tr><td class="ltr">${i + 1}</td><td class="${cls}" dir="${dir}">${esc(n.text)}</td><td class="${cls}" dir="${dir}">${esc((n.sounds || []).join(' · '))}</td></tr>`).join('');
  return `<section dir="${dir}"><h2>${C[block]}</h2>`
    + `<h3>${C.story} (${b.story.tokens.length} ${C.words})</h3>${coachNumbered(b.story.tokens, cls, dir)}`
    + (rows ? `<h3>${C.questions}</h3><table>${rows}</table>` : '')
    + (fs ? `<h3>${C.firstSounds}</h3><table>${fs}</table>` : '')
    + (nw ? `<h3>${C.nonwords}</h3><table>${nw}</table>` : '')
    + (b.fallback ? `<h3>${C.fallback}</h3>${coachNumbered(b.fallback.letters, cls, dir)}${coachNumbered(b.fallback.words, cls, dir)}` : '')
    + '</section>';
}

/**
 * The coach's copy: every item numbered, with its answer key. Never sent to a child.
 * @param {{grade:number, formCode:string, form:object, lang?:'ur'|'en'}} a
 */
function buildCoachSheetHtml({ grade, formCode: code, form, lang = 'ur' }) {
  const C = CHROME[lang];
  if (!C) throw new Error(`child-test render: coach sheet has no "${lang}" strings`);
  const m = need(form, 'maths');
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const nums = m.numbers.map((n, i) => `<tr><td class="ltr">${i + 1}</td><td class="ltr k">${esc(n.value)}</td><td class="ur" dir="rtl">${esc(n.say_ur)}</td><td class="en">${esc(n.say_en)}</td></tr>`).join('');
  const qs = `<div class="nums sums en" dir="ltr">${m.quick_sums.map((q, i) => `<div><i>${i + 1}</i>${esc(q.prompt)} = <b class="k">${esc(q.answer)}</b></div>`).join('')}</div>`;
  const wr = m.written.map((w, i) => `<tr><td class="ltr">${i + 1}</td><td class="ltr">${esc(w.prompt)}</td><td class="ltr k">${esc(w.answer)}</td></tr>`).join('');
  const wp = m.word_problem;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${fontFaceCss({ latin: true, urdu: true, bold: true })}${COACH_CSS}</style></head>`
    + `<body dir="${dir}" data-audience="coach" data-form="${esc(formCode(grade, code))}">`
    + `<h1>${C.title} · <span class="ltr">${esc(formCode(grade, code))}</span></h1>`
    + coachLang('urdu', need(form, 'urdu'), C)
    + coachLang('english', need(form, 'english'), C)
    + `<section dir="${dir}"><h2>${C.maths}</h2><h3>${C.numbers}</h3><table dir="ltr">${nums}</table>`
    + `<h3>${C.quickSums}</h3>${qs}`
    + `<h3>${C.written}</h3><table dir="ltr">${wr}</table>`
    + `<h3>${C.wordProblem}</h3><table><tr><td class="ur" dir="rtl">${esc(wp.prompt_ur)}</td><td class="en">${esc(wp.prompt_en)}</td><td class="k">${C.answer}: <span class="ltr">${esc(wp.answer)}</span></td></tr></table></section>`
    + '</body></html>';
}

module.exports = {
  BLOCKS, mathsDisplay, buildInlineHtml, buildPrintableHtml, buildCoachSheetHtml, formCode, itemCards, esc, CHROME,
};
