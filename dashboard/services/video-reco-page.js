'use strict';
/**
 * The recommended clip's player page (pure HTML) — bd-gzfdu9 (VIDREC), SPEC §4.6, r-ab ab/EVENTS_SCHEMA.md §2.
 *
 * A bare page for WhatsApp's in-app browser: the clip title, the level and the clip's bounds, a <video> that
 * opens at the clip start, "Why this clip" (the reason grounded in the teacher's own lesson), "Watch from the
 * start", the coach line and a way back to the report. EN or UR (right to left). No sign-in, no navigator.share,
 * no text-to-speech, nothing fetched but the video and its poster.
 *
 * The inline script reports what the teacher did, batched, through navigator.sendBeacon (fetch keepalive when
 * there is none) every 10 s and when the page is hidden: open (the script ran: a person, not a link preview),
 * play (the first media `playing`, never the play() call: media that never loads plays nothing — qa-e2e 20:16Z),
 * segment_start (first time the playing position is inside the clip), t30 / p50 / p90 (PLAYED time
 * inside the clip, summed from timeupdate steps of at most 1.5 s, so a seek is not watching), segment_end
 * (position reaches the clip end), ended, error. The server keeps the first of each.
 *
 * view = { language, title, clipLabel, reason, src|null, poster, startS, endS, eventsUrl, backHref|null }
 * Rendered by dashboard/routes/video-reco.routes.js.
 */
const { esc } = require('./coaching-report-style');
const copy = require('../../bot/shared/services/coaching/video-reco/copy');

const CSS = `
  :root { --bg:#f6f7f9; --card:#ffffff; --fg:#272b36; --muted:#5b6475; --line:#e3e6ec; --accent:#2f8a55; --chip:#eceef2; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161c; --card:#1d2129; --fg:#eceef3; --muted:#a6adbb; --line:#2c313b; --accent:#5cc28a; --chip:#2c313b; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:20px 16px 32px; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; }
  .kicker { color:var(--muted); font-size:14px; margin:0 0 4px; }
  h1 { font-size:24px; line-height:1.25; margin:0 0 10px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 14px; }
  .chip { background:var(--chip); color:var(--muted); border-radius:999px; padding:3px 12px; font-size:14px; }
  .chip bdi { direction:ltr; unicode-bidi:isolate; }
  video { width:100%; aspect-ratio:16/9; background:#000; border-radius:14px; display:block; margin:0 0 14px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; margin:0 0 14px; }
  h2 { font-size:17px; margin:0 0 6px; }
  p { margin:0 0 8px; }
  .btn { display:block; width:100%; min-height:48px; border:2px solid var(--accent); color:var(--accent); background:transparent; border-radius:12px; font:inherit; font-weight:600; cursor:pointer; margin:0 0 14px; }
  .muted { color:var(--muted); font-size:15px; }
  a.back { display:inline-block; color:var(--accent); font-weight:600; text-decoration:none; padding:10px 0; }
  html[lang="ur"] body { font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif; line-height:2.1; }
  html[lang="ur"] h1 { line-height:1.9; }
`;

/** The player script: the clip bounds and the beacon URL are the only values in it (JSON-encoded, '<' escaped). */
function script(cfg) {
  const data = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<script>(function(){
var C=${data},v=document.getElementById('v'),q=[],sent={},played=0,last=null,seeked=false,len=Math.max(1,C.end-C.start);
function add(e,at){if(e!=='error'){if(sent[e])return;sent[e]=1;}q.push({event:e,at_s:at==null?null:Math.round(at*10)/10,client_ts:new Date().toISOString()});}
function flush(){if(!q.length)return;var b=JSON.stringify({events:q.splice(0,50)});
try{if(navigator.sendBeacon&&navigator.sendBeacon(C.url,new Blob([b],{type:'text/plain;charset=UTF-8'})))return;}catch(_){}
try{fetch(C.url,{method:'POST',body:b,keepalive:true,headers:{'Content-Type':'text/plain;charset=UTF-8'}});}catch(_){}}
add('open',null);
if(v){
v.addEventListener('loadedmetadata',function(){if(!seeked){seeked=true;try{if(v.currentTime<C.start-1)v.currentTime=C.start;}catch(_){}}});
v.addEventListener('playing',function(){add('play',v.currentTime);});
v.addEventListener('seeking',function(){last=null;});
v.addEventListener('timeupdate',function(){var t=v.currentTime,inside=t>=C.start&&t<=C.end;
if(!v.paused&&inside)add('segment_start',t);
if(last!=null&&!v.paused&&!v.seeking){var d=t-last;if(d>0&&d<=1.5&&inside)played+=d;}
last=t;
if(played>=30)add('t30',t);if(played>=0.5*len)add('p50',t);if(played>=0.9*len)add('p90',t);
if(t>=C.end)add('segment_end',t);});
v.addEventListener('ended',function(){add('ended',v.currentTime);flush();});
v.addEventListener('error',function(){add('error',null);flush();});
var fs=document.getElementById('fromStart');if(fs)fs.addEventListener('click',function(){try{v.currentTime=0;v.play();}catch(_){}});
}
setInterval(flush,10000);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
window.addEventListener('pagehide',flush);
})();</script>`;
}

function renderPlayer(view = {}) {
  const l = copy.lang(view.language);
  const w = (k, p) => copy.word(k, l, p);
  const start = Number(view.startS) || 0;
  const end = Number(view.endS) > start ? Number(view.endS) : start + 60;
  // The range is one left-to-right isolate: inside an Urdu line "1:22 – 2:21" would otherwise read "2:21 – 1:22".
  const clip = w('videoRecoPlayerClip', { a: `\u2066${copy.clock(start)}`, b: `${copy.clock(end)}\u2069` });
  const src = view.src ? `${view.src}#t=${Math.floor(start)}` : '';
  const chips = [clip].map((c) => `<span class="chip"><bdi>${esc(c)}</bdi></span>`).join('');
  const video = `<video id="v" playsinline controls preload="metadata"${view.poster ? ` poster="${esc(view.poster)}"` : ''}${src ? ` src="${esc(src)}"` : ''}></video>`;
  const why = view.reason ? `<section><h2>${esc(w('videoRecoPlayerWhy'))}</h2><p>${esc(view.reason)}</p></section>` : '';
  const back = view.backHref ? `<a class="back" href="${esc(view.backHref)}">${esc(w('videoRecoPlayerBack'))}</a>` : '';
  const body = `<p class="kicker">Digital Coach</p><h1>${esc(view.title || '')}</h1><div class="chips">${chips}</div>${video}${why}`
    + `<button class="btn" id="fromStart" type="button">${esc(w('videoRecoPlayerFromStart'))}</button>`
    + `<p class="muted">${esc(w('videoRecoPlayerLookFor'))}</p>${back}`;
  return `<!doctype html>
<html lang="${l}" dir="${copy.dirOf(l)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(view.title || 'Digital Coach')}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
${view.eventsUrl ? script({ start, end, url: view.eventsUrl }) : ''}
</body>
</html>`;
}

module.exports = { renderPlayer };
