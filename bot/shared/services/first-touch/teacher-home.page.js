'use strict';
/**
 * The teacher home (`/quiz/teacher/<token>`): ONE server-rendered shell that reads nothing (the token check is CPU),
 * then ONE small inline script fetches /api/th/home after paint and fills it. Three things, one column:
 *
 *   header      "Hello, {first}" (the first name from the users row, filled after paint; never from the URL), the
 *               language switch
 *   top card    the ONE job (`data-primary` on its button): after a send with few answers, the class line
 *               ("No one in your class has played yet" / "{n} of your class have played") + "Send again" + "See report";
 *               else the library pick for the class's grade (a story → the stories page's own sheet; a ready video
 *               quiz → the send sheet); a quiz just made from a lesson replaces it with "Send to my class"
 *   under it    the confirm rows for children who joined on their own ("Same child / Different / Not sure"), "Children on this phone"
 *   timeline    "My lessons": lesson plans, coaching sessions and sent quizzes, newest first, 5 rows + "More"; each row
 *               one verb: "Quiz this" (the existing job, then the page polls until the class message exists) /
 *               "Send again" / "See report"; topic names verbatim with dir=auto
 *   library     "Chosen for Grade n", one quiet line once a story went out ("3 stories sent · 7 children read"; the
 *               home's, kept across grade changes), grade chips 1–5, up to four stories (links to the stories page; one sent this month
 *               says "Sent ✓ <day/month>" by its title) + "All stories",
 *               then one card "Ready video quizzes" → the maker page
 *   foot        "Make a new quiz", the maker's three cards (lesson plans / coaching / test paper), "Try it as a student"
 *               (coaches), "Not a teacher? Change", "Open my portal" (quiz_teacher_home_portal_link: the portal Home,
 *               signed in, for a teacher who did not come from the portal)
 *   send sheet  the class message in a read-only box, "Copy the message" FIRST ("Copied" only when the copy really
 *               happened, else "Long-press to copy"), then "Send to my class" — a plain https://wa.me/?text= link the
 *               server built (no fetch between the tap and the navigation), the two honest lines, and "After sending,
 *               come back from the button in your chat" (there is no screen to come back to)
 *
 * The script never builds HTML (createElement + textContent only); the inline CSS and the script are allowed by their
 * sha256 in the Content-Security-Policy (header + <meta>). Audit hooks: data-screen per screen, ONE data-primary per
 * screen, data-tap on every action, data-back on the sheet, data-home on the home, lang/dir on <html>.
 */
const crypto = require('crypto');
const { clampLanguage } = require('../../config/ux-strings');
const { str, ALL_IDS } = require('./teacher-home.strings');

const ASSET_BASE = '/wq';
const UR_FONT = `${ASSET_BASE}/fonts/wq-nastaliq-5.woff2`;
const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const bootJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const digits = (n, lang) => (lang === 'ur' ? String(n).replace(/\d/g, (d) => UR_DIGITS[Number(d)]) : String(n));

