'use strict';
/**
 * THE SHARE CARD'S PICTURE, design A ("trophy burst"; app_settings web_quiz_share_card_a, on top of the one share;
 * default OFF): the activity's land colour with gold rays and confetti, a big gold medal holding the finish's result
 * (the score, else the words read, else the sticker) with its stars above and its badge on a ribbon, Jugnu cheering,
 * who did what, a loud dare and the "Tap to play" pill. 1200 × 630, drawn by the same renderer as today's card.
 *
 *   renderCardA(f, { fonts, art }) -> html   f: the card's facts (kind, deed, lang, first, item, data); art: the
 *                                            item's picture {type, b64} (a book's cover, a lesson's frame) or null
 *   artOf(f) -> {type, b64} | null           the item's picture, shrunk; null when storage cannot give it. Never throws.
 *
 * Every number on it is the token's (web-quiz-card-data.js, from the server's rows); never a reading speed. Urdu lines
 * are native-read (18 Oct); every Nastaliq line has line-height ≥ 2 and room for its ink.
 */
const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../utils/logger');

const W = 1200;
const H = 630;
const COL = Object.freeze({
  gm: { c: '#3a9d4f', edge: '#296e37', deep: '#14532a', hi: '#6fd47f' },
  st: { c: '#e97f2e', edge: '#a35920', deep: '#7a3a0e', hi: '#ffb067' },
  vd: { c: '#2a86de', edge: '#1d5e9b', deep: '#0f3a6b', hi: '#6cb8ff' },
  sp: { c: '#8e5bd8', edge: '#634097', deep: '#3b2166', hi: '#c19bff' },
});
const LAND_OF = Object.freeze({ game: 'gm', quiz: 'gm', read: 'sp', listen: 'st', story: 'st', book: 'st', video: 'vd' });
const ICON_OF = Object.freeze({ game: 'game', quiz: 'quiz', read: 'reading', listen: 'story', story: 'story', book: 'story', video: 'video' });

// "{n} …": who did what, by the deed (a stop played again says the same); first person when the card names nobody
const DEED3 = {
  en: {
    quiz_done: (n) => `${n} finished a quiz!`, read_all: (n) => `${n} read a whole story!`, read_some: (n) => `${n} read out loud!`,
    read_tried: (n) => `${n} tried a new story!`, listen_done: (n) => `${n} listened to a story!`, story_read: (n) => `${n} read a story!`,
    answered: (n) => `${n} answered the story questions!`, game_done: (n) => `${n} played a game!`, book_read: (n) => `${n} read a storybook!`,
    video_watched: (n) => `${n} watched a video!`,
  },
  ur: {
    quiz_done: (n) => `${n} نے کوئز مکمل کیا!`, read_all: (n) => `${n} نے پوری کہانی پڑھی!`, read_some: (n) => `${n} نے اونچی آواز میں پڑھا!`,
    read_tried: (n) => `${n} نے ایک نئی کہانی پڑھی!`, listen_done: (n) => `${n} نے کہانی سنی!`, story_read: (n) => `${n} نے کہانی پڑھی!`,
    answered: (n) => `${n} نے کہانی کے سوالوں کے جواب دیے!`, game_done: (n) => `${n} نے کھیل کھیلا!`, book_read: (n) => `${n} نے کہانی کی کتاب پڑھی!`,
    video_watched: (n) => `${n} نے ویڈیو دیکھی!`,
  },
};
const SAME_AS = Object.freeze({ read_practice: 'read_all', read_some_practice: 'read_some', listen_practice: 'listen_done', story_practice: 'story_read', game_practice: 'game_done' });
const T = {
  en: {
    land: { gm: 'Game field', st: 'Story land', vd: 'Video sky', sp: 'Story land' }, quiz: 'Quiz', brand: 'Jugnu',
    cta: 'Tap to play', join: 'Join me on Jugnu', watched: 'Watched', words: 'words read', wordsAloud: 'words read out loud',
    dareVideo: 'Can you watch it too?', darePlay: 'Can you play too?',
  },
  ur: {
    land: { gm: 'کھیلوں کا میدان', st: 'کہانیوں کا دیس', vd: 'ویڈیوز کا آسمان', sp: 'کہانیوں کا دیس' }, quiz: 'کوئز', brand: 'جگنو',
    cta: 'دبائیں اور کھیلیں!', join: 'جگنو پر میرے ساتھ آئیں', watched: 'ویڈیو دیکھ لی', words: 'لفظ پڑھے', wordsAloud: 'لفظ اونچی آواز میں پڑھے',
    dareVideo: 'آپ بھی یہ ویڈیو دیکھ کر دکھائیں!', darePlay: 'آپ بھی کھیل کر دکھائیں!',
  },
};

