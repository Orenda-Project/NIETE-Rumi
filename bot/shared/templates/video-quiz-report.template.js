'use strict';
/**
 * Video-quiz class report — bd-2335, redesigned bd-2473.
 *
 * The teacher's copy of "how did my class do, and what do I do about it".
 * v2 (bd-2473) adopts the coaching hero-report visual system (navy hero,
 * Fraunces/Lexend, jewel-tone cards, gold accents — see
 * shared/services/coaching/report-v2/hero-report.template.js) instead of the
 * v1 flat white layout, so the report family reads as one product. Approved
 * mockup, built against real data (Razia / GPS Jhanda Chichi, Rawalpindi):
 * "06_Logs & Misc/Reports/Active/Video Quizzes - Jul 2026/report-redesign/".
 *
 * The ordering is still the argument, unchanged from v1: what to reteach
 * comes FIRST, above the roster. A report that opens with a ranked list of
 * children invites her to read it as a league table; one that opens with
 * "these three questions, this wrong answer, here is why" invites her to
 * change tomorrow's lesson. Scores are underneath, because she does still
 * need them.
 *
 * Function signature is UNCHANGED from v1 — video-quiz-report.service.js's
 * call site does not need to change.
 */

const fs = require('fs');
const path = require('path');

let _assets = null;

function readBase64(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch { return ''; }
}

function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      fraunces: readBase64('fonts/Fraunces-Regular.ttf'),
      frauncesSemi: readBase64('fonts/Fraunces-SemiBold.ttf'),
      // NIETE branding (2026-08-04): black-on-transparent N/ن monogram from
      // the niete-brand skill, for the light-background footer lockup.
      nieteMark: readBase64('assets/niete-mark-black-transparent.png'),
    };
  }
  return _assets;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Progress-bar band, matching the coaching hero-report's domain-bar palette. */
function band(pct) {
  if (pct >= 80) return 'band-strong';
  if (pct >= 60) return 'band-mid';
  return 'band-low';
}

