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
    scored: (n, s, t) => `${n} scored ${s} on ${t}`,
    tapPlay: 'Tap the link to play',
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

/** Text somebody wrote, in its own script and direction, isolated from the line around it. */
function own(text) {
  const t = String(text == null ? '' : text);
  return `<bdi dir="${scriptOf(t) === 'ur' ? 'rtl' : 'ltr'}">${esc(t)}</bdi>`;
}
function animal(key, pics) {
  const a = pics ? assets().animals[ANIMAL_KEYS.includes(key) ? key : 'star'] : '';
  return a ? `<img class="ani" src="data:image/svg+xml;base64,${a}" alt="">` : '<span class="ani"></span>';
}
const num = (s) => `<span class="num">${esc(s)}</span>`;
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

function body(kind, d, C, pics, size, ur2 = false) {
  const pic = (name) => (pics && assets()[name] ? `<img class="jug" src="data:image/webp;base64,${assets()[name]}" alt="">` : '<div class="jug"></div>');
  if (kind === 'card') {
    return {
      pic: pic('celebrate'),
      main: `<p class="kick">${esc(C.my)}${d.cls ? `${DOT}${own(d.cls)}` : ''}</p>`
        + `<h1 class="name">${d.animal ? animal(d.animal, pics) : ''}${own(d.first)}</h1>`
        + `<p class="big">${num(`${d.correct}/${d.total}`)}</p>${starsHtml(d.correct, d.total)}`
        + `<p class="sub">${own(d.topic)}</p>`
        // under the Urdu polish the school sits on its own line under the points: a Latin school name never breaks an Urdu sentence
        + (d.school && d.added ? `<p class="pts">${ur2 ? `${num(`+${d.added}`)} ${esc(C.pts)}<br>${own(d.school)}` : C.added(num(`+${d.added}`), own(d.school))}</p>` : (d.school ? `<p class="pts">${own(d.school)}</p>` : '')),
      cta: d.school ? '' : C.playSame,
    };
  }
  if (kind === 'invite') {
    const score = `${d.correct}/${d.total}`;
    // A challenger who scored nothing is never a score to beat, and a zero is never shown off.
    const zero = !(Number(d.correct) > 0);
    return {
      pic: pic('hello'),
      main: `<p class="kick">${esc(C.chal)}</p>`
        + `<h1 class="head">${zero ? C.dared(own(d.first)) : C.beat(own(d.first), num(score))}</h1>`
        + (zero ? `<p class="sub">${own(d.topic)}</p>` : `<p class="sub">${C.scored(own(d.first), num(score), own(d.topic))}</p>${starsHtml(d.correct, d.total)}`),
      cta: C.tapPlay,
    };
  }
  if (kind === 'class') {
    const top = d.top ? `${d.top.correct}/${d.top.total}` : '–';
    return {
      pic: d.rows && d.rows.length ? '' : pic('celebrate'),
      // The wide picture has no room for a separate line: the average joins the top line there.
      main: `<p class="kick">${d.cls ? `${own(d.cls)}${ur2 ? ' ' : DOT}` : ''}${own(d.topic)}${size !== 'sq' && d.rows && d.rows.length ? `${ur2 ? '<br>' : DOT}${C.avgLine(num(`${d.avgPct || 0}%`))}` : ''}</p>`
        + `<h1 class="head">${d.of ? C.playedOf(num(d.played || 0), num(d.of)) : `${num(d.played || 0)} ${esc(C.played)}`}</h1>`
        + (d.rows && d.rows.length ? `<ol class="crow">${around(d.rows.map((r) => ({ ...r, you: r.me })), size === 'sq' ? 6 : 3).map((r) => `<li class="${r.me ? 'me' : ''}">`
          + `<span class="rk">${num(r.place)}</span>${animal(r.animal, pics)}`
          + `<span class="who">${r.me ? `${own(r.first)} <small>(${esc(C.me)})</small>` : ''}</span>`
          + `<span class="sc">${num(`${r.correct}/${r.total}`)}</span></li>`).join('')}</ol>` : '')
        + (d.rows && d.rows.length
          ? (size === 'sq' ? `<p class="sub">${C.avgLine(num(`${d.avgPct || 0}%`))}</p>` : '')
          : `<div class="tiles"><div class="tile"><small>${esc(C.avg)}</small>${num(`${d.avgPct || 0}%`)}</div><div class="tile"><small>${esc(C.top)}</small>${num(top)}</div></div>`),
      cta: C.notYet,
    };
  }
  // school: the viewer's school and its neighbours (the caller crops to ±3; each box shows ±2).
  const rows = around(d.rows || [], 5).map((r) => {
    const mv = r.move > 0 ? '<span class="mv up"></span>' : (r.move < 0 ? '<span class="mv down"></span>' : '<span class="mv"></span>');
    return `<li class="row${r.you ? ' you' : ''}"><span class="rk">${num(r.rank)}</span>${mv}`
      + `<span class="sn">${own(r.name)}${r.sector ? `<small>${own(r.sector)}</small>` : ''}</span>`
      + `<span class="pt">${num(fmt(r.points))}<small>${esc(C.pts)} · ${num(fmt(r.kids))} ${esc(C.kids)}</small></span></li>`;
  }).join('');
  return { pic: '', main: `<p class="kick">${esc(C.school)}</p><ol class="board">${rows}</ol>`, cta: C.rule };
}

