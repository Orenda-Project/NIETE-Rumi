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
 *   failed   what happened, in the page's words: a model fault offers Try again (the same make, at most twice);
 *            a lesson cause, or the third failure, says so, the lesson cause with the /quiz door
 *   closed   (ready, but the children's code no longer opens) says so: the questions and PDF, no Copy, Send or Try
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
  + '.qnote{color:var(--muted);font-size:15px}'
  // the edit form: every field and button a 48 px target
  + '.qedit summary{min-height:48px;padding:12px 0;cursor:pointer;color:var(--s3);font-weight:600}'
  + '.qform label,.qform legend{display:block;font-weight:600;margin:6px 0}.qform fieldset{border:0;padding:0;margin:0 0 8px}'
  + '.qform textarea{width:100%;min-height:48px;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}'
  + '.qeopt{display:flex;gap:10px;align-items:center;min-height:48px;margin:0 0 6px;cursor:pointer;font-weight:400}'
  + '.qeopt input[type=radio],.qeopt input[type=checkbox]{width:24px;height:24px;flex:0 0 24px;margin:12px}'
  + '.qform .qopttext{flex:1 1 auto;min-width:0;resize:none;overflow:hidden;field-sizing:content}'
  // an Urdu quiz on an English page: its own words in Nastaliq
  + '.qz [lang="ur"]{font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif;line-height:2.1}'
  + '.qsay{font-weight:600}</style>';

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
    + "[].forEach.call(document.querySelectorAll('textarea.qopttext'),function(t){function fit(){t.style.height='auto';t.style.height=t.scrollHeight+'px'}"
    + "t.addEventListener('input',fit);t.addEventListener('keydown',function(e){if(e.key==='Enter')e.preventDefault()});fit()});"
    + "var q=document.querySelector('details.qq');if(q){var seen=false;q.addEventListener('toggle',function(){if(q.open&&!seen){seen=true;ev('view_questions')}})}"
    + '})();</script>';
}

function waQuiz(bot, ux) {
  return bot ? `<a class="btn" href="${esc(`https://wa.me/${bot}?text=${encodeURIComponent('/quiz')}`)}">${ux('qfix_offers_cq_open_wa')}</a>` : '';
}

/**
 * One question's edit forms, from the bot's edit view (`edit`): wording fields while nothing is locked and the item allows
 * them (never a picture option), the right answer as radio buttons, Remove above the floor. `hidden` = the surface.
 */
function editForms(item, edit, { base, hidden, ux }) {
  const ed = item.editable || {};
  const wording = !edit.locked;
  const ids = `${hidden}<input type="hidden" name="qid" value="${esc(item.qid)}"><input type="hidden" name="v" value="${esc(edit.edit_v)}">`;
  const keys = String(item.key || '').split(',');
  const text = wording && ed.text !== false && !item.picture
    ? `<label>${ux('qfix_offers_cq_edit_text')}<textarea name="text" rows="3" dir="auto">${esc(item.text)}</textarea></label>` : '';
  const opts = (item.options || []).map((o) => {
    // one right answer: a radio; "pick all that apply": checkboxes
    const radio = `<input type="${item.multi ? 'checkbox' : 'radio'}" name="key" value="${esc(o.slot)}"${keys.includes(o.slot) ? ' checked' : ''}${ed.key === false ? ' disabled' : ''} aria-label="${esc(o.picture ? o.slot : o.text)}">`;
    const field = wording && ed.options !== false && !o.picture
      ? `<textarea name="opt_${esc(o.slot)}" rows="1" dir="auto" class="qopttext">${esc(o.text)}</textarea>`
      : `<span dir="auto">${o.picture ? '🖼' : esc(o.text)}</span>`;
    // the whole row is the radio's 48-px target
    return `<label class="qeopt">${radio}${field}</label>`;
  }).join('');
  const save = `<form method="post" action="${esc(base)}/edit" class="qform">${ids}<input type="hidden" name="do" value="save">${text}`
    + `<fieldset><legend>${ux('qfix_offers_cq_edit_answers')}</legend>${opts}</fieldset>`
    + `<button type="submit" class="btn">${ux('qfix_offers_cq_save')}</button></form>`;
  const remove = wording && ed.remove !== false && Number(edit.n) > Number(edit.min)
    ? `<form method="post" action="${esc(base)}/edit">${ids}<input type="hidden" name="do" value="remove">`
      + `<button type="submit" class="btn ghost">${ux('qfix_offers_cq_remove')}</button></form>` : '';
  return `<details class="qedit"><summary>${ux('qfix_offers_cq_edit')}</summary>${save}${remove}</details>`;
}

