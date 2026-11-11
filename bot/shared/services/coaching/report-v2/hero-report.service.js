/**
 * Coaching Report v2 — Hero report service.
 *
 * Orchestrates the unified celebration renderer for a completed session:
 *   score adapter → narrative pass → (caller-supplied commitment action) → trend →
 *   hero template → htmlToImage → { png, caption }.
 *
 * The report's "one thing to try next" is the commitment-card action passed in
 * by the caller (single source of next-step truth).
 */

const { buildScoreViewModel } = require('./score-adapter.service');
const { generateReportNarrative } = require('./narrative.service');
const { buildHeroReportHtml, buildReportCaption } = require('./hero-report.template');
const { buildSlimCardHtml } = require('./slim-card.template');
const { cardHeader, wells } = require('../report-card');
const { practiceWhy } = require('../practice-why');
const { buildClassroomPhotoVm, excludedPhotoNumbers } = require('./classroom-photo-vm');
const { applyPhotoCaptions } = require('./photo-note');
const { resolveReportLanguage } = require('./report-language');
const { loadTrendData } = require('../coaching-trend.service');
const { resolveTarget } = require('../target-resolver');
const { observe2Target, pinObserve2Horizon } = require('./observe2-horizon');
const { buildPartialNote } = require('../report-transformers/_shared');
const { isV6Scored } = require('../frameworks/fico17-v6/stamp');

/**
 * The partial-report note ("based on classroom audio analysis only…"). At delivery the session carries the
 * job's flags (report-generator sets _isPartialReport & co.); on a re-render (hero-text, the app's report
 * page) only the stored copy exists — report-generator persists it beside the narrative. The hero image
 * showed none until bd-1r3k2h: the note was built for the PDFKit transformers only.
 */
function heroPartialNote(session, analysis) {
  const s = session || {};
  if (s._isPartialReport && !s._suppressPartialBanner) return buildPartialNote(s) || null;
  const stored = analysis && analysis.partial_report_note;
  return typeof stored === 'string' && stored.trim() ? stored : null;
}
const { resolveUx } = require('../../../config/ux-strings');
const { downloadFromR2, extractKeyFromUrl } = require('../../../storage/r2');
const { htmlToImage } = require('../../../utils/html-to-pdf');
const { logToFile } = require('../../../utils/logger');

/**
 * bd-1t1wz (ports the main bot's bd-43483): attach the per-domain one-line
 * "why" diagnosis onto each scorecard row. Groups key by domainKey (the
 * canonical snake_case domain key); a group without a matching why simply
 * renders no line. Exported as a pure helper so it is unit-testable without
 * this service's R2/sharp/LLM dependency graph (same split rationale as
 * report-language.js).
 */
function attachDomainWhys(groups, domainWhys) {
  if (!domainWhys || typeof domainWhys !== 'object') return groups;
  for (const g of (groups || [])) {
    // A not-assessed section already carries a why line written in code. The model
    // must not be able to replace it: it is under a prompt that requires it to name
    // one concrete missing element, and for a section that was never measured any
    // sentence it produces is invented. The same holds for a lesson-mismatch Section B
    // (bd-5lrgh): its line is the catalogue sentence and nothing else.
    if (g.notAssessed || g.lessonMismatch) continue;
    const why = domainWhys[g.domainKey || g.key];
    if (why) g.why = why;
  }
  return groups;
}

/**
 * bd-5lrgh: the header's lesson topic. `analysis.topic` is the selected plan's topic, so
 * on a lesson mismatch it names a lesson she did not teach — only the narrative's topic
 * (read from the transcript) may head that report. Everywhere else: unchanged.
 */
function heroTopic(narrative, analysis) {
  if (narrative && narrative.topic) return narrative.topic;
  const { isLessonMismatch } = require('./score-adapters/fico-adapter');
  if (isLessonMismatch(analysis)) return '';
  return (analysis && analysis.topic) || '';
}

// bd-z3cadk: the "Last time we asked" wording lives in uptake-line.js, so the portal's report page can build the
// same block from what was stored without loading this renderer.
const { buildUptakeVm, tallyInWords } = require('./uptake-line');

