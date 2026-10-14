'use strict';
/**
 * The coaching report page (pure HTML) — v10 coaching test, bd-v0toag.18. Group C and D's report on the
 * portal: the move to try in the next lesson, the full report image and voice note, the student quiz to
 * forward, and a way back to WhatsApp for the next plan. Read-only. Every value is escaped and every
 * link must be https. Rendered by dashboard/routes/coaching-report.routes.js.
 */

const COPY = {
  en: {
    title: 'Your coaching report',
    tryNext: 'Try this in your next lesson',
    report: 'Your full report',
    openReport: 'Open your full report',
    voice: 'Listen to your coach',
    quiz: 'Quiz for your students',
    sendQuiz: 'Send it to your class on WhatsApp',
    plan: 'Your next lesson plan',
    getPlan: 'Get it on WhatsApp',
    planText: 'lesson plan',
    notFoundTitle: 'This link is not complete',
    notFoundBody: 'Open the report from your WhatsApp message again.',
    errorTitle: 'Something went wrong',
    errorBody: 'Please try again in a few minutes.',
  },
  ur: {
    title: 'آپ کی کوچنگ رپورٹ',
    tryNext: 'اگلے سبق میں یہ آزمائیں',
    report: 'آپ کی مکمل رپورٹ',
    openReport: 'مکمل رپورٹ کھولیں',
    voice: 'اپنے کوچ کو سنیں',
    quiz: 'طلبہ کے لیے کوئز',
    sendQuiz: 'واٹس ایپ پر اپنی کلاس کو بھیجیں',
    plan: 'آپ کا اگلا سبق کا منصوبہ',
    getPlan: 'واٹس ایپ پر حاصل کریں',
    planText: 'lesson plan',
    notFoundTitle: 'یہ لنک مکمل نہیں ہے',
    notFoundBody: 'رپورٹ اپنے واٹس ایپ پیغام سے دوبارہ کھولیں۔',
    errorTitle: 'کچھ غلط ہو گیا',
    errorBody: 'براہ کرم چند منٹ بعد دوبارہ کوشش کریں۔',
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PKT_MS = 5 * 3600 * 1000;

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function https(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch (_) {
    return null;
  }
}

function pktDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + PKT_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const lang = (l) => (l === 'ur' ? 'ur' : 'en');

function shell(l, title, body) {
  const dir = l === 'ur' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${l}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { --bg:#ffffff; --fg:#333748; --muted:#5b6475; --accent:#47BA7D; --card:#f3f6f4; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161c; --fg:#eceef3; --muted:#a6adbb; --card:#1d2129; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; }
  section { background:var(--card); border-radius:16px; padding:20px; margin:0 0 16px; }
  section.try { border-top:4px solid var(--accent); }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:18px; margin:0 0 8px; }
  p { margin:0 0 8px; } .muted { color:var(--muted); }
  img, audio { width:100%; border-radius:12px; display:block; }
  a.btn { display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:10px 16px; border-radius:10px; font-weight:600; }
  [lang="ur"] body, html[lang="ur"] body { font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic",system-ui,sans-serif; line-height:2.1; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function botDigits(env) {
  return String(env.WHATSAPP_BOT_NUMBER || env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
}

/** view = { language, session, quizMessage }; env defaults to process.env (the bot number). */
function renderReportPage(view, env = process.env) {
  const l = lang(view && view.language);
  const c = COPY[l];
  const s = (view && view.session) || {};
  const a = s.analysis_data || {};
  const pa = s.prioritized_action || {};
  const move = (pa.thing_to_try && pa.thing_to_try.text) || pa.action || '';
  const parts = [];

  const sub = [a.subject, a.topic, pktDate(s.created_at)].filter(Boolean).map(esc).join(' · ');
  parts.push(`<header><h1>${esc(c.title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</header>`);
  if (move) parts.push(`<section class="try"><h2>${esc(c.tryNext)}</h2><p>${esc(move)}</p></section>`);

  const report = https(s.report_pdf_url);
  if (report) {
    const inner = /\.png(\?|$)/i.test(report)
      ? `<img src="${esc(report)}" alt="${esc(c.report)}">`
      : `<a class="btn" href="${esc(report)}">${esc(c.openReport)}</a>`;
    parts.push(`<section><h2>${esc(c.report)}</h2>${inner}</section>`);
  }
  const voice = https(s.voice_debrief_url);
  if (voice) parts.push(`<section><h2>${esc(c.voice)}</h2><audio controls src="${esc(voice)}"></audio></section>`);

  if (view && typeof view.quizMessage === 'string' && view.quizMessage.trim()) {
    const share = `https://wa.me/?text=${encodeURIComponent(view.quizMessage)}`;
    parts.push(`<section><h2>${esc(c.quiz)}</h2><p>${esc(view.quizMessage)}</p><a class="btn" href="${esc(share)}">${esc(c.sendQuiz)}</a></section>`);
  }
  const bot = botDigits(env);
  if (bot) {
    const planLink = `https://wa.me/${bot}?text=${encodeURIComponent(c.planText)}`;
    parts.push(`<section><h2>${esc(c.plan)}</h2><a class="btn" href="${esc(planLink)}">${esc(c.getPlan)}</a></section>`);
  }
  return shell(l, c.title, parts.join('\n'));
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

module.exports = { renderReportPage, renderMessagePage, pktDate, COPY };
