'use strict';
/**
 * "Your class's Jugnu link" — the standing class link's card on the teacher report's class tab
 * (switch web_quiz_class_link; the data comes from web-quiz-class-link.js forTeacher, null when off).
 *
 * NO JAVASCRIPT, like the rest of the report. "Open" is the teacher's own preview link; "Make a new link" asks first:
 * it is a plain link back to the class tab with ?jconfirm=<class>, where THAT class's card shows the warning, a POST
 * form (/r/<token>/jnew, the class and the signed nonce `n`) that revokes this link and mints a new one, and
 * "Keep this link" back to the tab (data.confirm = {classId, n}, set by the report route). Forward and Copy are server links (/r/<token>/jlink?class=<id>&how=)
 * that log class_link_forwarded{cls, how}: Forward answers 302 to wa.me with the URL ONLY (no count, no name,
 * the no-count, no-name forward rule); Copy answers 303 back to the class tab with this card's link open as selectable text. Strings are copy.v2.json keys, EN and UR.
 */

const { clampLanguage } = require('../config/ux-strings');

const COPY = {
  en: {
    title: "Your class's Jugnu link", // jg.t.link_title
    sub: 'Forward it once a term and pin it. It always opens this week\'s story.', // jg.t.link_sub
    copy: 'Copy', // jg.t.link_copy
    forward: 'Forward to the class group', // jg.t.fwd_btn
    open: 'Open', // jg.t.link_open
    make: 'Make a new link', // jg.t.link_make
    renewConfirm: 'The old link will stop working for everyone. Forward the new one to the class group.', // jg.t.link_renew_confirm
    renewGo: 'Make a new link', // jg.t.link_renew_go
    renewKeep: 'Keep this link', // jg.t.link_renew_keep
  },
  ur: {
    title: 'آپ کی کلاس کا جگنو لنک',
    sub: 'ہر ٹرم میں ایک بار فارورڈ کریں اور پِن کر دیں۔ یہ ہمیشہ اس ہفتے کی کہانی کھولتا ہے۔',
    copy: 'کاپی کریں',
    forward: 'کلاس گروپ میں فارورڈ کریں',
    open: 'کھولیں',
    make: 'نیا لنک بنائیں',
    renewConfirm: 'پرانا لنک سب کے لیے بند ہو جائے گا۔ نیا لنک کلاس گروپ میں بھیج دیں۔',
    renewGo: 'نیا لنک بنائیں',
    renewKeep: 'یہی لنک رکھیں',
  },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {{cards: Array<{classId: string, url: string, preview?: string}>, open?: string, confirm?: {classId: string, n: string}}|null|undefined} data
 *   open = the class whose link to show; confirm = the class whose "Make a new link" asks first, and its signed nonce
 * @param {{lang: 'en'|'ur', base: string, print?: boolean}} opts  base = the report's own /r/<token>
 * @returns {string} '' when there is nothing to show (switch off) or in print mode
 */
function renderClassLinkCard(data, { lang = 'en', base = '', print = false } = {}) {
  const cards = data && Array.isArray(data.cards) ? data.cards : [];
  if (!cards.length || print) return '';
  const C = COPY[clampLanguage(lang)] || COPY.en;
  const one = (c) => {
    const link = (how) => `${base}/jlink?class=${encodeURIComponent(c.classId)}&how=${how}`;
    // The link itself is the teacher's own preview (plays as practice); copying the text copies the plain link.
    const open = c.preview ? `<a href="${esc(c.preview)}" dir="ltr">${esc(c.url)}</a>` : `<span dir="ltr">${esc(c.url)}</span>`;
    // Copy is a server link (logged, how:'copy') that comes back here with this card's link open to select.
    const copy = data.open && data.open === c.classId
      ? `<details class="act" open><summary>${esc(C.copy)}</summary><textarea readonly rows="2" dir="ltr">${esc(c.url)}</textarea></details>`
      : `<a class="btn btn-ghost act" href="${esc(link('copy'))}">${esc(C.copy)}</a>`;
    // Open: the teacher's own preview (plays as practice, not counted as opened). Make a new link asks first: a plain
    // link to this card's confirm state; there, the warning, a POST form (class + signed nonce) that revokes this link
    // (it then opens nothing) and mints a new one, then comes back here; and Keep this link, back with no change.
    const openBtn = c.preview ? `<a class="btn btn-ghost act" href="${esc(c.preview)}">${esc(C.open)}</a>` : '';
    const asking = data.confirm && data.confirm.classId === c.classId && data.confirm.n;
    const make = asking
      ? `<p class="small">${esc(C.renewConfirm)}</p>
<form method="post" action="${esc(`${base}/jnew`)}" class="act"><input type="hidden" name="class" value="${esc(c.classId)}"><input type="hidden" name="n" value="${esc(data.confirm.n)}"><button type="submit" class="btn btn-ghost" style="width:100%;font:inherit;font-weight:700;cursor:pointer">${esc(C.renewGo)}</button></form>
<a class="btn btn-ghost act" href="${esc(`${base}?tab=class#class-link`)}">${esc(C.renewKeep)}</a>`
      : `<a class="btn btn-ghost act" href="${esc(`${base}?tab=class&jconfirm=${encodeURIComponent(c.classId)}#class-link`)}">${esc(C.make)}</a>`;
    return `<p class="small">${open}</p>
<a class="btn btn-primary act" href="${esc(link('forward'))}">${esc(C.forward)}</a>
${copy}
${openBtn}
${make}`;
  };
  return `<section class="card" id="class-link"><h2>${esc(C.title)}</h2><p class="small muted">${esc(C.sub)}</p>
${cards.map(one).join('\n')}</section>`;
}

module.exports = { renderClassLinkCard, COPY };
