'use strict';
/**
 * "Share with your class" on the teacher's quiz home (/quiz/teacher/<token>), bd-pdwwk4.6.20. Switch
 * web_quiz_class_link_share (OFF by default; only with web_quiz_class_link on). Teachers almost never forwarded the
 * standing class link, so children never reached the evening class quiz; this puts the link, with one tap to the class
 * group, right under the quiz home's top card.
 *
 *   forHome(uid, lang)     null while off; else {classes: [{classId, label, shown, sent}]} — the teacher app card's own
 *                          classes (web-quiz-class-link-app.js forApp: class_teachers, canary scope, minted link). `shown`
 *                          is the link without its scheme; never a child's name or a count.
 *   sendHref({uid, classId, ua})  the "Send to class group" tap (GET /quiz/teacher/<token>/cl?class=<id>): forApp's tap
 *                          logs quiz_forward_tap{surface class_link} and marks the class sent this term → the wa.me href
 *                          (the URL only, ?f=1); null when off, not a UUID, or not this teacher's class.
 *   swap(script)           the page script with the section's drawing (cls()) swapped in, under its own hash.
 *   section(lang)          the shell's section (hidden until the home's answer has classes).
 *   STRINGS                its words, en + ur (teacher-facing Urdu keeps Western digits, like the app card).
 */
const crypto = require('crypto');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STRINGS = Object.freeze({
  en: Object.freeze({
    'th.cl.head': 'Share with your class',
    'th.cl.sub': "Children play the class quiz at home from this link. Send it once to your class group.",
    'th.cl.send': 'Send to class group',
    'th.cl.sent': 'Class link sent',
    'th.cl.again': 'Send again',
  }),
  ur: Object.freeze({
    'th.cl.head': 'اپنی کلاس کے ساتھ شیئر کریں',
    'th.cl.sub': 'بچے اس لنک سے گھر پر کلاس کوئز کھیلتے ہیں۔ اسے ایک بار کلاس گروپ میں بھیجیں۔',
    'th.cl.send': 'کلاس گروپ میں بھیجیں',
    'th.cl.sent': 'کلاس لنک بھیجا گیا',
    'th.cl.again': 'دوبارہ بھیجیں',
  }),
});
const words = (lang) => STRINGS[lang === 'ur' ? 'ur' : 'en'];
const labelOf = (grade, section, lang) => `${lang === 'ur' ? 'کلاس' : 'Class'} ${grade}${section ? ` ${section}` : ''}`;

const App = () => require('../quiz/web-quiz-class-link-app');
const Flags = () => require('../quiz/web-quiz-class-link-flags');

async function forHome(uid, lang, { now = new Date() } = {}) {
  if (!uid || !(await Flags().shareOn())) return null;
  const out = await App().forApp(uid, { now });
  const classes = (out && Array.isArray(out.classes) ? out.classes : []).map((c) => ({
    classId: c.classId, label: labelOf(c.grade, c.section, lang), shown: String(c.url).replace(/^https:\/\//, ''), sent: c.sent === true,
  }));
  return classes.length ? { classes } : null;
}

async function sendHref({ uid, classId, ua = null } = {}) {
  if (!uid || typeof classId !== 'string' || !UUID_RX.test(classId) || !(await Flags().shareOn())) return null;
  const out = await App().tap({ teacherId: uid, classId, how: 'forward', ua });
  return out && typeof out.href === 'string' && /^https:\/\/wa\.me\//.test(out.href) ? out.href : null;
}

// The section's drawing: plain ES5, textContent only (the page's rule). Under the top card; no data-primary of its own.
const SWAPS = Object.freeze([
  ['function under(){', `function cls(){var s=q('#th-cl');if(!s)return;var L=d.classLink,all=(L&&L.classes)||[],ul=q('#th-cl-rows');clear(ul);
all.forEach(function(c){var li=el('li','th-row');li.setAttribute('data-row','class_link');var tx=el('div','th-row-t');tx.appendChild(el('span','th-row-n',c.label));
var u=el('span','th-row-k',c.shown);u.setAttribute('dir','ltr');tx.appendChild(u);if(c.sent)tx.appendChild(el('span','th-row-k',S['th.cl.sent']));li.appendChild(tx);
li.appendChild(link(c.sent?'th-row-v':'th-go2',S[c.sent?'th.cl.again':'th.cl.send'],'/quiz/teacher/'+T+'/cl?class='+encodeURIComponent(c.classId)+'&lang='+b.lang,'class_link'));ul.appendChild(li)});
s.hidden=!all.length}
function under(){`],
  ['top();under();', 'top();cls();under();'],
]);
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const SCRIPTS = new Map();
function swap(base, swapped) {
  if (!SCRIPTS.has(base)) { const text = swapped(base, SWAPS, 'the class link part'); SCRIPTS.set(base, { text, hash: sha(text) }); }
  return SCRIPTS.get(base);
}

function section(lang, esc) {
  const w = words(lang);
  return `
<section class="th-card" id="th-cl" data-section="class_link" hidden>
<h2>${esc(w['th.cl.head'])}</h2>
<p class="th-note">${esc(w['th.cl.sub'])}</p>
<ul class="th-rows" id="th-cl-rows"></ul>
</section>`;
}

module.exports = { forHome, sendHref, swap, section, words, STRINGS, SWAPS };
