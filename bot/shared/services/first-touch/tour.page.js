'use strict';
/**
 * The maker page's one tour banner, as an addon for buildMakerPage (TOUR.md §2, §4, §5):
 *
 *   tourAddon({ lang, show }) → { top, foot, script, css }
 *     top     the banner — mk.tour + the mk.tour.ok button, role="status", at the top of the first screen. The markup
 *             is always there (the replay shows it); `show` false renders it hidden. data-first="1" marks the
 *             first-time banner, the one whose dismissal is written.
 *     foot    "How it works" (mk.tour.replay), a plain link-styled button at the page foot, on every screen.
 *     script  ONE plain-ES5 script, run before the page's own: on load, a first-time banner posts {action:'show'}
 *             once; "Got it" hides it and posts {action:'dismiss', how:'ok'} (a replayed banner's "Got it" only
 *             hides); window.ftOnFirstChip (called once on the first grade tap) and the pre-fill's "Use it"
 *             ([data-pf="keep"]) hide a first-time banner still up and post the dismiss with how 'chip' / 'prefill';
 *             "How it works" shows the banner and posts {action:'replay'}. Every post is fire-and-forget
 *             (keepalive), never blocking a chip. It never builds HTML and keeps no local state: whether the banner
 *             shows is the server's decision (the token flag AND the quiz_tour row).
 *     css     the banner's rules, appended to the page's one <style> (one hash, CSP unchanged in shape).
 */
const { clampLanguage } = require('../../config/ux-strings');
const { str } = require('./maker.strings');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = [
  '.mk-tour{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:16px;background:#E8F6EE;border:2px solid var(--brand)}',
  '.mk-tour p{margin:0;color:var(--brand-ink);font-weight:800;font-size:17px;line-height:1.45}html[lang=ur] .mk-tour p{font-weight:400;font-size:18px;line-height:2}',
  '.mk-tour .mk-go2{min-height:44px;align-self:flex-start;width:auto;padding:4px 20px}',
].join('\n');

const SCRIPT = `(function(){
var b={};try{b=JSON.parse(document.getElementById('mk-boot').textContent)}catch(e){}
var el=document.getElementById('mk-tour');if(!el)return;
var up=el.getAttribute('data-first')==='1'&&!el.hidden;
function post(o){o.t=b.t;try{fetch('/api/ft/tour',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o),credentials:'same-origin',keepalive:true}).catch(function(){})}catch(e){}}
function dismiss(how){if(!up)return;up=false;el.hidden=true;post({action:'dismiss',how:how})}
window.ftOnFirstChip=function(){dismiss('chip')};
document.addEventListener('click',function(e){
var c=e.target&&e.target.closest?e.target.closest('#mk-tour-ok,#mk-tour-replay,[data-pf]'):null;if(!c)return;
if(c.id==='mk-tour-ok'){if(up)dismiss('ok');else el.hidden=true}
else if(c.id==='mk-tour-replay'){el.hidden=false;post({action:'replay'});window.scrollTo(0,0)}
else if(c.getAttribute('data-pf')==='keep'){dismiss('prefill')}
});
if(up)post({action:'show'});
})();`;

function tourAddon({ lang = 'en', show = false } = {}) {
  const l = clampLanguage(lang === 'bi' ? 'ur' : lang);
  const top = `<div class="mk-tour" id="mk-tour" role="status" data-id="mk.tour"${show ? ' data-first="1"' : ' hidden'}>`
    + `<p>${esc(str('mk.tour', l))}</p>`
    + `<button type="button" class="mk-go2" id="mk-tour-ok" data-id="mk.tour.ok">${esc(str('mk.tour.ok', l))}</button></div>`;
  const foot = `<p class="mk-foot"><button type="button" class="mk-link" id="mk-tour-replay" data-id="mk.tour.replay">${esc(str('mk.tour.replay', l))}</button></p>`;
  return { top, foot, script: SCRIPT, css: CSS };
}

module.exports = { tourAddon, SCRIPT, CSS };
