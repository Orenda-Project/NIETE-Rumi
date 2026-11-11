/**
 * bd-pni007 — the teacher's report for an FDE (obs612) visit: FDE's own result on FDE's own tool, as the coach scored
 * it. generateHeroReport hands an FDE analysis here, so every caller (the observe send preview, the renderer registry)
 * gets this page and never the FICO hero.
 *
 *   enur  the % big, the band, "109 of 148 · FDE: score × 100 ÷ 148", one bar per section (score / max) under FDE's
 *         section headings, then Section 8 (Strengths / Areas for Improvement / Recommendations / Timeline)
 *   msci  one row per indicator "<n> · <short name>   Level N" with FDE's full wording and the level's descriptor below,
 *         "5 students checked: 3-4 of 5 understood", the development plan "<area>: Level 0 → Level 1. <action>",
 *         and "FDE gives no total for this tool." (no total is made)
 *   gen   "<Section>   x of n Yes" per section (a pip per item), what was not seen, the coach's feedback line; no score
 *   all   footer "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score." and the label "FDE v1"
 *
 * No model call (the coach scored every item and wrote every sentence), no FICO score bars, no journey line: the
 * teacher's FICO history is never drawn beside an FDE result. Data comes from observe/obs612/view.js.
 *
 * Language (playwrite-reports skill): fonts are the hero's base64 faces (Lexend, Fraunces, Nastaliq, Naskh; the render
 * host has no system fonts). The chrome is English on every report (FEAT-106, as the hero's) and FDE's wording is
 * English as FDE printed it, so the page is an English, LTR page in every language: a report's language is its
 * CONTENT's (skill §7), and an RTL frame around FDE's English rows read right-aligned and backwards (first render,
 * 11 Nov). The coach's own sentences stay as written, each block first-strong (dir="auto", plaintext), with the
 * Nastaliq face in every stack, so an Urdu note renders RTL inside its block. The caption follows the teacher's
 * language (Urdu: DRAFT for native review).
 */

const O = require('../frameworks/obs612');
const { obs612View, num, FDE_FOOTNOTE } = require('../../observe/obs612/view');
const { clampLanguage } = require('../../../config/ux-strings');
const { fontFaces, esc } = require('./hero-report.template');
const { PALETTES } = require('./hero-report.style');

const CHROME = {
  eyebrow: "Classroom observation · FDE's tool",
  sections: 'Section by section',
  indicators: 'Indicator by indicator',
  formula: (total, max) => `${total} of ${max} · FDE: score × 100 ÷ ${max}`,
  yesOn: (yes, of) => `Yes on ${yes} of ${of}`,
  genNoScore: 'FDE gives no score for this form.',
  noTotal: 'FDE gives no total for this tool.',
  yesOf: (s) => `${s.yes} of ${s.of} Yes`,
  notSeen: 'Not seen this lesson',
  coachNoted: 'Your coach noted',
  plan: 'Development plan',
  section8: 'Feedback from your coach',
  feedback: "Your coach's feedback",
  missing: 'The details of this observation could not be shown.',
  footNote: FDE_FOOTNOTE,
  grade: (g) => `Grade ${g}`,
  level: (l) => `Level ${l}`,
};

// The caption that rides with the image, in the teacher's language (Urdu: DRAFT for native review).
const CAPTION = {
  en: { head: '📋 Your observation report · FDE\'s tool', grade: (g) => `Grade ${g}` },
  ur: { head: '📋 آپ کی مشاہداتی رپورٹ · ایف ڈی ای کا ٹول', grade: (g) => `جماعت ${g}` },
};

