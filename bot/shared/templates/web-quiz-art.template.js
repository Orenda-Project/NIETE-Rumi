'use strict';
/**
 * THE PICTURES A CHILD'S SHARE CARRIES (web quiz): my card, my class, my
 * school's place on the board, and the invite to beat my score.
 *
 * One template, four kinds, two sizes:
 *
 *   og  1200×630    the link preview. WhatsApp shows a ~1.91:1 og:image as the
 *                   big picture above the message; a square one shrinks to a
 *                   thumbnail beside it. This is the GUARANTEED path: it
 *                   arrives whenever the link does, even where the page cannot
 *                   attach a file.
 *   sq  1080×1080   the attached file, where the browser can share one. A
 *                   square fills a chat bubble without a crop.
 *
 * Rendered headless (htmlToImage) on a container with no fonts, so every face
 * is embedded and the stars are SVG, never a typed glyph. The chrome speaks the
 * QUIZ's language; a name or a topic keeps the script it was written in
 * (scriptOf), so "Amal" in an Urdu card is an LTR run and an Urdu topic in an
 * English card is Nastaliq. Numbers are one isolated LTR run in both.
 *
 * Privacy: the only child named on any picture is the child sharing it. The
 * class picture is numbers (played, average, top score); the school picture
 * names schools, never a teacher, a class or a child.
 *
 * Copy is a local, complete en/ur dictionary (the report templates' CHROME
 * pattern): these words are drawn into a picture, never sent as a message.
 */
const fs = require('fs');
const path = require('path');
const WebQuizBrand = require('../config/web-quiz-brand');
const { NASTALIQ, scriptOf } = require('./niete-brand');
const { clampLanguage } = require('../config/ux-strings');

const SIZES = Object.freeze({ og: [1200, 630], sq: [1080, 1080] });
const KINDS = ['card', 'invite', 'class', 'school'];
// The page's animals (web-quiz-token ANIMALS), drawn from SVG: the renderer has no emoji font.
const ANIMAL_KEYS = ['cat', 'dog', 'rabbit', 'parrot', 'fish', 'turtle', 'lion', 'elephant', 'owl', 'butterfly', 'bee', 'horse', 'star'];

const COPY = {
  en: {
    my: 'My score',
    playSame: 'Play the same quiz',
    chal: 'A challenge for you',
    beat: (n, score) => `Can you beat ${n}'s ${score}?`,
    dared: (n) => `${n} challenged you!`,
    // the headline under web_quiz_share_pic_polish: the score held to the name, "you!" to its verb (no lone last word)
    beatKeep: (n, score) => `Can you beat ${n}'s\u00a0${score}?`,
    daredKeep: (n) => `${n} challenged\u00a0you!`,
    scored: (n, s, t) => `${n} scored ${s} on ${t}`,
    tapPlay: 'Tap the link to play',
    // the pill under web_quiz_share_ur_stack (English keeps its words)
    openPlay: 'Tap the link to play',
    // the friend's door, where the picture sits under the real Play button (the friend is already on the link)
    yourTurn: 'Your turn!',
    played: 'played',
    playedOf: (n, of) => `${n} of ${of} played`,
    me: 'me',
    added: (n, sc) => `${n} points for ${sc}`,
    avg: 'Class average',
    avgLine: (p) => `Class average ${p}`,
    top: 'Top score',
    notYet: 'Not played yet? Same link, still open.',
    school: 'School points · this week',
    pts: 'points',
    kids: 'kids',
    rule: '10 points for playing, up to 10 for your score',
  },
  ur: {
    my: 'میرا اسکور',
    playSame: 'یہی کوئز کھیلیں',
    chal: 'آپ کے لیے چیلنج',
    // Imperative, never «آپ … سکتے ہیں» (masculine): the friend's gender is not ours to guess.
    beat: (n, score) => `${n} کے ${score} سے آگے نکلیں!`,
    dared: (n) => `${n} نے آپ کو چیلنج کیا ہے!`,
    scored: (n, s, t) => `${n} نے ${t} میں ${s} لیے`,
    tapPlay: 'لنک پر ٹیپ کریں اور کھیلیں',
    // the pill under web_quiz_share_ur_stack: the share words' own «کھولیں», no «ٹیپ»
    openPlay: 'لنک کھولیں اور کھیلیں',
    yourTurn: 'آپ کی باری!',
    played: 'بچوں نے کھیلا',
    playedOf: (n, of) => `${of} میں سے ${n} بچوں نے کھیلا`,
    me: 'میں',
    added: (n, sc) => `${sc} کے لیے ${n} پوائنٹس`,
    avg: 'کلاس کی اوسط',
    avgLine: (p) => `کلاس کی اوسط ${p}`,
    top: 'سب سے زیادہ',
    notYet: 'ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے۔',
    school: 'اسکول پوائنٹس · اس ہفتے',
    pts: 'پوائنٹس',
    kids: 'بچے',
    rule: 'کھیلنے کے 10 پوائنٹس، اسکور کے 10 تک',
  },
};

let _assets = null;
function readBase64(rel) {
  try {
    const abs = path.join(__dirname, '..', rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch { return ''; }
}
function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
      celebrate: readBase64('assets/wq-art/celebrate.webp'),
      hello: readBase64('assets/wq-art/hello.webp'),
      animals: Object.fromEntries(ANIMAL_KEYS.map((k) => [k, readBase64(`assets/wq-art/animals/${k}.svg`)])),
    };
  }
  return _assets;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Text somebody wrote, in its own script and direction, isolated from the line around it (cls: its own class). */
