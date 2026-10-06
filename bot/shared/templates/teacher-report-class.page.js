'use strict';
/**
 * The teacher web report's "All my classes" tab: one teacher's quizzes over the
 * last weeks, by grade × subject, by week, and quiz by quiz.
 *
 * A FRAGMENT, not a page. teacher-report.page.js owns the document — <html dir>,
 * the embedded fonts, the tab bar, print CSS — and places
 *   renderClassTab(data, opts)  inside its main column, and
 *   classTabCss(rtl)            inside its own <style>.
 * Every class here starts with `trc` so nothing collides with the page's own.
 *
 * `data` is teacher-report.data.js classReport() exactly:
 *   { cells:   [{grade, subject, quizzes, played, avg}],
 *     weeks:   [{weekStart, quizzes, played, avg}],          // oldest → newest
 *     quizzes: [{id, date, topic, grade, subject, played, of, avg}] }  // newest first
 * `opts.tokens` maps quiz id → that quiz's report token, minted by the route
 * (the page never signs anything). A quiz with no token is listed without a link.
 *
 * Server-rendered, no JavaScript: the trend is CSS bars, every action a link.
 * Copy is EN + UR (NIETE is flat en/ur), gender-neutral; numbers are isolated
 * LTR atoms inside Urdu (language-protocol §9.2, playwrite-reports §2.5).
 */

const { dirOf, PALETTE, FONTS } = require('./niete-brand');
const { wrapLatinRuns } = require('./latin-runs');
const { subjectLabel, formatLessonDate } = require('../services/quiz/transcript-quiz-language');
const { clampLanguage } = require('../config/ux-strings');

// The Latin word class video-quiz-report.template.js isolates with; a bare
// number is left alone (it already sits in its own .trc-n atom).
const LATIN = { token: '[A-Za-z0-9\'’".,:;!?()%/+=*$@#\\-]', requireLetter: true };

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Text content keeps its quotes (an escaped apostrophe would cut a Latin run in
// two, see video-quiz-report.template.js esc); an attribute value escapes them.
const { REPORT_PATH } = require('./teacher-report.page');
const attr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A number, a percentage or a date: always an isolated LTR atom. */
const n = (v) => `<span class="trc-n">${esc(v)}</span>`;

const CHROME = {
  en: {
    heading: 'All my classes',
    span: (d) => `Last ${n(d)} days`,
    totals: (q, p) => `${n(q)} ${q === 1 ? 'quiz' : 'quizzes'} · ${n(p)} ${p === 1 ? 'child' : 'children'} played`,
    average: 'average',
    cellsTitle: 'By class and subject',
    classSubject: (g, s) => (g ? `Class ${n(g)} · ${s}` : s),
    otherSubject: 'Other',
    quizzesN: (q) => `${n(q)} ${q === 1 ? 'quiz' : 'quizzes'}`,
    playedN: (p) => `${n(p)} played`,
    noOne: 'No one has played yet',
    trendTitle: 'Last 8 weeks',
    trendKey: 'Bar: children who played. Number on top: the average.',
    weekOf: 'week of',
    listTitle: 'Quiz by quiz',
    playedOf: (p, of) => `${n(p)} of ${n(of)} played`,
    open: 'Open report',
    empty: 'No quizzes sent in this time. Send /quiz on WhatsApp to make one.',
  },
  ur: {
    // quiz stays in Latin: the register this deployment writes in (ux-strings.js,
    // video-quiz-report.template.js) keeps it as a term of record.
    heading: 'میری سب کلاسیں',
    span: (d) => `پچھلے ${n(d)} دن`,
    totals: (q, p) => `${n(q)} quiz · ${n(p)} بچوں نے کھیلا`,
    average: 'اوسط',
    cellsTitle: 'کلاس اور مضمون کے لحاظ سے',
    classSubject: (g, s) => (g ? `جماعت ${n(g)} · ${s}` : s),
    otherSubject: 'دیگر',
    quizzesN: (q) => `${n(q)} quiz`,
    playedN: (p) => `${n(p)} نے کھیلا`,
    noOne: 'ابھی کسی نے نہیں کھیلا',
    trendTitle: 'پچھلے 8 ہفتے',
    trendKey: 'ستون: کھیلنے والے بچے۔ اوپر کا عدد: اوسط۔',
    weekOf: 'ہفتہ',
    listTitle: 'ہر quiz کی رپورٹ',
    playedOf: (p, of) => `${n(of)} میں سے ${n(p)} نے کھیلا`,
    open: 'رپورٹ کھولیں',
    empty: 'اس عرصے میں کوئی quiz نہیں بھیجا گیا۔ نیا quiz بنانے کے لیے WhatsApp پر ‎/quiz بھیجیں۔',
  },
};

/**
 * A date in the reader's language. Only its digits are atoms: an Urdu date
 * ("5 اکتوبر") wrapped whole in an LTR isolate reads month-first to an Urdu
 * reader, so the month word stays in the paragraph's own direction.
 */
const dateHtml = (iso, lang) => esc(formatLessonDate(iso, lang)).replace(/\d+/g, (d) => `<span class="trc-n">${d}</span>`);
/** The trend's week label on two short lines (day, then month), so eight fit in 360px. */
function weekLabel(iso, lang) {
  const [day, ...month] = String(formatLessonDate(iso, lang)).split(' ');
  return `<span class="trc-n">${esc(day)}</span><span class="trc-wk-m">${esc(month.join(' '))}</span>`;
}

const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);
const gradeNum = (g) => { const m = String(g || '').match(/\d+/); return m ? Number(m[0]) : 99; };