const CSS = [
  ':root{--brand:#47BA7D;--brand-d:#23794D;--ink:#2A2D3A;--brand-ink:#333748;--muted:#5F6374;--ground:#F5F8F6;--card:#fff;--line:#DCE5DF;--warn:#8A5E06;--warn-bg:#FFF2CF;',
  '--f:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--fu:"WQ Nastaliq 5","Noto Nastaliq Urdu",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}',
  'body{background:var(--ground);color:var(--ink);font-family:var(--f);-webkit-text-size-adjust:100%;touch-action:manipulation}',
  'html[lang=ur] body{font-family:var(--fu);word-spacing:.12em}',
  '[hidden]{display:none!important}',
  '.th{width:100%;max-width:480px;margin:0 auto;padding:10px 16px 28px;display:flex;flex-direction:column;gap:14px}',
  '.th-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}',
  'h1{margin:0;font-size:22px;line-height:1.3;font-weight:900;color:var(--brand-ink)}html[lang=ur] h1{font-weight:400;font-size:24px;line-height:1.9}',
  'h2{margin:0 0 6px;font-size:15px;font-weight:900;color:var(--muted);letter-spacing:.03em}html[lang=ur] h2{font-weight:400;font-size:19px;line-height:1.9;letter-spacing:0}',
  '.th-sw{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;border:2px solid var(--line);background:var(--card);color:var(--brand-ink);font:800 15px/1.4 var(--f);text-decoration:none}',
  '.th-sw[lang=ur]{font-family:var(--fu);font-weight:400;font-size:18px;line-height:1.8}',
  '.th-card{background:var(--card);border:2px solid var(--line);border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:10px}',
  '.th-card.th-main{border-color:var(--brand);box-shadow:0 3px 0 var(--line)}',
  '.th-say{margin:0;font-weight:800;font-size:19px;line-height:1.4;color:var(--brand-ink)}html[lang=ur] .th-say{font-weight:400;font-size:21px;line-height:1.9}',
  '.th-sub{margin:0;color:var(--muted);font-size:16px;line-height:1.5;overflow-wrap:anywhere}html[lang=ur] .th-sub{font-size:18px;line-height:2}',
  '.th-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border:0;border-radius:16px;background:var(--brand);color:#fff;box-shadow:0 4px 0 var(--brand-d);font:900 19px/1.2 var(--f);cursor:pointer;text-decoration:none;padding:8px 16px;text-align:center}',
  'html[lang=ur] .th-go{font-family:var(--fu);font-weight:400;font-size:21px;line-height:1.8}',
  '.th-go2{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border:2px solid var(--brand);border-radius:16px;background:var(--card);color:var(--brand-d);font:900 17px/1.2 var(--f);cursor:pointer;text-decoration:none;padding:8px 16px;text-align:center}',
  'html[lang=ur] .th-go2{font-family:var(--fu);font-weight:400;font-size:19px;line-height:1.8}',
  '.th-link{display:inline-flex;align-items:center;min-height:48px;border:0;background:none;color:var(--brand-d);text-decoration:underline;font:800 16px/1.5 var(--f);cursor:pointer;padding:4px 6px}html[lang=ur] .th-link{font-family:var(--fu);font-weight:400;font-size:18px}',
  '.th-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
  '.th-row{display:flex;align-items:center;gap:10px;background:var(--card);border:2px solid var(--line);border-radius:14px;padding:8px 10px;min-height:60px;flex-wrap:wrap}',
  '.th-row-t{flex:1 1 160px;min-width:0;display:flex;flex-direction:column}',
  '.th-row-k{font-size:14px;color:var(--muted);font-weight:800}html[lang=ur] .th-row-k{font-weight:400;font-size:18px;line-height:1.8}',
  '.th-row-n{font-size:16px;font-weight:800;line-height:1.4;overflow-wrap:anywhere}html[lang=ur] .th-row-n{font-weight:400;font-size:18px;line-height:1.9}',
  '.th-sent{display:inline-block;unicode-bidi:isolate;margin-inline-start:8px;padding:0 8px;border-radius:999px;background:#E8F6EE;color:var(--brand-d);font-size:14px;font-weight:800;white-space:nowrap}html[lang=ur] .th-sent{font-weight:400;font-size:16px}',
  '.th-row-v{flex:none;min-height:48px;min-width:48px;padding:4px 12px;border-radius:12px;border:2px solid var(--brand);background:var(--card);color:var(--brand-d);font:800 15px/1.2 var(--f);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}',
  'html[lang=ur] .th-row-v{font-family:var(--fu);font-weight:400;font-size:18px;line-height:1.8}',
  '.th-row-v:disabled{opacity:.5}',
  '.th-chips{display:flex;flex-wrap:wrap;gap:8px}',
  '.th-chip{min-height:48px;min-width:52px;padding:6px 12px;border-radius:14px;border:2px solid var(--line);background:var(--card);color:var(--brand-ink);font:800 18px/1.2 var(--f);cursor:pointer}',
  'html[lang=ur] .th-chip{font-family:var(--fu);font-weight:400;font-size:20px;line-height:1.8}',
  '.th-chip[aria-pressed=true]{border-color:var(--brand);background:#E8F6EE}',
  '.th-note{margin:0;color:var(--muted);font-size:15px;line-height:1.5}html[lang=ur] .th-note{font-size:18px;line-height:2}',
  '.th-err{margin:0;padding:6px 12px;border-radius:12px;background:var(--warn-bg);color:var(--warn);font-weight:800}html[lang=ur] .th-err{font-weight:400;font-size:18px;line-height:1.9}',
  '.th-msg{width:100%;min-height:150px;margin:0;padding:12px 14px;border-radius:14px;background:var(--card);border:2px solid var(--line);font:16px/1.5 var(--f);color:var(--ink);resize:vertical;field-sizing:content}',
  'html[lang=ur] .th-msg{font-family:var(--fu);font-size:18px;line-height:2}',
  '.th-ok{margin:0;font-weight:800;color:var(--brand-d)}html[lang=ur] .th-ok{font-weight:400;font-size:18px}',
  '.th-sk{background:#EDF2EF;border-radius:12px;min-height:22px}.th-sk-b{min-height:56px}',
  '.th-row-q{flex:1 1 100%}.th-row-b{display:flex;flex-wrap:wrap;gap:8px}',
  '.th-row .th-link{min-height:44px}',
  '.th-foot{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:6px}',
  '.th-cards{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}',
  '.th-sheet{position:fixed;inset:0;background:var(--ground);overflow:auto;z-index:5}',
  '.th-walk{margin-top:14px;padding:12px;border:2px dashed var(--line);border-radius:14px}.th-walk button{display:block;width:100%;min-height:48px;margin-top:8px;border-radius:12px;border:2px solid var(--line);background:var(--card);font:inherit;color:var(--ink)}html[lang=ur] .th-walk{font-size:18px;line-height:1.9}',
].join('\n');

function fontFace(lang) {
  if (lang !== 'ur') return '';
  return `@font-face{font-family:"WQ Nastaliq 5";src:url(${UR_FONT}) format("woff2");font-weight:400;font-display:swap}\n`;
}

/**
 * The send sheet's message box rows: every line of the message, each long line counted for every phone row it wraps
 * onto (≈ 28 Latin / 22 Urdu letters per row at 360 px; an Urdu message on the English page counts as Urdu), plus
 * one, never under 3. Plain ES5: the page's script
 * carries this very function (one source), so the whole message, the return line included, is in view.
 */
function msgRows(t, ur) {
  var per = ur || /[\u0600-\u06FF]/.test(String(t || '')) ? 22 : 28;
  var n = 1;
  String(t || '').split('\n').forEach(function (l) { n += Math.max(1, Math.ceil(l.length / per)); });
  return Math.max(3, n);
}

