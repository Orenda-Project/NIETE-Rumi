'use strict';
/**
 * The quiz-maker page (`/m/<token>`), server-rendered: grade → subject → topic chips (each topic marked EN / «اردو»
 * by its question language, none when unknown), then "Make the quiz"; on success the ready screen: what the quiz is
 * (grade, subject, topic, question language, "a ready quiz from the NIETE library"), its first question, "Send to
 * class group" (a plain link to /m/<token>/send?c=<share code id>, which answers 302 → wa.me/?text=), "Copy the
 * message" (always there: the Clipboard API, and the message selected in its visible read-only block so a
 * long-press copy works where the API is refused) and the next-time line. A token with a pre-fill whose cell is in
 * the bank opens on "Last time: Grade 4, Mathematics" with "Use it" (→ the topic step) / "Change" (→ the grade chips).
 * Every chip is in the HTML (hidden until its step); ONE small inline script shows one step at a time, posts each
 * step to /api/ft/step (fire-and-forget) and the make to /api/ft/make; it never builds HTML (textContent only). Inline CSS and the script are allowed by their sha256 in the page's
 * Content-Security-Policy (sent as a header by the route and repeated in a <meta>, so a proxy that drops the
 * header still serves a locked page).
 *
 * The page asks nothing typed: chips and buttons only (a hidden token field on the "Change my choice" form, which is
 * shown ONLY on a token from the chooser door). Topic names are the bank's English strings verbatim (isolated with
 * <bdi> on the Urdu page). Nothing on the page says the quiz came from the teacher's own lesson.
 * Hooks for the next changes: <div id="ft-banner-slot"> (the tour's banner) and window.ftOnFirstChip (called once on
 * the first grade tap; the tour replaces it).
 */
const crypto = require('crypto');
const { clampLanguage } = require('../../config/ux-strings');
const { str, fill, subjectLabel, SUBJECT_CODES } = require('./maker.strings');

