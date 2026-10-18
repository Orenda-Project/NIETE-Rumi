'use strict';
/**
 * The child pages' designed wait (app_settings web_quiz_wait_ux, decided by the bot: its hub answer says
 * `wait_ux: true`; the edge learns it from the last hub answer, like the fast page).
 *
 * On, the hub page's frame carries one small inline piece (no extra request, drawn before any script arrives):
 *   - a thin brand-coloured bar along the top edge for any wait over 400 ms: while Jugnu's opening frame is up, and
 *     while any child data read (GET /api/wq/…: the Games and Stories doors, the shelf, the videos) is in flight;
 *     it creeps towards 90 % and runs to the end and fades when the wait is over; a read still unanswered at 15 s is
 *     called off (the screen then shows its own try-again) and the bar lets it go, so it never creeps forever;
 *   - Jugnu's waiting moment for an opening over 1.5 s: Jugnu bobs and three dots pulse under the opening line;
 *   - the same child data read asked again while the first is still out (the home and the Stories door both ask for
 *     the shelf) rides the first: the later caller gets its own copy of the same answer, and one request goes out.
 * It adds no words (no new copy to translate), takes no taps (pointer-events none, aria-hidden) and honours reduced
 * motion (the bar still shows; nothing bobs or pulses).
 * Off: the key is absent from the hub answer, nothing is added, every page is today's, byte for byte.
 */

const CSS = '.wq-wbar{position:fixed;top:0;left:0;right:0;height:4px;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity .25s}'
  + '.wq-wbar.on{opacity:1}.wq-wbar i{display:block;height:100%;width:0;background:var(--brand,#47BA7D);border-radius:0 4px 4px 0;'
  + 'box-shadow:0 0 8px var(--brand,#47BA7D);transition:width .4s ease-out}'
  + '[dir=rtl] .wq-wbar i{margin-left:auto;border-radius:4px 0 0 4px}'
  + '.wq-boot.wq-bwait img{animation:wqbob 1.1s ease-in-out infinite}'
  + '.wq-boot.wq-bwait .wq-bootsay::after{content:"";display:block;width:36px;height:8px;margin:10px auto 0;'
  + 'background:radial-gradient(circle,var(--brand,#47BA7D) 3px,transparent 3.5px) 0 50%/12px 8px repeat-x;animation:wqdots 1.2s steps(3,end) infinite}'
  + '@keyframes wqbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}'
  + '@keyframes wqdots{0%{width:12px}100%{width:48px}}'
  + '@media (prefers-reduced-motion:reduce){.wq-boot.wq-bwait img,.wq-boot.wq-bwait .wq-bootsay::after{animation:none}.wq-wbar i{transition:none}}';

// The bar: shown 400 ms into a wait (an opening frame, the first or one the page draws again while it asks once more,
// or any child data read), creeping towards 90 %, finished and faded when nothing is waited for; Jugnu's moment 1.5 s
// into an opening frame that is still up. Never throws.
const JS = '(function(d,w){try{'
  + 'var b=d.createElement("div");b.className="wq-wbar";b.setAttribute("aria-hidden","true");b.innerHTML="<i></i>";d.body.appendChild(b);'
  + 'var bar=b.firstChild,n=0,p=0,sh=null,cr=null,boot=function(){return d.querySelector(".wq-boot")};'
  + 'function busy(){return n>0||!!boot()}'
  + 'function creep(){p=p+(90-p)*0.12;bar.style.width=p.toFixed(1)+"%"}'
  + 'function start(){if(sh||cr)return;sh=setTimeout(function(){sh=null;if(!busy())return;p=8;b.classList.add("on");creep();cr=setInterval(creep,300)},400)}'
  + 'function end(){if(busy())return;if(sh){clearTimeout(sh);sh=null}if(!cr)return;clearInterval(cr);cr=null;bar.style.width="100%";'
  + 'setTimeout(function(){if(cr)return;b.classList.remove("on");setTimeout(function(){if(!cr){bar.style.width="0";p=0}},260)},300)}'
  + 'var jt=null;function jm(){if(!jt)jt=setTimeout(function(){jt=null;var x=boot();if(x)x.classList.add("wq-bwait")},1500)}'
  + 'start();jm();'
  + 'var m=d.getElementById("wq");if(m&&w.MutationObserver)new w.MutationObserver(function(){if(boot()){start();jm()}else end()}).observe(m,{childList:true,subtree:true});'
  + 'var f=w.fetch,q={};if(f)w.fetch=function(u,o){var s=String(u&&u.url||u||""),'
  + 'g=/^get$/i.test(o&&o.method||u&&u.method||"GET")&&/\\/api\\/wq\\//.test(s);if(!g)return f.apply(this,arguments);'
  + 'var sh1=typeof u=="string"&&!(o&&o.signal),e=sh1&&q.hasOwnProperty(u)?q[u]:null;'
  + 'if(e)return new Promise(function(y,x){e.push([y,x])});'
  + 'var a,args=arguments;var C=w.AbortController;if(typeof u=="string"&&!(o&&o.signal)&&C){a=new C();args=[u,Object.assign({},o,{signal:a.signal})]}'
  + 'var r=f.apply(this,args),k=0,z=function(){if(k)return;k=1;clearTimeout(t);n--;end()},t=setTimeout(function(){if(a)a.abort();z()},15000);'
  + 'if(sh1){var ws=q[u]=[];r.then(function(v){delete q[u];ws.forEach(function(p){p[0](v&&v.clone?v.clone():v)})},function(x){delete q[u];ws.forEach(function(p){p[1](x)})})}'
  + 'n++;start();r.then(z,z);return r};'
  + '}catch(e){}})(document,window)';

const TAG = `<style id="wq-wait">${CSS}</style><script>${JS}</script>`;

const on = (payload) => Boolean(payload && payload.wait_ux === true);

/** The piece for the hub page's frame: the inline style and script while on, nothing while off. */
function tag(payload) {
  return on(payload) ? TAG : '';
}

module.exports = { on, tag, TAG, CSS, JS };