// The page's one script. Plain ES5; never builds HTML; a failed event post never blocks a tap.
const SCRIPT = `(function(){
${msgRows.toString()}
var b={};try{b=JSON.parse(document.getElementById('th-boot').textContent)}catch(e){}
var S=b.s||{},d=null,grade=null,busy=false,T=encodeURIComponent(b.t),shown=5,polls={},made={};
function q(s){return document.querySelector(s)}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function dg(n){var s=String(n);return b.dg?s.replace(/[0-9]/g,function(x){return b.dg.charAt(+x)}):s}
function day(v){var t=new Date(v);return isNaN(t.getTime())?'':dg(t.getDate()+'/'+(t.getMonth()+1))}
function fill(k,o){return String(S[k]||'').replace(/\\{(\\w+)\\}/g,function(m,n){return o&&o[n]!=null?String(o[n]):m})}
function post(p,o){return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o),credentials:'same-origin'})}
function getj(p){return fetch(p,{credentials:'same-origin'}).then(function(r){if(r.status===410){location.reload();throw 1}if(!r.ok)throw 0;return r.json()})}
function step(n,x){try{var o={t:b.t,step:n};if(x){if(x.kind)o.kind=x.kind;if(x.id)o.id=x.id;if(x.origin)o.origin=x.origin;if(x.c)o.c=x.c}var s=JSON.stringify(o);if(navigator.sendBeacon&&navigator.sendBeacon('/api/th/step',new Blob([s],{type:'application/json'})))return;post('/api/th/step',o).catch(function(){})}catch(e){}}
function store(k,v){try{if(v==null)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function clear(n){while(n&&n.firstChild)n.removeChild(n.firstChild)}
function topic(t){var x=el('bdi');x.setAttribute('dir','auto');x.textContent=t||'';return x}
function btn(cls,txt,tap,fn,primary){var x=el('button',cls,txt);x.type='button';x.setAttribute('data-tap',tap);if(primary)x.setAttribute('data-primary','');x.addEventListener('click',fn);return x}
function link(cls,txt,href,tap,primary){var x=el('a',cls,txt);x.href=href;x.setAttribute('data-tap',tap);if(primary)x.setAttribute('data-primary','');return x}
function err(on){q('#th-err').hidden=!on;var g=q('#th-err-go');if(g)g.hidden=!on}
function hello(){var h=q('#th-h');clear(h);if(d&&d.first){var p=String(S['th.h']||'').split('{first}');h.appendChild(document.createTextNode(p[0]||''));h.appendChild(topic(d.first));h.appendChild(document.createTextNode(p[1]||''))}else h.textContent=S['th.hello.noname']||''}
var cur=null;
function srv(x){return x.c&&(x.sendKind==='video'||x.sendKind==='share')?'/quiz/teacher/'+T+'/send?c='+encodeURIComponent(x.c)+'&o='+encodeURIComponent(x.origin||'library')+'&lang='+b.lang:''}
function sheet(x,title){cur=x;q('#th-sheet-t').textContent='';q('#th-sheet-t').appendChild(topic(title));var m=q('#th-msg');m.value=x.message;m.rows=msgRows(x.message,b.lang==='ur');q('#th-sheet-go').setAttribute('href',srv(x)||x.wa);q('#th-copied').hidden=true;q('#th-long').hidden=true;q('#th-sheet').hidden=false;q('#th-main').setAttribute('aria-hidden','true');held(true);try{m.style.height='auto';m.style.height=(m.scrollHeight+4)+'px'}catch(e){}
try{history.pushState({sheet:1},'')}catch(e){}window.scrollTo(0,0)}
function unsheet(){q('#th-sheet').hidden=true;q('#th-main').removeAttribute('aria-hidden');held(false)}
// one primary on the screen: the open sheet's send holds it, and the home's goes back when the sheet closes
var held0=[];function held(open){var g=q('#th-sheet-go');if(open){held0=Array.prototype.slice.call(q('#th-main').querySelectorAll('[data-primary]'));held0.forEach(function(e){e.removeAttribute('data-primary')});g.setAttribute('data-primary','')}else{g.removeAttribute('data-primary');held0.forEach(function(e){e.setAttribute('data-primary','')});held0=[]}}
window.addEventListener('popstate',function(){unsheet()});
function copied(ok){q('#th-copied').hidden=!ok;q('#th-long').hidden=ok;step(ok?'share_copy':'copy_failed')}
function copy(){var m=q('#th-msg');try{m.focus();m.select();m.setSelectionRange(0,m.value.length)}catch(e){}
function legacy(){var ok=false;try{ok=document.execCommand('copy')}catch(e){ok=false}copied(!!ok)}
try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(m.value).then(function(){copied(true)},legacy)}else legacy()}catch(e){legacy()}}
function fetchSend(kind,id,title,origin){if(busy)return;busy=true;err(false);
post('/api/th/send',{t:b.t,kind:kind,id:id,lang:b.lang}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(x){if(!x||typeof x.message!=='string'||typeof x.wa!=='string')throw 0;x.sendKind=kind;x.id=id;x.origin=origin;sheet(x,title)})
.catch(function(){err(true)}).then(function(){busy=false})}
function top(){paint();if(!q('#th-sheet').hidden)Array.prototype.forEach.call(q('#th-top').querySelectorAll('[data-primary]'),function(e){e.removeAttribute('data-primary');held0.push(e)})}
function paint(){var c=q('#th-top');clear(c);var p=d.primary||{};c.setAttribute('data-kind',p.kind||'none');
if(p.kind==='class'){c.appendChild(el('p','th-say',p.played>0?fill('th.played.n',{n:dg(p.played)}):S['th.zero']));
var t=el('p','th-sub');t.appendChild(topic(p.title));c.appendChild(t);
if(p.again&&p.again.href)c.appendChild(link('th-go',S['th.again'],p.again.href,'again',true));
else if(p.send)c.appendChild(btn('th-go',S['th.again'],'again',function(){var s=p.send;sheet({message:s.message,wa:s.wa,c:s.c,sendKind:s.sendKind,id:p.again&&p.again.id,origin:'again'},p.title)},true));
if(p.report)c.appendChild(link('th-link',S['th.report'],p.report,'report'));return}
if(p.kind==='lesson'){var pl=String(S['th.lastlesson']||'').split('{topic}');var hl=el('p','th-say');hl.appendChild(document.createTextNode(pl[0]||''));hl.appendChild(topic(p.title));hl.appendChild(document.createTextNode(pl[1]||''));c.appendChild(hl);
if(made[p.id]){c.appendChild(el('p','th-note',S['th.quiz.making']));return}
var lv=btn('th-go',S['th.quiz.this'],'quiz_this',function(){make({kind:p.from,make:p.make,id:p.id,title:p.title},c,lv)},true);c.appendChild(lv);return}
if(p.kind==='made'){var u0=el('p','th-say');u0.appendChild(topic(p.title));c.appendChild(u0);
c.appendChild(btn('th-go',S['th.send'],'send',function(){sheet({message:p.send.message,wa:p.send.wa,sendKind:'again',id:p.id,origin:p.origin},p.title)},true));return}
c.appendChild(el('p','th-say',S['th.primary.lib']));
if(p.kind==='story'||p.kind==='video'){var u=el('p','th-sub');u.appendChild(topic(p.title));c.appendChild(u);
if(p.kind==='story')c.appendChild(link('th-go',S['th.send'],p.href,'story_tile',true));
else if(p.send)c.appendChild(btn('th-go',S['th.send'],'send',function(){sheet({message:p.send.message,wa:p.send.wa,c:p.send.c,sendKind:'video',id:p.id,origin:'library'},p.title)},true));return}
if(p.kind==='make'&&p.href){c.appendChild(link('th-go',S['th.make'],p.href,'make',true))}}
function under(){var ul=q('#th-confirm');clear(ul);(d.confirm||[]).forEach(function(r){var li=el('li','th-row');li.setAttribute('data-row','confirm');var tx=el('div','th-row-t th-row-q');
tx.appendChild(el('span','th-row-n',fill('th.confirm.q',{name:r.first,name2:r.candidateFirst})));li.appendChild(tx);var bx=el('div','th-row-b');li.appendChild(bx);
[['same','th.confirm.same'],['no','th.confirm.diff'],['unsure','th.confirm.unsure']].forEach(function(k){bx.appendChild(btn('th-row-v',S[k[1]],'confirm_'+k[0],function(){if(busy)return;busy=true;
post('/api/th/confirm',{t:b.t,looseId:r.looseId,candidateId:r.candidateId,decision:k[0]}).then(function(x){if(!x.ok&&x.status!==204)throw 0;li.parentNode&&li.parentNode.removeChild(li)}).catch(function(){err(true)}).then(function(){busy=false})}))});ul.appendChild(li)});
ul.hidden=!(d.confirm&&d.confirm.length);var c=q('#th-children');c.hidden=!d.children;if(d.children)c.setAttribute('href',d.children)}
var TAG={lp:'th.tag.lp',coach:'th.tag.coach',quiz:'th.tag.quiz',story:'th.tag.story'};
function poll(row,box,v){var id=row.quizId,t0=Date.now();if(polls[id])return;polls[id]=1;var note=el('p','th-note',S['th.quiz.making']);note.setAttribute('role','status');box.appendChild(note);if(v)v.hidden=true;
function tick(){getj('/api/th/quiz/'+encodeURIComponent(id)+'?t='+T+(b.ask?'&lang='+b.ask:'')).then(function(x){if(x&&x.state==='ready'&&x.message){note.textContent='';d.primary={kind:'made',id:id,title:x.title||row.title,send:{message:x.message,wa:x.wa},origin:row.kind==='coach'?'coaching':'lesson_plan'};top();
(d.timeline||[]).forEach(function(t){if(t.verb==='quiz_this'&&t.id===row.id&&row.make)Object.assign(t,{verb:'again',id:id,sendKind:'again'})});rows();window.scrollTo(0,0);return}
if(x&&x.state==='failed'){note.textContent=S['th.error'];return}later()}).catch(later)}
// after 3 min the late line, and the page keeps asking every 15 s until 10 min (the card still becomes the quiz)
function later(){var e=Date.now()-t0;if(e>180000)note.textContent=S['th.quiz.late'];if(e<600000)setTimeout(tick,e>180000?15000:5000)}
setTimeout(tick,5000)}
function make(row,box,v){if(busy)return;busy=true;err(false);v.disabled=true;
post('/api/th/quiz/make',{t:b.t,kind:row.make,id:row.id,lang:b.lang}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(x){if(!x||!x.quizId)throw 0;box.appendChild(el('p','th-note',S['th.job']));row.quizId=x.quizId;poll(row,box,v);made[row.id]=1;if(box===q('#th-top'))rows();else if(d.primary&&d.primary.kind==='lesson'&&d.primary.id===row.id)top()})
.catch(function(){err(true);v.disabled=false}).then(function(){busy=false})}
function rows(){var ul=q('#th-rows');clear(ul);var all=d.timeline||[];
all.slice(0,shown).forEach(function(r){var li=el('li','th-row');li.setAttribute('data-row',r.kind);var tx=el('div','th-row-t');
var k=el('span','th-row-k',S[TAG[r.kind]]||'');if(r.played!=null){k.textContent+=' \\u00b7 '+(r.played>0?fill('th.played.n',{n:dg(r.played)}):S['th.zero'])}
tx.appendChild(k);var n=el('span','th-row-n');n.appendChild(topic(r.title));tx.appendChild(n);li.appendChild(tx);
if(r.verb==='again')li.appendChild(btn('th-row-v',S['th.again'],'again',function(){fetchSend(r.sendKind,r.id,r.title,'again')}));
if(r.report)li.appendChild(link('th-link',S['th.report'],r.report,'report'));
if(r.verb==='quiz_this'&&made[r.id])tx.appendChild(el('p','th-note',S['th.quiz.making']));
else if(r.verb==='quiz_this'){var v=btn('th-row-v',S['th.quiz.this'],'quiz_this',function(){make(r,tx,v)});li.appendChild(v)}
else if(r.status==='making'&&r.quizId){poll(r,tx,null)}
ul.appendChild(li)});q('#th-tl').hidden=!all.length;q('#th-more').hidden=all.length<=shown}
function lib(L){Array.prototype.forEach.call(q('#th-grades').querySelectorAll('[data-grade]'),function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-grade')===String(L.grade)))});
q('#th-chosen').textContent=fill('th.chosen.for',{n:dg(L.grade)});
var ul=q('#th-stories');clear(ul);(L.stories||[]).forEach(function(s){var li=el('li','th-row');li.setAttribute('data-row','story');var tx=el('div','th-row-t');var n=el('span','th-row-n');n.appendChild(topic(s.title));if(s.sent)n.appendChild(el('span','th-sent',fill('th.sent.on',{day:day(s.sent)})));tx.appendChild(n);li.appendChild(tx);li.appendChild(link('th-row-v',S['th.send'],s.href,'story_tile'));ul.appendChild(li)});
ul.hidden=!(L.stories&&L.stories.length);var a=q('#th-all');a.hidden=!L.all;if(L.all)a.setAttribute('href',L.all);
var v=q('#th-videos');v.hidden=!d.maker;if(d.maker)v.setAttribute('href',d.maker)}
function pickGrade(n){if(String(n)===String(grade))return;grade=n;store('th.grade',String(n));step('grade');
getj('/api/th/library?t='+T+'&g='+n+(b.ask?'&lang='+b.ask:'')).then(function(L){d.library=L;if(d.primary&&(d.primary.kind==='story'||d.primary.kind==='video')&&L.pick){d.primary=L.pick;top()}lib(L)}).catch(function(e){if(e!==1)err(true)})}
function foot(){var m=q('#th-make');m.hidden=!d.maker;if(d.maker)m.setAttribute('href',d.maker);
var cs=q('#th-cards');clear(cs);(d.cards||[]).forEach(function(c){var a=link('th-go2',c.title,c.href,'card');a.setAttribute('data-card',c.card);cs.appendChild(a)});cs.hidden=!(d.cards&&d.cards.length);
var s=q('#th-try');s.hidden=!d.tryStudent;if(d.tryStudent)s.setAttribute('href',d.tryStudent);var cl=q('#th-change-go');cl.hidden=typeof d.change!=='string';if(typeof d.change==='string')cl.setAttribute('href',d.change);walk()}
function walk(){var w=q('#th-walk'),k=d.walk;w.hidden=!k;if(!k||w.firstChild||String(k.html).indexOf('<section data-screen="walk">')!==0)return;w.insertAdjacentHTML('beforeend',k.html);
Array.prototype.forEach.call(w.querySelectorAll('[data-persona]'),function(x){x.addEventListener('click',function(){if(busy)return;busy=true;
post('/api/go/persona',{t:k.t,as:x.getAttribute('data-persona')}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(o){if(!o||typeof o.next!=='string'||o.next.indexOf('/quiz/go/')!==0)throw 0;location.href=o.next})
.catch(function(){busy=false;err(true)})})})}
function render(){hello();top();under();rows();lib(d.library||{grade:2});foot();q('#th-main').setAttribute('data-ready','1')}
q('#th-more').addEventListener('click',function(){shown+=10;rows();step('more')});
q('#th-back').addEventListener('click',function(){try{history.back()}catch(e){unsheet()}});
q('#th-copy').addEventListener('click',copy);
q('#th-cards').addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('[data-card]'):null;if(a)step('card_'+a.getAttribute('data-card'))});
q('#th-sheet-go').addEventListener('click',function(){if(cur&&!srv(cur))step('share_tap',{kind:cur.sendKind,id:cur.id,origin:cur.origin,c:cur.c})});
q('#th-grades').addEventListener('click',function(e){var c=e.target&&e.target.closest?e.target.closest('[data-grade]'):null;if(c)pickGrade(c.getAttribute('data-grade'))});
var g0=store('th.grade');
getj('/api/th/home?t='+T+(b.ask?'&lang='+b.ask:'')+(/^[1-5]$/.test(g0||'')?'&g='+g0:''))
.then(function(x){d=x;grade=x.library&&x.library.grade;render()}).catch(function(e){if(e!==1){err(true);q('#th-main').setAttribute('data-ready','err')}});
})();`;
const SCRIPT_HASH = sha(SCRIPT);

