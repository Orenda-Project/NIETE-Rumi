'use strict';
/**
 * The quiz-maker page (`/m/<token>`), server-rendered: grade → subject → topic chips, then "Make the quiz"; on
 * success the class message in a read-only block under "Your quiz is ready". Every chip is in the HTML (hidden until
 * its step); ONE small inline script shows one step at a time, posts each chip tap to /api/ft/step (fire-and-forget)
 * and the make to /api/ft/make. Inline CSS and the script are allowed by their sha256 in the page's
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
const { str, subjectLabel, SUBJECT_CODES } = require('./maker.strings');

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
var first=true,busy=false,pick={grade:null,subject:null,quizId:null};
function q(s){return document.querySelector(s)}
function all(s){return Array.prototype.slice.call(document.querySelectorAll(s))}
function post(p,o){return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o),credentials:'same-origin',keepalive:true})}
function step(n){try{post('/api/ft/step',{t:b.t,step:n,grade:pick.grade,subject:pick.subject,quizId:pick.quizId}).catch(function(){})}catch(e){}}
function show(id,push){all('[data-screen]').forEach(function(s){s.hidden=s.getAttribute('data-screen')!==id});if(push){try{history.pushState({s:id},'')}catch(e){}}window.scrollTo(0,0)}
function only(sel,key){all(sel).forEach(function(g){g.hidden=g.getAttribute('data-key')!==key})}
window.addEventListener('popstate',function(e){var s=e.state&&e.state.s;if(s!=='ready')show(s||'grade',false)});
document.addEventListener('click',function(e){
var c=e.target&&e.target.closest?e.target.closest('[data-grade],[data-subject],[data-quiz],#mk-make'):null;if(!c)return;
if(c.hasAttribute('data-grade')){if(first){first=false;try{window.ftOnFirstChip()}catch(x){}}
pick.grade=c.getAttribute('data-grade');pick.subject=null;pick.quizId=null;only('[data-subjects]',pick.grade);show('subject',true);step('grade')}
else if(c.hasAttribute('data-subject')){pick.subject=c.getAttribute('data-subject');pick.quizId=null;
all('[data-quiz]').forEach(function(x){x.setAttribute('aria-pressed','false')});q('#mk-make').disabled=true;
only('[data-topics]',pick.grade+'|'+pick.subject);show('topic',true);step('subject')}
else if(c.hasAttribute('data-quiz')){pick.quizId=c.getAttribute('data-quiz');all('[data-quiz]').forEach(function(x){x.setAttribute('aria-pressed',String(x===c))});q('#mk-make').disabled=false;step('topic')}
else if(c.id==='mk-make'){make()}
});
function make(){if(busy||!pick.quizId)return;busy=true;q('#mk-err').hidden=true;q('#mk-make').disabled=true;
post('/api/ft/make',{t:b.t,grade:pick.grade,subject:pick.subject,quizId:pick.quizId}).then(function(r){if(!r.ok)throw 0;return r.json()})
.then(function(d){if(!d||typeof d.message!=='string')throw 0;q('#mk-msg').textContent=d.message;show('ready',true)})
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

/**
 * The maker page. `tree` is the bank's chip tree; `via` decides the "Change my choice" foot.
 * → { html, csp } (the header value for the response).
 */
function buildMakerPage({ token, lang = 'en', switchTo = null, via = 'menu', tree = {} }) {
  const l = clampLanguage(lang);
  const ur = l === 'ur';
  const style = `${fontFace(l)}${CSS}`;
  const styleHash = sha(style);
  const enc = encodeURIComponent(token);
  const grades = Object.keys(tree).filter((g) => /^[1-5]$/.test(g)).sort();
  const topicText = (t) => (ur ? `<bdi>${esc(t)}</bdi>` : `<span class="mk-topic">${esc(t)}</span>`);
  const sw = switchTo
    ? `<a class="mk-sw" lang="${switchTo}" href="/m/${enc}?lang=${switchTo}">${esc(str('mk.lang.switch', l))}</a>`
    : '';
  const gradeChips = grades.map((g) => `<button type="button" class="mk-chip" data-grade="${g}">${esc(digits(g, l))}</button>`).join('');
  const subjectGroups = grades.map((g) => {
    const codes = SUBJECT_CODES.filter((c) => tree[g][c] && tree[g][c].length);
    const chips = codes.map((c) => `<button type="button" class="mk-chip" data-subject="${c}">${esc(subjectLabel(c, l))}</button>`).join('');
    return `<div class="mk-chips" data-subjects data-key="${g}" hidden>${chips}</div>`;
  }).join('\n');
  const topicGroups = grades.flatMap((g) => SUBJECT_CODES.filter((c) => tree[g][c] && tree[g][c].length).map((c) => {
    const chips = tree[g][c].map((t) => `<button type="button" class="mk-chip" data-quiz="${esc(t.quizId)}" aria-pressed="false">${topicText(t.topic)}</button>`).join('');
    return `<div class="mk-chips" data-topics data-key="${g}|${c}" hidden>${chips}</div>`;
  })).join('\n');
  const foot = via === 'door'
    ? `<form class="mk-foot" method="post" action="/api/ft/door"><input type="hidden" name="t" value="${esc(token)}"><button type="submit" class="mk-link">${esc(str('mk.change', l))}</button></form>`
    : '';
  const html = `${head(l, str('mk.h', l), style, styleHash, SCRIPT_HASH)}
<body>
<main class="mk">
<header class="mk-top"><h1>${esc(str('mk.h', l))}</h1>${sw}</header>
<section data-screen="grade">
<div id="ft-banner-slot"></div>
<h2>${esc(str('mk.grade', l))}</h2>
<div class="mk-chips mk-grade">${gradeChips}</div>
</section>
<section data-screen="subject" hidden>
<h2>${esc(str('mk.subject', l))}</h2>
${subjectGroups}
</section>
<section data-screen="topic" hidden>
<h2>${esc(str('mk.topic', l))}</h2>
${topicGroups}
<p class="mk-err" id="mk-err" role="alert" hidden>${esc(str('mk.error', l))}</p>
<button type="button" class="mk-go" id="mk-make" disabled>${esc(str('mk.make', l))}</button>
</section>
<section data-screen="ready" hidden>
<h2>${esc(str('mk.ready.h', l))}</h2>
<p class="mk-msg" id="mk-msg" dir="auto"></p>
</section>
${foot}
</main>
<script type="application/json" id="mk-boot">${bootJson({ t: token, lang: l, tree })}</script>
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

module.exports = { buildMakerPage, buildMessagePage, pageLang, SCRIPT, SCRIPT_HASH };
