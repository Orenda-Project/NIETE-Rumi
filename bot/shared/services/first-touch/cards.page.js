'use strict';
/**
 * The quiz-maker page's three branch cards and its one forward line, as a page addon (maker.page buildMakerPage
 * `addons`): `cardsAddon({ lang, bot })` → { ready, foot, script, css }.
 *
 *   Cards   "Lesson plans" · "AI coaching" · "Test Paper" — each a plain link back into the SAME chat with the bot,
 *           the feature's REAL entry word already typed: https://wa.me/<bot>?text=<word>. The teacher sends it; the
 *           feature's own door answers (and its own app redirect still runs there). Words by the page's language:
 *             lesson plan / «لیسن پلان»   → lp-intent.js BARE
 *             coaching    / «کوچنگ»        → coaching-trigger.js COACHING_TRIGGER_RX (start-anchored; "AI coaching"
 *                                             matches nothing, so the LABEL says it and the WORD does not)
 *             /assessment (both pages)     → the handler's exact slash-command list (no Urdu word is honoured)
 *           The exam card's title is the REAL menu row title (resolveUx('menuRowAssessmentTitle')), never a copy.
 *           Shown inside the ready screen (screen "ready") and at the page foot (screen "foot"); the foot copy hides
 *           itself while the ready screen is up, so the ready screen never shows the cards twice.
 *   Forward "Share with teachers" — https://wa.me/?text=<mk.fwd>, WhatsApp's picker with a text for a staff group that
 *           ends in the bot's own link (?text=quiz). It carries no token, no uid, no share code: every receiver
 *           arrives through their own door.
 *
 * `bot` is this deployment's dialable number (video-quiz-share botNumber()); anything that is not 10–15 digits →
 * the addon is empty (no cards, no forward line: never a dead link). Nothing here sends a message.
 *
 * The script (plain ES5, never builds HTML): a tap on a card or the forward line posts one beacon to /api/ft/tour
 * ({t, action:'card', card, screen} / {t, action:'forward'}) and never stops the link — a lost beacon loses an
 * event, never the navigation. It reads the token from the page's #mk-boot block at tap time.
 */
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { str, fill } = require('./maker.strings');

const BOT_RX = /^\d{10,15}$/;

/** The three cards, in page order: the event's card name, the title, the word the card pre-types. */
const CARDS = Object.freeze([
  Object.freeze({ card: 'lp', title: (l) => str('mk.card.lp', l), word: 'mk.card.lp.word' }),
  Object.freeze({ card: 'coach', title: (l) => str('mk.card.coach', l), word: 'mk.card.coach.word' }),
  Object.freeze({ card: 'exam', title: (l) => resolveUx('menuRowAssessmentTitle', { language: l }), word: 'mk.card.exam.word' }),
]);
const SCREENS = Object.freeze(['ready', 'foot']);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The bot's number as digits, or null when it is not a dialable number. */
function botOf(bot) {
  if (bot == null) return null;
  const d = String(bot).replace(/\D/g, '');
  return BOT_RX.test(d) ? d : null;
}

/** The page language the cards speak ('bi' → the Urdu page's words, as the page itself). */
const langOf = (lang) => (lang === 'bi' ? 'ur' : clampLanguage(lang));

/** https://wa.me/<bot>?text=<word> — the chat with the bot, the word typed. */
const cardHref = (bot, word) => `https://wa.me/${bot}?text=${encodeURIComponent(word)}`;

/** mk.fwd with the bot's number in its link (the Urdu text keeps ?text=quiz too: COPY's signed deviation). */
const forwardText = (bot, lang) => fill('mk.fwd', langOf(lang), { bot });

/** https://wa.me/?text=<mk.fwd> — WhatsApp's picker. */
const forwardHref = (bot, lang) => `https://wa.me/?text=${encodeURIComponent(forwardText(bot, lang))}`;

/** The cards as { card, title, word, href } for one page language (null without a bot number). */
function cardsFor({ lang, bot }) {
  const n = botOf(bot);
  if (!n) return null;
  const l = langOf(lang);
  return CARDS.map((c) => {
    const word = str(c.word, l);
    return { card: c.card, title: c.title(l), word, href: cardHref(n, word) };
  });
}

function cardsHtml(list, at) {
  const links = list.map((c) => `<a class="ft-card" data-card="${c.card}" data-at="${at}" data-id="mk.card.${c.card}" href="${esc(c.href)}">${esc(c.title)}</a>`).join('');
  return `<div class="ft-cards" data-at="${at}">${links}</div>`;
}

const CSS = [
  '.ft-cards{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
  '.ft-card{display:flex;align-items:center;min-height:52px;padding:10px 16px;border-radius:16px;border:2px solid var(--line);background:var(--card);color:var(--brand-ink);font:800 17px/1.3 var(--f);text-decoration:none;text-align:start}',
  'html[lang=ur] .ft-card{font-family:var(--fu);font-weight:400;line-height:1.8}',
  '.ft-fwd{display:inline-block;margin-top:10px;padding:8px;color:var(--muted);font:700 15px/1.6 var(--f);text-decoration:underline}',
  'html[lang=ur] .ft-fwd{font-family:var(--fu);font-weight:400}',
  'body:has(section[data-screen=ready]:not([hidden])) .ft-cards[data-at=foot]{display:none}',
].join('\n');

// One beacon per tap, before the browser follows the link; never preventDefault. Capture phase, so no other
// handler can stop it.
const SCRIPT = `(function(){
function tok(){try{return JSON.parse(document.getElementById('mk-boot').textContent).t||null}catch(e){return null}}
function send(o){var s=JSON.stringify(o);try{if(navigator.sendBeacon&&navigator.sendBeacon('/api/ft/tour',new Blob([s],{type:'application/json'})))return}catch(e){}
try{fetch('/api/ft/tour',{method:'POST',headers:{'content-type':'application/json'},body:s,credentials:'same-origin',keepalive:true}).catch(function(){})}catch(e){}}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[data-card],a[data-fwd]'):null;if(!a)return;var t=tok();if(!t)return;
if(a.hasAttribute('data-fwd'))send({t:t,action:'forward'});else send({t:t,action:'card',card:a.getAttribute('data-card'),screen:a.getAttribute('data-at')})},true);
})();`;

/**
 * The addon: `ready` (the cards inside the ready screen, after mk.next), `foot` (the cards and the forward line at
 * the page foot), `script`, `css`. No dialable bot number → {} (the page renders exactly as without the addon).
 */
function cardsAddon({ lang = 'en', bot = null } = {}) {
  const list = cardsFor({ lang, bot });
  if (!list) return {};
  const n = botOf(bot);
  const l = langOf(lang);
  const fwd = `<p class="mk-foot"><a class="ft-fwd" data-fwd data-id="mk.fwd.btn" href="${esc(forwardHref(n, l))}">${esc(str('mk.fwd.btn', l))}</a></p>`;
  return {
    ready: cardsHtml(list, 'ready'),
    foot: `${cardsHtml(list, 'foot')}\n${fwd}`,
    script: SCRIPT,
    css: CSS,
  };
}

module.exports = { cardsAddon, cardsFor, cardHref, forwardText, forwardHref, botOf, CARDS, SCREENS, SCRIPT, CSS };