const STAR = (fill = '#ffc83a', stroke = '#b27a00') => `<svg viewBox="0 0 100 100"><path d="M50 6l13 28 30 4-22 21 6 31-27-15-27 15 6-31L7 38l30-4z" fill="${fill}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round"/><path d="M38 30l12-3" stroke="#fff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/></svg>`;
const PLAY = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="currentColor"/><path d="M15 11l14 9-14 9z" fill="#fff"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON = {
  game: '<svg viewBox="0 0 64 64"><rect x="6" y="18" width="52" height="30" rx="15" fill="currentColor"/><rect x="15" y="30" width="12" height="4" rx="2" fill="#fff"/><rect x="19" y="26" width="4" height="12" rx="2" fill="#fff"/><circle cx="42" cy="29" r="3.5" fill="#ffc83a"/><circle cx="49" cy="36" r="3.5" fill="#ff6b8b"/></svg>',
  quiz: '<svg viewBox="0 0 64 64"><rect x="12" y="8" width="40" height="50" rx="8" fill="currentColor"/><path d="M20 24l5 5 9-10M20 42l5 5 9-10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="38" y="24" width="8" height="4" rx="2" fill="#fff"/><rect x="38" y="42" width="8" height="4" rx="2" fill="#fff"/></svg>',
  story: '<svg viewBox="0 0 64 64"><path d="M8 14c9-3 17-2 24 3v35c-7-5-15-6-24-3z" fill="currentColor"/><path d="M56 14c-9-3-17-2-24 3v35c7-5 15-6 24-3z" fill="currentColor" opacity=".8"/></svg>',
  video: '<svg viewBox="0 0 64 64"><rect x="6" y="12" width="52" height="40" rx="10" fill="currentColor"/><path d="M27 23l13 9-13 9z" fill="#fff"/></svg>',
  reading: '<svg viewBox="0 0 64 64"><rect x="24" y="6" width="16" height="30" rx="8" fill="currentColor"/><path d="M16 30a16 16 0 0 0 32 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><rect x="29.5" y="45" width="5" height="10" fill="currentColor"/><rect x="20" y="54" width="24" height="5" rx="2.5" fill="currentColor"/></svg>',
};
// Jugnu's jar of 5 lights: a picture of the read's stars, never a number
const JAR = (lit) => `<svg viewBox="0 0 120 150"><defs><radialGradient id="jg"><stop offset="0" stop-color="#fff8c4"/><stop offset=".45" stop-color="#ffd84a"/><stop offset="1" stop-color="#ffd84a" stop-opacity="0"/></radialGradient></defs><rect x="34" y="8" width="52" height="16" rx="6" fill="#b5763b"/><path d="M28 26h64c8 0 12 6 12 14v86c0 12-8 18-20 18H36c-12 0-20-6-20-18V40c0-8 4-14 12-14z" fill="rgba(220,240,255,.55)" stroke="#fff" stroke-width="5"/>${[[45, 120], [78, 112], [60, 92], [40, 72], [80, 64]].map(([x, y], i) => (i < lit ? `<circle cx="${x}" cy="${y}" r="20" fill="url(#jg)"/><circle cx="${x}" cy="${y}" r="7" fill="#fff6b0"/>` : `<circle cx="${x}" cy="${y}" r="6" fill="rgba(255,255,255,.5)"/>`)).join('')}<path d="M30 44v70" stroke="#fff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/></svg>`;

