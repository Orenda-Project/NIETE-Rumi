'use strict';
/**
 * The child's CLASS card — where they stand against the class on this quiz.
 *
 * Sent to every child who finished, at the moment their teacher gets the class
 * report, as an image in the same family as the scorecard they got at the end
 * of the quiz (video-quiz-scorecard.template.js): the same ground, the same
 * eyebrow, the same type, the same gold. What is new is a ranked list of the
 * class with THIS child's row lit — their name, their score, their place — and
 * the class average beside their own.
 *
 * Two modes, chosen by the caller:
 *   'full'  every finished child by name (the class as the teacher sees it)
 *   'top'   the top rows by name; everyone else is a count, except the child
 *           the card is for, whose own row is always shown wherever it falls
 * Both are bounded: at most MAX_ROWS rows are painted, and when the child sits
 * below the visible top the list shows the top, a gap row, then the child.
 *
 * Rank is shared on a tie ("3=" reads as third-equal), so two children with
 * the same score never see themselves ordered by something invisible.
 *
 * A name keeps the script it was typed in (dirOf); the CARD's language decides
 * which edge the blocks hang off. A fraction is always left-to-right.
 */
const fs = require('fs');
const path = require('path');
const { PALETTE, FONTS, latticeSvg, diamondSvg, dirOf } = require('./niete-brand');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const { cardPalette } = require('./video-quiz-scorecard.template');

const MAX_ROWS = 8;
const TOP_NAMED = 5;          // 'top' mode: how many rows carry a name

let _assets = null;
function readBase64(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  try { return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : ''; } catch { return ''; }
}
function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
      nieteMark: readBase64('assets/niete-mark-white-transparent.png'),
    };
  }
  return _assets;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RTL_LANGS = new Set(['ur']);

/**
 * Copy painted INTO the card comes from the catalog (vqClass*), in the quiz
 * language; only the ordinal word is built here, because "5th" and "پانچواں"
 * are grammar, not copy.
 */
