/**
 * card.json -> the v10 phone card HTML, in the v20 design (port of workbench/card/card_render.py, bd-v0toag.27.6). Pure.
 *
 * Text is escaped; only <b> and <i> pass through. Each move carries data-covers (the v9 move ids), each picture
 * data-pic, the star slot is present and hidden, and every section links to its v9 section (#v9-<sec>). The neighbour
 * turn prints who goes first, both lines and the stop; a number-sense opening move gets its chip. Yesterday and Think
 * aloud print on their move, Ask and Listen for on the last Check move.
 *
 * Output is byte-identical to the Python builder on the same card (golden.test.js).
 */
const { esc, truthy } = require('./pytext');
const { CSS } = require('./css');
const { ORDER, CORE } = require('./rules-patterns');

const TITLES = { open: 'Opening', explain: 'Explanation · I Do', we: 'We Do', you: 'You Do · in the book',
  check: 'Check · exit ticket', hw: 'Homework' };
const LABELS = { open: 'Open', explain: 'Explain', we: 'We Do', you: 'You Do', check: '✓' };
const g = (o, k, d = '') => (o && o[k] !== undefined && o[k] !== null ? o[k] : d);

/** Escape text, keep <b>/<i>. */
const t = (s) => esc(String(s), false).replace(/&lt;(\/?)(b|i)&gt;/g, '<$1$2>');
/** Escape an attribute value. */
const a = (s) => esc(String(s), true);

function video(card) {
  const v = card.video;
  return truthy(v) ? ` <b>Video</b><span>📺 <a href="${a(v.href)}">${t(v.title)}</a></span>\n` : '';
}

function header(card) {
  const h = card.header;
  return `<div class="hd">\n <div class="k"><span><b>GRADE ${h.grade} · ${t(h.subject).toUpperCase()}</b> · `
    + `${t(h.chapter)}</span><span>Day ${h.day} · ${h.minutes} min</span></div>\n`
    + ` <h1>${t(h.title)}</h1>\n <div class="goal">${t(h.goal)}</div>\n</div>\n\n`
    + `<div class="info">\n <b>Bring</b><span>${t(card.bring)}</span>\n`
    + ` <b>Words</b><span>${card.words.map(t).join(' · ')}</span>\n${video(card)}</div>\n`;
}

function timeBar(by) {
  const m = Object.fromEntries(CORE.map((s) => [s, by[s].minutes]));
  const pre = m.open + m.explain; const prac = m.we + m.you; const post = m.check;
  const total = CORE.reduce((x, s) => x + m[s], 0);
  const aria = CORE.map((s) => `${m[s]} ${s !== 'check' ? LABELS[s] : 'check'}`.toLowerCase()).join(', ');
  const bar = CORE.map((s) => `  <span data-sec="${s}" style="flex:${m[s]};background:var(--${s})">${m[s]}′</span>`).join('\n');
  const lab = CORE.map((s) => `<span style="flex:${m[s]}">${LABELS[s]}</span>`).join('');
  return `<div class="time" aria-label="Time: ${a(aria)}">\n`
    + ` <div class="pr"><span style="flex:${pre}"></span><span style="flex:${prac}">PRACTICE · ${prac} of `
    + `${total} min</span><span style="flex:${post}"></span></div>\n <div class="bar">\n${bar}\n </div>\n`
    + ` <div class="lab">${lab}</div>\n</div>\n`;
}

const STAR = '<!-- Coaching slot: filled per teacher from their last report once recordings start. Hidden in the base '
  + 'corpus. -->\n<div class="star" hidden data-slot="star"><span class="l">★ Your one thing today</span> · in move '
  + '<b data-slot="star-move"></b><br><span data-slot="star-text"></span></div>\n';

function turn(tn) {
  return `<span class="ex"><b>${t(tn.first)} first:</b> “${t(tn.a)}” → <b>Reply:</b> “${t(tn.b)}” · `
    + `<b>Stop:</b> ${t(tn.stop)}${truthy(tn.help) ? ` · <b>Stuck?</b> ${t(tn.help)}` : ''}</span>`;
}

function move(n, m, extraIn = '') {
  const chip = truthy(m.chip) ? m.chip : (truthy(m.sense) ? 'NUMBER SENSE' : '');
  const extra = (truthy(m.turn) ? turn(m.turn) : '')
    + (truthy(m.think) ? `<span class="ex"><b>Think aloud:</b> “${t(m.think)}”</span>` : '') + extraIn;
  const y = g(m, 'yesterday');
  // a line that already starts "Yesterday ..." bolds its own word, so the card never prints "Yesterday: Yesterday"
  let yday = '';
  if (y) yday = y.startsWith('Yesterday') ? `<span class="ex"><b>Yesterday</b>${t(y.slice(9))}</span>` : `<span class="ex"><b>Yesterday:</b> ${t(y)}</span>`;
  const lead = (chip ? `<span class="chip">${t(chip)}</span><br>` : '')
    + (truthy(m.clock) ? `<span class="clock">${t(m.clock)}</span><br>` : '');
  const say = truthy(m.say) ? `\n  <span class="say">${t(m.say)}</span>` : '';
  const how = truthy(m.how) ? ` ${t(m.how)}` : '';
  return ` <div class="mv" data-covers="${a(m.covers.join(' '))}"><span class="n">${n}</span><p>${lead}`
    + `${yday}<span class="do">${t(m.do)}</span>${how}${say}${extra}</p></div>\n`;
}