/**
 * The page with the quick answer (switch quiz_teacher_home_paged ON): today's script with these parts swapped, so the
 * page with the switch OFF is today's byte for byte. The home's answer is waited for 15 s at most: after that (or on a
 * refusal) the error line and «Try again», which asks again; a late answer is still drawn, a stale timer stays quiet.
 */
const PAGED_SWAPS = Object.freeze([
  [`var g0=store('th.grade');
getj('/api/th/home?t='+T+(b.ask?'&lang='+b.ask:'')+(/^[1-5]$/.test(g0||'')?'&g='+g0:''))
.then(function(x){d=x;grade=x.library&&x.library.grade;render()}).catch(function(e){if(e!==1){err(true);q('#th-main').setAttribute('data-ready','err')}});`, `var g0=store('th.grade'),hq='/api/th/home?t='+T+(b.ask?'&lang='+b.ask:'')+(/^[1-5]$/.test(g0||'')?'&g='+g0:''),ask=0;
function stuck(){err(true);q('#th-retry').hidden=false;q('#th-main').setAttribute('data-ready','err')}
function home(){var n=++ask;setTimeout(function(){if(!d&&n===ask){step('home_slow');stuck()}},15000);
getj(hq).then(function(x){if(d)return;d=x;grade=x.library&&x.library.grade;err(false);q('#th-retry').hidden=true;render()}).catch(function(e){if(e!==1&&!d&&n===ask)stuck()})}
q('#th-retry').addEventListener('click',function(){q('#th-retry').hidden=true;err(false);q('#th-main').removeAttribute('data-ready');step('home_retry');home()});
home();`],
]);
function swapped(base, swaps, what = 'a paged part') {
  return swaps.reduce((out, [from, to]) => {
    if (out.split(from).length !== 2) throw new Error(`teacher home page: ${what} no longer matches the script`);
    return out.replace(from, () => to);
  }, base);
}
const SCRIPT_PAGED = swapped(SCRIPT, PAGED_SWAPS);
const SCRIPT_PAGED_HASH = sha(SCRIPT_PAGED);