function own(text, cls = '') {
  const t = String(text == null ? '' : text);
  return `<bdi${cls ? ` class="${cls}"` : ''} dir="${scriptOf(t) === 'ur' ? 'rtl' : 'ltr'}">${esc(t)}</bdi>`;
}
/** A name or a title written in the Urdu (Arabic) script: its own sizes and line height, whatever the picture's language. */
const isArabicScript = (text) => scriptOf(text) === 'ur';
function animal(key, pics) {
  const a = pics ? assets().animals[ANIMAL_KEYS.includes(key) ? key : 'star'] : '';
  return a ? `<img class="ani" src="data:image/svg+xml;base64,${a}" alt="">` : '<span class="ani"></span>';
}
const num = (s) => `<span class="num">${esc(s)}</span>`;
// An Urdu picture under web_quiz_share_ur_digits: the page's numerals (۴/۷), never 4/7. Only the digits change.
// a thousands comma between digits becomes the Arabic thousands sign «٬» (۱٬۲۳۴, never 1,۲۳۴)
const urDigits = (s) => String(s == null ? '' : s).replace(/(\d),(?=\d)/g, '$1\u066C').replace(/[0-9]/g, (c) => String.fromCharCode(0x06F0 + Number(c)));
const numUr = (s) => num(urDigits(s));
const DOT = '<span class="dot"> · </span>';
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';
function starsHtml(lit, total) {
  const n = Math.max(0, Math.min(20, Number(total) || 0));
  const on = Math.max(0, Math.min(n, Number(lit) || 0));
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += `<svg class="star${i < on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}"/></svg>`;
  }
  return `<div class="stars">${out}</div>`;
}

/** At most n rows, the viewer's school kept in the middle where the list allows. */
function around(rows, n) {
  if (rows.length <= n) return rows;
  const i = Math.max(0, rows.findIndex((r) => r.you));
  const from = Math.max(0, Math.min(rows.length - n, i - Math.floor(n / 2)));
  return rows.slice(from, from + n);
}

// The class table's rows under the one stack (web_quiz_share_ur_stack): the top rows, at most `cap`, and the child's own
// row always; when rows were left out before it, a «…» row marks the gap.
function topWithMe(rows, cap) {
  const i = rows.findIndex((r) => r.me);
  if (rows.length <= cap || i < cap) return rows.slice(0, cap);
  return [...rows.slice(0, cap - 1), { gap: true }, rows[i]];
}
// How many rows the class table's square holds under the one stack, from the drawn heights: 1080 less its padding (112),
// the brand (70), the title line (67), the count (130), the average (104), the pill (62), five 24 px gaps and a «…» row
// with its gap (47), in rows of 62 px with 10 px between: 5. The wide picture keeps its 3.
const CLASS_ROWS_SQ = Math.floor((1080 - 112 - 70 - 67 - 130 - 104 - 62 - 5 * 24 - 47 + 10) / (62 + 10));

