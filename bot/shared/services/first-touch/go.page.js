'use strict';
/**
 * The one door's pages, server-rendered, no web font, no external asset (≤ 30 KB; the question page is ~6 KB):
 *
 *   buildRolePage({ t, lang })    the ONE question: Urdu first + English, the child tile first (amber, ●),
 *                                 the parent line above it, then the teacher tile (blue, ◆), the note. No primary, no
 *                                 third option, no text entry. After paint the page asks the server who this phone is
 *                                 (POST /api/go/who): someone already known goes straight on. A tap POSTs /api/go/role
 *                                 and the page follows the answer's `next` in the same web view. 0 WhatsApp replies.
 *   buildMessagePage({ id, lang })  one line + nothing to do: go.stale (send "quiz" again), go.error, go.family
 *
 * Inline CSS and the one script are allowed by their sha256 in the page's Content-Security-Policy (sent as a header
 * and repeated in a <meta>). The token rides in a <script type="application/json"> block, never in a log; the page
 * keeps NOTHING that decides routing (no localStorage, no cookie of its own).
 */
const crypto = require('crypto');
const { clampLanguage } = require('../../config/ux-strings');
const { str } = require('./one-door.strings');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const bootJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const CSS = [
  ':root{--ink:#2A2D3A;--muted:#5F6374;--ground:#F5F8F6;--card:#fff;--line:#DCE5DF;--amber:#F2A93B;--amber-bg:#FFF4E0;--blue:#3B7DD8;--blue-bg:#E8F0FC;--warn:#8A5E06;--warn-bg:#FFF2CF;',
  '--f:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--fu:"Noto Nastaliq Urdu","Jameel Noori Nastaleeq",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '@media (prefers-color-scheme:dark){:root{--ink:#ECEEF3;--muted:#B5B9C6;--ground:#14161C;--card:#1E2129;--line:#343846;--amber-bg:#3A2C12;--blue-bg:#16263D;--warn:#FFD98A;--warn-bg:#3A2E10}}',
  '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}',
  'body{background:var(--ground);color:var(--ink);font-family:var(--f);-webkit-text-size-adjust:100%;touch-action:manipulation}',
  '.go{max-width:480px;margin:0 auto;padding:20px 16px 28px;display:flex;flex-direction:column;gap:14px}',
  '[lang=ur]{font-family:var(--fu);line-height:1.9;word-spacing:.12em}',
  '.en{display:block;font-family:var(--f);color:var(--muted);font-size:15px;line-height:1.4;font-weight:600}',
  'h1{margin:0;font-size:26px;font-weight:400;text-align:center}h1 .en{font-size:17px;font-weight:800;color:var(--ink)}',
  '.pl{margin:0;font-size:17px;text-align:center}',
  '.tile{display:flex;align-items:center;gap:14px;width:100%;min-height:112px;padding:14px 16px;border-radius:22px;border:3px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-align:start;font:inherit}',
  '.tile:active{transform:translateY(2px)}.tile[aria-busy=true]{opacity:.6}',
  '.c{border-color:var(--amber);background:var(--amber-bg)}.t{border-color:var(--blue);background:var(--blue-bg)}',
  '.ic{flex:0 0 64px;height:64px;display:flex;align-items:center;justify-content:center;line-height:1;border-radius:18px;background:var(--card)}',
  '.c .ic{color:var(--amber)}.t .ic{color:var(--blue)}.lb .en{text-align:right}',
  '.lb{display:flex;flex-direction:column;gap:2px}.lb b{font-size:24px;font-weight:400}.lb small{font-size:18px;color:var(--muted)}',
  '.note{margin:4px 0 0;text-align:center;font-size:15px;color:var(--muted)}',
  '.err{margin:0;padding:8px 12px;border-radius:12px;background:var(--warn-bg);color:var(--warn);font-weight:800;text-align:center}',
  '.msg{margin:40px 0 0;padding:18px;border-radius:18px;background:var(--card);border:2px solid var(--line);text-align:center;font-size:20px}',
  '[hidden]{display:none!important}',
].join('');

// The one script: who-am-I after paint, then the two taps. No library, no storage.
const SCRIPT = [
  '(function(){var b=JSON.parse(document.getElementById("go-boot").textContent),t=b.t,busy=false;',
  'function post(p,o,cb){var x=new XMLHttpRequest();x.open("POST",p,true);x.setRequestHeader("content-type","application/json");',
  'x.timeout=15000;x.onload=function(){var j=null;try{j=JSON.parse(x.responseText)}catch(e){}cb(x.status,j)};',
  'x.onerror=x.ontimeout=function(){cb(0,null)};x.send(JSON.stringify(o))}',
  'function err(id){var e=document.getElementById("go-err");e.hidden=false;e.textContent=b.words[id]||b.words["go.error"];}',
  'post("/api/go/who",{t:t},function(s,j){if(s===200&&j&&j.next){location.replace(j.next)}});',
  'var tiles=document.querySelectorAll("[data-side]");for(var i=0;i<tiles.length;i++){tiles[i].addEventListener("click",function(){',
  'if(busy)return;busy=true;var el=this;el.setAttribute("aria-busy","true");',
  'post("/api/go/role",{t:t,side:el.getAttribute("data-side")},function(s,j){',
  'if(s===200&&j&&j.next){location.assign(j.next);return}busy=false;el.removeAttribute("aria-busy");',
  'err(j&&j.error==="go.stale"?"go.stale":"go.error")})})}})();',
].join('');

// The two pictures, colour + SHAPE: the child on a ● (a child holding an open book), the teacher on a ◆
// (a grown-up beside a board). Inline, no file to fetch; they take the tile's colour.
const CHILD_SVG = '<svg viewBox="0 0 64 64" width="60" height="60"><circle cx="32" cy="32" r="31" fill="currentColor" opacity=".22"/>'
  + '<circle cx="32" cy="19" r="8" fill="currentColor"/><path d="M17 50c2-11 8-16 15-16s13 5 15 16z" fill="currentColor"/>'
  + '<path d="M19 43l13 4 13-4v11l-13 4-13-4z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
  + '<path d="M32 47v11" stroke="currentColor" stroke-width="2"/></svg>';
const TEACHER_SVG = '<svg viewBox="0 0 64 64" width="60" height="60"><path d="M32 1l31 31-31 31L1 32z" fill="currentColor" opacity=".22"/>'
  + '<rect x="11" y="14" width="30" height="21" rx="2" fill="#fff" stroke="currentColor" stroke-width="2.5"/>'
  + '<path d="M16 21h15M16 27h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
  + '<circle cx="46" cy="36" r="6" fill="currentColor"/><path d="M37 57c1-8 5-12 9-12s8 4 9 12z" fill="currentColor"/></svg>';

function csp() {
  return `default-src 'none'; style-src 'sha256-${sha(CSS)}'; script-src 'sha256-${sha(SCRIPT)}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

function shell({ title, body, script = '', withScript = false }) {
  const policy = withScript ? csp() : `default-src 'none'; style-src 'sha256-${sha(CSS)}'; base-uri 'none'; frame-ancestors 'none'`;
  return {
    csp: policy,
    html: '<!doctype html><html lang="ur" dir="rtl"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
      + `<meta http-equiv="Content-Security-Policy" content="${esc(policy)}">`
      + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
      + `<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}${script}</body></html>`,
  };
}

/** Urdu first, the English under it (the English line is dropped for an Urdu-only page). */
const two = (id, lang, tag = 'span') => `<${tag} lang="ur">${esc(str(id, 'ur'))}</${tag}>${lang === 'ur' ? '' : `<span class="en" lang="en" dir="ltr">${esc(str(id, 'en'))}</span>`}`;

/** The one question. `t` = the go token (it goes back in each POST). */
function buildRolePage({ t, lang = 'bi' } = {}) {
  const words = {};
  ['go.error', 'go.stale'].forEach((id) => { words[id] = lang === 'ur' ? str(id, 'ur') : `${str(id, 'ur')} · ${str(id, 'en')}`; });
  const body = '<main class="go" data-screen="role">'
    + `<h1>${two('rq.h', lang)}</h1>`
    + `<p class="pl">${two('rq.parent.line', lang)}</p>`
    + '<button type="button" class="tile c" data-tap="role_child" data-side="child">'
    + `<span class="ic" aria-hidden="true">${CHILD_SVG}</span>`
    + `<span class="lb"><b>${two('rq.child', lang)}</b><small>${two('rq.child.sub', lang)}</small></span></button>`
    + '<button type="button" class="tile t" data-tap="role_teacher" data-side="teacher">'
    + `<span class="ic" aria-hidden="true">${TEACHER_SVG}</span>`
    + `<span class="lb"><b>${two('rq.teacher', lang)}</b><small>${two('rq.teacher.sub', lang)}</small></span></button>`
    + '<p class="err" id="go-err" role="alert" hidden></p>'
    + `<p class="note">${two('rq.note', lang)}</p>`
    + '</main>';
  const script = `<script type="application/json" id="go-boot">${bootJson({ t, words })}</script><script>${SCRIPT}</script>`;
  return shell({ title: str('rq.h', clampLanguage(lang)), body, script, withScript: true });
}

/** One line, nothing to tap: go.stale | go.error | go.family (the student tap while the join screen is not on). */
function buildMessagePage({ id = 'go.error', lang = 'bi' } = {}) {
  const ids = id === 'go.family' ? ['go.family.h', 'go.family.none'] : [id];
  const body = `<main class="go" data-screen="${esc(id)}">${ids.map((x) => `<p class="msg">${two(x, lang)}</p>`).join('')}</main>`;
  return shell({ title: str(ids[0], clampLanguage(lang)), body });
}

module.exports = { buildRolePage, buildMessagePage, csp, _CSS: CSS, _SCRIPT: SCRIPT };
