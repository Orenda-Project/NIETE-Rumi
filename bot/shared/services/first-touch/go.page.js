'use strict';
/**
 * The one door's pages, rendered by the bot with NO database read (the token check is CPU, the nonce a Redis read),
 * no web font, no external asset (each ≤ 30 KB):
 *
 *   buildRolePage({ t, lang, extra?, bot? })    the ONE question: Urdu first + English, the child tile first (amber, ●), the parent line
 *                                 above it, then the teacher tile (blue, ◆), the note. No primary, no third option, no
 *                                 text entry. After paint the page asks the server who this phone is (POST /api/go/who,
 *                                 with this device's quiz-page ref when it has one): someone already known goes
 *                                 straight on; a child who played on THIS device is offered one line above the tiles,
 *                                 "Is it <First>?", with the three notice sentences, "Yes, it's me" / "No". A tap POSTs
 *                                 /api/go/role (or /api/go/bind) and follows the answer's `next` in the same web view.
 *   buildPickPage({ t, lang, kids, bot? })  the children the server already knows for this phone (first names only):
 *                                 one → "Is it <First>?"; several → "Who is playing?" chips; then the notice sentences
 *                                 BEFORE "Yes, it's me" (POST /api/go/bind), and "None of these" → the one question.
 *   buildMessagePage({ id, lang, bot?, door? })  one line: go.stale (send "quiz" again), go.error, go.family; the first two
 *                                   carry ONE "Open WhatsApp" tap (wa.me/<bot>?text=quiz) when `bot` is a dialable number;
 *                                   with `door: true` (web_quiz_closed_way_back ON, read by the caller) they ALWAYS carry ONE tap
 *                                   instead, its words the signed go.back sentence, its href wa.me/<bot>?text=quiz or,
 *                                   with no number, whatsapp://send?text=quiz (chat-tap.js)
 *
 * Inline CSS and the one script are allowed by their sha256 in the page's Content-Security-Policy (sent as a header
 * and repeated in a <meta>). The token rides in a <script type="application/json"> block, never in a log. The page
 * keeps NOTHING that decides routing: it only READS the quiz page's own device ref ('wq_d') to ask the server.
 * 0 WhatsApp messages from any of these pages.
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
  ':root{--ink:#2A2D3A;--muted:#5F6374;--ground:#F5F8F6;--card:#fff;--line:#DCE5DF;--amber:#F2A93B;--amber-bg:#FFF4E0;--blue:#3B7DD8;--blue-bg:#E8F0FC;--green:#23794D;--warn:#8A5E06;--warn-bg:#FFF2CF;',
  '--f:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--fu:"Noto Nastaliq Urdu","Jameel Noori Nastaleeq",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '@media (prefers-color-scheme:dark){:root{--ink:#ECEEF3;--muted:#B5B9C6;--ground:#14161C;--card:#1E2129;--line:#343846;--amber-bg:#3A2C12;--blue-bg:#16263D;--warn:#FFD98A;--warn-bg:#3A2E10}}',
  '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}',
  'body{background:var(--ground);color:var(--ink);font-family:var(--f);-webkit-text-size-adjust:100%;touch-action:manipulation}',
  '.go{max-width:480px;margin:0 auto;padding:20px 16px 28px;display:flex;flex-direction:column;gap:14px}',
  '[lang=ur]{font-family:var(--fu);line-height:1.9;word-spacing:.12em}',
  '.en{display:block;font-family:var(--f);color:var(--muted);font-size:15px;line-height:1.4;font-weight:600}',
  'h1{margin:0;font-size:26px;font-weight:400;text-align:center}h1 .en{font-size:17px;font-weight:800;color:var(--ink)}',
  '.pl{margin:0;font-size:18px;text-align:center}',
  '.tile{display:flex;align-items:center;gap:14px;width:100%;min-height:112px;padding:14px 16px;border-radius:22px;border:3px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-align:start;font:inherit}',
  '.tile:active{transform:translateY(2px)}.tile[aria-busy=true]{opacity:.6}',
  '.c{border-color:var(--amber);background:var(--amber-bg)}.t{border-color:var(--blue);background:var(--blue-bg)}',
  '.ic{flex:0 0 64px;height:64px;display:flex;align-items:center;justify-content:center;line-height:1;border-radius:18px;background:var(--card)}',
  '.c .ic{color:var(--amber)}.t .ic{color:var(--blue)}.lb .en{text-align:right}',
  '.lb{display:flex;flex-direction:column;gap:2px}.lb b{font-size:24px;font-weight:400}.lb small{font-size:18px;color:var(--muted)}',
  '.note{margin:4px 0 0;text-align:center;font-size:18px;color:var(--muted)}',
  '.err{margin:0;padding:8px 12px;border-radius:12px;background:var(--warn-bg);color:var(--warn);font-weight:800;text-align:center;font-size:18px}',
  '.wa{display:block;min-height:48px;padding:10px 16px;border-radius:16px;background:var(--green);color:#fff;font-size:20px;font-weight:800;text-align:center;text-decoration:none}.wa .en{color:#fff}',
  '.msg{margin:40px 0 0;padding:18px;border-radius:18px;background:var(--card);border:2px solid var(--line);text-align:center;font-size:20px}',
  '.sheet{display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:22px;border:3px solid var(--amber);background:var(--amber-bg)}',
  '.q{margin:0;font-size:26px;text-align:center}.q .en{font-size:17px;font-weight:800;color:var(--ink)}',
  '.notice{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}',
  '.notice li{font-size:20px;line-height:1.9}.notice li .en{font-size:15px;line-height:1.4}',
  '.chips{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}',
  '.chip{min-height:52px;min-width:96px;padding:6px 16px;border-radius:16px;border:3px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-family:var(--fu);font-size:24px;line-height:1.6;cursor:pointer}',
  '.chip[aria-pressed=true]{border-color:var(--amber)}',
  '.yes{display:block;width:100%;min-height:56px;border:0;border-radius:18px;background:#23794D;color:#fff;font:inherit;font-size:22px;cursor:pointer}',
  '.yes:disabled{opacity:.45;cursor:default}.yes .en{color:#fff}',
  '.no{display:block;width:100%;min-height:48px;border:2px solid var(--line);border-radius:16px;background:var(--card);color:var(--ink);font:inherit;font-size:18px;text-align:center;text-decoration:none;padding:6px 12px;cursor:pointer}',
  '[hidden]{display:none!important}',
].join('');

// The one script. who-am-I after paint (with the quiz page's device ref, if this device has one); the role taps; the
// device-known line; the pick chips; the bind. No library; it stores nothing.
const SCRIPT = [
  '(function(){var b=JSON.parse(document.getElementById("go-boot").textContent),t=b.t,busy=false,pick=b.pick||null,d=null;',
  'function $(i){return document.getElementById(i)}',
  'function post(p,o,cb){var x=new XMLHttpRequest();x.open("POST",p,true);x.setRequestHeader("content-type","application/json");',
  'x.timeout=15000;x.onload=function(){var j=null;try{j=JSON.parse(x.responseText)}catch(e){}cb(x.status,j)};',
  'x.onerror=x.ontimeout=function(){cb(0,null)};x.send(JSON.stringify(o))}',
  'function err(id){var e=$("go-err");e.hidden=false;e.textContent=b.words[id]||b.words["go.error"];var w=$("go-wa");if(w)w.hidden=false}',
  'function fill(el,first){var n=el.querySelectorAll("[data-tpl]");for(var i=0;i<n.length;i++){n[i].textContent=n[i].getAttribute("data-tpl").split("{first}").join(first)}}',
  'function go(r){if(r&&r.next){location.assign(r.next);return true}return false}',
  'function bind(btn){if(busy||!pick)return;busy=true;btn.setAttribute("aria-busy","true");',
  'post("/api/go/bind",{t:t,pick:pick,d:d},function(s,j){if(s===200&&go(j))return;busy=false;btn.removeAttribute("aria-busy");',
  'err(j&&j.error&&b.words[j.error]?j.error:(s===410?"go.stale":"go.error"))})}',
  'if(b.kind==="role"){try{var v=localStorage.getItem("wq_d");v=v?JSON.parse(v):null;if(typeof v==="string"&&v.match(/^[A-Za-z0-9_-]{22}$/))d=v}catch(e){}',
  'post("/api/go/who",d?{t:t,d:d}:{t:t},function(s,j){if(s!==200||!j)return;if(j.next){location.replace(j.next);return}',
  'if(j.known&&j.known.pick){pick=j.known.pick;var k=$("go-known");fill(k,j.known.first||"");k.hidden=false}});',
  'var tiles=document.querySelectorAll("[data-side]");for(var i=0;i<tiles.length;i++){tiles[i].addEventListener("click",function(){',
  'if(busy)return;busy=true;var el=this;el.setAttribute("aria-busy","true");',
  'post("/api/go/role",{t:t,side:el.getAttribute("data-side")},function(s,j){if(s===200&&go(j))return;busy=false;el.removeAttribute("aria-busy");',
  'err(j&&j.error==="go.stale"?"go.stale":"go.error")})})}',
  'var no=$("go-no");if(no)no.addEventListener("click",function(){$("go-known").hidden=true;pick=null});',
  // the sandbox walk-through row's buttons (rendered only for listed test phones): one POST, then follow `next`
  'var ps=document.querySelectorAll("[data-persona]");for(var q=0;q<ps.length;q++){ps[q].addEventListener("click",function(){',
  'if(busy)return;busy=true;var el=this;post("/api/go/persona",{t:t,as:el.getAttribute("data-persona")},function(s,j){if(s===200&&go(j))return;',
  'busy=false;err(s===410?"go.stale":"go.error")})})}}',
  'var yes=$("go-yes");if(yes)yes.addEventListener("click",function(){bind(yes)});',
  'var chips=document.querySelectorAll("[data-pick]");for(var c=0;c<chips.length;c++){chips[c].addEventListener("click",function(){',
  'for(var k=0;k<chips.length;k++)chips[k].setAttribute("aria-pressed","false");this.setAttribute("aria-pressed","true");',
  'pick=this.getAttribute("data-pick");var s=$("go-sheet");fill(s,this.getAttribute("data-first")||"");$("go-notice").hidden=false;yes.disabled=false})}',
  '})();',
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
      // the <meta> copy (the edge forwards only the page): frame-ancestors is header-only, so it is left out here
      + `<meta http-equiv="Content-Security-Policy" content="${esc(policy.replace(/; frame-ancestors 'none'/, ''))}">`
      + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
      + `<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}${script}</body></html>`,
  };
}

/** Urdu first, the English under it (the English line is dropped for an Urdu-only page). */
const two = (id, lang, tag = 'span', params = null) => `<${tag} lang="ur">${esc(str(id, 'ur', params))}</${tag}>${lang === 'ur' ? '' : `<span class="en" lang="en" dir="ltr">${esc(str(id, 'en', params))}</span>`}`;
/** The same, filled on the page from a template (a name the server sent after paint, or the chip a child tapped). */
const twoTpl = (id, lang) => `<span lang="ur" data-tpl="${esc(str(id, 'ur'))}"></span>${lang === 'ur' ? '' : `<span class="en" lang="en" dir="ltr" data-tpl="${esc(str(id, 'en'))}"></span>`}`;