const span = (sec, start) => (sec.sec === 'hw' ? 'at home' : `${start}–${start + sec.minutes}′`);

function section(sec, start, n0, v9) {
  const s = sec.sec;
  let out = `<section class="sec" style="--c:var(--${s})" data-sec="${s}">\n <div class="sh"><h2>${TITLES[s]}</h2>`
    + `<span class="t">${span(sec, start)}</span><a class="fd" href="${a(v9)}#v9-${s}">Full details ›</a></div>\n`;
  const last = sec.moves.length - 1;
  const extra = (truthy(sec.stuck) ? `<span class="ex"><b>If stuck:</b> ${t(sec.stuck)}</span>` : '')
    + (truthy(sec.ask) ? `<span class="ex"><b>Ask:</b> “${t(sec.ask)}” → <b>Listen for:</b> ${t(sec.listen)}</span>` : '')
    + (truthy(sec.success) ? `<span class="ex"><b>Success:</b> “${t(sec.success)}” 👍 or ✊ first</span>` : '');
  sec.moves.forEach((m, i) => { out += move(n0 + i, m, i === last ? extra : ''); });
  if (truthy(sec.answers)) {
    const rows = sec.answers.map(([q, ans]) => `   <div><span>${t(q)}</span><span class="e">${t(ans)}</span></div>`).join('\n');
    out += ` <div class="box"><h3>Check 5 books · answers</h3>\n  <div class="ans">\n${rows}\n  </div></div>\n`;
  }
  if (truthy(sec.mistake)) out += ` <div class="box mis"><h3>Likely mistake</h3>${t(sec.mistake)}</div>\n`;
  if (truthy(sec.correct)) {
    out = `${out.slice(0, -'</p></div>\n'.length)}<span class="ex"><b>Correct:</b> ${t(sec.correct)}</span></p></div>\n`;
  }
  return `${out}</section>\n`;
}

function picture(p) {
  const head = `<div class="board" data-pic="${a(p.id)}"><h3>${t(p.title)}</h3>`;
  let body;
  if (p.kind === 'faces') {
    body = `<div class="faces">\n${p.items.map(([e, w]) => ` <div><span class="e">${t(e)}</span>${t(w)}</div>`).join('')}</div>`;
  } else if (p.kind === 'steps') {
    // an item is a heading, or [big text, small label]
    body = `<ol class="steps">${p.items.map((x) => (Array.isArray(x)
      ? `<li><b>${t(x[0])}</b> <small>${t(x[1])}</small></li>` : `<li>${t(x)}</li>`)).join('')}</ol>`;
  } else body = `<div class="svg">${p.svg}</div>`;
  const line = truthy(p.line) ? `\n <div class="pl"><b>${t(p.line)}</b></div>` : '';
  return `${head}${body}${line}</div>\n`;
}

/** The card HTML. Call validate(card) first; render does not re-check content. Does not mutate the card. */
function render(card) {
  const ur = card.lang === 'ur';
  const by = {};
  card.sections.forEach((s) => { by[s.sec] = s; });
  const h = card.header;
  const body = [];
  let start = 0; let n = 1;
  ORDER.filter((k) => Object.prototype.hasOwnProperty.call(by, k)).map((k) => by[k]).forEach((s) => {
    body.push(section(s, start, n, card.v9_html));
    (card.pictures || []).filter((p) => p.after === s.sec).forEach((p) => body.push(picture(p)));
    start += s.sec !== 'hw' ? s.minutes : 0;
    n += s.moves.length;
  });
  const head = `<!doctype html>\n<html lang="${ur ? 'ur' : 'en'}" dir="${ur ? 'rtl' : 'ltr'}"><head>`
    + '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    + `<meta name="color-scheme" content="light">\n<title>G${h.grade} ${t(h.subject)} `
    + `${t(h.chapter.split(' ')[0])} Day ${h.day} Card</title>\n<style>\n${CSS}\n</style></head>\n`;
  const foot = `<div class="foot"><a href="${a(card.v9_html)}">Full lesson plan ›</a></div>\n`;
  return `${head}<body><div class="page">\n\n${header(card)}\n${timeBar(by)}\n${STAR}\n${body.join('\n')}\n${foot}</div></body></html>\n`;
}

module.exports = { render, CSS, t, a };
