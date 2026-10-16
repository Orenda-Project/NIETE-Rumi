'use strict';
/**
 * The C/D coach ping's pages (pure HTML) — v10 coaching test, bd-v0toag.38.9, the teammate's "Do you agree?"
 * prototype. Replaces bd-v0toag.45's one-tap coach page.
 *   reasons page — what wasn't right (four ticks), an optional voice note up to 20 s, her school's coaches
 *                  only when there is more than one, then "Send to my coach". Nothing is sent before that.
 *   coach card   — the link in the coach's WhatsApp ping: her score, section scores, reasons, voice note and
 *                  "I have visited".
 * PING holds the card's lines the report page shows (coaching-report-page.js). Every value is escaped.
 */
const { esc, shell } = require('./coaching-report-style');
const { REASONS, CODES } = require('./coach-ping-reasons');

const PING = {
  en: {
    help: 'Don’t agree? Your coach will come and see your class',
    helped: '✓ Your coach has been told and will come to see your class.',
    failed: 'We could not reach your coach just now. Your answer is saved.',
    noCoach: 'We could not find a coach for your school. Your answer is saved.',
    title: 'Tell your coach',
    q: 'What wasn’t right? Choose all that apply.',
    pick: 'Which coach should come?',
    vn: '🎙 Record a voice note (optional)',
    stop: 'Recording… tap to stop',
    play: '▶ Play',
    del: '✕ Delete',
    vnHint: 'Up to 20 seconds, in your own words.',
    send: 'Send to my coach',
    cancel: 'Cancel',
    cardTitle: 'A teacher would like a visit',
    reasons: 'What she said wasn’t right',
    note: 'Her voice note',
    sections: 'Performance by section',
    visit: 'I have visited',
    visited: '✓ Visit done. Thank you.',
  },
  ur: {
    help: 'متفق نہیں؟ آپ کے کوچ آ کر کلاس دیکھیں گے',
    helped: '✓ آپ کے کوچ کو بتا دیا گیا ہے، وہ آ کر آپ کی کلاس دیکھیں گے۔',
    failed: 'ہم ابھی آپ کے کوچ تک نہیں پہنچ سکے۔ آپ کا جواب محفوظ ہے۔',
    noCoach: 'ہمیں آپ کے اسکول کا کوئی کوچ نہیں ملا۔ آپ کا جواب محفوظ ہے۔',
    title: 'اپنے کوچ کو بتائیں',
    q: 'کیا ٹھیک نہیں لگا؟ جو جو درست ہو، چنیں۔',
    pick: 'کون سے کوچ آئیں؟',
    vn: '🎙 وائس نوٹ ریکارڈ کریں (اختیاری)',
    stop: 'ریکارڈنگ… روکنے کے لیے دبائیں',
    play: '▶ سنیں',
    del: '✕ ہٹائیں',
    vnHint: '20 سیکنڈ تک، اپنے الفاظ میں۔',
    send: 'کوچ کو بھیجیں',
    cancel: 'رہنے دیں',
    cardTitle: 'ایک ٹیچر دورہ چاہتی ہیں',
    reasons: 'ٹیچر کے مطابق کیا ٹھیک نہیں تھا',
    note: 'ٹیچر کا وائس نوٹ',
    sections: 'حصہ وار کارکردگی',
    visit: 'میں نے دورہ کر لیا',
    visited: '✓ دورہ ہو گیا۔ شکریہ۔',
  },
};

const MAX_SECONDS = 20;
const MAX_NOTE_BYTES = 1500000;
const langOf = (v) => (v && v.language === 'ur' ? 'ur' : 'en');

// Records in the browser (MediaRecorder) or takes a file from the phone's recorder, and puts the audio in the
// hidden "note" field as a data URL. Stops itself at 20 s; a file over the size cap is not kept.
const VOICE_JS = `(function(){var b=document.querySelector('.voice');if(!b)return;
var max=+b.dataset.maxSeconds*1000,cap=${MAX_NOTE_BYTES},note=b.querySelector('input[name=note]'),rec=b.querySelector('.rec'),
file=b.querySelector('input[type=file]'),au=b.querySelector('audio'),done=b.querySelector('.done'),r=null,t=null;
function keep(blob){if(!blob||blob.size>cap){clear();return;}var f=new FileReader();f.onload=function(){note.value=f.result;
au.src=f.result;done.hidden=false;rec.hidden=true;};f.readAsDataURL(blob);}
function clear(){note.value='';au.removeAttribute('src');done.hidden=true;rec.hidden=false;rec.textContent=rec.dataset.start;}
b.querySelector('.del').onclick=clear;b.querySelector('.play').onclick=function(){au.play();};
file.onchange=function(){keep(file.files&&file.files[0]);};
if(!window.MediaRecorder||!navigator.mediaDevices){rec.onclick=function(){file.click();};return;}
rec.onclick=function(){if(r){r.stop();return;}navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
var parts=[];r=new MediaRecorder(s);r.ondataavailable=function(e){parts.push(e.data);};
r.onstop=function(){clearTimeout(t);s.getTracks().forEach(function(k){k.stop();});keep(new Blob(parts,{type:r.mimeType||'audio/webm'}));r=null;};
r.start();rec.textContent=rec.dataset.stop;t=setTimeout(function(){if(r)r.stop();},max);}).catch(function(){file.click();});};})();`;