/**
 * The slow-answer wait (switch quiz_teacher_home_wait ON, with the quick answer OFF or ON): the quick answer's script
 * with these parts swapped. The wait before the error line is max(measured p99 × 1.5, 25 s): HOME_P99_MS is the p99 of
 * the page's load to the home's answer (document + /api/th/home): the slowest measured load, 9.41 s (a cold throttled
 * 4G walk; the Slow 3G walks measured at most 7.85 s, most of it the server's /api/th/home), so 25 s rules.
 * «Try again» while the home read is still on its way re-uses that read (no second /api/th/home) and waits again; once
 * the read is over (refused, offline) «Try again» asks again. The skeleton stays under the line; a late answer is drawn.
 */
const HOME_P99_MS = 9410;
const WAIT_MS = Math.max(Math.round(HOME_P99_MS * 1.5), 25000);
const WAIT_SWAPS = Object.freeze([
  [`?'&g='+g0:''),ask=0;
`, `?'&g='+g0:''),ask=0,live=null;
`],
  [`function home(){var n=++ask;setTimeout(function(){if(!d&&n===ask){step('home_slow');stuck()}},15000);
getj(hq).then(function(x){if(d)return;d=x;grade=x.library&&x.library.grade;err(false);q('#th-retry').hidden=true;render()}).catch(function(e){if(e!==1&&!d&&n===ask)stuck()})}`,
  `function home(){var n=++ask;setTimeout(function(){if(!d&&n===ask){step('home_slow');stuck()}},${WAIT_MS});if(live)return;
live=getj(hq).then(function(x){live=null;if(d)return;d=x;grade=x.library&&x.library.grade;err(false);q('#th-retry').hidden=true;render()}).catch(function(e){live=null;if(e!==1&&!d)stuck()})}`],
]);
const SCRIPT_WAIT = swapped(SCRIPT_PAGED, WAIT_SWAPS, 'wait');
const SCRIPT_WAIT_HASH = sha(SCRIPT_WAIT);