function strings(language) {
  const ux = (key, params) => resolveUx(key, { language, params });
  const ord = language === 'ur' ? urduOrdinal : ordinal;
  return {
    eyebrow: ux('vqClassEyebrow'),
    place: (rank, n) => ux('vqClassPlace', { place: ord(rank), n }),
    placeTie: (rank, n) => ux('vqClassPlaceTie', { place: ord(rank), n }),
    you: ux('vqClassYou'), classAvg: ux('vqClassAvg'), yours: ux('vqClassYours'),
    others: (n) => ux('vqClassOthers', { n }),
    finished: (n) => ux('vqClassFinished', { n }),
  };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function urduOrdinal(n) {
  const words = { 1: 'پہلا', 2: 'دوسرا', 3: 'تیسرا', 4: 'چوتھا', 5: 'پانچواں', 6: 'چھٹا', 7: 'ساتواں', 8: 'آٹھواں', 9: 'نواں', 10: 'دسواں' };
  return words[n] || `${n}واں`;
}

/**
 * Rank the finished sessions: percentage first, then correct count, then who
 * finished first. Ties share a rank. Pure, exported so it can be asserted.
 */
function rankRows(rows) {
  const sorted = [...(rows || [])]
    .filter((r) => r && Number.isFinite(Number(r.pct)))
    .sort((a, b) => (Number(b.pct) - Number(a.pct))
      || (Number(b.correct || 0) - Number(a.correct || 0))
      || (String(a.completedAt || '').localeCompare(String(b.completedAt || ''))));
  let rank = 0;
  let prevKey = null;
  return sorted.map((r, i) => {
    const key = `${Number(r.pct)}|${Number(r.correct || 0)}`;
    if (key !== prevKey) { rank = i + 1; prevKey = key; }
    const tied = sorted.filter((x) => `${Number(x.pct)}|${Number(x.correct || 0)}` === key).length > 1;
    return { ...r, rank, tied };
  });
}

/**
 * Which rows get painted. Returns an array of row objects, with `gap: true`
 * entries standing in for a run of hidden rows and `anon: true` marking a row
 * shown without its name ('top' mode).
 */
function visibleRows(ranked, targetIndex, mode) {
  const n = ranked.length;
  if (n <= MAX_ROWS) {
    return ranked.map((r, i) => ({ ...r, anon: mode === 'top' && i >= TOP_NAMED && i !== targetIndex }));
  }
  const head = MAX_ROWS - 2;                       // rows before the gap
  if (targetIndex < head + 1) {
    // the child is inside the top: show the top MAX_ROWS-1, then one gap row
    const rows = ranked.slice(0, MAX_ROWS - 1).map((r, i) => ({ ...r, anon: mode === 'top' && i >= TOP_NAMED && i !== targetIndex }));
    rows.push({ gap: true, count: n - (MAX_ROWS - 1) });
    return rows;
  }
  const rows = ranked.slice(0, head).map((r, i) => ({ ...r, anon: mode === 'top' && i >= TOP_NAMED }));
  rows.push({ gap: true, count: targetIndex - head });
  rows.push({ ...ranked[targetIndex], anon: false });
  const after = n - targetIndex - 1;
  if (after > 0) rows.push({ gap: true, count: after, tail: true });
  return rows;
}

function renderLeaderboardHtml(d) {
  const a = assets();
  const {
    topic = 'Quiz', subject = '', className = '', rows = [], targetSessionId = null, mode = 'full',
  } = d || {};
  const language = clampLanguage((d && d.language) || 'en');
  const RTL = RTL_LANGS.has(language);
  const dir = RTL ? 'rtl' : 'ltr';
  const S = strings(language);
  const palette = cardPalette();

  const ranked = rankRows(rows);
  const n = ranked.length;
  const targetIndex = Math.max(0, ranked.findIndex((r) => r.sessionId === targetSessionId));
  const me = ranked[targetIndex] || null;
  const avg = n ? Math.round(ranked.reduce((s, r) => s + Number(r.pct || 0), 0) / n) : 0;
  const shown = visibleRows(ranked, targetIndex, mode);

  const logoImg = a.nieteMark ? `<img class='logo' src='data:image/png;base64,${a.nieteMark}' alt='NIETE'>` : '';
  const lattice = latticeSvg({ id: 'niete-lattice-lb', line: '#ffffff', opacity: 0.085 });
  const nuqtas = diamondSvg({ size: 7, fill: PALETTE.greenPale, stroke: PALETTE.greenPale, width: 0, className: 'dia nuqta' })
    + diamondSvg({ size: 7, fill: PALETTE.greenPale, stroke: PALETTE.greenPale, width: 0, className: 'dia nuqta faint' });

  const placeLine = me ? (me.tied ? S.placeTie(me.rank, n) : S.place(me.rank, n)) : '';
  const subline = [topic, className, subject].filter(Boolean)
    .map((s) => `<span class='content' dir='${dirOf(s)}'>${esc(s)}</span>`).join(`<span class='sep'>·</span>`);

  const rowHtml = shown.map((r) => {
    if (r.gap) {
      return `<div class='row gap${r.tail ? ' tail' : ''}'><span class='dots'>···</span><span class='gaptxt'>${esc(S.others(r.count))}</span></div>`;
    }
    const isMe = me && r.sessionId === me.sessionId;
    const label = r.anon ? '' : esc(r.name || '');
    const nameDir = dirOf(r.name || '');
    const pct = Math.max(0, Math.min(100, Math.round(Number(r.pct) || 0)));
    return `<div class='row${isMe ? ' me' : ''}${r.anon ? ' anon' : ''}'>
      <span class='rk'><span class='dia2'><span>${r.rank}${r.tied ? '=' : ''}</span></span></span>
      <span class='nm content' dir='${nameDir}'>${isMe && !label ? esc(S.you) : label}${isMe && label ? `<span class='youtag'>${esc(S.you)}</span>` : ''}</span>
      <span class='bar'><span class='fill' style='width:${pct}%'></span></span>
      <span class='sc'>${Number(r.correct) || 0}<span>/${Number(r.total) || 0}</span></span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang='${language}'><head><meta charset='utf-8'><style>
  @font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend})}
  @font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
  @font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
  @font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold})}
  *{box-sizing:border-box;margin:0;padding:0}
  .content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:1.8}
  .content[dir="ltr"]{font-family:${FONTS.bodyLatin};line-height:1.3}
  body{width:540px;font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin};color:#fff}
  .card{width:540px;background:linear-gradient(${RTL ? '203deg' : '157deg'},${palette.bgFrom} 0%,${palette.bgFrom} 32%,${palette.bgTo} 88%,${palette.bgEnd} 100%);
    padding:24px 30px 24px;position:relative;overflow:hidden;display:flex;flex-direction:column;gap:14px}
  .card::before{content:'';position:absolute;width:560px;height:560px;inset-inline-end:-190px;bottom:-260px;border-radius:50%;
    background:radial-gradient(circle,${palette.bloom} 0%,rgba(71,186,125,0) 70%)}
  .lattice{position:absolute;left:0;top:0;width:100%;height:100%}
  .card>*:not(.lattice){position:relative;z-index:1}
  .hdr{display:flex;justify-content:space-between;align-items:center}
  .t1{direction:${dir};font-size:${RTL ? '20px' : '16px'};letter-spacing:${RTL ? '0' : '2.4px'};color:${PALETTE.greenPale};font-weight:800;
    display:flex;align-items:center;gap:6px;line-height:1.5}
  .t1 .nuqta{flex:0 0 auto;margin-bottom:${RTL ? '5px' : '1px'}} .t1 .faint{opacity:.55}
  .logo{width:44px;height:auto;opacity:.96;display:block}
  .place{font-size:${RTL ? '30px' : '30px'};font-weight:800;line-height:${RTL ? '1.6' : '1.15'};letter-spacing:${RTL ? '0' : '-.6px'};direction:${dir};text-align:${RTL ? 'right' : 'left'}}
  .sub{font-size:${RTL ? '19px' : '17px'};opacity:.82;direction:${dir};text-align:${RTL ? 'right' : 'left'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub .sep{opacity:.5;margin:0 7px}
  /* the two numbers that matter, side by side */
  .stats{display:flex;gap:12px;direction:${dir}}
  .stat{flex:1;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:9px 14px}
  .stat.mine{background:rgba(255,201,74,.16);border-color:rgba(255,201,74,.55)}
  .stat .n{font-size:30px;font-weight:800;line-height:1;direction:ltr;unicode-bidi:isolate;font-family:${FONTS.bodyLatin}}
  .stat.mine .n{color:${palette.accent}}
  .stat .l{font-size:${RTL ? '16px' : '12.5px'};letter-spacing:${RTL ? '0' : '.08em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.greenPale};margin-top:${RTL ? '2px' : '5px'};line-height:1.5}
  /* the list */
  .list{display:flex;flex-direction:column;gap:6px;direction:${dir}}
  .row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:11px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10)}
  .row.me{background:rgba(255,201,74,.18);border:1.5px solid ${palette.accent};box-shadow:0 0 0 3px rgba(255,201,74,.22),0 0 22px ${palette.glow}}
  .row.anon .nm{opacity:.45}
  .rk{flex:0 0 30px;display:inline-flex;align-items:center;justify-content:center}
  .dia2{width:26px;height:26px;position:relative;display:inline-block}
  .dia2::before{content:'';position:absolute;inset:1px;background:rgba(255,255,255,.12);border:1.3px solid rgba(255,255,255,.35);transform:rotate(45deg);border-radius:4px}
  .row.me .dia2::before{background:${palette.accent};border-color:${palette.accent}}
  .dia2>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:${FONTS.bodyLatin};font-size:12.5px;font-weight:800;direction:ltr}
  .row.me .dia2>span{color:${palette.badgeInk}}
  .nm{flex:1 1 0;min-width:0;font-size:${RTL ? '18px' : '17px'};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:start}
  .nm[dir="rtl"]{font-size:19px;line-height:1.6}
  .row.anon .nm::before{content:'';display:inline-block;width:64px;height:9px;border-radius:5px;background:rgba(255,255,255,.28);vertical-align:middle}
  .youtag{display:inline-block;font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin};font-size:${RTL ? '14px' : '11px'};letter-spacing:${RTL ? '0' : '.1em'};${RTL ? '' : 'text-transform:uppercase;'}
    background:${palette.accent};color:${palette.badgeInk};border-radius:8px;padding:${RTL ? '0 8px 2px' : '2px 7px'};margin-inline-start:8px;vertical-align:middle;line-height:1.4}
  .bar{flex:0 0 118px;height:9px;border-radius:5px;background:rgba(255,255,255,.16);overflow:hidden;direction:ltr}
  .bar .fill{display:block;height:100%;border-radius:5px;background:rgba(255,255,255,.72)}
  .row.me .bar .fill{background:${palette.accent}}
  .sc{flex:0 0 58px;text-align:right;font-family:${FONTS.bodyLatin};font-weight:800;font-size:18px;direction:ltr;unicode-bidi:isolate}
  .sc span{font-weight:400;font-size:13px;opacity:.7}
  .row.gap{background:transparent;border-color:transparent;padding:2px 10px;gap:12px}
  .dots{flex:0 0 30px;text-align:center;letter-spacing:3px;opacity:.55;font-weight:800}
  .gaptxt{font-size:${RTL ? '16px' : '13.5px'};opacity:.7;line-height:1.6}
  .foot{display:flex;justify-content:space-between;align-items:center;font-size:${RTL ? '16px' : '13px'};opacity:.78;direction:${dir}}
  </style></head><body><div class='card' dir='${dir}'>
  ${lattice}
  <div class='hdr'><div class='t1'>${esc(S.eyebrow)}${nuqtas}</div>${logoImg}</div>
  <div>
    <div class='place'>${esc(placeLine)}</div>
    <div class='sub'>${subline}</div>
  </div>
  <div class='stats'>
    <div class='stat mine'><div class='n'>${me ? Math.round(Number(me.pct) || 0) : 0}%</div><div class='l'>${esc(S.yours)}</div></div>
    <div class='stat'><div class='n'>${avg}%</div><div class='l'>${esc(S.classAvg)}</div></div>
  </div>
  <div class='list'>${rowHtml}</div>
  <div class='foot'><span>${esc(S.finished(n))}</span><span>NIETE</span></div>
  </div></body></html>`;
}

module.exports = renderLeaderboardHtml;
module.exports.rankRows = rankRows;
module.exports.visibleRows = visibleRows;
module.exports.MAX_ROWS = MAX_ROWS;
module.exports.TOP_NAMED = TOP_NAMED;