function renderVideoQuizReportHtml(d) {
  const a = assets();
  const {
    topic = 'Video quiz', teacherName = '', grade = '',
    started = 0, finished = 0, average = 0,
    students = [], hardest = [], guidance = null, unfinished = [],
    generatedAt = '',
  } = d || {};

  const missedCards = hardest.map((h, i) => {
    const chose = h.top_wrong_text ? `
      <div class="chose"><span class="lbl">Most chose</span>
        <span class="wrongpill">${esc(h.top_wrong_text)}</span>
        <span class="arrow">&rarr;</span>
        <span class="lbl">correct answer</span>
        <span class="rightpill">${esc(h.correct_text || '')}</span></div>` : '';
    const why = h.misconception ? `
      <div class="why"><b>Explanation:</b> ${esc(h.misconception)}</div>` : '';
    return `
      <div class="moment">
        <div class="mhead"><div class="num">${i + 1}</div><div class="m-q">${esc(h.question_text)}</div></div>
        <div class="mstat">${h.wrong} of ${h.total} got this wrong</div>
        ${chose}${why}
      </div>`;
  }).join('');

  const rosterRows = students.map((s) => {
    const pct = s.mastery_percentage || 0;
    return `
      <div class="r-row">
        <div class="r-name">${esc(s.student_name || 'Unnamed')}<div class="cls">${s.student_class ? `Grade ${esc(s.student_class)}` : ''}</div></div>
        <div class="pbar"><div class="pfill ${band(pct)}" style="width:${pct}%"></div></div>
        <div class="r-score">${s.correct_answers || 0}/${s.total_questions_answered || 0} &middot; ${pct}%</div>
      </div>`;
  }).join('');

  const brandMarkImg = a.nieteMark
    ? `<img class="mark" src="data:image/png;base64,${a.nieteMark}" alt="NIETE">` : '';

  const notFinished = unfinished.length ? `
    <div class="unfin"><b>Not finished yet:</b> ${esc(unfinished.join(', '))}</div>` : '';

  const guidanceBlock = guidance ? `
    <div class="try">
      <div class="label">For tomorrow</div>
      <div class="try-text">${esc(guidance)}</div>
    </div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend}) format('truetype')}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${a.lexendBold}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:400;src:url(data:font/ttf;base64,${a.fraunces}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:600;src:url(data:font/ttf;base64,${a.frauncesSemi}) format('truetype')}
body{background:#eef1f7;font-family:'Lexend',sans-serif}
.report{width:794px;margin:0 auto;background:#fff;color:#1c2438}

.hero{position:relative;min-height:230px;overflow:hidden;background:#0c1a4e;padding:30px 42px 26px}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,26,78,.5),rgba(12,26,78,.45) 45%,rgba(12,26,78,.92))}
.hero>*{position:relative;z-index:1}
.eyebrow{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9db0ff;font-weight:700}
.herotop{display:flex;justify-content:space-between;align-items:flex-start;margin-top:10px}
.hero h1{font-family:'Fraunces',serif;font-size:26px;line-height:1.2;font-weight:600;color:#fff;max-width:490px}
.hscore{text-align:right;flex-shrink:0;margin-left:20px}
.hscore .p{font-family:'Lexend';font-weight:700;font-size:46px;color:#fff;letter-spacing:-.02em;line-height:1}
.hscore .s{font-size:11.5px;color:#bcc8ff;margin-top:5px;letter-spacing:.05em;text-transform:uppercase}
.who{margin-top:16px;font-size:14px;color:#dfe5ff}
.who b{color:#fff}
.statrow{display:flex;gap:10px;margin-top:18px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:9px 14px}
.stchip .n{font-family:'Lexend';font-weight:700;font-size:19px;color:#fff}
.stchip .l{font-size:10.5px;color:#9db0ff;text-transform:uppercase;letter-spacing:.08em;margin-top:1px}

.body{padding:26px 42px 6px}
.label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#0c1a4e;opacity:.55;font-weight:700;margin-bottom:14px}

.moment{background:#f7f9ff;border-radius:14px;padding:16px 18px;margin-bottom:12px}
.mhead{display:flex;gap:10px;align-items:flex-start}
.num{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#0c1a4e;color:#fff;font-size:12px;font-weight:700;
     display:flex;align-items:center;justify-content:center;font-family:'Lexend'}
.m-q{font-family:'Fraunces',serif;font-size:16px;line-height:1.4;color:#26304d;font-weight:600}
.mstat{font-size:12px;color:#6a748f;margin:8px 0 10px 34px}
.chose{margin-left:34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}
.lbl{color:#6a748f}
.wrongpill{background:#fff4d6;color:#9a6b00;font-weight:700;padding:3px 10px;border-radius:12px}
.rightpill{background:#e2f6ea;color:#0f7a3d;font-weight:700;padding:3px 10px;border-radius:12px}
.arrow{color:#b7bfd6}
.why{margin:8px 0 0 34px;font-size:12px;line-height:1.5;color:#374151;background:#fff;border-radius:8px;padding:8px 10px}

.roster{margin-top:22px}
.r-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #eef0f6}
.r-row:last-child{border-bottom:none}
.r-name{width:190px;font-size:13.5px;font-weight:600;color:#26304d}
.r-name .cls{font-weight:400;color:#8a93ad;font-size:11.5px}
.pbar{flex:1;height:8px;border-radius:5px;background:#e7ebf3;overflow:hidden}
.pfill{height:100%;border-radius:5px}
.r-score{width:110px;text-align:right;font-family:'Lexend';font-weight:700;font-size:13px;color:#0c1a4e}
.band-strong{background:#3aa775}.band-mid{background:#e0a52e}.band-low{background:#dd7a5c}

.unfin{margin-top:16px;background:#faf9f7;border:1px dashed #e2e0d8;border-radius:10px;padding:12px 16px;font-size:12.5px;color:#7a7360}
.unfin b{color:#4a4636}

.try{margin:24px 42px 0;background:linear-gradient(135deg,#0c1a4e,#1b2f7a);color:#fff;border-radius:16px;padding:20px 24px}
.try .label{color:#9db0ff;opacity:1;margin-bottom:7px}
.try-text{font-family:'Fraunces',serif;font-size:16.5px;line-height:1.5}

.foot{display:flex;align-items:center;justify-content:space-between;padding:20px 42px 28px;margin-top:20px;border-top:1px solid #eef0f6;color:#8a93ad;font-size:12px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#0c1a4e;font-size:14px;font-family:'Lexend'}
.brand .mark{width:20px;height:20px;object-fit:contain;display:block}
</style></head><body>
<div class="report">

  <div class="hero">
    <div class="eyebrow">Class quiz results</div>
    <div class="herotop">
      <h1>${esc(topic)}</h1>
      <div class="hscore"><div class="p">${average}%</div><div class="s">Class average</div></div>
    </div>
    <div class="who">${teacherName ? `For <b>${esc(teacherName)}</b>` : 'Class results'}${grade ? ` &middot; Grade ${esc(grade)}` : ''}</div>
    <div class="statrow">
      <div class="stchip"><div class="n">${started}</div><div class="l">Started</div></div>
      <div class="stchip"><div class="n">${finished}</div><div class="l">Finished</div></div>
      <div class="stchip"><div class="n">${hardest.length}</div><div class="l">Worth reteaching</div></div>
    </div>
  </div>

  <div class="body">
    ${hardest.length ? `<div class="label">Worth reteaching &mdash; most missed</div>${missedCards}` : ''}

    ${students.length ? `<div class="roster">
      <div class="label">How each student did</div>
      ${rosterRows}
    </div>` : ''}

    ${notFinished}
  </div>

  ${guidanceBlock}

  <div class="foot">
    <div class="brand">${brandMarkImg}NIETE</div>
    <div>${esc(generatedAt)}</div>
  </div>

</div>
</body></html>`;
}

module.exports = renderVideoQuizReportHtml;
