'use strict';
/**
 * qfix offers — the quiz, made and handed on INSIDE the page the closed-window report opens: /cq/:token (a page with
 * only the quiz, for a teacher who does not get the new report) and the quiz block on /cr/:token (bot
 * quiz/report-page-quiz.js). One render function for both, with no route state in it, so any other teacher page can
 * mount the same block.
 *
 * The block, by the bot's state for the session (POST /api/internal/rq/state):
 *   held     "Make a quiz": a form that posts to the page (/cq/:token/make), never a message to the bot
 *   making   "Making your quiz…", and the page polls its own state and redraws when it moves
 *   ask      the language, as two buttons (/cq/:token/lang)
 *   ready    the message for the class with Copy and "Send to your class on WhatsApp" in a bar that stays on screen,
 *            the questions with the key marked, Download PDF, Try it as a student
 *   failed   what happened, in the page's words, and the /quiz door
 *   none     the /quiz door (the /cq page only; /cr shows nothing)
 * Taps the server does not see (copy, share, opening the questions, a make that takes too long) are sent to
 * /cq/:token/e as one beacon each. Pure HTML; every value escaped.
 */
const { esc, shell } = require('./coaching-report-style');
const { resolveUx, digitsFor } = require('../../bot/shared/config/ux-strings');
const { getLanguage } = require('../../bot/shared/config/languages');

// 48 px touch targets on every new button (the page's shared a.btn is 44 px in English); the bar stays on screen.
const QZ_CSS = '<style>.qz a.btn,.qz button.btn{display:inline-block;min-height:48px;box-sizing:border-box;padding:12px 16px}'
  + '.qz form{display:inline-block;margin:0}.qz .btn.ghost{background:transparent;color:var(--accent);border:2px solid var(--accent)}'
  // the message as the class gets it: read-only, a long press selects all of it, the link never broken inside its code
  + '.qmsg{padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);margin:0 0 8px;'
  + '-webkit-user-select:all;user-select:all;overflow-wrap:anywhere}'
  + '.qurl{white-space:nowrap;font-size:13px;display:inline-block;max-width:100%;overflow-x:auto;vertical-align:bottom}'
  + '.qsrc{position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none}'
  + '.qq summary{min-height:48px;padding:12px 0;cursor:pointer;font-weight:600;color:var(--s3)}'
  + '.qlist{list-style:none;padding:0;margin:0}.qitem{margin:0 0 14px}.qn{font-weight:700;margin-inline-end:6px}'
  + '.qitem ul{list-style:none;padding:0}.qopt{padding:6px 10px;border-radius:8px;border:1px solid var(--line);margin:0 0 6px}'
  + '.qopt.ok{border:2px solid var(--green);font-weight:600}.qopt.ok strong{color:var(--green)}'
  + '.qbar{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;padding:10px 0 4px;background:var(--card);border-top:1px solid var(--line);z-index:5}'
  + '.qbar .btn{flex:1 1 150px;text-align:center;margin:0}.qbar p{flex:1 1 100%;margin:0}'
  + '.qnote{color:var(--muted);font-size:15px}</style>';

const BEACON_EVENTS = Object.freeze(['copy', 'share', 'view_questions', 'make_timeout']);