// pp: the polish (web_quiz_share_pic_polish), null when off: { cap } the class table's rows, { title, nb } the challenge's
// sub line as the quiz title alone (nb: its spaces held, so it stays on one line).
function body(kind, d, C, pics, size, ur2 = false, og2 = false, door = false, ud = false, us = false, pp = null) {
  const N = ud ? numUr : num;
  // In Nastaliq the middle dot is the Urdu zero: «۱۵ · بچے» reads ۱۵۰. Beside Urdu digits the Urdu comma separates.
  const SEP = ud ? '<span class="dot">، </span>' : DOT;
  // native read: «۶۴ فیصد» (a % beside Urdu digits lands on the wrong side), and no "+" against «پوائنٹس»
  const PCT = (p) => (ud ? `${N(p)} فیصد` : N(`${p}%`));
  const PLUS = (n) => N(ud ? n : `+${n}`);
  const pic = (name) => (pics && assets()[name] ? `<img class="jug" src="data:image/webp;base64,${assets()[name]}" alt="">` : '<div class="jug"></div>');
  if (kind === 'card') {
    return {
      pic: pic('celebrate'),
      main: `${og2 ? '' : `<p class="kick">${esc(C.my)}${d.cls ? `${SEP}${own(d.cls)}` : ''}</p>`}`
        + `<h1 class="name">${d.animal ? animal(d.animal, pics) : ''}${own(d.first)}</h1>`
        + `<p class="big">${N(`${d.correct}/${d.total}`)}</p>${starsHtml(d.correct, d.total)}`
        + `<p class="sub">${own(d.topic)}</p>`
        // under the Urdu polish the school sits on its own line under the points: a Latin school name never breaks an Urdu sentence
        + (d.school && d.added ? `<p class="pts">${ur2 ? `${PLUS(d.added)} ${esc(C.pts)}<span class="sch">${own(d.school)}</span>` : C.added(PLUS(d.added), own(d.school))}</p>` : (d.school ? `<p class="pts">${own(d.school)}</p>` : '')),
      cta: d.school ? '' : C.playSame,
    };
  }
  if (kind === 'invite') {
    const score = `${d.correct}/${d.total}`;
    // A challenger who scored nothing is never a score to beat, and a zero is never shown off.
    const zero = !(Number(d.correct) > 0);
    return {
      pic: pic('hello'),
      main: `${og2 ? '' : `<p class="kick">${esc(C.chal)}</p>`}`
        // the polish's cut (pp.cut): the name in its own box that shortens, held with the score after it, which never is
        + `<h1 class="head">${pp && pp.cut
          ? (zero ? C.dared(own(pp.cut.text || d.first, 'nm')) : `${C.beat(`<span class="keep">${own(pp.cut.text || d.first, 'nm')}`, N(score))}</span>`)
          : (zero ? C.dared(own(d.first)) : C.beat(own(d.first), N(score)))}</h1>`
        + (pp && pp.title ? `<p class="sub">${own(pp.nb ? String(d.topic == null ? '' : d.topic).replace(/ /g, '\u00a0') : d.topic)}</p>${zero ? '' : starsHtml(d.correct, d.total)}`
          : (zero ? `<p class="sub">${own(d.topic)}</p>` : `<p class="sub">${C.scored(own(d.first), N(score), own(d.topic))}</p>${starsHtml(d.correct, d.total)}`)),
      cta: door ? C.yourTurn : C.tapPlay,
    };
  }
  if (kind === 'class') {
    const top = d.top ? `${d.top.correct}/${d.top.total}` : '–';
    return {
      pic: d.rows && d.rows.length ? '' : pic('celebrate'),
      // The wide picture has no room for a separate line: the average joins the top line there.
      main: `<p class="kick">${d.cls ? `${own(d.cls)}${ur2 ? ' ' : SEP}` : ''}${own(d.topic)}${size !== 'sq' && d.rows && d.rows.length ? `${ur2 ? '<br>' : SEP}${C.avgLine(PCT(d.avgPct || 0))}` : ''}</p>`
        + `<h1 class="head">${d.of ? C.playedOf(N(d.played || 0), N(d.of)) : `${N(d.played || 0)} ${esc(C.played)}`}</h1>`
        + (d.rows && d.rows.length ? `<ol class="crow">${(pp ? topWithMe(d.rows, pp.cap) : us ? topWithMe(d.rows, size === 'sq' ? CLASS_ROWS_SQ : 3) : around(d.rows.map((r) => ({ ...r, you: r.me })), size === 'sq' ? 6 : 3)).map((r) => (r.gap ? '<li class="gap" aria-hidden="true">…</li>' : `<li class="${r.me ? 'me' : ''}">`
          + `<span class="rk">${N(r.place)}</span>${animal(r.animal, pics)}`
          // under the polish the name is its own box that shortens, and the label a box that never does
          + `<span class="who">${r.me ? (pp ? `${own(r.first, 'nm')}<small>(${esc(C.me)})</small>` : `${own(r.first)} <small>(${esc(C.me)})</small>`) : ''}</span>`
          + `<span class="sc">${N(`${r.correct}/${r.total}`)}</span></li>`)).join('')}</ol>` : '')
        + (d.rows && d.rows.length
          ? (size === 'sq' ? `<p class="sub">${C.avgLine(PCT(d.avgPct || 0))}</p>` : '')
          : `<div class="tiles"><div class="tile"><small>${esc(C.avg)}</small>${PCT(d.avgPct || 0)}</div><div class="tile"><small>${esc(C.top)}</small>${N(top)}</div></div>`),
      cta: C.notYet,
    };
  }
  // school: the viewer's school and its neighbours (the caller crops to ±3; each box shows ±2).
  const rows = around(d.rows || [], 5).map((r) => {
    const mv = r.move > 0 ? '<span class="mv up"></span>' : (r.move < 0 ? '<span class="mv down"></span>' : '<span class="mv"></span>');
    return `<li class="row${r.you ? ' you' : ''}"><span class="rk">${N(r.rank)}</span>${mv}`
      + `<span class="sn">${own(r.name)}${r.sector ? `<small>${own(r.sector)}</small>` : ''}</span>`
      + `<span class="pt">${N(fmt(r.points))}<small>${esc(C.pts)}${ud ? '،&ensp;' : ' · '}${N(fmt(r.kids))} ${esc(C.kids)}</small></span></li>`;
  }).join('');
  return { pic: '', main: `<p class="kick">${esc(ud ? C.school.replace(' · ', '، ') : C.school)}</p><ol class="board">${rows}</ol>`, cta: C.rule };
}

// How wide a line of Urdu headline is, in ems: a Nastaliq letter ~0.46em (measured 0.44 on the long-name challenge), a
// Latin letter or digit ~0.61em (Lexend), a space ~0.3em. Only for choosing the size: the browser breaks the lines.
function emWidth(s) {
  return Array.from(String(s == null ? '' : s)).reduce((n, ch) => n + (/\s/.test(ch) ? 0.3 : (/[A-Za-z0-9]/.test(ch) ? 0.61 : 0.46)), 0);
}

/**
 * The one stack's CSS (web_quiz_share_ur_stack), after every other rule so it wins. The square: the brand, Jugnu, the
 * words and the pill are one centred column with 24 px gaps, and Jugnu's picture (190 px, never under 96) is what gives
 * up height when the words need it, so no line runs over another or off the picture. The wide picture keeps its two
 * columns; its words column gets the same 24 px gaps, starting 8 px higher, its sub line at 1.7. The card's score is
 * one Lexend line (its Urdu digits from Nastaliq made the line 118 px for a 92 px number). The challenge headline: its size (63 px square, 40 wide) unless
 * it would need more than 2 lines, then one step down (0.86); a name whose longest word is wider than the whole line is
 * sized to fit it, since a name is never cut. The pill: the English pill's height (its 1.2 lines and 14 px above and below) and
 * 28 px sides, the Nastaliq 2 px larger, on one line. The class table: the same column in both sizes (the wide one is a
 * column too), its rows 1.45 high with their place and score in Lexend (Urdu digits from Nastaliq made each row 74 px for
 * 54 px of text), a «…» row where rows were left out, and on the wide one its two-line title at 1.6.
 */