function wordsFor(lang) {
  const words = {};
  ['go.error', 'go.stale'].forEach((id) => { words[id] = lang === 'ur' ? str(id, 'ur') : `${str(id, 'ur')} · ${str(id, 'en')}`; });
  return words;
}
const NOTICE_IDS = ['cl.notice.save', 'cl.notice.stop', 'cl.notice.readings'];
const bootTag = (o) => `<script type="application/json" id="go-boot">${bootJson(o)}</script><script>${SCRIPT}</script>`;

/** The one question. `t` = the go token (it goes back in each POST). */
/** ONE tap back to the bot's chat with "quiz" typed (F22), or '' without a dialable number. Hidden until an error. */
function waTap(lang, bot, hidden = false) {
  const n = require('./cards.page').botOf(bot);
  return n ? `<a class="wa"${hidden ? ' id="go-wa"' : ''} href="https://wa.me/${n}?text=quiz" data-tap="open_whatsapp"${hidden ? ' hidden' : ''}>${two('go.wa', lang)}</a>` : '';
}

function buildRolePage({ t, lang = 'bi', extra = '', bot = null } = {}) {
  const body = '<main class="go" data-screen="role">'
    + `<h1>${two('rq.h', lang)}</h1>`
    // a child who played on THIS device (filled after paint by /api/go/who; hidden until then)
    + '<section class="sheet" id="go-known" data-screen="known" hidden>'
    + `<p class="q">${twoTpl('cl.confirm.q', lang)}</p>`
    + `<ul class="notice">${NOTICE_IDS.map((id) => `<li>${twoTpl(id, lang)}</li>`).join('')}</ul>`
    + `<button type="button" class="yes" id="go-yes" data-tap="known_yes">${two('cl.confirm.yes', lang)}</button>`
    + `<button type="button" class="no" id="go-no" data-tap="known_no">${two('cl.confirm.no', lang)}</button>`
    + '</section>'
    + `<p class="pl">${two('rq.parent.line', lang)}</p>`
    + '<button type="button" class="tile c" data-tap="role_child" data-side="child">'
    + `<span class="ic" aria-hidden="true">${CHILD_SVG}</span>`
    + `<span class="lb"><b>${two('rq.child', lang)}</b><small>${two('rq.child.sub', lang)}</small></span></button>`
    + '<button type="button" class="tile t" data-tap="role_teacher" data-side="teacher">'
    + `<span class="ic" aria-hidden="true">${TEACHER_SVG}</span>`
    + `<span class="lb"><b>${two('rq.teacher', lang)}</b><small>${two('rq.teacher.sub', lang)}</small></span></button>`
    + '<p class="err" id="go-err" role="alert" hidden></p>' + waTap(lang, bot, true)
    + `<p class="note">${two('rq.note', lang)}</p>`
    // the sandbox walk-through row (listed test phones only; its own module builds it) — nothing otherwise
    + (typeof extra === 'string' ? extra : '')
    + '</main>';
  return shell({ title: str('rq.h', clampLanguage(lang)), body, script: bootTag({ kind: 'role', t, words: wordsFor(lang) }), withScript: true });
}