// app_settings quiz_teacher_home_grade_fast ON: the grade chips answer from the page. The tapped chip is pressed at the
// tap (the story list is aria-busy and dimmed until its answer is drawn); each grade's library answer is kept in memory for this page (this token, this language); once the home is
// painted and the page is idle, the neighbouring grades are asked for ONE AT A TIME (none while another library request
// is open, none at all when the phone saves data or is on 2G); a tap on a grade already held (the home's own grade is,
// from its answer) draws at once, with no request.
const FAST_SWAPS = Object.freeze([
  [`function pickGrade(n){if(String(n)===String(grade))return;grade=n;store('th.grade',String(n));step('grade');
getj('/api/th/library?t='+T+'&g='+n+(b.ask?'&lang='+b.ask:'')).then(function(L){d.library=L;if(d.primary&&(d.primary.kind==='story'||d.primary.kind==='video')&&L.pick){d.primary=L.pick;top()}lib(L)}).catch(function(e){if(e!==1)err(true)})}`,
  `var C={},P={},pf=[],pfOn=false;
function ck(n){return T+'|'+(b.ask||'')+'|'+n}
function libGet(n){var k=ck(n);if(P[k])return P[k];P[k]=getj('/api/th/library?t='+T+'&g='+n+(b.ask?'&lang='+b.ask:'')).then(function(L){delete P[k];C[k]=L;return L},function(e){delete P[k];throw e});return P[k]}
function press(n){Array.prototype.forEach.call(q('#th-grades').querySelectorAll('[data-grade]'),function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-grade')===String(n)))})}
function libWait(on){var u=q('#th-stories');if(on)u.setAttribute('aria-busy','true');else u.removeAttribute('aria-busy');u.style.opacity=on?'.5':''}
function show(L){libWait(false);d.library=L;if(d.primary&&(d.primary.kind==='story'||d.primary.kind==='video')&&L.pick){d.primary=L.pick;top()}lib(L)}
function pickGrade(n){if(String(n)===String(grade))return;grade=n;press(n);store('th.grade',String(n));step('grade');
var L=C[ck(n)];if(L){show(L);soon();return}
libWait(true);
libGet(n).then(function(L){if(String(grade)!==String(n))return;show(L);soon()}).catch(function(e){if(String(grade)!==String(n))return;libWait(false);grade=d.library&&d.library.grade;press(grade);if(e!==1)err(true)})}
// the home's own grade is held from the start: its library card, and its top card when that is the library's pick
function seed(){var L=d.library,p=d.primary||{},o={},k;if(!L||!L.grade||C[ck(L.grade)])return;for(k in L)o[k]=L[k];o.pick=p.kind==='story'||p.kind==='video'?p:null;C[ck(L.grade)]=o}
function lite(){var c=navigator.connection;return !!(c&&(c.saveData===true||/(^|-)2g$/.test(String(c.effectiveType||''))))}
function soon(){if(lite())return;var g=+grade;[g+1,g-1].forEach(function(x){if(x>=1&&x<=5&&!C[ck(x)]&&pf.indexOf(x)<0)pf.push(x)});
if(pfOn||!pf.length)return;pfOn=true;(window.requestIdleCallback||function(f){return setTimeout(f,300)})(next)}
function next(){var k;for(k in P){P[k].then(next,next);return}var x=pf.shift();if(x==null){pfOn=false;return}if(C[ck(x)])return next();libGet(x).then(next,next)}`],
  [`foot();q('#th-main').setAttribute('data-ready','1')}`, `foot();q('#th-main').setAttribute('data-ready','1');seed();soon()}`],
]);
// Each part is found exactly once in today's script and in the quick answer's (swapped() throws at load otherwise):
// the two switches compose, each variant under its own hash.
const FAST_SCRIPT = swapped(SCRIPT, FAST_SWAPS);
const FAST_SCRIPT_HASH = sha(FAST_SCRIPT);
const SCRIPT_PAGED_FAST = swapped(SCRIPT_PAGED, FAST_SWAPS);
const SCRIPT_PAGED_FAST_HASH = sha(SCRIPT_PAGED_FAST);
/**
 * Two more switched parts, swapped the same way on either page above (each must match once):
 *   named (quiz_teacher_home_named_item): the class card says what it sends again, from the home's `primary.item`
 *     ("Story:"/"Quiz:" before the isolated title; "Send this story again"); a card without `item` reads as today.
 *   early (quiz_teacher_home_early_pick): a grade tapped before the home answers is kept (pressed + stored) and asked
 *     once the home is drawn; the library answer never writes into a home that is not there; a render clears the
 *     error line.
 */
const NAMED_SWAPS = Object.freeze([
  ["var t=el('p','th-sub');t.appendChild(topic(p.title));c.appendChild(t);\nif(p.again&&p.again.href)c.appendChild(link('th-go',S['th.again'],p.again.href,'again',true));\nelse if(p.send)c.appendChild(btn('th-go',S['th.again'],'again',",
    "var t=el('p','th-sub');var kw=p.item&&S['th.kind.'+p.item];if(kw)t.appendChild(document.createTextNode(kw+' '));t.appendChild(topic(p.title));c.appendChild(t);var ag=(kw&&S['th.again.'+p.item])||S['th.again'];\nif(p.again&&p.again.href)c.appendChild(link('th-go',ag,p.again.href,'again',true));\nelse if(p.send)c.appendChild(btn('th-go',ag,'again',"],
]);
const EARLY_SWAPS = Object.freeze([
  ["var S=b.s||{},d=null,grade=null,", "var S=b.s||{},d=null,pend=null,grade=null,"],
  ["function pickGrade(n){if(String(n)===String(grade))return;",
    "function pickGrade(n){if(!d){pend=n;store('th.grade',String(n));Array.prototype.forEach.call(q('#th-grades').querySelectorAll('[data-grade]'),function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-grade')===String(n)))});return}if(String(n)===String(grade))return;"],
  // anchored on the library ask itself, so a line added at the head of its answer (the story counts carry) still matches
  ["(b.ask?'&lang='+b.ask:'')).then(function(L){", "(b.ask?'&lang='+b.ask:'')).then(function(L){if(!d)return;"],
  // the render's head and its ready mark, apart, so the fast grade chips' tail (seed();soon()) may follow the mark
  ["function render(){hello();", "function render(){err(false);hello();"],
  ["q('#th-main').setAttribute('data-ready','1')", "q('#th-main').setAttribute('data-ready','1');var n=pend;pend=null;if(n!=null)pickGrade(n)"],
]);
/**
 * counts (quiz_teacher_story_counts): the library card's one counts line from the home's `library.counts` ("3 stories
 * sent · children who read: 7"), kept across a grade change (a grade's library answer carries no counts). Swapped
 * first, so the early pick's guard still comes before the carry.
 */