/**
 * Say why the subject-specific Section F row is absent.
 *
 * About three in ten recordings carry no signal at all about which subject was being
 * taught. The subject-tagged rubric row is then correctly left out — and until now the
 * page said nothing, so the teacher saw a Section F built from five indicators with no
 * account of the sixth. Worse, when the model guessed, she was told in writing that her
 * Urdu lesson was not a literacy lesson.
 *
 * Appended to the Section F row's existing "why" rather than replacing it, so the
 * narrative's own diagnosis survives. Idempotent, and a no-op on any analysis that
 * resolved a subject or predates `subject_resolution` entirely.
 *
 * Pure helper for the same reason attachDomainWhys is one: unit-testable without this
 * service's R2/sharp/LLM dependency graph.
 */
function attachSubjectNote(groups, analysis, language) {
  const resolution = analysis && analysis.subject_resolution;
  if (!resolution || resolution.confidence !== 'none') return groups;
  const { subjectUnconfirmedNote } = require('./narrative.service');
  const note = subjectUnconfirmedNote(language);
  for (const g of (groups || [])) {
    if (!g || (g.domainKey || g.key) !== 'teacher_subject_knowledge') continue;
    const existing = typeof g.why === 'string' ? g.why.trim() : '';
    if (existing.includes(note)) continue;
    g.why = existing ? `${existing} ${note}` : note;
  }
  return groups;
}

// FICO6 r2 (spec §9.3, CONTRACTS §11.5): the v6 report lines, read from the /observe2 strings with this English
// until a language lacks them.
const V6_REPORT_IE = "The recording didn't cover this part of the lesson.";
const V6_REPORT_BROKEN = "The recording couldn't be used, so this report has no levels from it.";
const V6_RUBRIC_SECTIONS = new Set(['high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']);

/**
 * The scorecard of an /observe2 visit scored on FICO17 v6, as spec §9.3 has the teacher read it. The rules lived
 * only in fico-report-transformer.js, which never reaches the image (redteam T4.3, T4.4):
 * - an IE row is said once, by its v6 name, as the one line, on its section's row; an NA row is not named;
 * - a broken recording, or a report held for a missing coach level (v6_fallback only), draws no rubric bar:
 *   the C, D and F rows read "not assessed"; a broken one says why once, in the note under the report.
 * Runs after the narrative's why lines, so the model cannot replace these. Mutates `groups`.
 *
 * @returns {null|{note: (string|null)}} null for any other analysis (v5, V3, /observe v6): nothing changed.
 */
function v6HeroRows(groups, analysis, language) {
  const o2 = (analysis && analysis.observe2) || {};
  if (o2.rubric !== 'fico17_v6') return null;
  const V6 = require('../frameworks/fico17-v6');
  const { observe2Strings } = require('../../observe/observe2/strings');
  const { notAssessedWords } = require('./score-adapters/fico-adapter');
  const S = observe2Strings(language);
  const finals = o2.final_levels || {};
  const broken = (o2.transcript_quality || {}).status === 'broken';
  const held = V6.COMBINED_CODES.some((c) => !/^([1-4]|NA|IE)$/.test(String(finals[c] == null ? '' : finals[c])));
  for (const g of (groups || [])) {
    const key = g && (g.domainKey || g.key);
    if (!V6_RUBRIC_SECTIONS.has(key)) continue;
    if (broken || held) {
      Object.assign(g, { score: null, max: null, pct: null, notAssessed: true, notAssessedWords: notAssessedWords(language) });
      delete g.why;
      continue;
    }
    const gaps = (((analysis.domains || {})[key] || {}).indicators || [])
      .filter((ind) => ind && String(finals[ind.id]) === 'IE')
      .map((ind) => `${ind.name}: ${S.v6_report_ie || V6_REPORT_IE}`);
    if (!gaps.length) continue;
    const existing = typeof g.why === 'string' ? g.why.trim() : '';
    g.why = [existing, ...gaps].filter(Boolean).join(' ');
  }
  return { note: broken ? (S.v6_report_broken || V6_REPORT_BROKEN) : null };
}