/**
 * The children the server knows for this phone, before a binding: first names only. `kids` = [{ pick, first }] — `pick`
 * is an opaque per-link id (never a student id). One child → "Is it <First>?"; several → chips.
 */
function buildPickPage({ t, lang = 'bi', kids = [], bot = null } = {}) {
  const one = kids.length === 1 ? kids[0] : null;
  const head = one
    ? `<p class="q">${two('cl.confirm.q', lang, 'span', { first: one.first })}</p>`
    : `<p class="q">${two('cl.confirm.who', lang)}</p>`
      + `<div class="chips">${kids.map((k) => `<button type="button" class="chip" data-tap="pick_chip" data-pick="${esc(k.pick)}" data-first="${esc(k.first)}" aria-pressed="false"><bdi>${esc(k.first)}</bdi></button>`).join('')}</div>`;
  const notice = one
    ? `<ul class="notice" id="go-notice">${NOTICE_IDS.map((id) => `<li>${two(id, lang, 'span', { first: one.first })}</li>`).join('')}</ul>`
    : `<ul class="notice" id="go-notice" hidden>${NOTICE_IDS.map((id) => `<li>${twoTpl(id, lang)}</li>`).join('')}</ul>`;
  const body = '<main class="go" data-screen="pick">'
    + `<section class="sheet" id="go-sheet">${head}${notice}`
    + `<button type="button" class="yes" id="go-yes" data-tap="pick_yes"${one ? '' : ' disabled'}>${two('cl.confirm.yes', lang)}</button>`
    + '</section>'
    + '<p class="err" id="go-err" role="alert" hidden></p>' + waTap(lang, bot, true)
    + `<a class="no" data-tap="pick_none" href="/quiz/go/${encodeURIComponent(t)}?ask=1">${two(one ? 'cl.confirm.no' : 'cl.confirm.none', lang)}</a>`
    + '</main>';
  return shell({
    title: one ? str('cl.confirm.q', clampLanguage(lang), { first: one.first }) : str('cl.confirm.who', clampLanguage(lang)),
    body, script: bootTag({ kind: 'pick', t, pick: one ? one.pick : null, words: wordsFor(lang) }), withScript: true,
  });
}