const ASSET_BASE = '/wq';
const UR_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
/** Grade digits as the page's language writes them (Urdu-Indic on the Urdu page). */
function digits(n, lang) {
  const urdu = lang === 'ur';
  return urdu ? String(n).replace(/\d/g, (d) => UR_DIGITS[Number(d)]) : String(n);
}
/** JSON safe inside a <script type="application/json"> block. */
const bootJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const CSS = [
  ':root{--brand:#47BA7D;--brand-d:#23794D;--ink:#2A2D3A;--brand-ink:#333748;--muted:#5F6374;--ground:#F5F8F6;--card:#fff;--line:#DCE5DF;--warn:#8A5E06;--warn-bg:#FFF2CF;',
  '--f:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--fu:"WQ Nastaliq 2","Noto Nastaliq Urdu",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}',
  'body{background:var(--ground);color:var(--ink);font-family:var(--f);-webkit-text-size-adjust:100%;touch-action:manipulation}',
  'html[lang=ur] body{font-family:var(--fu);word-spacing:.12em}',
  '.mk{max-width:480px;margin:0 auto;padding:12px 16px 24px;display:flex;flex-direction:column;gap:12px}',
  '.mk-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px}',
  'h1{margin:0;font-size:26px;line-height:1.25;font-weight:900;color:var(--brand-ink)}html[lang=ur] h1{font-weight:400;line-height:1.9}',
  'h2{margin:4px 0 8px;font-size:15px;font-weight:900;color:var(--muted);letter-spacing:.04em}html[lang=ur] h2{font-weight:400;font-size:18px;line-height:1.8;letter-spacing:0}',
  '.mk-sw{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;border:2px solid var(--line);background:var(--card);color:var(--brand-ink);font-weight:800;font-size:14px;text-decoration:none;font-family:var(--f)}',
  '.mk-sw[lang=ur]{font-family:var(--fu);font-weight:400;font-size:15px;line-height:1.6}',
  '[hidden]{display:none!important}',
  '.mk-chips{display:flex;flex-wrap:wrap;gap:10px}',
  '.mk-chip{min-height:52px;min-width:52px;padding:8px 16px;border-radius:16px;border:2px solid var(--line);background:var(--card);color:var(--brand-ink);font:800 18px/1.3 var(--f);cursor:pointer;text-align:start}',
  'html[lang=ur] .mk-chip{font-family:var(--fu);font-weight:400;line-height:1.8}',
  '.mk-chip bdi,.mk-topic{font-family:var(--f);font-weight:800}',
  '.mk-chip[aria-pressed=true]{border-color:var(--brand);background:#E8F6EE}',
  '.mk-grade .mk-chip{font-size:22px;min-width:60px;text-align:center}',
  '.mk-go{display:block;width:100%;min-height:56px;margin-top:14px;border:0;border-radius:18px;background:var(--brand);color:#fff;box-shadow:0 4px 0 var(--brand-d);font:900 20px/1.2 var(--f);cursor:pointer}',
  'html[lang=ur] .mk-go{font-family:var(--fu);font-weight:400;line-height:1.8}',
  '.mk-go:disabled{opacity:.45;cursor:default}',
  '.mk-err{margin:10px 0 0;padding:6px 12px;border-radius:12px;background:var(--warn-bg);color:var(--warn);font-weight:800}',
  '.mk-msg{margin:0;padding:12px 14px;border-radius:14px;background:var(--card);border:2px solid var(--line);white-space:pre-wrap;word-break:break-word;font-size:16px;line-height:1.5;user-select:text}',
  '.mk-say{margin:0;padding:12px 14px;border-radius:14px;background:var(--card);font-weight:800;font-size:18px;line-height:1.4}html[lang=ur] .mk-say{font-weight:400;line-height:1.9}',
  '.mk-foot{margin-top:18px;text-align:center}',
  '.mk-mark{display:inline-block;margin-inline-start:8px;padding:0 7px;border-radius:8px;background:#EEF1F6;color:var(--muted);font:800 12px/1.7 var(--f);vertical-align:middle}',
  '.mk-mark[lang=ur]{font-family:var(--fu);font-weight:400;font-size:13px;line-height:1.9}',
  '.mk-sub{margin:0;color:var(--brand-ink);font-size:16px;line-height:1.5}html[lang=ur] .mk-sub{font-size:18px;line-height:2}',
  '.mk-q{padding:12px 14px;border-radius:14px;background:var(--card);border:2px solid var(--line)}',
  '.mk-qn{margin:0 0 4px;color:var(--muted);font-weight:800;font-size:14px}html[lang=ur] .mk-qn{font-weight:400;font-size:16px;line-height:1.9}',
  '.mk-qt{margin:0;font-size:18px;line-height:1.5;font-weight:700;word-break:break-word}',
  'a.mk-go{display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;padding:8px 16px;margin-top:4px}',
  '.mk-go2{display:block;width:100%;min-height:52px;border:2px solid var(--brand);border-radius:18px;background:var(--card);color:var(--brand-d);font:900 18px/1.2 var(--f);cursor:pointer;padding:8px 16px}',
  'html[lang=ur] .mk-go2{font-family:var(--fu);font-weight:400;line-height:1.8}',
  '.mk-note{margin:0;color:var(--muted);font-size:14px;line-height:1.5}html[lang=ur] .mk-note{font-size:16px;line-height:2}',
  '.mk-next{margin:6px 0 0;color:var(--muted);font-size:14px;line-height:1.5}html[lang=ur] .mk-next{font-size:16px;line-height:2}',
  '.mk-ready{display:flex;flex-direction:column;gap:12px}.mk-ready h2{margin:0}',
  '.mk-pf{display:flex;flex-direction:column;gap:12px}',
  '.mk-link{border:0;background:none;color:var(--muted);text-decoration:underline;font:700 15px/1.6 var(--f);cursor:pointer;padding:8px}html[lang=ur] .mk-link{font-family:var(--fu);font-weight:400}',
].join('\n');

function fontFace(lang) {
  if (lang !== 'ur') return '';
  return `@font-face{font-family:"WQ Nastaliq 2";src:url(${ASSET_BASE}/fonts/wq-nastaliq-2.woff2) format("woff2");font-weight:400;font-display:swap}\n`;
}