/** A string from the database: escaped, faced and directed by its own script. */
function dbText(raw, cls) {
  const s = String(raw || '');
  const rtl = dirOf(s) === 'rtl';
  const html = rtl ? wrapLatinRuns(esc(s), LATIN) : esc(s);
  return `<span class="${cls}" dir="${rtl ? 'rtl' : 'ltr'}">${html}</span>`;
}

/**
 * @param {{cells?:Array, weeks?:Array, quizzes?:Array}} data classReport()
 * @param {{language?:'en'|'ur', tokens?:Object<string,string>, base?:string, days?:number}} opts
 * @returns {string} an HTML fragment
 */
function renderClassTab(data, { language = 'en', tokens = {}, base = '', days = 60 } = {}) {
  const lang = clampLanguage(language);
  const C = CHROME[lang] || CHROME.en;
  const rtl = lang === 'ur';
  const L = (s) => (rtl ? wrapLatinRuns(s, LATIN) : s);   // trusted chrome: isolate Latin runs, never re-escape
  const cells = [...((data && data.cells) || [])]
    .sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || String(a.subject || '').localeCompare(String(b.subject || '')));
  const weeks = ((data && data.weeks) || []).slice(-8);
  const quizzes = (data && data.quizzes) || [];
  const subj = (s) => esc(subjectLabel(s, lang) || s || C.otherSubject);

  const head = `<div class="trc-head"><h2 class="trc-h">${L(C.heading)}</h2><div class="trc-span">${L(C.span(days))}</div></div>`;
  if (!quizzes.length && !cells.length) {
    return `<section class="trc">${head}<p class="trc-empty">${L(C.empty)}</p></section>`;
  }

  const totalQ = quizzes.length || cells.reduce((s, c) => s + (c.quizzes || 0), 0);
  const totalP = cells.reduce((s, c) => s + (c.played || 0), 0);
  const totals = `<div class="trc-totals">${L(C.totals(totalQ, totalP))}</div>`;

  const cards = cells.map((c) => `
    <div class="trc-card">
      <div class="trc-card-t">${L(C.classSubject(c.grade || '', subj(c.subject)))}</div>
      <div class="trc-card-avg">${c.played ? `${n(pct(c.avg))} <span class="trc-avg-l">${L(C.average)}</span>` : `<span class="trc-none">${L(C.noOne)}</span>`}</div>
      <div class="trc-card-m">${L(C.quizzesN(c.quizzes || 0))} · ${L(C.playedN(c.played || 0))}</div>
    </div>`).join('');

  const maxPlayed = Math.max(1, ...weeks.map((w) => w.played || 0));
  const bars = weeks.map((w) => {
    const h = Math.round(((w.played || 0) / maxPlayed) * 100);
    const date = formatLessonDate(w.weekStart, lang);   // plain text, for the aria-label
    return `
      <div class="trc-wk" role="img" aria-label="${attr(`${C.weekOf} ${date}: ${w.played || 0} · ${pct(w.avg)}`)}">
        <div class="trc-wk-avg">${w.played ? n(pct(w.avg)) : ''}</div>
        <div class="trc-wk-col"><div class="trc-wk-bar${w.played ? '' : ' trc-wk-zero'}" style="height:${h}%"></div></div>
        <div class="trc-wk-p">${n(w.played || 0)}</div>
        <div class="trc-wk-d">${weekLabel(w.weekStart, lang)}</div>
      </div>`;
  }).join('');
  const trend = weeks.length ? `
    <h3 class="trc-sub">${L(C.trendTitle)}</h3>
    <div class="trc-trend">${bars}</div>
    <div class="trc-key">${L(C.trendKey)}</div>` : '';

  const rows = quizzes.map((q) => {
    const token = tokens[q.id];
    const meta = [dateHtml(q.date, lang), L(C.classSubject(q.grade || '', subj(q.subject)))].join(' · ');
    const score = q.played
      ? `${q.of ? L(C.playedOf(q.played, q.of)) : L(C.playedN(q.played))} · ${n(pct(q.avg))}`
      : `<span class="trc-none">${L(C.noOne)}</span>`;
    const inner = `
        <div class="trc-q-main">${dbText(q.topic, 'trc-q-topic')}<div class="trc-q-meta">${meta}</div></div>
        <div class="trc-q-score">${score}</div>`;
    return token
      ? `<li><a class="trc-q" href="${attr(`${base}${REPORT_PATH}/${encodeURIComponent(token)}`)}" aria-label="${attr(`${C.open}: ${q.topic || ''}`)}">${inner}<span class="trc-go" aria-hidden="true">${rtl ? '‹' : '›'}</span></a></li>`
      : `<li><div class="trc-q">${inner}</div></li>`;
  }).join('');

  return `<section class="trc">
  ${head}
  ${totals}
  ${cards ? `<h3 class="trc-sub">${L(C.cellsTitle)}</h3><div class="trc-cards">${cards}</div>` : ''}
  ${trend}
  ${rows ? `<h3 class="trc-sub">${L(C.listTitle)}</h3><ul class="trc-list">${rows}</ul>` : ''}
</section>`;
}