// seeded: every draw of one card is the same picture
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function confetti(seed, count, box, colors, sizes) {
  const r = rng(seed);
  let h = '';
  for (let i = 0; i < count; i += 1) {
    const x = box[0] + r() * (box[2] - box[0]); const y = box[1] + r() * (box[3] - box[1]);
    const w = sizes[0] + r() * (sizes[1] - sizes[0]); const c = colors[Math.floor(r() * colors.length)]; const rot = Math.floor(r() * 180);
    const t = r();
    if (t < 0.45) h += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(w * 0.45).toFixed(1)}" rx="2" fill="${c}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    else h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(w * 0.32).toFixed(1)}" fill="${c}"/>`;
  }
  return h;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const num = (n, ur) => (ur ? String(n).replace(/[0-9]/g, (d) => UR_DIGITS[d]) : String(n));
// an Urdu line's closing "!": the Nastaliq "!" stands a gap apart, so it is pulled to its word and kept on its line
const tight = (html, ur) => (ur ? html.replace(/\s*!/g, '\u2060<span class="ex">!</span>') : html);
// «صحیح» after a word or digit: its tall start leaves a hole that reads as a double space (native read, 18 Oct)
const sah = (html, ur) => (ur ? html.replace(/ صحیح/g, ' <span class="sah">صحیح</span>') : html);