/**
 * @param {object} session - coaching_sessions row (transcript_text, user_id, created_at, classroom_photos)
 * @param {object} analysis - enhancedAnalysis (framework, scores, domains, reflective_corpus, …)
 * @param {object} opts - { teacherName, commitmentAction, language, brand, target, requireNarrative }
 *   `requireNarrative` (bd-trksw9): reject with code NARRATIVE_UNAVAILABLE instead of
 *   rendering when the narrative pass failed twice. Off by default.
 *   `target` is the ONE indicator this report is about (target-resolver). When the
 *   caller does not supply it, it is resolved from the analysis here so the
 *   observe path and the coaching pipeline name the same horizon.
 *   `brand` selects the template palette ('niete' for the FICO/NIETE path,
 *   injected by renderer-registry; omitted = default palette). bd-2452.
 * @returns {Promise<{png:Buffer, caption:string, narrative:(object|null)}>}
 */
async function generateHeroReport(session, analysis, opts = {}) {
  const { teacherName = 'Teacher', commitmentAction = '', brand } = opts;
  // bd-gipr1 — this used to be `language || analysis.language ||
  // session.transcript_language || 'en'`, which let an STT label choose both the
  // template's script branch and the language the narrative LLM writes in.
  // transcript_language has been 'hindi'/'javanese'/'sindhi' on prod (bd-bfy69).
  // resolveReportLanguage() only ever returns a language we actually offer.
  const lang = resolveReportLanguage(opts, analysis, session);
  const framework = (analysis.framework || 'oecd').toLowerCase();

  const score = buildScoreViewModel(analysis, { framework, language: lang });

  // Cross-framework journey trend. Non-fatal if it fails: a freshly-cloned bot
  // with no coaching_sessions yet will return [] and the template renders the
  // hero without the sparkline. Exclude the current session so if it's already
  // marked completed by the time this runs, we don't double-count today.
  let trend = [];
  // bd-ra8xu.39: a FICO17 v6 report shows no journey line. The teacher's earlier sessions are V3 percentages, and a
  // v6 score drawn on the same line would mix two rubrics (operator, 11 Nov: never mixed). The stamp, not the
  // framework: an /observe2 v6 visit is framework 'fico' (redteam T7.D6).
  if (!isV6Scored(analysis)) try {
    const raw = await loadTrendData(session.user_id, { limit: 12, locale: 'en', excludeSessionId: session.id });
    trend = raw
      .map((t) => ({ date: String(t.date || '').slice(0, 10), pct: Math.round(parseFloat(t.pct || 0)) }))
      .filter((t) => t.pct > 0);
  } catch (e) {
    logToFile('hero-report: trend load failed (non-fatal)', { error: e.message });
  }

  // /observe2: the coach's "Work on first" is the target, judged or not (observe2-horizon).
  const target = opts.target !== undefined ? opts.target : (observe2Target(analysis) || resolveTarget(analysis));
  const narrative = await generateReportNarrative(analysis, {
    transcript: session.transcript_text,
    trend,
    language: lang,
    teacherName,
    target,
  });
  // /observe2: the horizon's title is the coach's pick, in its own words, set here rather than trusted
  // to the model (pilot sheet R3). Before the image and before the caller stores the narrative.
  pinObserve2Horizon(narrative, analysis);
  // bd-trksw9: without the narrative the page renders its score, photos and trend
  // around an empty strength, horizon and moments. A caller that would rather say so
  // than send that (the /observe preview) opts in; every other caller is unchanged.
  if (!narrative && opts.requireNarrative) {
    const err = new Error('hero report: narrative unavailable after retry');
    err.code = 'NARRATIVE_UNAVAILABLE';
    throw err;
  }

  // bd-1t1wz: per-section "why" diagnosis lines onto the scorecard rows.
  attachDomainWhys(score.groups, narrative && narrative.domain_whys);
  attachSubjectNote(score.groups, analysis, lang);
  const v6 = v6HeroRows(score.groups, analysis, lang);

  // bd-pv2tl: the teacher's own classroom photos, framed under the scorecard.
  // Non-fatal: the helper skips any broken photo and returns [] on failure.
  let classroomPhotos = [];
  try {
    const sharp = require('sharp');
    classroomPhotos = await buildClassroomPhotoVm(session.classroom_photos, {
      downloadFn: downloadFromR2,
      extractKey: extractKeyFromUrl,
      downscale: (buf) => sharp(buf).rotate().resize({ width: 720, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer(),
      // bd-b3pop.17: an upload the vision pass kept away from both scorers is not framed in the report either.
      skipPhotoNumbers: excludedPhotoNumbers(analysis),
    });
    // bd-8s2xb → bd-1mcpe: a caption under EACH framed photo, from that photo's own vision
    // description (first clause only — never the scorer's critique), matched by the photo's
    // original index. Pure + non-fatal; no description → that frame renders exactly as before.
    classroomPhotos = applyPhotoCaptions(classroomPhotos, analysis);
  } catch (e) {
    logToFile('hero-report: classroom photo strip failed (non-fatal)', { error: e.message });
  }

  const stored = heroPartialNote(session, analysis);
  const partialNote = v6 && v6.note && !(stored || '').includes(v6.note) ? [v6.note, stored].filter(Boolean).join(' ') : stored;
  const vm = {
    language: lang,
    brand,
    teacherName,
    partialNote,
    topic: heroTopic(narrative, analysis),
    date: String(session.created_at || '').slice(0, 10),
    score: { overall: score.overall, marks: score.marks, max: score.max },
    groups: score.groups,
    narrative: narrative || {},
    tryNext: commitmentAction || '',
    // feedback-uptake loop: "last time we asked" (null when the loop is off / no prior)
    uptake: buildUptakeVm(opts.loop, analysis.uptake, lang),
    trend,
    photoB64: '', // hero background stays the solid brand colour; photos render in the framed strip
    classroomPhotos, // bd-pv2tl: up to 2 framed classroom photos under the scorecard
    // bd-gzfdu9 §4.9: the recommended clip under the try box; no key when there is none (the HTML is as today).
    ...(opts.videoStrip ? { videoStrip: opts.videoStrip } : {}),
  };

  const shot = { selector: '.report', width: 794, deviceScaleFactor: 2 };
  const png = await htmlToImage(buildHeroReportHtml(vm), shot);
  // bd-fmf24g.10: the narrative travels back with the image so the caller can keep it
  // (narrative-store) — the app's report page reads the session, not the PNG.
  const out = { png, caption: buildReportCaption(vm), narrative: narrative || null, partialNote };
  // bd-22gf7p: an image whose strip promises the clip template's button also gets an app-hint copy (same view model, no
  // second narrative call), stored and sent instead if that template is refused at the send. Null when it fails to render.
  if (opts.videoStrip && opts.videoStrip.where === 'button') {
    try {
      out.fallbackPng = await htmlToImage(buildHeroReportHtml({ ...vm, videoStrip: { ...opts.videoStrip, where: 'app' } }), shot);
    } catch (e) {
      out.fallbackPng = null;
      logToFile('hero-report: app-hint copy failed to render (non-fatal)', { error: e.message });
    }
  }

  // bd-v0toag.57: groups C and D are sent a slim image, the /cr page's card (slim-report.js, slim-card.template.js);
  // the full one above is still the stored report. With no strengths stored, the narrative's strength is what she
  // did well. A failed slim render sends the full image.
  if (opts.slim) {
    try {
      const n = narrative || {};
      const well = wells(analysis, lang, narrative);
      const own = lang === 'en' ? n.strength_note || n.strength_name : null;
      const card = {
        language: lang,
        header: cardHeader(session, analysis, teacherName, lang),
        wells: well.length ? well : (own ? [own] : []),
        thing: { text: opts.slim.tryNext || vm.tryNext, step: opts.slim.step || null, why: practiceWhy(opts.slim.tag, lang) },
        ...(opts.videoStrip ? { videoStrip: opts.videoStrip } : {}),
      };
      out.slimPng = await htmlToImage(buildSlimCardHtml(card), { selector: '.report', width: 480, deviceScaleFactor: 2 });
    } catch (e) {
      logToFile('hero-report: slim render failed (the full image is sent)', { error: e.message });
    }
  }
  return out;
}

module.exports = {
  generateHeroReport, attachDomainWhys, attachSubjectNote, buildUptakeVm, tallyInWords, heroTopic, v6HeroRows,
};