function stackCss(k, d, C, sq, S, W, col) {
  const width = sq ? W - 144 : 702;
  let head = Math.round((sq ? 58 : 40) * S);
  if (k === 'invite') {
    const zero = !(Number(d.correct) > 0);
    const name = String(d.first || '');
    const line = zero ? C.dared(name) : C.beat(name, `${d.correct}/${d.total}`);
    if (emWidth(line) * head > 2 * width) head = Math.round(head * 0.86);
    // a word can only break at its spaces: the name's longest word must fit the line on its own
    const word = Math.max(0, ...name.split(/\s+/).map(emWidth));
    if (word * head > width) head = Math.floor(width / word);
  }
  const pillFs = Math.round(26 * S);
  const pillH = Math.round(pillFs * 1.2 + 28);
  return `
/* One stack (web_quiz_share_ur_stack): every line in the column with 24 px between, the English pill's size. */
.main{gap:24px}${col ? '.main{flex:0 0 auto}.art{gap:24px;justify-content:center}' : '.main{padding-top:52px}'}${sq ? '.side{flex:0 1 190px;min-height:96px}.jug{width:auto;height:100%;aspect-ratio:1/1}' : ''}
.kick{line-height:1.9}.sub{line-height:${sq ? 1.9 : 1.7};text-wrap:balance}${k === 'card' ? `
.big{line-height:1;font-family:'Lexend','NastaliqUrdu',sans-serif}` : ''}${k === 'invite' ? `
.head{font-size:${head}px;line-height:1.8;text-wrap:balance}` : ''}${k === 'class' ? `
.head{line-height:1.8}.crow{gap:${sq ? 10 : 4}px}.crow li{line-height:1.45}.crow .rk,.crow .sc{font-family:'Lexend','NastaliqUrdu',sans-serif}${sq ? '' : '.kick{line-height:1.6}'}
.crow li.gap{background:none;justify-content:center;line-height:1;padding:0;font-family:'Lexend',sans-serif;opacity:.8}` : ''}
.cta{margin:0}
.cta{height:${pillH}px;line-height:${pillH}px;padding:0 28px;font-size:${pillFs + 2}px;white-space:nowrap}`;
}

// The polish's class table rows (web_quiz_share_pic_polish): 60% of the square's width (648 px; they were as wide as their
// words, about a third of it) and the text grown with them (37 px to 52); the wide picture's rows keep its column's width
// (89%) and grow 26 px to 34 (Urdu 32). How many rows each picture holds, from the drawn heights so the whole stack stays
// inside the picture's padding with the child's row and a «…» row: square rows 87 px (Urdu 78) with 12 px between, so 5
// (Urdu 4, under its taller title and average lines); wide rows 57 px (Urdu 48), so 3 (Urdu 2, under its two-line title).
const PP_ROW_PX = { sq: 52, og: 34 };
const PP_ROW_PX_RTL = { sq: 52, og: 32 };
const PP_ROWS = { sq: 5, og: 3 };
const PP_ROWS_RTL = { sq: 4, og: 2 };

/**
 * The polish's English challenge headline: its size (one step down, never under 0.7, when it would need more than 2 lines,
 * counted at 85% of 2 lines for where the words fall) and its cut. The name is held to its score ("…'s 3/8?"), so the
 * name's last word and the score are one run that cannot wrap; a word of the name can't either. When the widest such run
 * (Lexend bold measured ~6% wider than emWidth; 8% kept) is wider than the text column (702 wide: the column left of
 * Jugnu; 936 square: 72 px each side), the name is its own box cut with «…», the score after it ("'s 3/8?", given 1.2x
 * its estimate) whole: the headline never runs under Jugnu or off the column, and the score is never cut.
 */
// Lexend Bold's advance widths (em) for the printable ASCII letters, read from the embedded font (fonts/Lexend-Bold.ttf),
// and its «…»: to write a Latin name already cut to its box. A letter outside the table counts as the widest one.
const LEXEND_BOLD = { ' ': 0.32, '!': 0.309, '"': 0.477, '#': 0.734, $: 0.634, '%': 0.968, '&': 0.776, "'": 0.252, '(': 0.39, ')': 0.39, '*': 0.44, '+': 0.597, ',': 0.287, '-': 0.448, '.': 0.257, '/': 0.595,
  0: 0.675, 1: 0.561, 2: 0.548, 3: 0.591, 4: 0.662, 5: 0.596, 6: 0.579, 7: 0.553, 8: 0.599, 9: 0.577, ':': 0.257, ';': 0.291, '<': 0.525, '=': 0.623, '>': 0.526, '?': 0.536, '@': 0.965,
  A: 0.694, B: 0.701, C: 0.694, D: 0.772, E: 0.645, F: 0.618, G: 0.782, H: 0.779, I: 0.555, J: 0.665, K: 0.739, L: 0.609, M: 0.878, N: 0.807, O: 0.812, P: 0.662, Q: 0.812, R: 0.702, S: 0.634,
  T: 0.655, U: 0.765, V: 0.712, W: 0.993, X: 0.705, Y: 0.689, Z: 0.683, '[': 0.42, '\\': 0.584, ']': 0.42, '^': 0.592, _: 0.687, '`': 0.5,
  a: 0.659, b: 0.658, c: 0.545, d: 0.654, e: 0.586, f: 0.393, g: 0.669, h: 0.635, i: 0.319, j: 0.316, k: 0.626, l: 0.304, m: 0.962, n: 0.635, o: 0.641, p: 0.659, q: 0.658, r: 0.455, s: 0.495,
  t: 0.398, u: 0.642, v: 0.605, w: 0.834, x: 0.606, y: 0.62, z: 0.55, '{': 0.427, '|': 0.318, '}': 0.427, '~': 0.558 };
