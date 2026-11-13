'use strict';
/**
 * bd-snkn32.4 — her rewritten grades 1–5 day as a phone page, in the v10 card's look (lp-v10-card/css.js: the same
 * section colours, a 520-wide page printed by lp-v10-card/print.js). Pure: script in, HTML out.
 *
 * Five sections in the reviewer's order: Opening → Explanation · I Do → We Do → You Do → Check → Homework, the way
 * named once at the top. An Urdu book's plan prints right to left in Nastaliq with Urdu headings. Every string is
 * escaped; a field the script does not have is simply not printed (no "not ready" line, the reviewer's rule).
 */
const { CSS } = require('./lp-v10-card/css');

const WORDS = {
  en: { grade: 'GRADE', day: 'Day', of: 'of', min: 'min', mine: 'Mine', way: 'Teaching way', open: 'Opening',
    explain: 'Explanation · I Do', we: 'We Do', you: 'You Do', check: 'Check · exit ticket', hw: 'Homework',
    ask: 'Ask', listen: 'Listen for', words: 'Words', materials: 'You need', reteach: 'Re-teach', ifStuck: 'If stuck', mistake: 'Common mistake', fix: 'Fix',
    answer: 'Answer', behind: 'Needs help', ahead: 'Ready for more', checkQ: 'Check', board: 'Board', say: 'Say' },
  ur: { grade: 'جماعت', day: 'دن', of: 'از', min: 'منٹ', mine: 'میرا', way: 'پڑھانے کا طریقہ', open: 'آغاز',
    explain: 'وضاحت · میں کروں', we: 'ہم کریں', you: 'آپ کریں', check: 'جانچ · ایگزٹ ٹکٹ', hw: 'ہوم ورک',
    ask: 'پوچھیں', listen: 'سنیں', words: 'الفاظ', materials: 'ضروری سامان', reteach: 'دوبارہ پڑھائیں', ifStuck: 'اگر مشکل ہو', mistake: 'عام غلطی', fix: 'درستی',
    answer: 'جواب', behind: 'مدد چاہیے', ahead: 'مزید کے لیے تیار', checkQ: 'جانچ', board: 'بورڈ', say: 'کہیں' },
};

/** The teaching ways by name, as the portal shows them (own/copy.ts ways, after the reviewer's TaRL wording). */
const WAY_NAMES = {
  en: { tarl: "Teach at each child's level", cpa: 'Things → pictures → numbers', phonics: 'Sounds first',
    games: 'Games and movement', story: 'Story and talk' },
  ur: { tarl: 'ہر بچے کی سطح پر پڑھائیں', cpa: 'چیزیں ← تصویریں ← اعداد', phonics: 'پہلے آوازیں',
    games: 'کھیل اور حرکت', story: 'کہانی اور بات چیت' },
};

/** An Urdu book's subject in Urdu, where the catalogue names it in English. */
const SUBJECT_UR = { urdu: 'اردو', 'social studies (urdu)': 'معاشرتی علوم', 'general knowledge': 'واقفیتِ عامہ' };
const subjectFor = (subject, ur) => (ur && !/[\u0600-\u06FF]/.test(String(subject || ''))
  ? SUBJECT_UR[String(subject || '').trim().toLowerCase()] || subject : subject);

const URDU_CSS = '[dir=rtl] .hd h1{line-height:1.9}.n,.t,bdi{unicode-bidi:isolate}[dir=rtl] body,[dir=rtl] .page{font-family:"Noto Nastaliq Urdu","Jameel Noori Nastaleeq",serif;line-height:2.1}'
  + '[dir=rtl] .say::before{content:"کہیں: "}[dir=rtl] .sec{border-inline-start-width:7px}';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const has = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
const g = (o, ...path) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);

const p = (text, cls = '') => (has(text) ? `<p${cls ? ` class="${cls}"` : ''}>${esc(text)}</p>` : '');
const line = (label, text) => (has(text) ? `<p><b>${esc(label)}:</b> ${esc(text)}</p>` : '');
const box = (title, inner, cls = '') => (inner ? `<div class="box${cls ? ` ${cls}` : ''}"><h3>${esc(title)}</h3>${inner}</div>` : '');

function moves(steps) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => {
    const body = [p(s.action, 'do'), has(s.say) ? `<span class="say">${esc(s.say)}</span>` : '',
      has(s.sayLocal) && s.sayLocal !== s.say ? `<span class="ex">${esc(s.sayLocal)}</span>` : ''].join('');
    return body ? `<div class="mv"><div class="n">${esc(s.n || i + 1)}</div><div>${body}</div></div>` : '';
  }).join('');
}

function worked(w, W) {
  if (!w || typeof w !== 'object') return '';
  const work = Array.isArray(w.work) ? w.work.map((x) => esc(x)).join('<br>') : '';
  return box(W.answer, [p(w.problem), work ? `<p>${work}</p>` : '', line(W.answer, w.answer)].join(''));
}

function section(key, title, minutes, inner) {
  if (!inner) return '';
  const t = has(minutes) ? `<span class="t">${esc(minutes)}′</span>` : '';
  return `<section class="sec" style="--c:var(--${key})"><div class="sh"><h2>${esc(title)}</h2>${t}</div>${inner}</section>`;
}

