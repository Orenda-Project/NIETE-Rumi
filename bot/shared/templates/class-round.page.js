'use strict';
/**
 * The class round's screens on the teacher's phone (web_quiz_class_round), and its card on the teacher's report.
 *
 *   renderCard({ lang, token })              the class tab's card: title, what it asks, "Start the round"
 *   renderRound(view, { lang, token, turnHref })
 *     view.mode 'start'     the card's words and Start (a round drawn, not started)
 *     view.mode 'teacher'   the teacher's count (theirs only), every child by first name in the server's order,
 *                           "Mark absent" on a child still to play (absent stays on the list, struck), and
 *                           "Hold to call the next child" (a long-press, ≥ 600 ms; a tap does nothing)
 *     view.mode 'child'     "<name>'s turn" (the button into the games), "Still to play:", done children ticked
 *     view.mode 'handback'  "Give the phone back to your teacher", the same list, ticks kept
 *   The child's screens carry no count, and replace their history entry and trap Back: the teacher's screen is
 *   never one Back away (the server also refuses it while a turn is open). Nothing is written to the browser: no
 *   storage, no cookie, no remembered child. The only script is the long-press and the Back trap.
 *
 * Copy: copy.v2.json keys jg.round.* and jg.who.turn_of only (EN + UR; the Urdu name isolate kept).
 */
const { PALETTE } = require('./niete-brand');

// copy.v2.json → the page's T object (key in the comment)
const T = {
  en: {
    cardTitle: "This term's class round", // jg.round.card_title
    cardSub: 'Your class has been picked. On your phone, each child present plays two tap games. About 35 to 45 minutes.', // jg.round.card_sub
    start: 'Start the round', // jg.round.start
    tCount: (done, total, absent) => `${done} of ${total} done, ${absent} absent`, // jg.round.t_count
    tAbsent: 'Mark absent', // jg.round.t_absent
    tNext: 'Hold to call the next child', // jg.round.t_next
    cStill: 'Still to play:', // jg.round.c_still
    cDone: 'Done ✓', // jg.round.c_done
    cHandback: 'Give the phone back to your teacher', // jg.round.c_handback
    turnOf: (name) => `${name}'s turn`, // jg.who.turn_of
    // jg.round.t_declined, t_pause, t_resume, t_not_this_term: not in copy.v2.json yet; each control renders only
    // once its string is here (never invented).
  },
  ur: {
    cardTitle: 'اس ٹرم کا کلاس راؤنڈ',
    cardSub: 'آپ کی کلاس چنی گئی ہے۔ اپنے فون پر کلاس میں موجود ہر بچے سے ٹیپ والے دو کھیل کروائیں۔ تقریباً ۳۵ سے ۴۵ منٹ۔',
    start: 'راؤنڈ شروع کریں',
    tCount: (done, total, absent) => `${total} میں سے ${done} مکمل، ${absent} غیر حاضر`,
    tAbsent: 'غیر حاضر لگائیں',
    tNext: 'اگلے بچے کے لیے دبا کر رکھیں',
    cStill: 'ابھی باری آنی ہے:',
    cDone: 'ہو گیا ✓',
    cHandback: 'فون واپس ٹیچر کو دے دیں',
    turnOf: (name) => `⁨${name}⁩ کی باری`,
  },
};

const HOLD_MS = 600;
// Every attribute here is double-quoted, so an apostrophe ("This term's") stays as typed.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const langOf = (l) => (l === 'ur' ? 'ur' : 'en');
const q = (lang) => `?lang=${langOf(lang)}`;
const base = (token) => `/r/${encodeURIComponent(token || '')}/round`;

/** The card on the teacher's class tab (no script: a plain form). */
function renderCard({ lang, token, started = false }) {
  const C = T[langOf(lang)];
  // "Not this term" (jg.round.t_not_this_term): one tap, before the round starts, only once its string exists
  const notThisTerm = !started && C.tNotThisTerm
    ? `<form method="post" action="${base(token)}/not-this-term${q(lang)}" style="margin-top:8px"><button class="btn btn-ghost" type="submit" style="width:100%;font:inherit;cursor:pointer">${esc(C.tNotThisTerm)}</button></form>`
    : '';
  return `<section class="card cr-card" style="margin-top:16px"><h2>${esc(C.cardTitle)}</h2><p class="muted">${esc(C.cardSub)}</p>`
    + `<form method="post" action="${base(token)}/start${q(lang)}"><button class="btn btn-primary" type="submit" style="width:100%;border:0;font:inherit;font-weight:700;cursor:pointer">${esc(C.start)}</button></form>${notThisTerm}</section>`;
}

