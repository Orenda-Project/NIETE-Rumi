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
const { buildClassroomPhotoVm, excludedPhotoNumbers } = require('./classroom-photo-vm');
const { applyPhotoCaptions } = require('./photo-note');
const { resolveReportLanguage } = require('./report-language');
const { loadTrendData } = require('../coaching-trend.service');
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
    // sentence it produces is invented.
    if (g.notAssessed) continue;
    const why = domainWhys[g.domainKey || g.key];
    if (why) g.why = why;
  }
  return groups;
}

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

/**
 * @param {object} session - coaching_sessions row (transcript_text, user_id, created_at, classroom_photos)
 * @param {object} analysis - enhancedAnalysis (framework, scores, domains, reflective_corpus, …)
 * @param {object} opts - { teacherName, commitmentAction, language, brand }
 *   `brand` selects the template palette ('niete' for the FICO/NIETE path,
 *   injected by renderer-registry; omitted = default palette). bd-2452.
 * @returns {Promise<{png:Buffer, caption:string}>}
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
  try {
    const raw = await loadTrendData(session.user_id, { limit: 12, locale: 'en', excludeSessionId: session.id });
    trend = raw
      .map((t) => ({ date: String(t.date || '').slice(0, 10), pct: Math.round(parseFloat(t.pct || 0)) }))
      .filter((t) => t.pct > 0);
  } catch (e) {
    logToFile('hero-report: trend load failed (non-fatal)', { error: e.message });
  }

  const narrative = await generateReportNarrative(analysis, {
    transcript: session.transcript_text,
    trend,
    language: lang,
    teacherName,
  });

  // bd-1t1wz: per-section "why" diagnosis lines onto the scorecard rows.
  attachDomainWhys(score.groups, narrative && narrative.domain_whys);
  attachSubjectNote(score.groups, analysis, lang);

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

  const vm = {
    language: lang,
    brand,
    teacherName,
    topic: (narrative && narrative.topic) || analysis.topic || '',
    date: String(session.created_at || '').slice(0, 10),
    score: { overall: score.overall, marks: score.marks, max: score.max },
    groups: score.groups,
    narrative: narrative || {},
    tryNext: commitmentAction || '',
    trend,
    photoB64: '', // hero background stays the solid brand colour; photos render in the framed strip
    classroomPhotos, // bd-pv2tl: up to 2 framed classroom photos under the scorecard
  };

  const png = await htmlToImage(buildHeroReportHtml(vm), { selector: '.report', width: 794, deviceScaleFactor: 2 });
  return { png, caption: buildReportCaption(vm) };
}

module.exports = { generateHeroReport, attachDomainWhys, attachSubjectNote };
