'use strict';
/**
 * "Your class's Jugnu link" — the standing class link's card on the teacher report's class tab
 * (switch web_quiz_class_link; the data comes from web-quiz-class-link.js forTeacher, null when off).
 *
 * NO JAVASCRIPT, like the rest of the report. Forward and Copy are server links (/r/<token>/jlink?class=<id>&how=)
 * that log class_link_forwarded{cls, how}: Forward answers 302 to wa.me with the URL ONLY (no count, no name,
 * RUBRIC L11); Copy answers 303 back to the class tab with this card's link open as selectable text. Strings are copy.v2.json keys, EN and UR.
 */

const COPY = {
  en: {
    title: "Your class's Jugnu link", // jg.t.link_title
    sub: 'Forward it once a term and pin it. It always opens this week\'s story.', // jg.t.link_sub
    copy: 'Copy', // jg.t.link_copy
    forward: 'Forward to the class group', // jg.t.fwd_btn
  },
  ur: {
    title: 'آپ کی کلاس کا جگنو لنک',
    sub: 'ہر ٹرم میں ایک بار فارورڈ کریں اور پِن کر دیں۔ یہ ہمیشہ اس ہفتے کی کہانی کھولتا ہے۔',
    copy: 'کاپی کریں',
    forward: 'کلاس گروپ میں فارورڈ کریں',
  },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {{cards: Array<{classId: string, url: string, preview?: string}>, open?: string}|null|undefined} data  open = the class whose link to show
 * @param {{lang: 'en'|'ur', base: string, print?: boolean}} opts  base = the report's own /r/<token>
 * @returns {string} '' when there is nothing to show (switch off) or in print mode
 */
function renderClassLinkCard(data, { lang = 'en', base = '', print = false } = {}) {
  const cards = data && Array.isArray(data.cards) ? data.cards : [];
  if (!cards.length || print) return '';
  const C = COPY[lang === 'ur' ? 'ur' : 'en'];
  const one = (c) => {
    const link = (how) => `${base}/jlink?class=${encodeURIComponent(c.classId)}&how=${how}`;
    // The link itself is the teacher's own preview (plays as practice); copying the text copies the plain link.
    const open = c.preview ? `<a href="${esc(c.preview)}" dir="ltr">${esc(c.url)}</a>` : `<span dir="ltr">${esc(c.url)}</span>`;
    // Copy is a server link (logged, how:'copy') that comes back here with this card's link open to select.
    const copy = data.open && data.open === c.classId
      ? `<details class="act" open><summary>${esc(C.copy)}</summary><textarea readonly rows="2" dir="ltr">${esc(c.url)}</textarea></details>`
      : `<a class="btn btn-ghost act" href="${esc(link('copy'))}">${esc(C.copy)}</a>`;
    return `<p class="small">${open}</p>
<a class="btn btn-primary act" href="${esc(link('forward'))}">${esc(C.forward)}</a>
${copy}`;
  };
  return `<section class="card" id="class-link"><h2>${esc(C.title)}</h2><p class="small muted">${esc(C.sub)}</p>
${cards.map(one).join('\n')}</section>`;
}

module.exports = { renderClassLinkCard, COPY };