const CSS = `
@font-face{font-family:'WQ Nastaliq';src:url('/wq/fonts/wq-nastaliq-1.woff2') format('woff2');font-display:swap}
:root{--ink:${PALETTE.ink};--green:${PALETTE.green};--green-deep:${PALETTE.greenDeep};--wash:${PALETTE.greenWash};--line:#E2E5EA;--bg:#F6F7F9;--card:#fff;--muted:#5B6170}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
[lang=ur] body,body[lang=ur],.ur{font-family:'WQ Nastaliq','Noto Nastaliq Urdu',serif;line-height:2.1;font-size:20px}
main{max-width:480px;margin:0 auto;padding:16px}
h1{font-size:1.35rem;margin:4px 0 8px}
h2{font-size:1.05rem;margin:18px 0 8px}
.muted{color:var(--muted)}
.count{font-weight:700;color:var(--green-deep);margin:0 0 12px}
ol,ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:0 0 8px;min-height:52px}
li .nm{font-weight:700;font-size:1.1rem}
li.done{background:var(--wash);border-color:var(--green)}
li.done .tick{color:var(--green-deep);font-weight:700;white-space:nowrap}
li.now{border:2px solid var(--green)}
form{margin:0}
.small{font:inherit;font-size:.9rem;background:var(--card);border:1.5px solid var(--line);color:var(--ink);border-radius:999px;padding:6px 14px;min-height:44px;cursor:pointer}
.go{display:block;width:100%;font:inherit;font-weight:700;font-size:1.05rem;border:0;border-radius:14px;padding:14px;min-height:56px;background:var(--green);color:#fff;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}
.go.hold{background:var(--ink)}
.go.pressing{opacity:.75}
.turn{display:block;text-align:center;text-decoration:none;background:var(--green);color:#fff;border-radius:18px;padding:28px 16px;font-size:1.6rem;font-weight:700;margin:8px 0 18px;min-height:96px}
.turn .pl{display:block;font-size:2rem;line-height:1}
.handback{text-align:center;background:var(--card);border:2px solid var(--green);border-radius:18px;padding:28px 16px;margin:8px 0 18px}
.foot{margin-top:22px}
`;

// The long-press: the form posts only after HOLD_MS of pressing (the server checks act=hold and hold ≥ 600).
const HOLD_JS = `(function(){var fs=document.querySelectorAll('form.hold');for(var i=0;i<fs.length;i++)(function(f){var b=f.querySelector('button'),h=f.querySelector('input[name=hold]'),t0=0,tm=null;
function up(){if(tm){clearTimeout(tm);tm=null;}b.classList.remove('pressing');}
b.addEventListener('pointerdown',function(e){e.preventDefault();t0=Date.now();b.classList.add('pressing');tm=setTimeout(function(){h.value=String(Date.now()-t0);f.submit();},${HOLD_MS + 50});});
['pointerup','pointerleave','pointercancel'].forEach(function(n){b.addEventListener(n,up);});
b.addEventListener('contextmenu',function(e){e.preventDefault();});
f.addEventListener('submit',function(e){if(!h.value)e.preventDefault();});})(fs[i]);})();`;
// The child's screens: this entry replaces the last one, and Back stays here.
const TRAP_JS = 'history.replaceState(null,"",location.href);history.pushState(null,"",location.href);window.addEventListener("popstate",function(){history.pushState(null,"",location.href);});';

function holdForm(action, label) {
  return `<form class="hold" method="post" action="${action}"><input type="hidden" name="act" value="hold"><input type="hidden" name="hold" value="">`
    + `<button class="go hold" type="submit">${esc(label)}</button></form>`;
}

// The teacher's screen only: an absent or declined child stays in place, struck (never on a child's screen).
const TEACHER_CSS = 'li.absent .nm,li.declined .nm{text-decoration:line-through;color:var(--muted);font-weight:400}li.absent,li.declined{background:transparent;border-style:dashed}.row-acts{display:flex;gap:6px}';