const LEXEND_BOLD_ELLIPSIS = 0.736;
/** A Latin name cut to fit `em` (its letters and a «…», 2% to spare), or null when it fits whole or is not all in the table. */
function cutToFit(name, em) {
  const ch = Array.from(String(name || ''));
  if (!ch.length || ch.some((c) => !(c in LEXEND_BOLD))) return null;
  const w = (c) => LEXEND_BOLD[c] * 1.02;
  if (ch.reduce((n, c) => n + w(c), 0) <= em) return null;
  let used = LEXEND_BOLD_ELLIPSIS * 1.02;
  let i = 0;
  while (i < ch.length && used + w(ch[i]) <= em) { used += w(ch[i]); i += 1; }
  return `${ch.slice(0, i).join('').replace(/\s+$/, '')}…`;
}

function enHead(d, C, sq, S, W) {
  const width = sq ? W - 144 : 702;
  const base = Math.round(58 * S);
  const name = String(d.first || '');
  const zero = !(Number(d.correct) > 0);
  const line = zero ? C.dared(name) : C.beat(name, `${d.correct}/${d.total}`);
  let head = base;
  if (emWidth(line) * head > 2 * width * 0.85) head = Math.max(Math.round(base * 0.7), Math.floor((2 * width * 0.85) / emWidth(line)));
  const tail = zero ? '' : `'s ${d.correct}/${d.total}?`;
  const words = name.split(/\s+/).filter(Boolean);
  const run = Math.max(0, ...words.map((w, i) => emWidth(i === words.length - 1 ? `${w}${tail}` : w))) * 1.08;
  const cut = run * head > width ? { max: width - Math.ceil(emWidth(tail) * 1.2 * head) } : null;
  // the square writes the name already cut, so its box ends where its letters end and "'s" follows them (the browser's «…»
  // stops at a whole letter, leaving up to a letter's width of space before "'s"); the box keeps its limit as a guard
  if (cut && sq) {
    const text = cutToFit(name, cut.max / head);
    if (text) cut.text = text;
  }
  return { head, cut };
}

/**
 * The polish's CSS (web_quiz_share_pic_polish), last so it wins. The class table: its rows wider with larger text, the
 * child's name a box that shortens (an ellipsis) beside a "(me)" label that never does, and the English picture the same
 * one centred stack with 24 px between as the Urdu one (no empty band above the pill). The English challenge headline:
 * balanced lines, one size step down when it would need more than 2 (counted at 85% of 2 lines, for where the words
 * fall; never under 0.7), and on the square one centred stack with 24 px between. The challenge in both languages: its
 * sub line (the quiz title alone) a step smaller when that keeps it on its line.
 */
function polishCss(k, d, sq, S, W, RTL, INK, C, sub) {
  let out = `
/* The polish (web_quiz_share_pic_polish). */`;
  if (k === 'class') {
    const fs = (RTL ? PP_ROW_PX_RTL : PP_ROW_PX)[sq ? 'sq' : 'og'];
    if (!RTL) out += '.main{gap:24px}.main{flex:0 0 auto}.art{gap:24px;justify-content:center}.cta{margin:0}.crow li.gap{background:none;justify-content:center;line-height:1;padding:0;opacity:.8}';
    out += `
${sq ? `.crow{width:${Math.round(W * 0.6)}px;gap:12px}` : ''}.crow li{font-size:${fs}px;gap:.35em;padding:${RTL ? '0 .45em;line-height:1.3' : '.12em .45em'}}.crow .rk{flex:0 0 1.3em}
.crow .who{display:flex;align-items:center;gap:.25em;min-width:0}
.crow .who .nm{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${RTL && INK ? ';padding:.5em .15em;margin:-.5em -.15em' : ''}}
.crow .who small{flex:0 0 auto;font-size:.75em}.crow .sc{flex:0 0 auto}`;
  }
  if (k === 'invite' && !RTL) {
    out += `.head{font-size:${enHead(d, C, sq, S, W).head}px;text-wrap:balance}`;
    const cut = sub && sub.cut;
    if (cut) out += `.head .keep{white-space:nowrap}.head .nm{display:inline-block;max-width:${cut.max}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}`;
  }
  // the English square: one centred stack with 24 px between, as the Urdu one (Jugnu gives up height first)
  if (k === 'invite' && !RTL && sq) out += '.main{gap:24px}.main{flex:0 0 auto}.art{gap:24px;justify-content:center}.cta{margin:0}.side{flex:0 1 190px;min-height:96px}.jug{width:auto;height:100%;aspect-ratio:1/1}';
  if (k === 'invite' && sub && sub.px) out += `.sub{font-size:${sub.px}px;white-space:nowrap}`;
  return out;
}

/**
 * @param {{kind:'card'|'invite'|'class'|'school', size:'og'|'sq', brand:string, lang:'en'|'ur', d:object}} a
 * @param {{fonts?:boolean, pictures?:boolean}} [opt] - off only for the layout snapshot
 * @returns {string} HTML; the picture is the `.art` element, exactly SIZES[size]
 */