/** ONE tap back to WhatsApp whatever the deployment knows (the switch is on): the signed sentence, both languages as the page. */
function backTap(lang, bot) {
  return `<a class="wa" href="${esc(require('./chat-tap').chatHref(bot))}" data-tap="open_whatsapp">${two('go.back', lang)}</a>`;
}

/** One line: go.stale | go.error | go.family (the student tap while the join screen is not on). */
function buildMessagePage({ id = 'go.error', lang = 'bi', bot = null, door = false } = {}) {
  const ids = id === 'go.family' ? ['go.family.h', 'go.family.none'] : [id];
  // a dead end carries ONE tap back to the bot's chat with "quiz" typed: with the switch on, always (the app's own link
  // when there is no number); with it off, only with a dialable number (else the words alone, as before)
  const dead = id === 'go.stale' || id === 'go.error';
  const wa = dead ? (door === true ? backTap(lang, bot) : waTap(lang, bot)) : '';
  const body = `<main class="go" data-screen="${esc(id)}">${ids.map((x) => `<p class="msg">${two(x, lang)}</p>`).join('')}${wa}</main>`;
  return shell({ title: str(ids[0], clampLanguage(lang)), body });
}

module.exports = { buildRolePage, buildPickPage, buildMessagePage, csp, _CSS: CSS, _SCRIPT: SCRIPT };