// The page's one script. Plain ES5; never builds HTML; a failed step post never blocks a chip.
const SCRIPT = `(function(){
var b={};try{b=JSON.parse(document.getElementById('mk-boot').textContent)}catch(e){}
window.ftOnFirstChip=window.ftOnFirstChip||function(){};
var first=true,busy=false,marked=false,pick={grade:b.pick&&b.pick.grade||null,subject:b.pick&&b.pick.subject||null,quizId:b.pick&&b.pick.quizId||null};
function q(s){return document.querySelector(s)}
function all(s){return Array.prototype.slice.call(document.querySelectorAll(s))}
function post(p,o){return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o),credentials:'same-origin',keepalive:true})}
function body(n){return{t:b.t,step:n,grade:pick.grade,subject:pick.subject,quizId:pick.quizId}}
function step(n){try{post('/api/ft/step',body(n)).catch(function(){})}catch(e){}}
function beacon(n){var s=JSON.stringify(body(n));try{if(navigator.sendBeacon&&navigator.sendBeacon('/api/ft/step',new Blob([s],{type:'application/json'})))return}catch(e){}step(n)}
function show(id,push){all('[data-screen]').forEach(function(s){s.hidden=s.getAttribute('data-screen')!==id});if(push){try{history.pushState({s:id},'')}catch(e){}}window.scrollTo(0,0)}
function only(sel,key){all(sel).forEach(function(g){g.hidden=g.getAttribute('data-key')!==key})}
function topics(){var k=pick.grade+'|'+pick.subject;all('[data-quiz]').forEach(function(x){x.setAttribute('aria-pressed','false')});q('#mk-make').disabled=true;
only('[data-topics]',k);show('topic',true);
if(!marked){var g=q('[data-topics][data-key="'+k+'"]');var m=g?Array.prototype.slice.call(g.querySelectorAll('[data-qlang]')).some(function(x){return x.getAttribute('data-qlang')!==b.lang}):false;if(m){marked=true;step('lang_mark_seen')}}}
function digits(n){var s=String(n);return b.dg?s.replace(/[0-9]/g,function(d){return b.dg.charAt(+d)}):s}
function set(sel,v){var e=q(sel);if(e)e.textContent=v}
function selectMsg(){var m=q('#mk-msg');try{var r=document.createRange();r.selectNodeContents(m);var w=window.getSelection();w.removeAllRanges();w.addRange(r)}catch(e){}}
function copy(){var t=q('#mk-msg').textContent;beacon('share_copy');
function legacy(){selectMsg();try{document.execCommand('copy')}catch(e){}}
try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(selectMsg,legacy)}else legacy()}catch(e){legacy()}}
window.addEventListener('popstate',function(e){var s=e.state&&e.state.s;if(s!=='ready')show(s||b.first,false)});
document.addEventListener('click',function(e){
var c=e.target&&e.target.closest?e.target.closest('[data-grade],[data-subject],[data-quiz],[data-pf],#mk-make,#mk-copy'):null;if(!c)return;
if(c.hasAttribute('data-grade')){if(first){first=false;try{window.ftOnFirstChip()}catch(x){}}
pick.grade=c.getAttribute('data-grade');pick.subject=null;pick.quizId=null;only('[data-subjects]',pick.grade);show('subject',true);step('grade')}
else if(c.hasAttribute('data-subject')){pick.subject=c.getAttribute('data-subject');pick.quizId=null;topics();step('subject')}
else if(c.hasAttribute('data-quiz')){pick.quizId=c.getAttribute('data-quiz');all('[data-quiz]').forEach(function(x){x.setAttribute('aria-pressed',String(x===c))});q('#mk-make').disabled=false;step('topic')}
else if(c.hasAttribute('data-pf')){if(c.getAttribute('data-pf')==='keep'){pick.grade=b.pf.grade;pick.subject=b.pf.subject;pick.quizId=null;only('[data-subjects]',pick.grade);step('prefill_kept');topics()}
else{show('grade',true);step('prefill_changed')}}
else if(c.id==='mk-make'){make()}
else if(c.id==='mk-copy'){copy()}
});
function ready(d){var k=pick.grade+'|'+pick.subject,chip=q('[data-quiz="'+pick.quizId+'"]');
set('[data-s=gs]',(b.gs||{})[k]||'');set('[data-s=topic]',chip?chip.getAttribute('data-topic'):'');
var lc=d.qlang&&b.lc?b.lc[d.qlang]:null;q('[data-s=lw]').hidden=!lc;set('[data-s=lang]',lc||'');
q('#mk-q').hidden=!d.total;set('#mk-qn-n',digits(d.total||0));set('#mk-qt',d.preview||'');q('#mk-qt').hidden=!d.preview;
q('#mk-send').setAttribute('href','/m/'+encodeURIComponent(b.t)+'/send?c='+encodeURIComponent(d.shareCodeId));
q('#mk-msg').textContent=d.message;show('ready',true)}
function make(){if(busy||!pick.quizId)return;busy=true;q('#mk-err').hidden=true;q('#mk-make').disabled=true;
post('/api/ft/make',{t:b.t,grade:pick.grade,subject:pick.subject,quizId:pick.quizId}).then(function(r){if(!r.ok)throw 0;return r.json()})
.then(function(d){if(!d||typeof d.message!=='string'||typeof d.shareCodeId!=='string')throw 0;ready(d)})
.catch(function(){q('#mk-err').hidden=false;q('#mk-make').disabled=false}).then(function(){busy=false})}
})();`;
const SCRIPT_HASH = sha(SCRIPT);