/** The page's own script: polling while making, Copy (clipboard, then the select-all fallback), the beacons. */
function script(base, surface, state) {
  const j = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<script>(function(){var b=${j(base)},s=${j(surface)},st=${j(state)};`
    // form-encoded: a CORS-safelisted type, so sendBeacon never refuses it (a JSON Blob is refused by Chrome).
    + 'function ev(e,x){try{var o={ev:e,surface:s};for(var k in (x||{}))o[k]=String(x[k]);var d=new URLSearchParams(o);'
    + "if(navigator.sendBeacon&&navigator.sendBeacon(b+'/e',d))return;"
    + "fetch(b+'/e',{method:'POST',body:d,keepalive:true}).catch(function(){})}catch(_){}}"
    + "if(st==='making'){var t0=Date.now(),slow=false;"
    + "function next(){if(!slow&&Date.now()-t0>480000){slow=true;var w=document.getElementById('qslow');if(w)w.hidden=false;ev('make_timeout')}setTimeout(poll,slow?15000:4000)}"
    + "function poll(){fetch(b+'/state',{headers:{accept:'application/json'},cache:'no-store'}).then(function(r){return r.ok?r.json():null})"
    + '.then(function(x){if(x&&x.state&&x.state!==st){location.reload();return}next()},next)}next()}'
    + "var c=document.querySelector('[data-copy]'),m=document.getElementById('qmsg');"
    + "if(c&&m)c.addEventListener('click',function(){"
    + "function done(f){var k=document.getElementById('qcopied');if(k){k.hidden=false;setTimeout(function(){k.hidden=true},3000)}ev('copy',{fallback:f})}"
    + "function hand(){m.focus();m.select();try{m.setSelectionRange(0,m.value.length)}catch(_){}"
    + "try{if(document.execCommand('copy')){done(true);return}}catch(_){}var h=document.getElementById('qmanual');if(h)h.hidden=false;ev('copy',{fallback:true,manual:true})}"
    + 'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(m.value).then(function(){done(false)},hand)}else{hand()}});'
    + "var sh=document.querySelector('[data-share]');if(sh)sh.addEventListener('click',function(){ev('share')});"
    + "var q=document.querySelector('details.qq');if(q){var seen=false;q.addEventListener('toggle',function(){if(q.open&&!seen){seen=true;ev('view_questions')}})}"
    + '})();</script>';
}

function waQuiz(bot, ux) {
  return bot ? `<a class="btn" href="${esc(`https://wa.me/${bot}?text=${encodeURIComponent('/quiz')}`)}">${ux('qfix_offers_cq_open_wa')}</a>` : '';
}

function questionsList(questions, l, ux) {
  const items = questions.map((q, i) => {
    const opts = (q.options || []).map((o) => (o.correct
      ? `<li class="qopt ok"><span dir="auto">${esc(o.text)}</span> <strong>✓ ${ux('qfix_offers_cq_correct')}</strong></li>`
      : `<li class="qopt"><span dir="auto">${esc(o.text)}</span></li>`)).join('');
    return `<li class="qitem"><p><span class="qn">${esc(digitsFor(i + 1, l))}.</span> <span dir="auto">${esc(q.text)}</span></p><ul>${opts}</ul></li>`;
  }).join('');
  const n = esc(resolveUx('qfix_offers_cq_questions', { language: l, params: { n: digitsFor(questions.length, l) } }));
  return `<details class="qq"><summary>${n}</summary><ol class="qlist">${items}</ol></details>`;
}

/**
 * The quiz block for the bot's state `model`. `base` = /cq/<token> (every action posts there, whichever page shows
 * the block); `surface` = 'cq' | 'cr' (logged, and where a form goes back to); `heading` draws the block's own title.
 * '' when there is nothing to show.
 */
function renderQuizBlock(model, { language, base, surface = 'cq', bot, heading = false } = {}) {
  const l = language === 'ur' ? 'ur' : 'en';
  const ux = (key) => esc(resolveUx(key, { language: l }));
  const m = model || { state: 'none' };
  const where = surface === 'cr' ? 'cr' : 'cq';
  const hidden = `<input type="hidden" name="surface" value="${where}">`;
  const parts = [];
  if (heading) parts.push(`<h2>${ux('qfix_offers_cr_quiz_head')}</h2>`);
  if (m.state === 'held') {
    parts.push(`<p>${ux('qfix_offers_cr_quiz_body')}</p>`
      + `<form method="post" action="${esc(base)}/make" onsubmit="this.querySelector('button').disabled=true">${hidden}`
      + `<button type="submit" class="btn">${ux('qfix_offers_cr_quiz_button')}</button></form>`);
  } else if (m.state === 'making') {
    parts.push(`<p role="status">${ux('qfix_offers_cq_making')}</p><p id="qslow" class="qnote" hidden>${ux('qfix_offers_cq_slow')}</p>`);
  } else if (m.state === 'ask') {
    const choices = Array.isArray(m.choices) && m.choices.length ? m.choices : ['ur', 'en'];
    parts.push(`<p>${ux('qfix_offers_cq_lang_q')}</p><p class="qnote">${ux('qfix_offers_cq_lang_ur_note')}<br>${ux('qfix_offers_cq_lang_en_note')}</p>`);
    parts.push(choices.map((code) => `<form method="post" action="${esc(base)}/lang" onsubmit="this.querySelector('button').disabled=true">${hidden}`
      + `<input type="hidden" name="language" value="${esc(code)}"><button type="submit" class="btn">${esc(getLanguage(code).languageTitle)}</button></form>`).join(' '));
  } else if (m.state === 'ready' && typeof m.message === 'string' && m.message.trim()) {
    const share = `https://wa.me/?text=${encodeURIComponent(m.message)}`;
    // shown: one line per line, each link one LTR run; copied: the stored message itself (the hidden field)
    const shown = m.message.split('\n').map((line) => esc(line).replace(/https?:\/\/[^\s<]+/g, (u) => `<bdi dir="ltr" class="qurl">${u}</bdi>`)).join('<br>');
    parts.push(`<p>${ux('qfix_offers_cq_ready')}</p><div class="qmsg" dir="auto">${shown}</div>`
      + `<textarea id="qmsg" class="qsrc" readonly tabindex="-1" aria-hidden="true">${esc(m.message)}</textarea>`);
    if (Array.isArray(m.questions) && m.questions.length) parts.push(questionsList(m.questions, l, ux));
    const links = [m.pdf ? `<a class="btn ghost" href="${esc(base)}/pdf">${ux('qfix_offers_cq_pdf')}</a>` : '',
      m.preview ? `<a class="btn ghost" href="${esc(base)}/try">${ux('qfix_offers_cq_try')}</a>` : ''].filter(Boolean).join(' ');
    if (links) parts.push(`<p>${links}</p>`);
    parts.push(`<div class="qbar"><button type="button" class="btn" data-copy>${ux('qfix_offers_cq_copy')}</button>`
      + `<a class="btn" data-share href="${esc(share)}">${ux('qfix_offers_cq_send')}</a>`
      + `<p id="qcopied" class="qnote" role="status" hidden>${ux('qfix_offers_cq_copied')}</p>`
      + `<p id="qmanual" class="qnote" hidden>${ux('qfix_offers_cq_copy_manual')}</p></div>`);
  } else if (m.state === 'failed') {
    parts.push(`<p>${ux(m.reason === 'subject_not_allowed' ? 'qfix_offers_cq_failed_subject' : 'qfix_offers_cq_failed')}</p>${waQuiz(bot, ux)}`);
  } else if (where === 'cq') {
    parts.push(`<p>${ux('qfix_offers_cq_none')}</p>${waQuiz(bot, ux)}`);
  } else {
    return '';
  }
  return `<section class="qz" id="quiz">${QZ_CSS}${parts.join('')}${script(base, where, m.state)}</section>`;
}

/** /cq/:token: the lesson, then the block. */
function renderQuizPage({ language, topic, model, base, bot } = {}) {
  const l = language === 'ur' ? 'ur' : 'en';
  const head = `<header><section><h1>${esc(resolveUx('qfix_offers_cr_quiz_head', { language: l }))}</h1>${topic ? `<p class="muted">${esc(topic)}</p>` : ''}</section></header>`;
  return shell(l, resolveUx('qfix_offers_cr_quiz_head', { language: l }), `${head}\n${renderQuizBlock(model, { language: l, base, surface: 'cq', bot })}`);
}

module.exports = { renderQuizPage, renderQuizBlock, QZ_CSS, BEACON_EVENTS };
