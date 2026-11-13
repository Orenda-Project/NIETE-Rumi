/**
 * bd-pni007 — the teacher's report for an FDE (obs612) visit: FDE's own result on FDE's own tool, as the coach scored
 * it. generateHeroReport hands an FDE analysis here, so every caller (the observe send preview, the renderer registry)
 * gets this page and never the FICO hero.
 *
 *   enur  the % big, the band (on FDE's 108 scale), "109 of 148 · 79.5 of 108 on FDE's scale", one bar per section (score / max) under FDE's
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
 * host has no system fonts). The chrome is English on every report (as the hero's) and FDE's wording is
 * English as FDE printed it, so the page is an English, LTR page in every language: a report's language is its
 * CONTENT's (skill §7), and an RTL frame around FDE's English rows read right-aligned and backwards (first render,
 * 11 Nov). The coach's own sentences stay as written, each block first-strong (dir="auto", plaintext), with the
 * Nastaliq face in every stack, so an Urdu note renders RTL inside its block. The caption follows the teacher's
 * language (Urdu: DRAFT for native review).
 */

const O = require('../frameworks/obs612');
const { obs612View, num, FDE_FOOTNOTE, FDE_FOOTNOTE_UR, readableNote } = require('../../observe/obs612/view');
const { clampLanguage } = require('../../../config/ux-strings');
const { fontFaces, esc } = require('./hero-report.template');
const { PALETTES } = require('./hero-report.style');

const CHROME = {
  eyebrow: "Classroom observation · FDE's tool",
  sections: 'Section by section',
  indicators: 'Indicator by indicator',
  // Section 7 (13 Nov): FDE's bands are on a 108-point score; the lesson's total is scaled to it.
  formula: (total, max, on108) => `${total} of ${max} · ${on108} of 108 on FDE's scale (score × 108 ÷ ${max})`,
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
  ur: { head: '📋 آپ کی مشاہداتی رپورٹ · ایف ڈی ای کا ٹول', grade: (g) => `جماعت ${String(g).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d)))}` },
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
  const subject = v ? subjectIn(v, vm.language === 'ur' ? 'ur' : 'en') : null;
  const parts = [C.head, v && v.grade ? C.grade(v.grade) : null, subject, vm.date].filter(Boolean);
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
    score = `<div class="hscore"><div class="p num">${esc(`${num(e.pct)}%`)}</div>${e.band ? `<div class="band">${E(e.band)}</div>` : ''}<div class="s num">${esc(C.formula(e.total, e.max, num(e.score_108)))}</div></div>`;
    let lastHead = null;
    const rows = e.sections.map((s) => {
      // FDE prints "Section 2: A. Teacher Practices" (its parts are B-G): shown without the "A." (operator 13 Nov).
      const head = s.section && s.section !== lastHead ? `<div class="sub">${E(String(s.section).replace(/^(Section \d+:)\s*A\.\s*/, '$1 '))}</div>` : '';
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

// ── The FICO teacher report's page, for an FDE visit (bd-ra8xu.51) ──────────────
// Rifat, 13 Nov (pre-approved by the operator): the teacher gets the report we send after a FICO observation, in the
// same format, design and order: the score, the scorecard, then the teacher's strength, the area to improve and one
// focus for the next lesson. Written to the teacher. Built from the coach's FDE scores and own notes only: no model
// writes a word of it, and no FICO journey is drawn (an FDE score is never put beside FICO history). The page is the
// FICO hero template (hero-report.template.js); only its view model is FDE's.

// Our own lines on the page, in the teacher's language (Urdu: DRAFT for native review; Urdu digits).
const HERO = {
  en: {
    affirm: (band) => (band ? `Your lesson, as your coach scored it on FDE's tool: ${band}` : "Your lesson, as your coach scored it on FDE's tool"),
    rating: (on108, band) => `FDE's rating: ${band}, ${on108} of 108 on FDE's scale.`,
    by: (t) => `By: ${t}`,
    noTotal: "FDE's tool gives levels, not a total.",
    yesOf: (yes, of) => `Yes on ${yes} of ${of}`,
    planGoal: (from, to) => `From Level ${from} to Level ${to}.`,
    grade: (g) => `Grade ${g}`,
  },
  ur: {
    affirm: (band) => (band ? `آپ کا سبق، کوچ نے ایف ڈی ای کے ٹول پر جانچا: ${band}` : 'آپ کا سبق، کوچ نے ایف ڈی ای کے ٹول پر جانچا'),
    rating: (on108, band) => `ایف ڈی ای کی درجہ بندی: ${band}، ایف ڈی ای کے پیمانے پر ۱۰۸ میں سے ${urDigitsOf(on108)}۔`,
    by: (t) => `کب تک: ${t}`,
    noTotal: 'ایف ڈی ای کا ٹول درجے دیتا ہے، کل نمبر نہیں۔',
    yesOf: (yes, of) => `${urDigitsOf(of)} میں سے ${urDigitsOf(yes)} ہاں`,
    planGoal: (from, to) => `درجہ ${urDigitsOf(from)} سے درجہ ${urDigitsOf(to)} تک۔`,
    grade: (g) => `جماعت ${urDigitsOf(g)}`,
  },
};
function urDigitsOf(n) { return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d))); }
const pct = (a, b) => (b > 0 ? Math.round((a * 100) / b) : 0);
const joinNote = (...parts) => parts.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean).join(' ');
// A part's name with FDE's own section number, so Section 3's A and Section 4's A cannot be confused on a flat
// scorecard: "3A. Participation", "4D. Writing Skills"; a section that is one block: "5. Assessment & Feedback".
function partName(s) {
  const n = (/^Section (\d+)/.exec(s.section || '') || [])[1];
  if (!n) return s.title;
  const m = /^([A-Z])\.\s*(.*)$/.exec(s.title || '');
  return m ? `${n}${m[1]}. ${m[2]}` : `${n}. ${s.title}`;
}