const ASSET = (p) => {
  try { return require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', p)).toString('base64'); } catch { return ''; }
};
let _logos = null;
const logos = () => {
  if (!_logos) _logos = { white: ASSET('assets/niete-mark-ondark.png'), navy: ASSET('assets/niete-mark-onlight.png') };
  return _logos;
};

/**
 * The page's view model. Pure.
 * @param {object} session   coaching_sessions row (created_at)
 * @param {object} analysis  the FDE visit's analysis_data
 * @param {{language?: string, teacherName?: string, brand?: string}} [opts]
 */
function buildObs612ReportVm(session, analysis, opts = {}) {
  const view = obs612View(analysis);
  const a = analysis || {};
  const id = view ? view.rubricId : [a.rubric, a.framework, a.scores && a.scores.rubric].find((x) => O.isObs612Id(x)) || null;
  const tool = O.toolOf(id);
  return {
    language: clampLanguage(opts.language),
    brand: opts.brand || 'niete',
    teacherName: String(opts.teacherName || '').trim(),
    date: String((session && session.created_at) || (view && view.submittedAt) || '').slice(0, 10),
    tool,
    toolName: tool ? O.SHORT.tools[tool] : 'FDE',
    toolTitle: view ? view.toolTitle : (tool ? O.SHORT.tools[tool] : 'FDE'),
    label: O.LABEL,
    view,
  };
}

function caption(vm) {
  const C = CAPTION[vm.language] || CAPTION.en;
  const v = vm.view;
  const parts = [C.head, v && v.grade ? C.grade(v.grade) : null, v && v.subjectLabel, vm.date].filter(Boolean);
  return parts.join(' · ');
}

const barColor = (pct, P) => (pct >= 80 ? P.barHigh : pct >= 50 ? '#e0a52e' : '#dd7a5c');

/**
 * The page as HTML for the image renderer (selector '.report', width 794).
 * @param {object} vm  buildObs612ReportVm()
 */
function buildObs612ReportHtml(vm) {
  const P = PALETTES[vm.brand] || PALETTES.niete;
  const NON_LATIN = `'NastaliqUrdu','NaskhArabic'`;
  const bodyFam = `'Lexend',${NON_LATIN},sans-serif`;
  const headFam = `'Fraunces',${NON_LATIN},serif`;
  const C = CHROME;
  const v = vm.view;
  const E = esc;
  // The coach's own sentences: first-strong, in whatever language they were written.
  const own = (s) => `<div class="own" dir="auto">${esc(s)}</div>`;
  const logo = (b64, cls) => (b64 ? `<img class="${cls}" src="data:image/png;base64,${b64}" alt="NIETE">` : '');

  let score = '';
  let body = '';
  if (!v) {
    body = `<div class="block"><div class="nt">${E(C.missing)}</div></div>`;
  } else if (v.tool === 'enur') {
    const e = v.enur;
    score = `<div class="hscore"><div class="p num">${esc(`${num(e.pct)}%`)}</div>${e.band ? `<div class="band">${E(e.band)}</div>` : ''}<div class="s num">${esc(C.formula(e.total, e.max))}</div></div>`;
    let lastHead = null;
    const rows = e.sections.map((s) => {
      const head = s.section && s.section !== lastHead ? `<div class="sub">${E(s.section)}</div>` : '';
      lastHead = s.section;
      return `${head}<div class="sc-row"><div class="sc-h"><span class="sc-n">${E(s.title)}</span><span class="sc-s num">${esc(`${s.score}/${s.max}`)}</span></div>`
        + `<div class="pbar"><div class="pfill" style="width:${Math.max(0, Math.min(100, s.pct || 0))}%;background:${barColor(s.pct || 0, P)}"></div></div></div>`;
    }).join('');
    const fb = O.TOOLS.enur.feedback.filter((f) => v.feedback[f.key])
      .map((f) => `<div class="fb"><div class="pill">${E(f.label)}</div>${own(v.feedback[f.key])}</div>`).join('');
    body = `<div class="block"><div class="label">${E(C.sections)}</div>${rows}</div>`
      + (fb ? `<div class="block"><div class="label">${E(C.section8)}</div><div class="fbs">${fb}</div></div>` : '');
  } else if (v.tool === 'gen') {
    const g = v.gen;
    score = `<div class="hscore"><div class="p num">${esc(String(g.yes))}<span class="of">${esc(` of ${g.of}`)}</span></div><div class="s num">${esc(C.yesOn(g.yes, g.of))}</div><div class="s">${E(C.genNoScore)}</div></div>`;
    const rows = g.sections.map((s) => {
      const pips = Array.from({ length: s.of }, (_, i) => `<i class="pip${i < s.yes ? ' on' : ''}"></i>`).join('');
      const no = s.noItems.length ? `<div class="nos">${E(`${C.notSeen}: ${s.noItems.map((t) => String(t).replace(/[.\s]+$/, '')).join('; ')}`)}</div>` : '';
      return `<div class="sc-row"><div class="sc-h"><span class="sc-n">${E(s.title)}</span><span class="sc-s num">${esc(C.yesOf(s))}</span></div><div class="pips">${pips}</div>${no}</div>`;
    }).join('');
    body = `<div class="block"><div class="label">${E(C.sections)}</div>${rows}</div>`
      + (v.feedback.line ? `<div class="block"><div class="label">${E(C.feedback)}</div><div class="fb">${own(v.feedback.line)}</div></div>` : '');
  } else {
    const m = v.msci;
    score = `<div class="hscore"><div class="s nt-h">${E(C.noTotal)}</div></div>`;
    let lastStage = null;
    const rows = m.indicators.map((i) => {
      const head = i.stage !== lastStage ? `<div class="sub">${E(i.stage)}</div>` : '';
      lastStage = i.stage;
      const pips = [1, 2, 3].map((n) => `<i class="pip${i.level !== null && n <= i.level ? ' on' : ''}"></i>`).join('');
      return `${head}<div class="ind"><div class="sc-h"><span class="sc-n">${E(`${i.n} · ${i.short}`)}</span><span class="lv"><span class="pips">${pips}</span><span class="sc-s num">${esc(i.level === null ? '—' : C.level(i.level))}</span></span></div>`
        + `<div class="full">${E(i.text)}</div>`
        + (i.levelText ? `<div class="full">${E(`${C.level(i.level)}: ${i.levelText}`)}</div>` : '')
        + (i.observation ? `<div class="noted"><span class="nl">${E(`${C.coachNoted}:`)}</span>${own(i.observation)}</div>` : '')
        + '</div>';
    }).join('');
    const st = m.students.level === null ? ''
      : `<div class="block"><div class="ind"><div class="sc-h"><span class="sc-n">${E(`${O.SHORT.msci.students}: ${m.students.short}`)}</span><span class="sc-s num">${esc(C.level(m.students.level))}</span></div><div class="full">${E(m.students.text)}</div></div></div>`;
    const plan = v.plan.map((p) => {
      const move = [p.current === null ? null : C.level(p.current), p.goal === null ? null : C.level(p.goal)].filter(Boolean).join(' → ');
      return `<div class="fb"><div class="pl">${E(`${p.short}${move ? `: ${move}` : ''}${p.action ? '.' : ''}`)}</div>${p.action ? own(p.action) : ''}</div>`;
    }).join('');
    body = `<div class="block"><div class="label">${E(C.indicators)}</div>${rows}</div>${st}`
      + (plan ? `<div class="block"><div class="label">${E(C.plan)}</div><div class="fbs">${plan}</div></div>` : '');
  }

  // One LTR element per part (a name, "Grade 7", a subject, a date), so none of them reorders inside an RTL line.
  const who = [
    vm.teacherName ? `<b dir="auto">${esc(vm.teacherName)}</b>` : null,
    v && v.grade ? E(C.grade(v.grade)) : null,
    v && v.subjectLabel ? E(v.subjectLabel) : null,
    vm.date ? `<span class="num">${esc(vm.date)}</span>` : null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  return `<!doctype html><html dir="ltr" lang="en"><head><meta charset="utf-8"><style>${fontFaces()}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:${P.pageBg}}
  .report{width:794px;background:#fff;font-family:${bodyFam};color:${P.text}}
  .num{unicode-bidi:isolate;direction:ltr}
  .hero{background:${P.deep};color:#fff;padding:26px 42px 28px}
  .hrow{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}
  .eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${P.eyebrow};font-weight:700;margin-top:6px}
  .logo{width:58px;display:block}
  .headline{display:flex;align-items:flex-start;justify-content:space-between;gap:28px}
  .ht{flex:1}
  .hero h1{font-family:${headFam};font-size:25px;line-height:1.25;font-weight:600}
  .who{margin-top:12px;font-size:14px;color:${P.who}}.who b{color:#fff}
  .hscore{flex-shrink:0;max-width:250px;text-align:right;line-height:1.15}
  .hscore .p{font-family:'Lexend';font-weight:700;font-size:46px;letter-spacing:-.02em}
  .hscore .p .of{font-size:20px;font-weight:600;color:${P.scoreSub};letter-spacing:0}
  .hscore .band{display:inline-block;margin-top:6px;background:${P.barHigh};color:#fff;font-weight:700;font-size:13px;padding:3px 12px;border-radius:14px}
  .hscore .s{display:block;font-size:12px;color:${P.scoreSub};margin-top:7px}
  .hscore .nt-h{font-size:14px;color:${P.who};margin-top:6px}
  .block{padding:18px 42px 0}
  .label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${P.deep};opacity:.6;font-weight:700;margin-bottom:10px}
  .sub{font-size:12px;font-weight:700;color:${P.deep};margin:12px 0 7px;padding-bottom:4px;border-bottom:1px solid ${P.footBorder}}
  .sc-row{margin-bottom:10px}
  .sc-h{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:5px}
  .sc-n{font-size:13px;font-weight:700;color:${P.mid}}
  .sc-s{font-family:'Lexend';font-size:13px;font-weight:700;color:${P.deep};white-space:nowrap}
  .pbar{height:8px;border-radius:5px;background:${P.barBg};overflow:hidden}.pfill{height:100%;border-radius:5px}
  .pips{display:inline-flex;gap:4px;flex-wrap:wrap;vertical-align:middle}
  .pip{display:inline-block;width:12px;height:12px;border-radius:3px;background:${P.barBg}}
  .pip.on{background:${P.barHigh}}
  .lv{display:inline-flex;align-items:center;gap:10px;white-space:nowrap}
  .ind{padding:8px 0 9px;border-bottom:1px solid ${P.footBorder}}
  .full{font-size:11.5px;color:${P.quiet};line-height:1.45;margin-top:3px}
  .noted{font-size:12px;color:${P.note};margin-top:5px;line-height:1.45}.noted .nl{font-weight:700;color:${P.mid}}
  .noted .own{font-size:12px;margin-top:2px}
  .nos{font-size:11.5px;color:${P.quiet};margin-top:5px;line-height:1.45}
  .fbs{display:flex;flex-direction:column;gap:10px}
  .fb{background:${P.momentBg};border-radius:12px;padding:12px 16px}
  .fb .pill{display:inline-block;font-size:11px;font-weight:700;padding:3px 11px;border-radius:14px;margin-bottom:6px;background:${P.pillStrengthBg};color:${P.pillStrengthText}}
  .fb .pl{font-size:13px;font-weight:700;color:${P.mid};margin-bottom:4px}
  /* The coach's own words: any language, so the Nastaliq face is in the stack and the line height fits it. */
  .own{font-size:13.5px;line-height:1.9;color:${P.ink};unicode-bidi:plaintext}
  .nt{font-size:13px;color:${P.note}}
  .foot{margin-top:20px;padding:14px 42px 20px;border-top:1px solid ${P.footBorder};color:${P.note};font-size:12px}
  .fnote{line-height:1.5}
  .frow{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
  .tag{font-family:'Lexend';font-size:9.5px;letter-spacing:.06em;color:${P.faint}}
  .brand{display:flex;align-items:center;gap:8px;font-weight:700;color:${P.deep};font-size:14px;font-family:'Lexend'}.brand img{width:26px}
  </style></head><body>
  <div class="report">
    <div class="hero">
      <div class="hrow"><div class="eyebrow">${E(C.eyebrow)}</div>${logo(logos().white, 'logo')}</div>
      <div class="headline">
        <div class="ht"><h1>${E(vm.toolTitle)}</h1>${who ? `<div class="who">${who}</div>` : ''}</div>
        ${score}
      </div>
    </div>
    ${body}
    <div class="foot">
      <div class="fnote">${E(C.footNote)}</div>
      <div class="frow"><span class="tag">${E(vm.label)}</span><span class="brand">${logo(logos().navy, '')}NIETE</span></div>
    </div>
  </div>
  </body></html>`;
}

/**
 * Render the FDE report: { png, caption, narrative: null, partialNote: null } — the shape generateHeroReport returns.
 * @param {object} session
 * @param {object} analysis
 * @param {{language?: string, teacherName?: string, brand?: string}} [opts]
 */
async function generateObs612Report(session, analysis, opts = {}) {
  const { htmlToImage } = require('../../../utils/html-to-pdf');
  const vm = buildObs612ReportVm(session, analysis, opts);
  const png = await htmlToImage(buildObs612ReportHtml(vm), { selector: '.report', width: 794, deviceScaleFactor: 2 });
  return { png, caption: caption(vm), narrative: null, partialNote: null };
}

module.exports = { generateObs612Report, buildObs612ReportVm, buildObs612ReportHtml, caption, CHROME };