function shell({ lang, title, body, script, css = '' }) {
  const l = langOf(lang);
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ur' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${CSS}${css}</style>
</head>
<body lang="${l}">
<main>${body}</main>
<script>${script}</script>
</body>
</html>`;
}

/**
 * @param {{mode: string, rows: Array<{pos:number, name:string, s:string, now?:boolean}>, current?: {name:string}}} view
 * @param {{lang:'en'|'ur', token:string, turnHref?:string}} opts
 */
function renderRound(view, { lang, token, turnHref = null }) {
  const l = langOf(lang);
  const C = T[l];
  const b = base(token);
  const rows = view.rows || [];
  if (view.mode === 'start') {
    const body = `<h1>${esc(C.cardTitle)}</h1><p class="muted">${esc(C.cardSub)}</p>`
      + `<form method="post" action="${b}/start${q(l)}"><button class="go" type="submit">${esc(C.start)}</button></form>`;
    return shell({ lang: l, title: C.cardTitle, body, script: '' });
  }
  if (view.mode === 'teacher') {
    const done = rows.filter((r) => r.s === 'done').length;
    const absent = rows.filter((r) => r.s === 'absent').length;
    const posForm = (act, label, pos) => `<form method="post" action="${b}/${act}${q(l)}"><input type="hidden" name="pos" value="${pos}"><button class="small" type="submit">${esc(label)}</button></form>`;
    const items = rows.map((r) => {
      if (r.s === 'done') return `<li class="done"><span class="nm">${esc(r.name)}</span><span class="tick">${esc(C.cDone)}</span></li>`;
      if (r.s === 'absent') return `<li class="absent"><span class="nm">${esc(r.name)}</span></li>`;
      if (r.s === 'declined') return `<li class="declined"><span class="nm">${esc(r.name)}</span>${C.tDeclined ? `<span class="muted">${esc(C.tDeclined)}</span>` : ''}</li>`;
      return `<li class="todo${r.now ? ' now' : ''}"><span class="nm">${esc(r.name)}</span><span class="row-acts">`
        + `${posForm('absent', C.tAbsent, r.pos)}${C.tDeclined ? posForm('declined', C.tDeclined, r.pos) : ''}</span></li>`;
    }).join('');
    const pauseKey = view.paused ? C.tResume : C.tPause;
    const pauseForm = pauseKey ? `<form method="post" action="${b}/${view.paused ? 'resume' : 'pause'}${q(l)}" style="margin-top:10px"><button class="small" type="submit" style="width:100%">${esc(pauseKey)}</button></form>` : '';
    const body = `<h1>${esc(C.cardTitle)}</h1><p class="count">${esc(C.tCount(done, rows.length, absent))}</p><ol class="kids">${items}</ol>`
      + `<div class="foot">${view.paused ? '' : holdForm(`${b}/next${q(l)}`, C.tNext)}${pauseForm}</div>`;
    return shell({ lang: l, title: C.cardTitle, body, script: HOLD_JS, css: TEACHER_CSS });
  }
  // the child's screens: no count; done children stay ticked; absent children are not listed to the class
  const cur = view.current || { name: '' };
  const still = rows.filter((r) => r.s === 'todo' && !r.now);
  const doneRows = rows.filter((r) => r.s === 'done');
  const top = view.mode === 'handback'
    ? `<div class="handback"><h1>${esc(C.cHandback)}</h1></div>`
    : `<a class="turn" href="${esc(turnHref || '#')}"><span class="pl" aria-hidden="true">▶</span>${C.turnOf(esc(cur.name))}</a>`;
  const body = `${top}${still.length ? `<h2>${esc(C.cStill)}</h2><ul class="still">${still.map((r) => `<li class="todo"><span class="nm">${esc(r.name)}</span></li>`).join('')}</ul>` : ''}`
    + `${doneRows.length ? `<ul class="done-list">${doneRows.map((r) => `<li class="done"><span class="nm">${esc(r.name)}</span><span class="tick">${esc(C.cDone)}</span></li>`).join('')}</ul>` : ''}`
    + `<div class="foot">${holdForm(`${b}/teacher${q(l)}`, C.tNext)}</div>`;
  return shell({ lang: l, title: view.mode === 'handback' ? C.cHandback : C.cardTitle, body, script: `${TRAP_JS}\n${HOLD_JS}` });
}

module.exports = { renderCard, renderRound, T, HOLD_MS };
