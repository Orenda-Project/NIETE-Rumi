'use strict';
/**
 * A new phone's first Home asks for itself from the page's head (app_settings web_quiz_early_unlock, read by the bot in
 * the hub's one settings read; the hub answer says `early_unlock: true` only when it is on).
 *
 * A phone without the wq_dv cookie (its first hub open) reaches the bot as no phone at all, so the server render is the
 * locked page and hub.js asks the bot again as this phone (POST /api/wq/hub/<t> with its device_ref) before it draws the
 * Home: one more round trip that only starts once the page's scripts have arrived and run (~1 s after the head on slow
 * 4G). ON, the head the fast first page sends before the bot answers carries a small script for such a phone: it works
 * out the phone's device_ref exactly as hub.js does (the stored ref, else the wq_dv cookie, else a new one, kept in both)
 * and starts that same call at once (window.WQHUB0 = {t, b, r}: the token, the body as sent, the fetch). hub.js's first
 * hub call uses it when it would send exactly that body for that token, else asks as today; a failed early call is
 * asked again from the network. The grown-ups corner's language tap (?keep=1) is never asked early (hub.js adds keep).
 *
 * The server render such a phone gets is the locked answer, whose page has none of the home's files nor its look: the
 * answer the head asked for would then wait for wq-home.js, its stylesheet and the adventure kit to be fetched (~0.8 s
 * more). So that page's tail is drawn in the SHAPE of the last child's answer this edge saw (shaped()): its switches that
 * name files and the look (home_v3, home_fb, pack, listen, the Jugnu corner's presence, adv, one_face, the look's ui
 * booleans), never a name, a child, a quiz or a token; it stays locked (`locked: true`, no children), so hub.js still
 * asks (or takes the head's call) before anything is shown, and a link on another phone stays locked.
 * The head is sent before the answer is known, so it follows the LAST hub answer this edge saw (as `fast`, `home_pre`
 * and `home_inline` do); a locked answer teaches it too (it is the answer such a phone's server render gets).
 * Off (no `early_unlock`, or anything but JSON true), or a phone with its wq_dv cookie: head() is empty, the page is today's.
 */
let last = false; // the last hub answer's `early_unlock`
let shape = null; // the last child's answer's page shape (shaped() below), or null

// The look's ui booleans, and the switches that name the page's files or its look (hubPageParts, withLook).
const UI = ['ur2', 'fl', 'uf', 'adv'];
const KEYS = ['home_v3', 'home_fb', 'pack', 'listen', 'adv', 'one_face'];
// The bot sends the home's own two as 1 (web-quiz-hub-home.js `home_v3: 1`, `home_fb: 1`), the rest as true: either is on,
// kept as sent (homeTags reads them as truthy).
const isOn = (v) => v === true || v === 1;

/** Every hub answer (a locked one too) says whether the switch is on; a child's answer also gives its page's shape. */
function learn(payload) {
  last = Boolean(payload && payload.early_unlock === true);
  if (!last) { shape = null; return; }
  if (payload.locked || !payload.kid) return;
  const out = {};
  for (const k of KEYS) if (isOn(payload[k])) out[k] = payload[k];
  if (payload.play && typeof payload.play === 'object') out.play = {};
  if (payload.ui && typeof payload.ui === 'object') {
    const ui = {};
    for (const k of UI) if (payload.ui[k] === true) ui[k] = true;
    if (Object.keys(ui).length) out.ui = ui;
  }
  shape = out;
}

/**
 * The portal's learner (edge learn) says the v3 home is on (`home_v3`) before this process saw any child: the page's
 * shape from what it says (the home, the look), so the first new phone after a process start gets the home's files
 * in its locked render's tail too. A child's answer, once seen, is the shape (learn() above).
 */
function guess(b) {
  if (!last || shape || !b || !isOn(b.home_v3)) return;
  const out = { home_v3: b.home_v3 };
  if (b.adv === true) out.adv = true;
  if (b.one_face === true) out.one_face = true;
  if (b.ui && typeof b.ui === 'object') {
    const ui = {};
    for (const k of UI) if (b.ui[k] === true) ui[k] = true;
    if (Object.keys(ui).length) out.ui = ui;
  }
  shape = out;
}

/** A locked answer drawn for a phone whose head asked early: the same answer in the last child's shape (still locked). */
function shaped(locked) {
  if (!last || !shape || !locked || locked.locked !== true) return locked;
  return { ...locked, ...shape, locked: true, kids: [], kid: null };
}

// JSON for an inline script: nothing may close the tag.
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// hub.js deviceRef() + hubFor(null), in the same steps: a storage that cannot keep the ref asks nothing early.
const SCRIPT = `(function(w,d,t){try{
var R=/^[A-Za-z0-9_-]{22}$/,S=w.localStorage,v=null,q=String(w.location.search||""),m;
if(/[?&]lang=(en|ur)(&|$)/.test(q)&&/[?&]keep=1(&|$)/.test(q))return;
try{v=JSON.parse(S.getItem("wq_d")||"null")}catch(x){v=null}
if(typeof v!=="string"||!R.test(v)){m=/(?:^|;\\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/.exec(d.cookie||"");
if(m)v=m[1];else{var A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",a=new Uint8Array(22);w.crypto.getRandomValues(a);v="";for(var i=0;i<22;i++)v+=A.charAt(a[i]&63)}
S.setItem("wq_d",JSON.stringify(v));if(JSON.parse(S.getItem("wq_d"))!==v)return}
d.cookie="wq_dv="+v+"; path=/; max-age=2592000; samesite=lax"+(w.location.protocol==="https:"?"; secure":"");
var b={device_ref:v},l=(/[?&]lang=(en|ur)(&|$)/.exec(q)||[])[1];if(l)b.lang=l;b=JSON.stringify(b);
var r=w.fetch("/api/wq/hub/"+encodeURIComponent(t),{method:"POST",headers:{accept:"application/json","content-type":"application/json"},body:b});
r.then(null,function(){});w.WQHUB0={t:t,b:b,r:r}
}catch(x){}})(window,document,__T__);`;

/**
 * The head's script for this open: only with the switch learned on and a phone that has no wq_dv cookie (`hasDevice`
 * false), else ''.
 */
function head(token, { hasDevice }) {
  if (!last || hasDevice) return '';
  return `<script>${SCRIPT.replace('__T__', js(String(token)))}</script>\n`;
}

module.exports = { learn, guess, head, shaped, _reset: () => { last = false; shape = null; }, _last: () => last, _shape: () => shape };
