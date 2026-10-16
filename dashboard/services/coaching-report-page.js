'use strict';
/**
 * The coaching report page (pure HTML) — v10 coaching test, bd-v0toag.18, reshaped to Amena's ICT-3
 * template in bd-v0toag.55. Group C and D's report on the portal, two screens on one link:
 *   card   — her score, what went well, the one thing to try (its step and why it matters), a way back
 *            to WhatsApp for tomorrow's plan, the report image, voice note and student quiz;
 *   detail — marks, the four sections with bars and the stored why, and her journey so far.
 * C and D are asked "Do you agree?" with their coach one tap away (bd-v0toag.38.9, coach-ping-page.js).
 * Takes the view from coaching-report-view.js. Read-only. Every value is escaped and every link https.
 * Rendered by dashboard/routes/coaching-report.routes.js.
 */
const { esc, shell } = require('./coaching-report-style');
const { pktDate } = require('./coaching-report-view');
// The survey's words come from the bot's catalog, so the page asks exactly what A and B are asked on WhatsApp.
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { PING } = require('./coach-ping-page');

const COPY = {
  en: {
    title: 'Your coaching report',
    well: 'What you did well',
    tryh: '★ Try one thing tomorrow',
    check: 'We’ll look for this in your next recording.',
    open: 'Open tomorrow’s lesson ›',
    more: 'See detailed analysis of your lesson ›',
    back: '‹ Back to my card',
    made: 'Performance by section',
    journey: 'Your journey',
    first: 'First lesson',
    best: 'Best',
    now: 'This lesson',
    notAssessed: 'not assessed',
    report: 'Your full report',
    openReport: 'Open your full report',
    voice: 'Listen to your coach',
    quiz: 'Quiz for your students',
    sendQuiz: 'Send it to your class on WhatsApp',
    planText: 'lesson plan',
    notFoundTitle: 'This link is not complete',
    notFoundBody: 'Open the report from your WhatsApp message again.',
    errorTitle: 'Something went wrong',
    errorBody: 'Please try again in a few minutes.',
  },
  ur: {
    title: 'آپ کی کوچنگ رپورٹ',
    well: 'آپ نے یہ اچھا کیا',
    tryh: '★ کل ایک کام آزمائیں',
    check: 'اگلی ریکارڈنگ میں ہم یہی دیکھیں گے۔',
    open: 'کل کا سبق کھولیں',
    more: 'اپنے سبق کا تفصیلی تجزیہ دیکھیں',
    back: 'اپنے کارڈ پر واپس',
    made: 'حصہ وار کارکردگی',
    journey: 'آپ کا سفر',
    first: 'پہلا سبق',
    best: 'سب سے اچھا',
    now: 'یہ سبق',
    notAssessed: 'جانچ نہیں ہوئی',
    report: 'آپ کی مکمل رپورٹ',
    openReport: 'مکمل رپورٹ کھولیں',
    voice: 'اپنے کوچ کو سنیں',
    quiz: 'طلبہ کے لیے کوئز',
    sendQuiz: 'واٹس ایپ پر اپنی کلاس کو بھیجیں',
    planText: 'lesson plan',
    notFoundTitle: 'یہ لنک مکمل نہیں ہے',
    notFoundBody: 'رپورٹ اپنے واٹس ایپ پیغام سے دوبارہ کھولیں۔',
    errorTitle: 'کچھ غلط ہو گیا',
    errorBody: 'براہ کرم چند منٹ بعد دوبارہ کوشش کریں۔',
  },
};

const lang = (v) => (v && v.language === 'ur' ? 'ur' : 'en');
const head = (v) => (v && v.header) || {};
const botDigits = (env) => String((env && (env.WHATSAPP_BOT_NUMBER || env.REFERRAL_BOT_NUMBER)) || '').replace(/\D/g, '');