/** The bot's edit view → the read-only list's shape ({text, options:[{text, correct}]}), ids kept for the anchors. */
function fromEdit(edit) {
  return (edit.questions || []).map((it) => {
    const keys = String(it.key || '').split(',');
    return {
      id: it.qid, text: it.text, item: it,
      options: (it.options || []).map((o) => ({ key: o.slot, text: o.picture ? '🖼' : o.text, correct: keys.includes(o.slot) })),
    };
  });
}

function questionsList(questions, l, ux, { edit = null, base, hidden, open = false, langAttr = '' } = {}) {
  const items = questions.map((q, i) => {
    const opts = (q.options || []).map((o) => (o.correct
      ? `<li class="qopt ok"><span dir="auto">${esc(o.text)}</span> <strong>✓ ${ux('qfix_offers_cq_correct')}</strong></li>`
      : `<li class="qopt"><span dir="auto">${esc(o.text)}</span></li>`)).join('');
    const anchor = q.id ? ` id="q-${esc(q.id)}"` : '';
    const forms = edit && q.item ? editForms(q.item, edit, { base, hidden, ux }) : '';
    return `<li class="qitem"${anchor}><p><span class="qn">${esc(digitsFor(i + 1, l))}.</span> <span dir="auto">${esc(q.text)}</span></p><ul>${opts}</ul>${forms}</li>`;
  }).join('');
  const n = esc(resolveUx('qfix_offers_cq_questions', { language: l, params: { n: digitsFor(questions.length, l) } }));
  const locked = edit && edit.locked ? `<p class="qnote">${ux('qfix_offers_cq_locked')}</p>` : '';
  return `<details class="qq"${langAttr}${open ? ' open' : ''}><summary>${n}</summary>${locked}<ol class="qlist">${items}</ol></details>`;
}

// The line a save, a refusal or a PDF remake leaves on the page (?e=<code>).
const NOTICE = Object.freeze({
  saved: 'qfix_offers_cq_saved', none: 'qfix_offers_cq_edit_none', locked: 'qfix_offers_cq_locked', floor: 'qfix_offers_cq_floor',
  stale: 'qfix_offers_cq_stale', too_long: 'qfix_offers_cq_too_long', empty: 'qfix_offers_cq_empty', not_text: 'qfix_offers_cq_not_text',
  not_editable: 'qfix_offers_cq_not_editable', failed: 'qfix_offers_cq_edit_failed', pdf_pending: 'qfix_offers_cq_pdf_pending',
});

/**
 * The quiz block for the bot's state `model`. `base` = /cq/<token> (every action posts there, whichever page shows
 * the block); `surface` = 'cq' | 'cr' (logged, and where a form goes back to); `heading` draws the block's own title.
 * '' when there is nothing to show.
 */