function csp(styleHash, scriptHash, { meta = false } = {}) {
  return `default-src 'none'; style-src 'sha256-${styleHash}'; ${scriptHash ? `script-src 'sha256-${scriptHash}'; connect-src 'self'; ` : ''}`
    + `img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'${meta ? '' : "; frame-ancestors 'none'"}`;
}

function head(lang, title, style, styleHash, scriptHash) {
  const rtl = lang === 'ur';
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${esc(csp(styleHash, scriptHash, { meta: true }))}">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#47BA7D">
<title>${esc(title)}</title>
<style>${style}</style>
</head>`;
}

/** The page's language and its switch: en / ur as given; bi → Urdu with "English", or English with «اردو» on ?lang=en. */
function pageLang(tokenLang, asked) {
  if (tokenLang === 'en' || tokenLang === 'ur') return { lang: tokenLang, switchTo: null };
  return asked === 'en' ? { lang: 'en', switchTo: 'ur' } : { lang: 'ur', switchTo: 'en' };
}

const LRI = '⁦';
const PDI = '⁩';

/** "Grade 4 Mathematics" / «جماعت ۴، ریاضی»: mk.grade.n + the REAL subject label, as the signed line writes them. */
function gradeSubject(grade, subject, lang) {
  const g = fill('mk.grade.n', lang, { n: digits(grade, lang) });
  return lang === 'ur' ? `${g}، ${subjectLabel(subject, lang)}` : `${g} ${subjectLabel(subject, lang)}`;
}
/** The language clause for a known question language; null → the clause is dropped (never guessed). */
const langClause = (qlang, lang) => (qlang === 'en' || qlang === 'ur' ? str(`mk.ready.lang.${qlang}`, lang) : null);

/**
 * mk.ready.sub.lang as plain text (Latin runs in Urdu isolated with U+2066/U+2069), composed from the signed parts:
 *   EN  "Grade 4 Mathematics · Fractions · questions in English · a ready quiz from the NIETE library"
 *   UR  «جماعت ۴، ریاضی: ⁦Fractions⁩۔ سوال انگریزی میں ہیں۔ ⁦NIETE⁩ لائبریری کا تیار کوئز۔»
 */
function readySubText({ grade, subject, topic, qlang, lang }) {
  const l = clampLanguage(lang);
  const lc = langClause(qlang, l);
  const lib = str('mk.ready.sub.lib', l);
  const gs = gradeSubject(grade, subject, l);
  if (l === 'ur') return `${gs}: ${LRI}${topic}${PDI}۔ ${lc ? `${lc} ` : ''}${lib}`;
  return `${gs} · ${topic}${lc ? ` · ${lc}` : ''} · ${lib}`;
}

/** The same line as HTML with slots the page's script fills after a make (the topic in <bdi> on the Urdu page). */
function readySubHtml({ grade, subject, topic, qlang }, l) {
  const lc = langClause(qlang, l);
  const gs = grade && subject ? esc(gradeSubject(grade, subject, l)) : '';
  const lib = esc(str('mk.ready.sub.lib', l));
  const lw = (inner) => `<span data-s="lw"${lc ? '' : ' hidden'}>${inner}</span>`;
  const lang = `<span data-s="lang">${esc(lc || '')}</span>`;
  if (l === 'ur') return `<span data-s="gs">${gs}</span>: <bdi data-s="topic">${esc(topic || '')}</bdi>۔ ${lw(`${lang} `)}${lib}`;
  return `<span data-s="gs">${gs}</span> · <span class="mk-topic" data-s="topic">${esc(topic || '')}</span>${lw(` · ${lang}`)} · ${lib}`;
}

/** The ready screen: exactly mk.ready.h, mk.ready.sub.lang, mk.ready.q, mk.send, mk.send.note, mk.copy, mk.next. */
function readySection({ token, l, r, shown }) {
  const enc = encodeURIComponent(token);
  const total = r && r.total ? r.total : 0;
  const [qa, qb] = str('mk.ready.q', l).split('{n}');
  const href = r && r.shareCodeId ? ` href="/m/${enc}/send?c=${encodeURIComponent(r.shareCodeId)}"` : '';
  return `<section data-screen="ready"${shown ? '' : ' hidden'}>
<div class="mk-ready">
<h2 data-id="mk.ready.h">${esc(str('mk.ready.h', l))}</h2>
<p class="mk-sub" data-id="mk.ready.sub.lang">${readySubHtml(r || {}, l)}</p>
<div class="mk-q" id="mk-q" data-id="mk.ready.q"${total ? '' : ' hidden'}><p class="mk-qn">${esc(qa)}<span id="mk-qn-n">${esc(digits(total, l))}</span>${esc(qb || '')}</p><p class="mk-qt" id="mk-qt" dir="auto"${r && r.preview ? '' : ' hidden'}>${esc((r && r.preview) || '')}</p></div>
<a class="mk-go" id="mk-send" data-id="mk.send"${href}>${esc(str('mk.send', l))}</a>
<p class="mk-note" data-id="mk.send.note">${esc(str('mk.send.note', l))}</p>
<button type="button" class="mk-go2" id="mk-copy" data-id="mk.copy">${esc(str('mk.copy', l))}</button>
<p class="mk-msg" id="mk-msg" dir="auto">${esc((r && r.message) || '')}</p>
<p class="mk-next" data-id="mk.next">${esc(str('mk.next', l))}</p>
</div>
</section>`;
}

const hasCell = (tree, g, c) => Boolean(tree && tree[g] && tree[g][c] && tree[g][c].length);
/** The token's pf ("grade_4|maths") as { grade, subject } when its cell is in the tree; else null. */
function prefillCell(pf, tree) {
  const m = /^grade_([1-5])\|([a-z_]+)$/.exec(typeof pf === 'string' ? pf : '');
  return m && SUBJECT_CODES.includes(m[2]) && hasCell(tree, m[1], m[2]) ? { grade: m[1], subject: m[2] } : null;
}

/**
 * The maker page. `tree` is the bank's chip tree; `via` decides the "Change my choice" foot; `pf` the token's
 * pre-fill (shown only when its cell is in the tree). For a server-side render of a later state (tests, renders):
 * `ready` = { grade, subject, topic, qlang, message, preview, total, shareCodeId } opens on the ready screen;
 * `view` = { screen: 'subject' | 'topic', grade, subject } opens on that step.
 * → { html, csp } (the header value for the response).
 */
function buildMakerPage({ token, lang = 'en', switchTo = null, via = 'menu', tree = {}, pf = null, ready = null, view = null }) {
  const l = clampLanguage(lang);
  const ur = l === 'ur';
  const style = `${fontFace(l)}${CSS}`;
  const styleHash = sha(style);
  const enc = encodeURIComponent(token);
  const grades = Object.keys(tree).filter((g) => /^[1-5]$/.test(g)).sort();
  const cells = (g) => SUBJECT_CODES.filter((c) => hasCell(tree, g, c));
  const pre = prefillCell(pf, tree);
  const at = view && hasCell(tree, view.grade, view.subject) ? view : null;
  const firstScreen = pre ? 'prefill' : 'grade';
  const screen = ready ? 'ready' : (at ? at.screen : firstScreen);
  const open = (name) => (screen === name ? '' : ' hidden');
  const pick = ready || at || null;
  const topicText = (t) => (ur ? `<bdi>${esc(t)}</bdi>` : `<span class="mk-topic">${esc(t)}</span>`);
  const mark = (q) => (q === 'en' || q === 'ur'
    ? `<span class="mk-mark" lang="${q}">${esc(str(`mk.topic.mark.${q}`, l))}</span>` : '');
  const sw = switchTo
    ? `<a class="mk-sw" lang="${switchTo}" href="/m/${enc}?lang=${switchTo}">${esc(str('mk.lang.switch', l))}</a>`
    : '';
  const gradeChips = grades.map((g) => `<button type="button" class="mk-chip" data-grade="${g}">${esc(digits(g, l))}</button>`).join('');
  const subjectGroups = grades.map((g) => {
    const chips = cells(g).map((c) => `<button type="button" class="mk-chip" data-subject="${c}">${esc(subjectLabel(c, l))}</button>`).join('');
    return `<div class="mk-chips" data-subjects data-key="${g}"${pick && pick.grade === g ? '' : ' hidden'}>${chips}</div>`;
  }).join('\n');
  const topicGroups = grades.flatMap((g) => cells(g).map((c) => {
    const chips = tree[g][c].map((t) => {
      const q = t.qlang === 'en' || t.qlang === 'ur' ? t.qlang : null;
      return `<button type="button" class="mk-chip" data-quiz="${esc(t.quizId)}" data-topic="${esc(t.topic)}"${q ? ` data-qlang="${q}"` : ''} aria-pressed="false">${topicText(t.topic)}${mark(q)}</button>`;
    }).join('');
    const shownHere = pick && pick.grade === g && pick.subject === c;
    return `<div class="mk-chips" data-topics data-key="${g}|${c}"${shownHere ? '' : ' hidden'}>${chips}</div>`;
  })).join('\n');
  const prefill = pre
    ? `<section data-screen="prefill"${open('prefill')}>
<div class="mk-pf">
<p class="mk-say">${esc(fill('mk.prefill', l, { grade: fill('mk.grade.n', l, { n: digits(pre.grade, l) }), subject: subjectLabel(pre.subject, l) }))}</p>
<button type="button" class="mk-go" data-pf="keep">${esc(str('mk.prefill.keep', l))}</button>
<button type="button" class="mk-go2" data-pf="change">${esc(str('mk.prefill.change', l))}</button>
</div>
</section>
` : '';
  const foot = via === 'door'
    ? `<form class="mk-foot" method="post" action="/api/ft/door"><input type="hidden" name="t" value="${esc(token)}"><button type="submit" class="mk-link">${esc(str('mk.change', l))}</button></form>`
    : '';
  // What the script needs to fill the ready screen with textContent only.
  const gs = {};
  grades.forEach((g) => cells(g).forEach((c) => { gs[`${g}|${c}`] = gradeSubject(g, c, l); }));
  const boot = {
    t: token, lang: l, first: firstScreen, pf: pre, gs,
    lc: { en: str('mk.ready.lang.en', l), ur: str('mk.ready.lang.ur', l) },
    dg: ur ? UR_DIGITS.join('') : null,
    pick: pick ? { grade: pick.grade, subject: pick.subject, quizId: null } : null,
  };
  const html = `${head(l, str('mk.h', l), style, styleHash, SCRIPT_HASH)}
<body>
<main class="mk">
<header class="mk-top"><h1>${esc(str('mk.h', l))}</h1>${sw}</header>
<div id="ft-banner-slot"></div>
${prefill}<section data-screen="grade"${open('grade')}>
<h2>${esc(str('mk.grade', l))}</h2>
<div class="mk-chips mk-grade">${gradeChips}</div>
</section>
<section data-screen="subject"${open('subject')}>
<h2>${esc(str('mk.subject', l))}</h2>
${subjectGroups}
</section>
<section data-screen="topic"${open('topic')}>
<h2>${esc(str('mk.topic', l))}</h2>
${topicGroups}
<p class="mk-err" id="mk-err" role="alert" hidden>${esc(str('mk.error', l))}</p>
<button type="button" class="mk-go" id="mk-make" disabled>${esc(str('mk.make', l))}</button>
</section>
${readySection({ token, l, r: ready, shown: screen === 'ready' })}
${foot}
</main>
<script type="application/json" id="mk-boot">${bootJson(boot)}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
  return { html, csp: csp(styleHash, SCRIPT_HASH) };
}

/** A one-line page: `mk.stale` or `mk.error` (no form, no script). → { html, csp }. */
function buildMessagePage({ lang = 'en', id = 'mk.error' } = {}) {
  const l = clampLanguage(lang === 'bi' ? 'ur' : lang);
  const line = str(id === 'mk.stale' ? 'mk.stale' : 'mk.error', l);
  const style = `${fontFace(l)}${CSS}`;
  const styleHash = sha(style);
  const html = `${head(l, line, style, styleHash, null)}
<body>
<main class="mk">
<p class="mk-say">${esc(line)}</p>
</main>
</body>
</html>`;
  return { html, csp: csp(styleHash, null) };
}

module.exports = { buildMakerPage, buildMessagePage, pageLang, readySubText, prefillCell, SCRIPT, SCRIPT_HASH };
