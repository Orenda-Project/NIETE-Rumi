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
const { buildClassroomPhotoVm } = require('./classroom-photo-vm');
const { resolveReportLanguage } = require('./report-language');
const { loadTrendData } = require('../coaching-trend.service');
const { resolveTarget } = require('../target-resolver');
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
    const why = domainWhys[g.domainKey || g.key];
    if (why) g.why = why;
  }
  return groups;
}

const UPTAKE_LINE_KEY = {
  achieved: 'uptakeLineAchieved',
  partial: 'uptakeLinePartial',
  not_seen: 'uptakeLineNotSeen',
  not_applicable: 'uptakeLineNotApplicable',
  unknown: 'uptakeLineUnknown',
};

/** "specific feedback moves 2, next step feedback 0" — the tally in words, never a score. */
function tallyInWords(count) {
  if (!count || typeof count !== 'object') return '';
  return Object.entries(count)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${String(k).replace(/_/g, ' ')} ${v}`)
    .join(', ');
}

/**
 * The hero's "Last time we asked" block, from the loop state the report
 * generator computed ({ prior, status, state }) and this lesson's tally.
 * Null when there is nothing to show (no loop, no prior, or no verdict).
 * The line is catalog copy in the report language; the ask is verbatim in
 * whatever language it was written. Never a percentage.
 */
function buildUptakeVm(loop, uptake, lang) {
  if (!loop || !loop.prior || !loop.prior.target || !loop.status || loop.status === 'no_prior') return null;
  const status = UPTAKE_LINE_KEY[loop.status] ? loop.status : 'unknown';
  const target = loop.prior.target.name || loop.prior.target.indicator;
  const count = tallyInWords(uptake && uptake.count) || '—';
  let line = resolveUx(UPTAKE_LINE_KEY[status], { language: lang, params: { count, target } });
  if (loop.state && loop.state.hand_over) {
    line += ' ' + resolveUx('uptakeLineHandOver', { language: lang, params: { count, target } });
  }
  return { asked: String(loop.prior.action || ''), status, line };
}

/**
 * @param {object} session - coaching_sessions row (transcript_text, user_id, created_at, classroom_photos)
 * @param {object} analysis - enhancedAnalysis (framework, scores, domains, reflective_corpus, …)
 * @param {object} opts - { teacherName, commitmentAction, language, brand, target }
 *   `target` is the ONE indicator this report is about (target-resolver). When the
 *   caller does not supply it, it is resolved from the analysis here so the
 *   observe path and the coaching pipeline name the same horizon.
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

  const target = opts.target !== undefined ? opts.target : resolveTarget(analysis);
  const narrative = await generateReportNarrative(analysis, {
    transcript: session.transcript_text,
    trend,
    language: lang,
    teacherName,
    target,
  });

  // bd-1t1wz: per-section "why" diagnosis lines onto the scorecard rows.
  attachDomainWhys(score.groups, narrative && narrative.domain_whys);

  // bd-pv2tl: the teacher's own classroom photos, framed under the scorecard.
  // Non-fatal: the helper skips any broken photo and returns [] on failure.
  let classroomPhotos = [];
  try {
    const sharp = require('sharp');
    classroomPhotos = await buildClassroomPhotoVm(session.classroom_photos, {
      downloadFn: downloadFromR2,
      extractKey: extractKeyFromUrl,
      downscale: (buf) => sharp(buf).rotate().resize({ width: 720, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer(),
    });
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
    // feedback-uptake loop: "last time we asked" (null when the loop is off / no prior)
    uptake: buildUptakeVm(opts.loop, analysis.uptake, lang),
    trend,
    photoB64: '', // hero background stays the solid brand colour; photos render in the framed strip
    classroomPhotos, // bd-pv2tl: up to 2 framed classroom photos under the scorecard
  };

  const png = await htmlToImage(buildHeroReportHtml(vm), { selector: '.report', width: 794, deviceScaleFactor: 2 });
  return { png, caption: buildReportCaption(vm) };
}

module.exports = { generateHeroReport, attachDomainWhys, buildUptakeVm, tallyInWords };