/** The lesson's subject in the report's language (Urdu: the Urdu name), else as stored. */
function subjectIn(v, lang) {
  const { SUBJECT_LABELS } = require('../../observe/obs612/strings');
  return (SUBJECT_LABELS[lang] || {})[v.subject] || v.subjectLabel || null;
}

/**
 * The FICO hero page's view model for an FDE visit (buildHeroReportHtml). Pure.
 * @param {object} session   coaching_sessions row (created_at)
 * @param {object} analysis  the FDE visit's analysis_data
 * @param {{language?: string, teacherName?: string, brand?: string}} [opts]
 */
function buildObs612HeroVm(session, analysis, opts = {}) {
  const base = buildObs612ReportVm(session, analysis, opts);
  const lang = base.language === 'ur' ? 'ur' : 'en';
  const H = HERO[lang];
  const v = base.view;
  const vm = {
    language: base.language,
    brand: base.brand,
    teacherName: base.teacherName,
    // An ISO date after Urdu words reorders (13-11-2026): isolated left to right on an Urdu page.
    date: lang === 'ur' && base.date ? `\u2066${base.date}\u2069` : base.date,
    topic: v ? [v.grade ? H.grade(v.grade) : null, subjectIn(v, lang)].filter(Boolean).join(' · ') : '',
    score: { overall: null, marks: null, max: null },
    groups: [],
    narrative: {},
    tryNext: '',
    trend: [],
    classroomPhotos: [],
    photoB64: '',
    partialNote: lang === 'ur' ? FDE_FOOTNOTE_UR : FDE_FOOTNOTE,
    breakLongWords: true,
  };
  if (!v) return vm;
  const top = (v.strongest || [])[0] || null;
  const low = (v.lowest || [])[0] || null;
  const fb = v.feedback || {};
  if (v.tool === 'enur') {
    const e = v.enur;
    vm.score = { overall: Math.round(e.pct), marks: e.total, max: e.max };
    vm.groups = e.sections.map((s) => ({ name: partName(s), score: s.score, max: s.max, pct: pct(s.score, s.max) }));
    vm.narrative = {
      affirmation: H.affirm(e.band),
      identity: e.band ? H.rating(num(e.score_108), e.band) : '',
      strength_name: top ? partName(top) : '',
      strength_note: readableNote(fb.strengths || ''),
      horizon_title: low ? partName(low) : '',
      horizon_note: readableNote(fb.areas || ''),
    };
    vm.tryNext = readableNote(joinNote(fb.recommendations, fb.timeline ? H.by(fb.timeline) : ''));
    return vm;
  }
  if (v.tool === 'msci') {
    const m = v.msci;
    vm.groups = m.indicators.map((i) => ({ name: `${i.n}. ${i.short}`, score: i.level === null ? 0 : i.level, max: 3, pct: pct(i.level || 0, 3) }));
    const plan = (v.plan || [])[0] || null;
    const focus = plan ? m.indicators.find((i) => i.key === plan.area) : low;
    vm.narrative = {
      affirmation: H.affirm(null),
      identity: H.noTotal,
      strength_name: top ? `${top.n}. ${top.short}` : '',
      strength_note: readableNote(top ? (top.observation || top.levelText || '') : ''),
      horizon_title: focus ? `${focus.n}. ${focus.short}` : '',
      horizon_note: plan && plan.current !== null && plan.goal !== null ? H.planGoal(plan.current, plan.goal) : (focus ? (focus.observation || '') : ''),
    };
    vm.tryNext = readableNote(plan ? plan.action || '' : '');
    return vm;
  }
  const g = v.gen;
  vm.groups = g.sections.map((s) => ({ name: s.title, score: s.yes, max: s.of, pct: pct(s.yes, s.of) }));
  vm.narrative = {
    affirmation: H.affirm(null),
    identity: H.yesOf(g.yes, g.of),
    strength_name: top ? top.title : '',
    strength_note: '',
    horizon_title: low ? low.title : '',
    horizon_note: low && low.noItems && low.noItems.length ? low.noItems.join('; ') : '',
  };
  vm.tryNext = readableNote(fb.line || '');
  return vm;
}

/**
 * Render the FDE report: { png, caption, narrative: null, partialNote } — the shape generateHeroReport returns.
 * The page is the FICO teacher report's (bd-ra8xu.51); the caption stays FDE's own, in the teacher's language.
 * @param {object} session
 * @param {object} analysis
 * @param {{language?: string, teacherName?: string, brand?: string}} [opts]
 */
async function generateObs612Report(session, analysis, opts = {}) {
  const { htmlToImage } = require('../../../utils/html-to-pdf');
  const { buildHeroReportHtml } = require('./hero-report.template');
  const vm = buildObs612HeroVm(session, analysis, opts);
  const png = await htmlToImage(buildHeroReportHtml(vm), { selector: '.report', width: 794, deviceScaleFactor: 2 });
  return { png, caption: caption(buildObs612ReportVm(session, analysis, opts)), narrative: null, partialNote: vm.partialNote };
}

module.exports = { generateObs612Report, buildObs612ReportVm, buildObs612HeroVm, buildObs612ReportHtml, caption, CHROME, HERO };