function top(h, extra = '') {
  // The date sits in <bdi> so "19 Oct 2026" keeps its order inside Urdu (right to left) text.
  const meta = [h.meta && esc(h.meta), h.date && `<bdi>${esc(h.date)}</bdi>`].filter(Boolean).join(' · ');
  return `<header><section>${h.name ? `<h1>${esc(h.name)}</h1>` : ''}${meta ? `<p class="muted">${meta}</p>` : ''}`
    + `${h.pct != null ? `<p class="big">${esc(h.pct)}%</p>` : ''}${extra}</section></header>`;
}

function trySection(t, c, bot) {
  if (!t) return '';
  const chip = t.step ? `<span class="chip s${t.step.index}">${esc(t.step.name)}</span>` : '';
  const why = t.why ? `<p class="why">${esc(t.why)}</p>` : '';
  const plan = bot ? `<a class="btn" href="${esc(`https://wa.me/${bot}?text=${encodeURIComponent(c.planText)}`)}">${esc(c.open)}</a>` : '';
  return `<section class="try"><h2>${esc(c.tryh)}</h2>${chip}<p>${esc(t.text)}</p>${why}<p class="muted">${esc(c.check)}</p>${plan}</section>`;
}

/**
 * "Do you agree with this report?" (bd-v0toag.49; reworded in bd-v0toag.38.9). A POST form, so a link preview
 * never answers it. state: undefined = ask; 'yes' = thanks; 'no' = ask for the reason; 'done' = thanks for the
 * reason. For C and D (coachHref set) No opens the coach ping instead, and the link to it shows from the start.
 */
function usefulSection(action, state, language, coachHref) {
  if (!action) return '';
  const ux = (key) => esc(resolveUx(key, { language }));
  if (state === 'yes') return `<section class="useful"><p>${ux('coachingSurveyThanks')}</p></section>`;
  if (state === 'done') return `<section class="useful"><p>${ux('coachingSurveyReasonThanks')}</p></section>`;
  const form = `<form method="post" action="${esc(action)}">`;
  if (state === 'no' && !coachHref) {
    return `<section class="useful">${form}<label for="reason">${ux('coachingSurveyAskReason')}</label>`
      + '<textarea id="reason" name="reason" rows="3" maxlength="1000" required></textarea>'
      + `<button class="btn" type="submit">✓</button></form></section>`;
  }
  const help = coachHref ? `<a class="more" href="${esc(coachHref)}">${esc(PING[language].help)}</a>` : '';
  return `<section class="useful"><h2>${ux('coachingSurveyAsk')}</h2>${form}`
    + `<button class="btn" type="submit" name="useful" value="yes">${ux('coachingSurveyYesButton')}</button> `
    + `<button class="btn" type="submit" name="useful" value="no">${ux('coachingSurveyNoButton')}</button></form>${help}</section>`;
}

/** What happened once a C/D teacher sent the coach ping (coachState from ?coach=). */
const COACH_SAID = { sent: 'helped', already: 'helped', failed: 'failed', invalid: 'failed', no_coach: 'noCoach' };
const coachSection = (coachState, l) => `<section class="useful"><p>${esc(PING[l][COACH_SAID[coachState]])}</p></section>`;

/**
 * The card screen. links = { detail, card, useful, coach }; env gives the bot number (defaults to process.env).
 * usefulState is the survey's step after an answer (see usefulSection); coachState is ?coach= (COACH_SAID).
 */
function renderReportPage(view, env = process.env, links = {}, usefulState, coachState) {
  const v = view || {};
  const l = lang(v);
  const c = COPY[l];
  const parts = [top(head(v))];
  const wells = Array.isArray(v.wells) ? v.wells : [];
  if (wells.length) parts.push(`<section><h2>${esc(c.well)}</h2><ul>${wells.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>`);
  parts.push(trySection(v.thing, c, botDigits(env)));
  if (links.detail) parts.push(`<a class="more" href="${esc(links.detail)}">${esc(c.more)}</a>`);
  if (v.report) {
    const inner = /\.png(\?|$)/i.test(v.report)
      ? `<img src="${esc(v.report)}" alt="${esc(c.report)}">`
      : `<a class="btn" href="${esc(v.report)}">${esc(c.openReport)}</a>`;
    parts.push(`<section><h2>${esc(c.report)}</h2>${inner}</section>`);
  }
  if (v.voice) parts.push(`<section><h2>${esc(c.voice)}</h2><audio controls src="${esc(v.voice)}"></audio></section>`);
  if (typeof v.quizMessage === 'string' && v.quizMessage.trim()) {
    const share = `https://wa.me/?text=${encodeURIComponent(v.quizMessage)}`;
    parts.push(`<section><h2>${esc(c.quiz)}</h2><p>${esc(v.quizMessage)}</p><a class="btn" href="${esc(share)}">${esc(c.sendQuiz)}</a></section>`);
  }
  // Once she has sent the coach ping (C and D only), the question is answered: don't ask again.
  if (links.coach && COACH_SAID[coachState]) parts.push(coachSection(coachState, l));
  else parts.push(usefulSection(links.useful, usefulState, l, links.coach));
  return shell(l, c.title, parts.filter(Boolean).join('\n'));
}