function renderArt({ kind, size, brand, lang, d, ui, door }, opt = {}) {
  const k = KINDS.includes(kind) ? kind : 'card';
  const sz = SIZES[size] ? size : 'og';
  const [W, H] = SIZES[sz];
  const L = clampLanguage(lang);
  const RTL = L === 'ur';
  // The Urdu polish switch (app_settings web_quiz_ur_polish, carried as `ui.ur2`): the Urdu lines a step larger, the quiz name
  // the headline, the CTA readable at WhatsApp's ~300 px preview. Off (or English), every size below is today's.
  const UR2 = RTL && Boolean(ui && ui.ur2 === true);
  // The one share (app_settings web_quiz_share_v4, carried as `ui.ink`): Urdu text keeps all its ink. Off, every line below is today's.
  const INK = RTL && Boolean(ui && ui.ink === true);
  // One stack (app_settings web_quiz_share_ur_stack, carried as `ui.us`): an Urdu card or challenge picture lays its
  // headline, sub line, stars and pill out as one column with 24 px between them (nothing over anything), its headline in
  // balanced lines a size step down when it would need 3, and the English pill's height and padding with «کھولیں» in it.
  // The Urdu class table (with rows) too: title, count, rows (the top ones and always the child's own), average, pill.
  // Off (or English, or the class tiles and the school picture), every line below is today's.
  const US = RTL && (k === 'card' || k === 'invite' || (k === 'class' && Boolean(d && d.rows && d.rows.length))) && Boolean(ui && ui.us === true);
  // The polish (app_settings web_quiz_share_pic_polish, carried as `ui.pp`), the challenge and the class table with rows in
  // both languages: see polishCss. Off (and on the card, the school and the class tiles), every line below is today's.
  const PP = (k === 'invite' || (k === 'class' && Boolean(d && d.rows && d.rows.length))) && Boolean(ui && ui.pp === true);
  // Its challenge sub line names the quiz in «» («… نے «تفہیم - مکالمے کو سمجھنا» میں ۴/۷ لیے»): a title that ends in a verb
  // reads as a name, not as part of the sentence. The title keeps its own isolated run inside the marks.
  const C0 = US ? { ...COPY[L], tapPlay: COPY[L].openPlay, scored: (n, sc, tp) => COPY[L].scored(n, sc, `«${tp}»`) } : COPY[L];
  // the polish's English headline: the score held to the name (an Urdu headline keeps its words)
  const C = PP && k === 'invite' ? { ...C0, beat: C0.beatKeep || C0.beat, dared: C0.daredKeep || C0.dared } : C0;
  // The wide picture (1200×630) has no height to spare: under the polish its stack is budgeted — no kicker on the card and
  // the invite, the name 56/1.7, the topic 44 (36 when long), the invite's scored line 32, every line at 1.9 — so the
  // CTA pill, the last child, is never the one that falls off. The square has the height and keeps the larger sizes.
  const OG2 = UR2 && size !== 'sq';
  const topicLen = Array.from(String((d && d.topic) || '')).length;
  const B = WebQuizBrand.publicBrand(Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, brand) ? brand : WebQuizBrand.DEFAULT_BRAND);
  const t = B.tokens;
  const a = opt.fonts === false ? {} : assets();
  // Urdu digits (app_settings web_quiz_share_ur_digits, carried as `ui.ud`): off (or English), every number below is today's.
  const UD = RTL && Boolean(ui && ui.ud === true);
  // The card's name fits (app_settings web_quiz_share_name_fit, carried as `ui.nf`): its own LTR run, sized down by its length
  // to fit its line (a Nastaliq letter is ~0.42em wide, a Lexend one ~0.61em), never under 34 px, and cut only at its own end
  // («Amal Testw…», never «…l Testwala»). The line: the card's column (702 wide, 936 on the square), less the ink's room
  // (0.5em each side, under INK) and 1.3em for the animal, in the line's own size. An Urdu name's run has Nastaliq's own
  // line height (as its own box it no longer stretches the line: on an English card it lost the foot of its ل). Off, today's.
  const NF = k === 'card' && Boolean(ui && ui.nf === true);
  const first = String((d && d.first) || '');
  const nameBase = RTL && sz !== 'sq' ? 56 : Math.round(68 * (sz === 'sq' ? 1.08 : 1));
  const NFANI = Math.ceil(1.3 * nameBase);
  const NFPX = Math.floor(((sz === 'sq' ? W - 144 : 702) - (INK ? nameBase : 0) - NFANI) / (Math.max(1, Array.from(first).length) * (isArabicScript(first) ? 0.42 : 0.61)));
  const sq = sz === 'sq';
  // The polish's challenge (both languages): when the headline already names the child (decided from its own words), the
  // sub line is the quiz title alone, its spaces held so it stays on one line; a title too long for the line is set smaller
  // down to 0.75 of the sub line's size, and past that keeps its spaces (it may break, never runs off the picture).
  let ppSub = null;
  if (PP && k === 'invite') {
    const name = String((d && d.first) || '');
    const zero = !(Number(d && d.correct) > 0);
    const said = zero ? C.dared(name) : C.beat(name, `${d.correct}/${d.total}`);
    const subPx = Math.round((UR2 ? (OG2 ? 32 : 44) : 32) * (sq ? 1.08 : 1));
    const em = emWidth((d && d.topic) || '');
    const fit = Math.floor((sq ? W - 144 : 702) / Math.max(1, em));
    ppSub = { title: zero || (name !== '' && said.includes(name)), nb: fit >= Math.round(subPx * 0.75), px: fit < subPx && fit >= Math.round(subPx * 0.75) ? fit : 0,
      ...(RTL ? {} : { cut: enHead(d, C, sq, sq ? 1.08 : 1, W).cut }) };
  }
  const ppOf = !PP ? null : k === 'class' ? { cap: (RTL ? PP_ROWS_RTL : PP_ROWS)[sq ? 'sq' : 'og'] } : (ppSub && ppSub.title ? ppSub : null);
  const parts = body(k, d || {}, C, opt.pictures !== false, sz, UR2, OG2, door === true, UD, US || Boolean(PP && k === 'class'), ppOf);
  const col = sq || k === 'school' || (k === 'class' && Boolean(d && d.rows && d.rows.length));   // stacked: the square, and the board in either size
  const deco = B.deco ? `url("data:image/svg+xml;utf8,${encodeURIComponent(B.deco)}")` : 'none';
  // A wide mark (Rumi) sits bare on the dark ground: drawn in white and the accent, never navy on navy.
  const [mk1, mk2] = B.mark.tile ? B.mark.onTile : ['#FFFFFF', t.brand];
  const body1 = RTL ? "'NastaliqUrdu','Lexend',sans-serif" : "'Lexend','NastaliqUrdu',sans-serif";
  const lh = RTL ? (UR2 ? 2.5 : NASTALIQ.leading.regular) : 1.25;
  const fonts = opt.fonts === false ? '' : `@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend})}
@font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold})}`;
  const S = sq ? 1.08 : 1;   // the square is read at a smaller on-screen size: type a step up
  // the polish's Urdu class table stands on the one stack too, with the stack switch or without it
  const usCss = US || (PP && RTL && k === 'class') ? stackCss(k, d || {}, C, sq, S, W, col) : '';
  const ppCss = PP ? polishCss(k, d || {}, sq, S, W, RTL, INK, C, ppSub) : '';
  const css = `${fonts}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:${t['brand-ink']}}
body{width:${W}px;height:${H}px;overflow:hidden;font-family:${body1};color:#fff}
.art{position:relative;width:${W}px;height:${H}px;overflow:hidden;display:flex;flex-direction:${col ? 'column' : 'row'};
  align-items:${sq ? 'center' : 'stretch'};padding:${sq ? '56px 72px 56px' : (col ? '40px 64px 36px' : '56px 64px')};gap:${sq ? 20 : (col ? 16 : 40)}px;
  background:linear-gradient(${RTL ? 203 : 157}deg,${t['brand-ink']} 0%,${t['brand-ink']} 35%,${t['brand-d']} 100%)}
.art::before{content:'';position:absolute;inset:0;background-image:${deco};background-size:${Math.round(110 * S)}px;opacity:.10}
.top,.main,.side,.cta{position:relative}
.top{display:flex;align-items:center;gap:14px;flex:0 0 auto;${col && RTL ? 'margin-bottom:10px;' : ''}${col ? '' : 'position:absolute;top:44px;inset-inline-start:64px;'}}
.mark{width:${Math.round(56 * S)}px;height:${Math.round(56 * S)}px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  background:${B.mark.tile ? t['brand-ink'] : 'transparent'};${B.mark.tile ? 'box-shadow:0 0 0 2px rgba(255,255,255,.25);' : ''}--mk1:${mk1};--mk2:${mk2}}
.mark svg{width:${B.mark.tile ? 70 : 100}%;height:auto}
.brand{font:800 ${Math.round(26 * S)}px/1 'Lexend',sans-serif;letter-spacing:.04em}
.main{flex:1;display:flex;flex-direction:column;justify-content:safe center;gap:${sq ? 12 : 14}px;min-width:0;min-height:0;${sq ? 'text-align:center;align-items:center;' : (col ? '' : 'padding-top:60px;')}}
.kick{font-size:${Math.round((UR2 ? 32 : 26) * S)}px;line-height:${lh};color:${t.brand};font-weight:${RTL ? 700 : 800};${RTL ? '' : 'letter-spacing:.02em;'}}
.name{font-size:${Math.round(68 * S)}px;line-height:${RTL ? (UR2 && !OG2 ? 1.9 : 1.7) : 1.05};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.head{font-size:${Math.round((RTL && !sq ? 40 : 58) * S)}px;line-height:${RTL ? 2.0 : 1.12};font-weight:800}
.big{font-size:${Math.round((sq ? 100 : 104) * S)}px;line-height:1;font-weight:800}
.sub{font-size:${Math.round((UR2 ? (OG2 ? (k === 'invite' ? 32 : (topicLen > 22 ? 36 : 44)) : 44) : 32) * S)}px;line-height:${RTL ? (OG2 ? 1.9 : lh) : 1.3};opacity:.92;max-width:100%}
.num{font-family:${UD ? "'Lexend','NastaliqUrdu'" : "'Lexend'"},sans-serif;unicode-bidi:isolate;direction:ltr;font-weight:800}
bdi[dir="ltr"]{font-family:'Lexend','NastaliqUrdu',sans-serif}
bdi[dir="rtl"]{font-family:'NastaliqUrdu','Lexend',sans-serif}
.stars{display:flex;gap:${sq ? 10 : 8}px;flex-wrap:wrap;direction:${RTL ? 'rtl' : 'ltr'}}
.star{width:${Math.round(44 * S)}px;height:${Math.round(44 * S)}px;fill:none;stroke:rgba(255,255,255,.55);stroke-width:1.6;stroke-linejoin:round}
.star.on{fill:#F5B841;stroke:#F5B841}
.side{flex:0 0 ${sq ? 'auto' : '330px'};display:flex;align-items:center;justify-content:center}
.jug{width:${sq ? 190 : 280}px;height:${sq ? 190 : 280}px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.22) 0%,rgba(255,255,255,0) 68%);object-fit:contain;padding:${sq ? 12 : 24}px}
.tiles{display:flex;gap:18px;flex-wrap:wrap;${sq ? 'justify-content:center;' : ''}}
.tile{background:rgba(255,255,255,.12);border-radius:20px;padding:16px 24px;display:flex;flex-direction:column;gap:4px;font-size:${Math.round(48 * S)}px;line-height:1.2}
.tile small{font-size:${Math.round(22 * S)}px;opacity:.85;line-height:${RTL ? lh : 1.3}}
.cta{flex:0 0 auto;${sq ? '' : 'align-self:flex-start;'}${col ? '' : 'margin-top:8px;'}display:inline-block;background:${t.brand};color:${t['brand-on']};
  font-size:${Math.round((UR2 ? 40 : 26) * S)}px;line-height:${RTL ? 1.9 : 1.2};font-weight:800;padding:${RTL ? '4px 28px' : '14px 28px'};border-radius:999px}
.board{list-style:none;display:flex;flex-direction:column;gap:${sq ? 12 : 6}px;width:100%;text-align:start}
.row{display:flex;align-items:center;gap:18px;background:rgba(255,255,255,.08);border-radius:16px;padding:${sq ? '12px 22px' : '4px 18px'};font-size:${Math.round((sq ? 28 : (RTL ? 22 : 25)) * S)}px;line-height:${RTL ? (sq ? 1.75 : 1.6) : 1.2}}
.row.you{background:${t.brand};color:${t['brand-on']};box-shadow:0 0 0 3px #fff}
.rk{flex:0 0 56px;font-size:1.15em}
.sn{flex:1;min-width:0;display:flex;flex-direction:column;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sn small,.pt small{font-size:.62em;opacity:.8}
.pt{display:flex;flex-direction:column;align-items:flex-end;text-align:end}
.mv{flex:0 0 18px;width:0;height:0;border-inline:9px solid transparent}
.mv.up{border-bottom:14px solid #7BE0A6}
.mv.down{border-top:14px solid #FF8C7A}
/* A line never gives up its height to the box (a clipped name shrank to nothing). */
.main>*{flex-shrink:0}
${col && !sq ? '.sn small{display:none}.pt{flex-direction:row;align-items:baseline;gap:10px}' : ''}
${RTL && !sq ? `.kick{line-height:1.9}.name{font-size:56px;line-height:${UR2 ? 1.7 : 1.55}}.big{font-size:92px}.head{line-height:${UR2 ? 1.9 : 1.7}}.crow li{line-height:1.45}.crow{gap:4px}.sub{line-height:1.9}` : ''}
.ani{width:1em;height:1em;display:inline-block;vertical-align:-.12em;margin-inline-end:.25em;object-fit:contain}
${NF ? `${sq ? '.main{width:100%;max-width:100%}.name{width:100%}' : ''}.name bdi{display:inline-block;max-width:calc(100% - ${NFANI}px);font-size:max(34px,min(1em,${NFPX}px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom${isArabicScript(first) ? ';line-height:1.9' : ''}}
` : ''}.pts{display:inline-block;align-self:${sq ? 'center' : 'flex-start'};background:rgba(255,255,255,.14);border-radius:${UR2 ? '28px' : '999px'};padding:${RTL ? (UR2 ? '2px 24px' : '0 22px') : '8px 22px'};font-size:${Math.round((UR2 && !OG2 ? 28 : 24) * S)}px;line-height:${RTL ? 1.9 : 1.3};font-weight:700${UR2 ? ';text-align:start' : ''}}${UR2 ? `
.pts .sch{display:block;font-family:'Lexend','NastaliqUrdu',sans-serif;font-size:${Math.round((OG2 ? 21 : 26) * S)}px;line-height:1.35;opacity:.9}` : ''}
.crow{list-style:none;display:flex;flex-direction:column;gap:${sq ? 10 : 6}px;width:${sq ? '86%' : '100%'};text-align:start}
.crow li{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.08);border-radius:12px;padding:${RTL ? '0 16px' : '4px 16px'};font-size:${Math.round((sq ? 34 : 26) * S)}px;line-height:${RTL ? 1.6 : 1.25}}
.crow li.me{background:${t.brand};color:${t['brand-on']}}
.crow .rk{flex:0 0 40px}.crow .who{flex:1;min-width:0;white-space:nowrap;overflow:hidden}.crow .ani{margin:0}
.dot{font-family:'Lexend',sans-serif;unicode-bidi:isolate}${INK ? `
/* Room for the ink (the one share): a clipped Urdu name keeps the stroke a ک or گ throws past its line, and a pill's word
   keeps its tall letters inside the pill. The padding is given back as margin, so nothing else moves. */
.name,.crow .who,.sn{padding:.5em .5em;margin:-.5em -.5em}
.pts{padding-top:.45em}.cta{padding-top:.6em;padding-bottom:.3em}${sq ? '.main{gap:8px}' : ''}` : ''}${usCss}${ppCss}`;
  const top = `<div class="top"><span class="mark" aria-hidden="true">${B.mark.svg}</span><span class="brand">${esc(B.label[L])}</span></div>`;
  const side = parts.pic ? `<div class="side">${parts.pic}</div>` : '';
  // the school's rule line has its digits in the copy itself
  const cta = parts.cta ? `<div class="cta">${esc(UD ? urDigits(parts.cta) : parts.cta)}</div>` : '';
  const inner = col
    ? `${top}${side}<div class="main">${parts.main}</div>${cta}`
    : `${top}<div class="main">${parts.main}${cta}</div>${side}`;
  return `<!DOCTYPE html><html lang="${L}" dir="${RTL ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${css}</style></head>`
    + `<body><div class="art ${k} ${sz}" style="width:${W}px;height:${H}px">${inner}</div></body></html>`;
}

module.exports = { renderArt, SIZES, KINDS, COPY };