const COUNTS_SWAPS = Object.freeze([
  ["q('#th-chosen').textContent=fill('th.chosen.for',{n:dg(L.grade)});\n", "q('#th-chosen').textContent=fill('th.chosen.for',{n:dg(L.grade)});\nvar k=L.counts,kc=q('#th-counts'),kn=k&&k.sent>=1;kc.textContent=kn?fill(k.sent===1?'th.stories.counts.one':'th.stories.counts',{sent:dg(k.sent),read:dg(k.read||0)}):'';kc.hidden=!kn;\n"],
  ["(b.ask?'&lang='+b.ask:'')).then(function(L){", "(b.ask?'&lang='+b.ask:'')).then(function(L){if(d.library&&d.library.counts&&!L.counts)L.counts=d.library.counts;"],
]);
/**
 * portal (quiz_teacher_home_portal_link): the foot's "Open my portal" takes its href from the home's `portalHref` (the
 * server mints it; none → the link stays hidden) and a tap is the step `portal`. Anchored on the foot's own head, so
 * it composes with every other part; swapped last.
 */
const PORTAL_SWAPS = Object.freeze([
  ['function foot(){', "function foot(){var po=q('#th-portal');if(po){po.hidden=!d.portalHref;if(d.portalHref){po.setAttribute('href',d.portalHref);po.onclick=function(){step('portal')}}}"],
]);
// Every page the switches can ask for: paged × named × early × counts × grade-fast × portal, each under its own hash.
// The fast grade chips are swapped first (their parts are today's pickGrade and render tail), so with the fast switch
// on the counts carry and the early pick's guard land in the fast chips' one library ask (libGet), guard still first.
const SCRIPTS = new Map();
[false, true].forEach((paged) => [false, true].forEach((wait) => [false, true].forEach((named) => [false, true].forEach((early) => [false, true].forEach((counts) => [false, true].forEach((fast) => [false, true].forEach((portal) => {
  let text = wait ? SCRIPT_WAIT : paged ? SCRIPT_PAGED : SCRIPT;
  if (fast) text = wait ? swapped(SCRIPT_WAIT, FAST_SWAPS) : paged ? SCRIPT_PAGED_FAST : FAST_SCRIPT;
  if (counts) text = swapped(text, COUNTS_SWAPS, 'a story-counts part');
  if (named) text = swapped(text, NAMED_SWAPS, 'a named-item part');
  if (early) text = swapped(text, EARLY_SWAPS, 'an early-pick part');
  if (portal) text = swapped(text, PORTAL_SWAPS, 'the portal-link part');
  SCRIPTS.set(`${paged}|${wait}|${named}|${early}|${counts}|${fast}|${portal}`, { text, hash: !fast && !counts && !named && !early && !portal ? (wait ? SCRIPT_WAIT_HASH : paged ? SCRIPT_PAGED_HASH : SCRIPT_HASH) : sha(text) });
})))))));

/**
 * The page policy. A hash, or a list of them (the stories page has more than one inline style); `media` adds
 * media-src 'self' (a page with an <audio>); `formTo`, origins a form's post may redirect to (browsers check
 * form-action on the redirect too). `meta`: the <meta> copy, which cannot carry frame-ancestors.
 */
function csp(styleHash, scriptHash, { meta = false, media = false, formTo = [] } = {}) {
  const hashes = (h) => [].concat(h || []).map((x) => `'sha256-${x}'`).join(' ');
  const scripts = hashes(scriptHash);
  return `default-src 'none'; style-src ${hashes(styleHash)}; ${scripts ? `script-src ${scripts}; connect-src 'self'; ` : ''}`
    + `img-src 'self'; ${media ? "media-src 'self'; " : ''}font-src 'self'; form-action ${["'self'", ...formTo].join(' ')}; base-uri 'none'${meta ? '' : "; frame-ancestors 'none'"}`;
}