/**
 * @param {{kind:'card'|'invite'|'class'|'school', size:'og'|'sq', brand:string, lang:'en'|'ur', d:object}} a
 * @param {{fonts?:boolean, pictures?:boolean}} [opt] - off only for the layout snapshot
 * @returns {string} HTML; the picture is the `.art` element, exactly SIZES[size]
 */
function renderArt({ kind, size, brand, lang, d, ui }, opt = {}) {
  const k = KINDS.includes(kind) ? kind : 'card';
  const sz = SIZES[size] ? size : 'og';
  const [W, H] = SIZES[sz];
  const L = clampLanguage(lang);
  const RTL = L === 'ur';
  // The Urdu polish switch (app_settings web_quiz_ur_polish, carried as `ui.ur2`): the Urdu lines a step larger, the quiz name
  // the headline, the CTA readable at WhatsApp's ~300 px preview. Off (or English), every size below is today's.
  const UR2 = RTL && Boolean(ui && ui.ur2 === true);
  const C = COPY[L];
  const B = WebQuizBrand.publicBrand(Object.prototype.hasOwnProperty.call(WebQuizBrand.BRANDS, brand) ? brand : WebQuizBrand.DEFAULT_BRAND);
  const t = B.tokens;
  const a = opt.fonts === false ? {} : assets();
  const parts = body(k, d || {}, C, opt.pictures !== false, sz, UR2);
  const sq = sz === 'sq';
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
.name{font-size:${Math.round(68 * S)}px;line-height:${RTL ? (UR2 ? 1.9 : 1.7) : 1.05};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.head{font-size:${Math.round((RTL && !sq ? (UR2 ? 46 : 40) : 58) * S)}px;line-height:${RTL ? 2.0 : 1.12};font-weight:800}
.big{font-size:${Math.round((sq ? 100 : 104) * S)}px;line-height:1;font-weight:800}
.sub{font-size:${Math.round((UR2 ? 44 : 32) * S)}px;line-height:${RTL ? lh : 1.3};opacity:.92;max-width:100%}
.num{font-family:'Lexend',sans-serif;unicode-bidi:isolate;direction:ltr;font-weight:800}
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
${RTL && !sq ? `.kick{line-height:1.9}.name{font-size:56px;line-height:${UR2 ? 1.9 : 1.55}}.big{font-size:92px}.head{line-height:${UR2 ? 1.9 : 1.7}}.crow li{line-height:1.45}.crow{gap:4px}.sub{line-height:1.9}` : ''}
.ani{width:1em;height:1em;display:inline-block;vertical-align:-.12em;margin-inline-end:.25em;object-fit:contain}
.pts{display:inline-block;align-self:${sq ? 'center' : 'flex-start'};background:rgba(255,255,255,.14);border-radius:${UR2 ? '28px' : '999px'};padding:${RTL ? (UR2 ? '2px 24px' : '0 22px') : '8px 22px'};font-size:${Math.round((UR2 ? 28 : 24) * S)}px;line-height:${RTL ? 1.9 : 1.3};font-weight:700${UR2 ? ';text-align:start' : ''}}
.crow{list-style:none;display:flex;flex-direction:column;gap:${sq ? 10 : 6}px;width:${sq ? '86%' : '100%'};text-align:start}
.crow li{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.08);border-radius:12px;padding:${RTL ? '0 16px' : '4px 16px'};font-size:${Math.round((sq ? 34 : 26) * S)}px;line-height:${RTL ? 1.6 : 1.25}}
.crow li.me{background:${t.brand};color:${t['brand-on']}}
.crow .rk{flex:0 0 40px}.crow .who{flex:1;min-width:0;white-space:nowrap;overflow:hidden}.crow .ani{margin:0}
.dot{font-family:'Lexend',sans-serif;unicode-bidi:isolate}`;
  const top = `<div class="top"><span class="mark" aria-hidden="true">${B.mark.svg}</span><span class="brand">${esc(B.label[L])}</span></div>`;
  const side = parts.pic ? `<div class="side">${parts.pic}</div>` : '';
  const cta = parts.cta ? `<div class="cta">${esc(parts.cta)}</div>` : '';
  const inner = col
    ? `${top}${side}<div class="main">${parts.main}</div>${cta}`
    : `${top}<div class="main">${parts.main}${cta}</div>${side}`;
  return `<!DOCTYPE html><html lang="${L}" dir="${RTL ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${css}</style></head>`
    + `<body><div class="art ${k} ${sz}" style="width:${W}px;height:${H}px">${inner}</div></body></html>`;
}

module.exports = { renderArt, SIZES, KINDS, COPY };