function voiceBlock(c) {
  return `<div class="voice" data-max-seconds="${MAX_SECONDS}">`
    + `<button class="btn rec" type="button" data-start="${esc(c.vn)}" data-stop="${esc(c.stop)}">${esc(c.vn)}</button>`
    + '<input type="file" accept="audio/*" capture hidden>'
    + '<input type="hidden" name="note" value="">'
    + `<div class="done" hidden><audio controls></audio><button class="btn play" type="button">${esc(c.play)}</button>`
    + `<button class="btn del" type="button">${esc(c.del)}</button></div>`
    + `<p class="muted">${esc(c.vnHint)}</p></div>`;
}

/** The reasons page. coaches = [{ id, name }]; the list shows only when there is more than one. */
function renderReasonsPage(view, coaches, action, cardHref) {
  const l = langOf(view);
  const c = PING[l];
  const list = Array.isArray(coaches) ? coaches : [];
  const tick = (code) => `<label class="pick"><input type="checkbox" name="reason" value="${esc(code)}">`
    + `<span>${esc(REASONS[code][l])}</span></label>`;
  const pick = list.length > 1
    ? `<p>${esc(c.pick)}</p>${list.map((x) => `<label class="pick"><input type="radio" name="coach" value="${esc(x.id)}" required>`
      + `<span>${esc(x.name)}</span></label>`).join('')}`
    : '';
  const body = `<section class="useful"><h2>${esc(c.q)}</h2><form method="post" action="${esc(action)}">`
    + `${CODES.map(tick).join('')}${voiceBlock(c)}${pick}`
    + `<button class="btn" type="submit">${esc(c.send)}</button>`
    + `<a class="more" href="${esc(cardHref)}">${esc(c.cancel)}</a></form></section>`
    + `<script>${VOICE_JS}</script>`;
  return shell(l, c.title, body);
}

/** The coach card. card = loadCard() in coach-visit-request.js; action = the "I have visited" POST. */
function renderCoachCard(card, action) {
  const l = langOf(card);
  const c = PING[l];
  const view = card.view || {};
  const h = view.header || {};
  const parts = [`<header><section><h1>${esc(card.teacher)}</h1><p class="muted">${esc(card.school)}`
    + `${h.date ? ` · <bdi>${esc(h.date)}</bdi>` : ''}</p>${h.pct != null ? `<p class="big">${esc(h.pct)}%</p>` : ''}</section></header>`];
  const reasons = (card.reasons || []).filter((x) => REASONS[x]);
  if (reasons.length) parts.push(`<section><h2>${esc(c.reasons)}</h2><ul>${reasons.map((x) => `<li>${esc(REASONS[x][l])}</li>`).join('')}</ul></section>`);
  if (card.noteUrl) parts.push(`<section><h2>${esc(c.note)}</h2><audio controls src="${esc(card.noteUrl)}"></audio></section>`);
  const secs = (view.sections || []).filter((s) => s && !s.notAssessed && s.score != null && s.max != null);
  if (secs.length) {
    parts.push(`<section><h2>${esc(c.sections)}</h2>${secs.map((s) => `<div class="sec"><div class="row"><span>${esc(s.name)}</span>`
      + `<span>${esc(`${s.score}/${s.max}`)}</span></div></div>`).join('')}</section>`);
  }
  parts.push(card.status === 'visited'
    ? `<section class="useful"><p>${esc(c.visited)}</p></section>`
    : `<section class="useful"><form method="post" action="${esc(action)}"><button class="btn" type="submit">${esc(c.visit)}</button></form></section>`);
  return shell(l, c.cardTitle, parts.join('\n'));
}

module.exports = { renderReasonsPage, renderCoachCard, PING, MAX_SECONDS };