function head(lang, title, style, styleHash, scriptHash) {
  const preload = lang === 'ur' ? `\n<link rel="preload" href="${UR_FONT}" as="font" type="font/woff2" crossorigin>` : '';
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${esc(csp(styleHash, scriptHash, { meta: true }))}">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#47BA7D">${preload}
<title>${esc(title)}</title>
<style>${style}</style>
</head>`;
}

/** The page's language and its switch: en / ur as given; bi → Urdu with "English", or English with «اردو» on ?lang=en. */
function pageLang(tokenLang, asked) {
  if (tokenLang === 'en' || tokenLang === 'ur') return { lang: tokenLang, switchTo: null };
  return asked === 'en' ? { lang: 'en', switchTo: 'ur' } : { lang: 'ur', switchTo: 'en' };
}

// The strings the script fills with (textContent only), by id. The page's own static words are not repeated.
const NAMED_IDS = Object.freeze(['th.kind.story', 'th.kind.quiz', 'th.again.story', 'th.again.quiz']);
const COUNTS_IDS = Object.freeze(['th.stories.counts', 'th.stories.counts.one']);
const SCRIPT_IDS = Object.freeze(ALL_IDS.filter((id) => !['th.stale', 'th.lang.switch', 'th.title', 'cm.return', 'th.open.wa', 'th.retry', 'th.portal', ...NAMED_IDS, ...COUNTS_IDS].includes(id)));

/**
 * The shell. Nothing in it depends on the teacher and nothing is read to build it: the token (already verified by the
 * caller) rides only in the boot block; every teacher-specific word arrives from /api/th/home after paint. `asked` is
 * the ?lang the page was opened with (bi tokens only); `gradeFast` (only a real true) swaps in the fast grade chips'
 * script and its own hash; `portal` (only a real true) adds "Open my portal" to the foot and its script part.
 * → { html, csp } (the header value for the response).
 */
function buildShell({ token, lang = 'en', switchTo = null, asked = null, paged = false, named = false, early = false, counts = false, gradeFast = false, wait = false, portal = false }) {
  const { text: script, hash: scriptHash } = SCRIPTS.get(`${Boolean(paged)}|${wait === true}|${named === true}|${early === true}|${counts === true}|${gradeFast === true}|${portal === true}`);
  const l = clampLanguage(lang);
  const style = `${fontFace(l)}${CSS}`;
  const styleHash = sha(style);
  const enc = encodeURIComponent(token);
  const chat = require('./teacher-home.copy').chatLink();
  const s = {};
  SCRIPT_IDS.forEach((id) => { s[id] = str(id, l); });
  if (named === true) NAMED_IDS.forEach((id) => { s[id] = str(id, l); });
  if (counts === true) COUNTS_IDS.forEach((id) => { s[id] = str(id, l); });
  const sw = switchTo
    ? `<a class="th-sw" lang="${switchTo}" href="/quiz/teacher/${enc}?lang=${switchTo}" data-tap="lang">${esc(str('th.lang.switch', l))}</a>`
    : '';
  const chips = [1, 2, 3, 4, 5].map((g) => `<button type="button" class="th-chip" data-grade="${g}" data-tap="grade" aria-pressed="false" aria-label="${esc(str('th.grade.n', l).replace('{n}', digits(g, l)))}">${esc(digits(g, l))}</button>`).join('');
  const boot = { t: token, lang: l, ask: switchTo && asked === 'en' ? 'en' : null, dg: l === 'ur' ? UR_DIGITS : null, s };
  const html = `${head(l, str('th.title', l), style, styleHash, scriptHash)}
<body>
<main class="th" id="th-main" data-screen="teacher_home" data-home>
<header class="th-top"><h1 id="th-h">${esc(str('th.hello.noname', l))}</h1>${sw}</header>
<p class="th-err" id="th-err" role="alert" hidden>${esc(str('th.error', l))}</p>${paged || wait === true ? `\n<button class="th-go2" id="th-retry" type="button" hidden>${esc(str('th.retry', l))}</button>` : ''}${chat ? `\n<a class="th-go2" id="th-err-go" href="${esc(chat)}" hidden>${esc(str('th.open.wa', l))}</a>` : ''}
<section class="th-card th-main" id="th-top" aria-live="polite"><div class="th-sk"></div><div class="th-sk"></div><div class="th-sk th-sk-b"></div></section>
<ul class="th-rows" id="th-confirm" hidden></ul>
<a class="th-link" id="th-children" data-tap="children" hidden>${esc(str('th.children', l))}</a>
<section id="th-tl" hidden>
<h2>${esc(str('th.timeline', l))}</h2>
<ul class="th-rows" id="th-rows"></ul>
<button type="button" class="th-link" id="th-more" data-tap="more" hidden>${esc(str('th.more', l))}</button>
</section>
<section class="th-card" id="th-lib">
<h2>${esc(str('th.sec.library', l))}</h2>
<p class="th-note" id="th-chosen"></p>${counts === true ? '\n<p class="th-note" id="th-counts" hidden></p>' : ''}
<div class="th-chips" id="th-grades">${chips}</div>
<ul class="th-rows" id="th-stories" hidden></ul>
<a class="th-link" id="th-all" data-tap="all_stories" hidden>${esc(str('th.all.stories', l))}</a>
<a class="th-go2" id="th-videos" data-tap="videos" hidden>${esc(str('th.videos.card', l))}</a>
</section>
<nav class="th-foot">
<a class="th-link" id="th-make" data-tap="make" hidden>${esc(str('th.make', l))}</a>
<div class="th-cards" id="th-cards" hidden></div>
<a class="th-link" id="th-try" data-tap="try_student" hidden>${esc(str('th.try.student', l))}</a>
<a class="th-link" id="th-change-go" data-tap="change" hidden>${esc(str('th.change', l))}</a>${portal === true ? `\n<a class="th-link" id="th-portal" data-tap="portal" hidden>${esc(str('th.portal', l))}</a>` : ''}
<div class="th-walk" id="th-walk" hidden></div>
</nav>
</main>
<section class="th-sheet" id="th-sheet" data-screen="teacher_send" hidden>
<div class="th">
<div class="th-top"><button type="button" class="th-link" id="th-back" data-back data-tap="back" aria-label="${esc(str('th.title', l))}">${l === 'ur' ? '\u2192' : '\u2190'}</button></div>
<p class="th-say" id="th-sheet-t"></p>
<textarea class="th-msg" id="th-msg" readonly dir="auto" rows="${l === 'ur' ? 9 : 7}" aria-label="${esc(str('th.copy', l))}"></textarea>
<button type="button" class="th-go2" id="th-copy" data-tap="copy">${esc(str('th.copy', l))}</button>
<p class="th-ok" id="th-copied" role="status" hidden>${esc(str('th.copied', l))}</p>
<p class="th-note" id="th-long" role="status" hidden>${esc(str('th.copy.long', l))}</p>
<a class="th-go" id="th-sheet-go" data-tap="share_tap">${esc(str('th.send', l))}</a>
<p class="th-note">${esc(str('th.send.note1', l))}</p>
<p class="th-note">${esc(str('th.send.note2', l))}</p>
<p class="th-note">${esc(str('th.back.note', l))}</p>
</div>
</section>
<script type="application/json" id="th-boot">${bootJson(boot)}</script>
<script>${script}</script>
</body>
</html>`;
  return { html, csp: csp(styleHash, scriptHash) };
}

module.exports = {
  buildShell, pageLang, msgRows, SCRIPT, SCRIPT_HASH, SCRIPT_PAGED, SCRIPT_PAGED_HASH,
  FAST_SCRIPT, FAST_SCRIPT_HASH, SCRIPT_PAGED_FAST, SCRIPT_PAGED_FAST_HASH, SCRIPT_WAIT, SCRIPT_WAIT_HASH, HOME_P99_MS, WAIT_MS, swapped, digits, csp, sha,
};