function sectionRow(s, c) {
  if (s.notAssessed) return `<div class="sec"><div class="row"><span>${esc(s.name)}</span><span class="muted">${esc(c.notAssessed)}</span></div></div>`;
  const score = s.score != null && s.max != null ? `${s.score}/${s.max}` : '';
  const bar = s.pct != null ? `<div class="track"><div class="bar ${esc(s.colour)}" style="width:${Math.max(0, Math.min(100, s.pct))}%"></div></div>` : '';
  return `<div class="sec"><div class="row"><span>${esc(s.name)}</span><span>${esc(score)}</span></div>${bar}`
    + `${s.why ? `<p class="why">${esc(s.why)}</p>` : ''}</div>`;
}

function journeySection(j, c) {
  if (!j || !Array.isArray(j.points) || j.points.length < 2) return '';
  const W = 300; const H = 100; const n = j.points.length;
  const xy = j.points.map((p, i) => [Math.round((i * W) / (n - 1)), Math.round(H - 8 - (Math.max(0, Math.min(100, p)) * (H - 16)) / 100)]);
  const svg = `<svg viewBox="-6 0 ${W + 12} ${H}" role="img" aria-label="${esc(c.journey)}">`
    + `<polyline fill="none" stroke="var(--s3)" stroke-width="3" points="${xy.map((q) => q.join(',')).join(' ')}"/>`
    + `${xy.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="var(--s3)"/>`).join('')}</svg>`;
  const item = (label, p) => `<span>${esc(label)} <b>${esc(p)}%</b></span>`;
  return `<section><h2>${esc(c.journey)}</h2>${svg}<div class="legend">${item(c.first, j.first)}${item(c.best, j.best)}${item(c.now, j.now)}</div></section>`;
}

/** The detailed screen, reached from the card. */
function renderDetailPage(view, links = {}) {
  const v = view || {};
  const l = lang(v);
  const c = COPY[l];
  const h = head(v);
  const parts = [];
  if (links.card) parts.push(`<a class="more" href="${esc(links.card)}">${esc(c.back)}</a>`);
  parts.push(top(h, h.marks != null && h.max != null ? `<p class="muted">${esc(`${h.marks}/${h.max}`)}</p>` : ''));
  const secs = Array.isArray(v.sections) ? v.sections : [];
  if (secs.length) parts.push(`<section><h2>${esc(c.made)}</h2>${secs.map((s) => sectionRow(s, c)).join('')}</section>`);
  parts.push(journeySection(v.journey, c));
  return shell(l, c.title, parts.filter(Boolean).join('\n'));
}

/** kind = 'not_found' | 'error'; both languages, since we may not know hers. */
function renderMessagePage(kind) {
  const k = kind === 'error' ? 'error' : 'notFound';
  const body = ['en', 'ur'].map((l) => {
    const c = COPY[l];
    return `<section lang="${l}" dir="${l === 'ur' ? 'rtl' : 'ltr'}"><h2>${esc(c[`${k}Title`])}</h2><p>${esc(c[`${k}Body`])}</p></section>`;
  }).join('\n');
  return shell('en', COPY.en[`${k}Title`], body);
}

module.exports = { renderReportPage, renderDetailPage, renderMessagePage, pktDate, COPY };
