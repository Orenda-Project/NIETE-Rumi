/**
 * Index of authored representative hero-report sample data. Used by
 * scripts/render-sample-hero-report.js to render one sample PNG per
 * framework. ALL DATA IS HAND-AUTHORED — never pulled from a real DB —
 * so it carries no teacher PII (same convention as docs/samples/coaching-report-sample.pdf).
 *
 * Each sample carries:
 *   session  : { user_id, created_at, transcript_text, transcript_language }
 *   analysis : { framework, language, topic, scores, strengths,
 *                growth_opportunities, reflective_corpus, executive_summary }
 *   opts     : { teacherName, commitmentAction, language }
 *
 * Score shapes match each framework's adapter (OECD goalN_total, HOTS/TEACH
 * areas, FICO/MEWAKA domains).
 */

module.exports = {
  oecd:   require('./hero-sample-oecd.json'),
  hots:   require('./hero-sample-hots.json'),
  teach:  require('./hero-sample-teach.json'),
  fico:   require('./hero-sample-fico.json'),
  mewaka: require('./hero-sample-mewaka.json'),
};