function opening(s, W) {
  const h = s.hook || {};
  const words = (h.keyWords || []).map((k) => (k && typeof k === 'object' ? `<b>${esc(k.term || '')}</b>${has(k.def) ? ` — ${esc(k.def)}` : ''}` : esc(k)));
  const mats = (h.materials || []).filter(has);
  return [mats.length ? line(W.materials, mats.join(' · ')) : '', line(W.ask, g(h, 'warmUp', 'teacherAsks')), line(W.listen, g(h, 'warmUp', 'expectedAnswer')), p(h.story),
    (h.conversation || []).map((c) => line(W.ask, c && c.teacherAsks)).join(''), moves(h.steps),
    words.length ? box(W.words, `<p>${words.join(' · ')}</p>`) : '',
    box(W.board, [p(g(h, 'board', 'instruction')), has(g(h, 'board', 'content')) ? `<p>${esc(h.board.content).replace(/\n/g, '<br>')}</p>` : ''].join(''))].join('');
}

function explain(s, W) {
  const d = s.iDo || {};
  return [moves(d.steps), has(d.teacherSays) ? `<span class="say">${esc(d.teacherSays)}</span>` : '', worked(d.worked, W),
    line(W.checkQ, d.cfu), line(W.ifStuck, d.ifStruggle),
    box(W.mistake, [p(g(d, 'misconception', 'slip')), line(W.fix, g(d, 'misconception', 'fix'))].join(''), 'mis')].join('');
}

function weDo(s, W) {
  const d = s.weDo || {};
  const pr = d.partner || {};
  return [p(d.action, 'do'), p(d.strategy), moves(d.steps), p(pr.instruction),
    has(pr.a) ? `<span class="ex">A: “${esc(pr.a)}” → B: “${esc(pr.b || '')}”</span>` : '', worked(d.modelled, W),
    line(W.checkQ, d.cfu)].join('');
}

function youDo(s, W) {
  const d = s.youDo || {};
  const probs = (d.problems || []).map((x) => (x && typeof x === 'object' ? `<li>${esc(x.prompt || '')}</li>` : `<li>${esc(x)}</li>`)).join('');
  return [p(d.action, 'do'), moves(d.steps), probs ? `<ol class="steps">${probs}</ol>` : '', p(g(d, 'wordProblem', 'prompt')),
    line(W.checkQ, d.cfu), line(W.behind, g(d, 'behind', 'prompt')), line(W.ahead, g(d, 'ahead', 'prompt'))].join('');
}

function check(s, W) {
  const ex = (g(s, 'wrap', 'exitOptions') || [])[0] || {};
  return [p(ex.prompt, 'do'), p(ex.howToRun), p(s.exitSuccessCriteria), line(W.reteach, g(s, 'wrap', 'reteach'))].join('');
}

function homework(s) {
  const hw = g(s, 'wrap', 'homework');
  return (Array.isArray(hw) ? hw : [hw]).filter(has).map((x) => p(typeof x === 'object' ? JSON.stringify(x) : x)).join('');
}

/** The page. `way` is the chosen teaching way's name in the plan's language. */
/** `fontCss`: the embedded @font-face rules (lp-k5-own-fonts), passed in so this stays pure. */
const URDU_DIGITS = (v) => String(v).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** bd-snkn32.17 — the book pages her plan teaches (`p.3-6`; `ص ۳-۶` in an Urdu book), or ''. */
function pageSpan(p, ur, num) {
  if (!p || !Number.isInteger(p.start) || !Number.isInteger(p.end)) return '';
  const r = p.start === p.end ? num(p.start) : `${num(p.start)}-${num(p.end)}`;
  return ` · <span class="pg">${ur ? `ص ${r}` : `p.${r}`}</span>`;
}

function renderK5Own(script, { lang = 'en', grade, subject, way, pages = null, fontCss = '' } = {}) {
  const ur = lang === 'ur';
  const num = (v) => (ur ? URDU_DIGITS(v) : v); // the reviewer: the header's digits match the Urdu body's (۲, not 2)
  const W = WORDS[ur ? 'ur' : 'en'];
  const s = script || {};
  const m = s.meta || {};
  const day = has(m.day) ? `${W.day} ${esc(num(m.day))}${has(m.total) ? ` ${W.of} ${esc(num(m.total))}` : ''}` : '';
  const head = `<div class="hd"><div class="k"><span><b>${W.grade} ${esc(num(grade ?? m.grade ?? ''))} · ${esc(subjectFor(subject || m.subject || '', ur))}</b></span>`
    + `<span>${day}${has(m.minutes) ? ` · ${esc(num(m.minutes))} ${W.min}` : ''}${pageSpan(pages, ur, num)} · ${W.mine}</span></div>`
    + `<h1>${esc(m.topic || '')}</h1><div class="goal">${esc(s.goal || '')}</div></div>`
    + (has(way) ? `<div class="info"><b>${W.way}</b><span>${esc(way)}</span></div>` : '');
  const body = [
    section('open', W.open, null, opening(s, W)),
    section('explain', W.explain, g(s, 'iDo', 'minutes'), explain(s, W)),
    section('we', W.we, g(s, 'weDo', 'minutes'), weDo(s, W)),
    section('you', W.you, g(s, 'youDo', 'minutes'), youDo(s, W)),
    section('check', W.check, null, check(s, W)),
    section('hw', W.hw, null, homework(s)),
  ].join('\n');
  return `<!doctype html><html lang="${ur ? 'ur' : 'en'}"${ur ? ' dir="rtl"' : ''}><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<style>${CSS}${fontCss}${ur ? URDU_CSS : ''}</style></head><body><div class="page">${head}\n${body}</div></body></html>`;
}

module.exports = { renderK5Own, WORDS, WAY_NAMES };
