/**
 * The child home's next files and first reads, started early (app_settings web_quiz_fast on: the fast first page only).
 *
 * A direct /h/<t>#stories used to ask, one after another, hub.js → wq-home.js → wq-doors.js / wq-stories.js → the
 * door's rows and the shelf: every hop after the bot's answer. The hash never reaches the edge, so:
 *   head(v)          an inline script for the head the edge sends BEFORE the bot answers: it reads the hash on the phone
 *                    and preloads the home's scripts and styles at the hub's own ?v= (a door or a story: the home and its
 *                    doors, + the reader for #stories / #story/; a phone whose last home was the v3 home: the home and its
 *                    doors on any open). A class link to a story that names the child (?kid=<chip>#story/<id>, the
 *                    story door's answer with the switch on) asks for the book and its first picture right here, before
 *                    the server has answered. It also sets window.WQPRE, the early answers' store.
 *   tail(t, B, tok)  the page's tail with one call after the boot JSON — WQPRE.go({…}) — that starts the door's rows, the
 *                    shelf, the library or the book at once (the child and the language are only known here), before
 *                    any script runs. A script's own GET of one of those URLs (wq-doors.js, wq-stories.js) is answered
 *                    from that early read (window.fetch is wrapped for those URLs only, for one minute); a failed or
 *                    non-OK early read is asked again from the network.
 * The shelf's covers (wq-stories.js reads window.WQLZ): each starts as a blank and gets its picture when it scrolls into
 * view; the first four are fetched the moment the shelf's JSON lands, so the ones on screen are already there.
 * Switch off: neither is called, the page is today's byte for byte, and with no WQPRE the scripts are today's.
 */

// The early answers: a URL's response, shared (each GET of it gets a clone) for a minute; a failed or non-OK one is never
// handed out (the network is asked). A story's first picture is fetched the moment the book's JSON lands.
const HEAD = `(function(w,d){try{
var F=w.fetch,G="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",io=null;
var P=w.WQPRE={on:1,p:{},
take:function(u){var e=P.p[u];if(!e||e.bad||Date.now()-e.t>60000)return null;return e.r.then(function(r){if(!r.ok){e.bad=1;throw 0}return r.clone()})},
get:function(u,f){if(P.p[u])return;var e=P.p[u]={t:Date.now()};e.r=F.call(w,u,{credentials:"same-origin",headers:{accept:"application/json"}});
e.r.then(function(r){if(!r.ok){e.bad=1;return}if(f)r.clone().json().then(f,function(){})},function(){e.bad=1})},
pic:function(s){try{if(s)new w.Image().src=s}catch(x){}},
see:function(im){if(!im.getAttribute("srcset"))return;var go=function(){im.removeAttribute("srcset")};
if(!w.IntersectionObserver)return go();
io=io||new w.IntersectionObserver(function(es,o){es.forEach(function(x){if(x.isIntersecting){o.unobserve(x.target);x.target.removeAttribute("srcset")}})},{rootMargin:"0px 0px 200px 0px"});
io.observe(im)}};
w.WQLZ=' srcset="'+G+'" onload="WQPRE.see(this)"';
w.fetch=function(u,i){var r=typeof u==="string"&&!(i&&i.method&&i.method!=="GET")&&P.take(u);return r?r.then(null,function(){return F.call(w,u,i)}):F.apply(w,arguments)};
var h=String(w.location.hash||""),door=/^#(stories|games|videos|watch\\/)/.test(h),st=/^#(stories$|story\\/)/.test(h),home=door||st;
try{if(w.localStorage.getItem("wq_h3")==="1")home=1}catch(x){}
function book(t,k){var m=/^#story\\/([A-Za-z0-9_-]+)(?:\\/(q|p(\\d+)))?$/.exec(h);if(m)P.get("/api/wq/stories/book/"+encodeURIComponent(m[1])+"/h/"+t+"?kid="+encodeURIComponent(k),function(b){var p=(b.pages||[])[m[3]?m[3]-1:0];if(p&&p.image)P.pic(p.image.url)})}
var pre=function(f,as){var l=d.createElement("link");l.rel="preload";l.as=as;l.href="/wq/"+f+"?v=__V__";d.head.appendChild(l)};
if(home){pre("wq-home.js","script");pre("wq-home.css","style");pre("wq-doors.js","script");pre("wq-doors.css","style")}
if(st){pre("wq-stories.js","script");pre("wq-stories.css","style")}
var c=/[?&]kid=([0-9a-f]{16})(&|$)/.exec(w.location.search||""),tk=/^\\/h\\/([A-Za-z0-9._-]+)$/.exec(w.location.pathname||"");
if(c&&tk)book(encodeURIComponent(tk[1]),c[1]);
P.go=function(o){
try{w.localStorage.setItem("wq_h3",o.h?"1":"0")}catch(x){}
if(!o.k||o.x||!(o.h||o.s))return;
var e=encodeURIComponent,t=e(o.t),k=e(o.k),l=o.l,m;
if(o.h&&(m=/^#(stories|games)$/.exec(h)))P.get("/api/wq/doors/h/"+t+"?kid="+k+"&d="+m[1]+"&l="+l);
if(o.h&&h==="#videos")P.get("/api/wq/lib/h/"+t+"?kid="+k+"&l="+l);
if(o.s&&o.h&&h==="#stories"){var g=[],ids="";try{g=String(w.localStorage.getItem("wq_st_gl")||"").split(",");ids=String(w.localStorage.getItem("wq_st_t:"+o.k)||"").split(",").filter(Boolean).join(",")}catch(x){}
P.get("/api/wq/stories/shelf/h/"+t+"?kid="+k+(g[0]?"&g="+e(g[0]):"")+"&l="+(g[1]?(g[1]==="ur"?"ur":"en"):l)+(ids?"&t="+e(ids):""),function(j){(j.books||[]).slice(0,4).forEach(function(b){P.pic(b.cover)})})}
if(o.s)book(t,o.k)};
}catch(x){}})(window,document);`;

// JSON for an inline script: nothing may close the tag.
const js = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function head(assetV) {
  return `<script>${HEAD.replace(/\n/g, '').replace('__V__', String(assetV).replace(/[^0-9A-Za-z]/g, ''))}</script>\n`;
}

// The call, right after the boot JSON (before wq-tel.js and every page script): token, child, language, the v3 home,
// stories on, a coach's preview. No child (a locked or shared phone's first render): only the home's flag is kept.
function tail(t, payload, token) {
  const B = payload || {};
  const o = {
    t: String(token || ''), k: typeof B.kid === 'string' && !B.locked ? B.kid : null, l: B.lang === 'ur' ? 'ur' : 'en',
    h: B.home_v3 ? 1 : 0, s: B.stories && B.stories.on ? 1 : 0, x: B.practice ? 1 : 0,
  };
  const call = `<script>window.WQPRE&&WQPRE.go&&WQPRE.go(${js(o)})</script>\n`;
  const at = t.indexOf('</script>\n');
  return at < 0 || !/^<script id="boot"/.test(t) ? t : `${t.slice(0, at + 10)}${call}${t.slice(at + 10)}`;
}

module.exports = { head, tail };
