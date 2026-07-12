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
const { loadTrendData } = require('../coaching-trend.service');
const { htmlToImage } = require('../../../utils/html-to-pdf');
const { logToFile } = require('../../../utils/logger');

/**
 * @param {object} session - coaching_sessions row (transcript_text, user_id, created_at, classroom_photos)
 * @param {object} analysis - enhancedAnalysis (framework, scores, domains, reflective_corpus, …)
 * @param {object} opts - { teacherName, commitmentAction, language }
 * @returns {Promise<{png:Buffer, caption:string}>}
 */
async function generateHeroReport(session, analysis, opts = {}) {
  const { teacherName = 'Teacher', commitmentAction = '', language } = opts;
  const lang = language || analysis.language || session.transcript_language || 'en';
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

  const vm = {
    language: lang,
    teacherName,
    topic: (narrative && narrative.topic) || analysis.topic || '',
    date: String(session.created_at || '').slice(0, 10),
    score: { overall: score.overall, marks: score.marks, max: score.max },
    groups: score.groups,
    narrative: narrative || {},
    tryNext: commitmentAction || '',
    trend,
    photoB64: '', // classroom-photo embedding = follow-up; solid-navy hero is the default
  };

  const png = await htmlToImage(buildHeroReportHtml(vm), { selector: '.report', width: 794, deviceScaleFactor: 2 });
  return { png, caption: buildReportCaption(vm) };
}

module.exports = { generateHeroReport };