/** The tab's CSS, for the page's <style>. Fonts come from the page's own stacks. */
function classTabCss(rtl = false) {
  const lead = rtl ? 1.9 : 1.4;
  return `
.trc{display:block;margin:0 0 24px}
.trc .ltr{unicode-bidi:isolate;direction:ltr}
.trc-n{unicode-bidi:isolate;direction:ltr;display:inline-block;font-family:${FONTS.bodyLatin};font-variant-numeric:tabular-nums}
.trc-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}
.trc-h{font-size:22px;line-height:${rtl ? 2 : 1.25};margin:0;color:${PALETTE.ink}}
.trc-span,.trc-key,.trc-totals{color:${PALETTE.muted};font-size:14px;line-height:${lead}}
.trc-totals{margin-top:4px;font-size:15px;color:${PALETTE.ink}}
.trc-sub{font-size:15px;font-weight:700;color:${PALETTE.slate};margin:22px 0 10px;line-height:${lead}}
.trc-empty{margin-top:12px;padding:14px 16px;border-radius:12px;background:#f5f6f8;color:${PALETTE.muted};line-height:${lead}}
.trc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.trc-card{background:${PALETTE.greenWash};border:1px solid #BFE3D0;border-radius:14px;padding:12px 14px;min-width:0}
.trc-card-t{font-weight:700;color:${PALETTE.slate};font-size:15px;line-height:${lead};overflow-wrap:anywhere}
.trc-card-avg{margin-top:4px;font-size:26px;font-weight:700;color:#12603C;line-height:1.3}
.trc-avg-l{font-size:13px;font-weight:400;color:${PALETTE.muted}}
.trc-card-m{margin-top:2px;font-size:13px;color:${PALETTE.muted};line-height:${lead}}
.trc-none{font-size:14px;font-weight:400;color:#7a839c;line-height:${lead};display:inline-block}
.trc-trend{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;align-items:end;direction:ltr;padding:8px 2px 0;border-bottom:1px solid #e3e6ec}
.trc-wk{display:flex;flex-direction:column;align-items:center;min-width:0}
.trc-wk-avg{font-size:11px;font-weight:700;color:${PALETTE.slate};height:18px;line-height:18px;direction:ltr;white-space:nowrap}
.trc-wk-col{height:96px;width:100%;display:flex;align-items:flex-end;justify-content:center}
.trc-wk-bar{width:70%;max-width:28px;min-height:3px;background:${PALETTE.green};border-radius:5px 5px 0 0}
.trc-wk-zero{background:#d9dde4}
.trc-wk-p{font-size:12px;font-weight:700;color:${PALETTE.ink};margin-top:4px;line-height:16px;direction:ltr}
.trc-wk-d{display:flex;flex-direction:column;align-items:center;font-size:11px;color:#7a839c;line-height:1.3}
.trc-wk-m{white-space:nowrap;font-size:${rtl ? 11 : 10.5}px;line-height:${rtl ? 1.9 : 1.3}}
.trc-key{margin-top:6px;font-size:12.5px}
.trc-list{list-style:none;margin:0;padding:0;border-top:1px solid #eef0f6}
.trc-q{display:flex;align-items:center;gap:10px;padding:12px 2px;border-bottom:1px solid #eef0f6;color:inherit;text-decoration:none;min-height:48px}
.trc-q-main{flex:1;min-width:0}
.trc-q-topic{display:block;font-weight:700;color:${PALETTE.ink};font-size:16px;line-height:${lead};overflow-wrap:anywhere}
.trc-q-topic[dir="rtl"]{line-height:1.9}
.trc-q-meta{font-size:13px;color:${PALETTE.muted};line-height:${lead}}
.trc-q-score{flex-shrink:0;max-width:44%;text-align:${rtl ? 'left' : 'right'};font-size:13px;color:${PALETTE.slate};line-height:${lead}}
.trc-go{flex-shrink:0;color:#b7bfd6;font-size:22px;line-height:1;font-family:${FONTS.bodyLatin}}
a.trc-q:active{background:#f5f6f8}
@media print{.trc-go{display:none}.trc-q,.trc-card,.trc-wk{break-inside:avoid;page-break-inside:avoid}}`;
}

module.exports = { renderClassTab, classTabCss, CHROME };