function renderQuizBlock(model, { language, base, surface = 'cq', bot, heading = false, edit = null, notice = null } = {}) {
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
    // the quiz's own language, when it differs from the page's (an Urdu quiz on an English page)
    const quizLang = (edit && edit.language) || m.language;
    const langAttr = quizLang === 'ur' && l !== 'ur' ? ' lang="ur"' : '';
    if (m.closed) {
      parts.push(`<p>${ux('qfix_offers_cq_closed')}</p>`);
      const shut = Array.isArray(m.questions) ? m.questions : [];
      if (shut.length) parts.push(questionsList(shut, l, ux, { langAttr }));
      if (m.pdf) parts.push(`<p><a class="btn ghost" href="${esc(base)}/pdf">${ux('qfix_offers_cq_pdf')}</a></p>`);
      parts.push(`<p>${ux('qfix_offers_cq_closed_new')}</p>${waQuiz(bot, ux)}`);
      return `<section class="qz" id="quiz">${QZ_CSS}${parts.join('')}${script(base, where, 'closed')}</section>`;
    }
    const share = `https://wa.me/?text=${encodeURIComponent(m.message)}`;
    const said = Object.prototype.hasOwnProperty.call(NOTICE, notice)
      ? esc(resolveUx(NOTICE[notice], { language: l, params: { n: digitsFor((edit && edit.min) || '', l) } })) : '';
    if (said) parts.push(`<p class="qsay" role="status">${said}</p>`);
    // shown: one line per line, each link one LTR run; copied: the stored message itself (the hidden field)
    const shown = m.message.split('\n').map((line) => esc(line).replace(/https?:\/\/[^\s<]+/g, (u) => `<bdi dir="ltr" class="qurl">${u}</bdi>`)).join('<br>');
    parts.push(`<p>${ux('qfix_offers_cq_ready')}</p><div class="qmsg" dir="auto"${langAttr}>${shown}</div>`
      + `<textarea id="qmsg" class="qsrc" readonly tabindex="-1" aria-hidden="true">${esc(m.message)}</textarea>`);
    const list = edit && Array.isArray(edit.questions) && edit.questions.length ? fromEdit(edit) : m.questions;
    if (Array.isArray(list) && list.length) parts.push(questionsList(list, l, ux, { edit, base, hidden, open: Boolean(said) && notice !== 'pdf_pending', langAttr }));
    const links = [m.pdf || edit ? `<a class="btn ghost" href="${esc(base)}/pdf">${ux('qfix_offers_cq_pdf')}</a>` : '',
      m.preview ? `<a class="btn ghost" href="${esc(base)}/try">${ux('qfix_offers_cq_try')}</a>` : ''].filter(Boolean).join(' ');
    if (links) parts.push(`<p>${links}</p>`);
    parts.push(`<div class="qbar"><button type="button" class="btn" data-copy>${ux('qfix_offers_cq_copy')}</button>`
      + `<a class="btn" data-share href="${esc(share)}">${ux('qfix_offers_cq_send')}</a>`
      + `<p id="qcopied" class="qnote" role="status" hidden>${ux('qfix_offers_cq_copied')}</p>`
      + `<p id="qmanual" class="qnote" hidden>${ux('qfix_offers_cq_copy_manual')}</p></div>`);
  } else if (m.state === 'failed') {
    if (m.retry) {
      parts.push(`<p>${ux(m.remakes > 0 ? 'qfix_offers_cq_failed_retry_last' : 'qfix_offers_cq_failed_retry')}</p>`
        + `<form method="post" action="${esc(base)}/make" onsubmit="this.querySelector('button').disabled=true">${hidden}`
        + `<button type="submit" class="btn">${ux('qfix_offers_cq_retry')}</button></form>`);
    } else if (m.capped) {
      parts.push(`<p>${ux('qfix_offers_cq_failed_capped')}</p>${waQuiz(bot, ux)}`);
    } else {
      parts.push(`<p>${ux(m.reason === 'subject_not_allowed' ? 'qfix_offers_cq_failed_subject' : 'qfix_offers_cq_failed')}</p>${waQuiz(bot, ux)}`);
    }
  } else if (where === 'cq') {
    parts.push(`<p>${ux('qfix_offers_cq_none')}</p>${waQuiz(bot, ux)}`);
  } else {
    return '';
  }
  return `<section class="qz" id="quiz">${QZ_CSS}${parts.join('')}${script(base, where, m.state)}</section>`;
}

/** /cq/:token: the lesson, then the block. */
function renderQuizPage({ language, topic, model, base, bot, edit = null, notice = null } = {}) {
  const l = language === 'ur' ? 'ur' : 'en';
  const head = `<header><section><h1>${esc(resolveUx('qfix_offers_cr_quiz_head', { language: l }))}</h1>${topic ? `<p class="muted">${esc(topic)}</p>` : ''}</section></header>`;
  return shell(l, resolveUx('qfix_offers_cr_quiz_head', { language: l }), `${head}\n${renderQuizBlock(model, { language: l, base, surface: 'cq', bot, edit, notice })}`);
}

module.exports = { renderQuizPage, renderQuizBlock, QZ_CSS, BEACON_EVENTS, NOTICE };