let _assets = null;
function b64(rel) {
  try {
    const abs = path.join(__dirname, '..', '..', rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch (_) { return ''; }
}
function assets() {
  if (!_assets) {
    _assets = {
      lexendBold: b64('fonts/Lexend-Bold.ttf'),
      nastaliq: b64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      // Jugnu's art is 200 px: drawn at its own size, never blown up
      celebrate: b64('assets/wq-art/celebrate.webp'),
    };
  }
  return _assets;
}

/** The card A picture's HTML for a card's facts. */
function renderCardA(f, opt = {}) {
  const ur = f.lang === 'ur';
  const l = ur ? 'ur' : 'en';
  const t = T[l];
  const a = opt.fonts === false ? {} : assets();
  const land = LAND_OF[f.kind] || 'gm';
  const c = COL[land];
  const Data = require('./web-quiz-card-data');
  const x = Data.clean(f.data);
  const lines = x ? Data.words(x, f.kind, l) : {};
  const COPY = require('./web-quiz-card-image').COPY;
  const deedKey = SAME_AS[f.deed] || f.deed;
  const who = f.first ? `<bdi>${esc(f.first)}</bdi>` : '';
  const deed = who && DEED3[l][deedKey] ? DEED3[l][deedKey](who) : esc(COPY[l][f.deed] || '');
  const fallbackDare = { read: Data.LINES[l].dareStory, story: Data.LINES[l].dareStory, book: Data.LINES[l].dareStory, listen: Data.LINES[l].dareStory, video: t.dareVideo };
  const dare = lines.dare || fallbackDare[f.kind] || t.darePlay;
  const MARK = require('./web-quiz-card-image').MARK;
  const markWord = (MARK[f.item && (f.item.type === 'book' || f.item.type === 'video') ? f.item.type : f.kind] || MARK.game)[l];
  const ribbon = x && x.b ? Data.BADGES[x.b][l] : markWord;
  // the medal: the score, else the words, else the sticker
  let big;
  let cap;
  if (x && x.o) {
    big = `<span dir="ltr" class="frac">${num(x.r, ur)}<i>/</i>${num(x.o, ur)}</span>`;
    cap = esc(lines.score);
  } else if (x && x.w) {
    big = num(x.w, ur);
    cap = esc(f.kind === 'read' ? t.wordsAloud : t.words);
  } else {
    big = `<span class="bigstar">${STAR()}</span>`;
    cap = f.deed === 'read_tried' || /_practice$/.test(f.deed) ? esc(markWord) : esc(COPY[l].sticker);
  }
  const stars = x && x.s != null ? `<div class="stars">${[0, 1, 2].map((i) => `<span class="st">${i < x.s ? STAR() : STAR('rgba(255,255,255,.35)', 'rgba(0,0,0,.18)')}</span>`).join('')}</div>` : '';
  const pic = opt.art && opt.art.b64 ? `data:${opt.art.type};base64,${opt.art.b64}` : null;
  let side;
  if (land === 'st' && pic) side = `<img class="side cover" src="${pic}" alt="">`;
  else if (land === 'vd' && pic) side = `<img class="side frame" src="${pic}" alt="">`;
  else if (land === 'sp') side = `<div class="side jar">${JAR(x && x.s != null ? [1, 2, 4, 5][x.s] : 3)}</div>`;
  else side = `<div class="side pad">${ICON[ICON_OF[f.kind] || 'game']}</div>`;
  const chip = `${ICON[ICON_OF[f.kind] || 'game']}<span>${esc(f.kind === 'quiz' ? t.quiz : t.land[land])} · ${esc(t.brand)}</span>`;
  const seed = String(f.kind || '').length;
  const art = `<svg viewBox="0 0 1200 630" preserveAspectRatio="none"><path d="M-20 560 Q 160 470 330 540 T 700 520 T 1220 500 V650 H-20z" fill="${c.edge}" opacity=".55"/><path d="M-20 600 Q 220 540 480 590 T 1220 570 V650 H-20z" fill="${c.deep}" opacity=".8"/><path d="M-10 610 C 200 560 380 600 560 560 S 900 520 1210 540" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="7" stroke-dasharray="2 20" stroke-linecap="round"/>${confetti(seed * 97 + 7, 60, [680, 0, 1200, 630], ['#ffe55c', '#ff6b8b', '#ffffff', '#7fe0ff', '#ffb000', '#b8ff7a'], [10, 22])}${confetti(seed * 31 + 3, 16, [0, 0, 680, 40], ['#ffe55c', '#ff6b8b', '#ffffff', '#7fe0ff'], [8, 16])}${confetti(seed * 13 + 5, 12, [0, 596, 680, 630], ['#ffe55c', '#ff6b8b', '#ffffff', '#7fe0ff'], [8, 16])}</svg>`;
  const fonts = opt.fonts === false ? '' : `@font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.lexendBold});unicode-range:U+0021}`;
  const jug = a.celebrate ? `<img class="jug" src="data:image/webp;base64,${a.celebrate}" alt="">` : '';
  return `<!doctype html><html lang="${l}" dir="${ur ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#222}
.card{--c:${c.c};--edge:${c.edge};--deep:${c.deep};--hi:${c.hi};--cx:${ur ? 25 : 75}%;--ink:#2A2D3A;--gold:#ffc83a;--gold-d:#b28c29;position:relative;width:${W}px;height:${H}px;overflow:hidden;isolation:isolate;font-family:${ur ? "'NastaliqUrdu','Lexend',sans-serif" : "'Lexend','NastaliqUrdu',sans-serif"};color:var(--ink);background:radial-gradient(circle at var(--cx) 46%,var(--hi) 0,var(--c) 34%,var(--deep) 82%)}
.layer{position:absolute;inset:0}.layer>svg{width:100%;height:100%;display:block}${ur ? '.mirror{transform:scaleX(-1)}' : ''}
.rays{background:repeating-conic-gradient(from 3deg at var(--cx) 46%,rgba(255,255,255,.17) 0 7deg,rgba(255,255,255,0) 7deg 18deg);-webkit-mask:radial-gradient(circle at var(--cx) 46%,#000 0,#000 45%,transparent 85%)}
.col{position:absolute;inset-inline-start:56px;top:40px;bottom:40px;width:610px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start}
.chip{display:inline-flex;align-items:center;gap:10px;background:#fff;color:var(--edge);font-weight:800;font-size:20px;letter-spacing:${ur ? 0 : '.06em'};text-transform:uppercase;padding:${ur ? '13px 18px 12px' : '9px 18px'};border-radius:999px;box-shadow:0 4px 0 rgba(0,0,0,.18)}
.chip svg{width:28px;height:28px;color:var(--c);flex:none}
.mid{display:flex;flex-direction:column;gap:${ur ? 0 : 14}px}
.deed{color:#fff;font-weight:800;font-size:${ur ? 36 : 40}px;line-height:1.1;padding-block:.06em .16em;text-shadow:0 3px 0 rgba(0,0,0,.22)}
.dare{color:#ffe55c;font-weight:800;font-size:${ur ? 52 : 68}px;line-height:1.04;padding-block:.06em .18em;letter-spacing:-.01em;text-shadow:0 5px 0 var(--deep),0 0 30px rgba(0,0,0,.25)}
.ctarow{display:flex;align-items:center;gap:20px}
.cta{display:inline-flex;align-items:center;gap:14px;background:var(--gold);color:var(--ink);font-weight:800;font-size:34px;line-height:1;padding:${ur ? '12px 30px 14px 18px' : '16px 32px 16px 18px'};border-radius:999px;box-shadow:0 7px 0 var(--gold-d),0 12px 24px rgba(0,0,0,.25);border:4px solid #fff3b8}
.cta svg{width:48px;height:48px;color:var(--ink);flex:none}
.join{color:#fff;font-weight:800;font-size:26px;line-height:1.2;padding-block:.1em .2em;padding-inline:.12em;white-space:nowrap;opacity:.95}
.med{position:absolute;z-index:1;inset-inline-end:100px;top:76px;width:400px;height:400px}
.ring{position:absolute;inset:0;border-radius:50%;background:repeating-conic-gradient(#ffd84a 0 6deg,#ffbf1f 6deg 12deg);border:10px solid #b27a00;box-shadow:0 14px 0 rgba(0,0,0,.25),0 0 0 8px rgba(255,255,255,.35),0 0 80px rgba(255,230,120,.8)}
.inner{position:absolute;inset:46px;border-radius:50%;background:radial-gradient(circle at 50% 30%,var(--edge),var(--deep));border:8px solid #fff3b0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center}
.stars{display:flex;gap:6px;margin-top:-6px}.st{display:inline-block;width:58px;height:58px}.st:nth-child(2){transform:translateY(-12px);width:66px;height:66px}.st svg,.bigstar svg{width:100%;height:100%;display:block}
.big{font-weight:800;font-size:${ur ? 92 : 118}px;line-height:${ur ? 1.6 : 1};padding-block:.04em .16em;margin-block:-6px -14px;letter-spacing:-.03em;text-shadow:0 5px 0 rgba(0,0,0,.3)}
.frac i{font-style:normal;opacity:.75;margin:0 .04em}.bigstar{display:inline-block;width:120px;height:120px;vertical-align:middle}
.cap{font-weight:800;font-size:22px;line-height:1.15;padding-block:.08em .18em;color:#fff3b0;max-width:260px}
.ribbon{position:absolute;left:50%;bottom:-34px;transform:translateX(-50%);white-space:nowrap;background:#e8394d;color:#fff;font-weight:800;font-size:30px;letter-spacing:${ur ? 0 : '.04em'};text-transform:uppercase;padding:12px 44px;line-height:1.1;clip-path:polygon(0 0,100% 0,calc(100% - 22px) 50%,100% 100%,0 100%,22px 50%);filter:drop-shadow(0 6px 0 #8f1d2c)}
.side{position:absolute;z-index:3}
.side.cover{width:130px;height:184px;inset-inline-end:-56px;top:-34px;transform:rotate(${ur ? -12 : 12}deg);border-radius:12px;border:6px solid #fff;box-shadow:0 10px 0 rgba(0,0,0,.22);object-fit:cover}
.side.frame{width:150px;height:86px;inset-inline-end:-70px;top:-40px;transform:rotate(${ur ? -9 : 9}deg);border-radius:14px;border:6px solid #fff;box-shadow:0 10px 0 rgba(0,0,0,.22);object-fit:cover}
.side.jar{width:120px;height:150px;inset-inline-end:-50px;top:-30px;z-index:2;filter:drop-shadow(0 8px 0 rgba(0,0,0,.2))}
.side.pad{width:130px;height:130px;inset-inline-end:-44px;top:-26px;transform:rotate(${ur ? -14 : 14}deg);color:var(--c);background:#fff;border-radius:50%;padding:18px;box-shadow:0 8px 0 rgba(0,0,0,.22)}
.side.pad svg{width:100%;height:100%}
.watched{position:absolute;top:110px;inset-inline-end:-66px;z-index:3;background:#fff;color:var(--edge);font-weight:800;font-size:22px;padding:8px 16px;border-radius:999px;box-shadow:0 5px 0 rgba(0,0,0,.2);transform:rotate(${ur ? -8 : 8}deg);display:flex;gap:8px;align-items:center}
.jug{position:absolute;width:200px;height:200px;inset-inline-end:430px;top:18px;filter:drop-shadow(0 0 22px rgba(255,236,140,.9));z-index:4${ur ? ';transform:scaleX(-1)' : ''}}
${ur ? `[data-ink]{font-weight:400;line-height:2.1;padding-block:.38em .4em;padding-inline:.4em}
.chip[data-ink]{font-size:22px;line-height:2;padding:6px 18px 4px}.deed[data-ink]{line-height:2}.dare[data-ink]{line-height:2.05}.cta[data-ink]{font-size:32px;line-height:2;padding:12px 18px 14px 30px}.cta svg{transform:translateY(5px)}
.big[data-ink]{line-height:2.1;padding-block:.05em .25em;margin-top:-34px;margin-bottom:-40px;-webkit-text-stroke:3px #fff;paint-order:stroke fill}.cap[data-ink]{line-height:2;white-space:nowrap;max-width:320px;padding-block:.35em .3em}
.ribbon[data-ink]{line-height:2;padding:10px 48px 10px}.watched[data-ink]{line-height:2;padding:0 16px 4px}.join[data-ink]{line-height:2;padding-block:.2em .3em}.ex{margin-inline-start:-.08em}.sah{margin-inline-start:-.32em}
.cta>span,.chip>span{line-height:2;padding-block:.35em .2em}` : ''}
</style></head><body><div class="card" data-land="${land}">
<div class="layer mirror" aria-hidden="true">${art}</div><div class="layer rays"></div>
<div class="med">${side}<div class="ring"></div><div class="inner">${stars}<div class="big" data-ink>${big}</div><div class="cap" data-ink>${sah(cap, ur)}</div></div>
${land === 'vd' ? `<div class="watched" data-ink>${CHECK}<span>${esc(t.watched)}</span></div>` : ''}<div class="ribbon" data-ink>${esc(ribbon)}</div></div>
${jug}<div class="col"><div class="chip" data-ink>${chip}</div><div class="mid"><div class="deed" data-ink>${tight(deed, ur)}</div><div class="dare" data-ink>${sah(tight(esc(dare), ur), ur)}</div></div>
<div class="ctarow"><div class="cta" data-ink>${PLAY}<span>${tight(esc(t.cta), ur)}</span></div><div class="join" data-ink>${esc(t.join)}</div></div></div>
</div></body></html>`;
}

/** The item's picture for the medal's corner: a book's cover, a lesson's frame; {type, b64} or null. Never throws. */
async function artOf(f) {
  try {
    const it = f && f.item;
    if (!it || !it.id) return null;
    const sharp = require('sharp');
    if (it.type === 'book') {
      const supabase = require('../../config/supabase');
      const StoryStore = require('./story-store');
      const { data } = await supabase.from('story_books').select('id, cover_file, status').eq('id', it.id).maybeSingle();
      if (!data || data.status !== 'ready' || !StoryStore.FILE_RX.test(String(data.cover_file || '')) || !StoryStore.BOOK_RX.test(String(data.id))) return null;
      const raw = await require('../../storage/r2').downloadFromR2(StoryStore.storyKey({ bookId: data.id, file: data.cover_file }), { bucket: StoryStore.storyBucket() || undefined });
      if (!raw || !raw.length) return null;
      const small = await sharp(raw).resize(260, 368, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
      return { type: 'image/jpeg', b64: small.toString('base64') };
    }
    if (it.type === 'video') {
      const pic = await require('./web-quiz-video-thumb').thumb(it.id);
      return pic && pic.bytes ? { type: pic.contentType || 'image/webp', b64: Buffer.from(pic.bytes).toString('base64') } : null;
    }
  } catch (err) {
    logToFile('⚠️ web quiz card A: the item\'s picture not read — drawn without it', { error: (err && err.name) || 'error' });
  }
  return null;
}

module.exports = { renderCardA, artOf, W, H, LAND_OF, DEED3, T };
