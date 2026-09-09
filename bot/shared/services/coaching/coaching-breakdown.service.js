'use strict';
/**
 * One session, shaped for a screen that is not WhatsApp.
 *
 * WHY THIS IS NOT IN THE PORTAL
 * -----------------------------
 * The portal built its own score breakdown from six hardcoded OECD goal names
 * reading `scores.goal1_total…goal5_total`. Every NIETE region is configured
 * for FICO, and a FICO session contains none of those keys — 30 of 30 recent
 * completed sessions on production. A `|| 0` on each read is what made it
 * silent: five bars at zero, under labels her framework has never used, and
 * "Strongest Area" chosen by sorting that empty list.
 *
 * The bot already solved this. `buildScoreViewModel` dispatches to five
 * adapters (fico · oecd · hots · teach · mewaka) and returns one normalised
 * shape — it is what renders the report image she receives in chat. So the
 * portal must hold NO framework logic at all: it asks here and renders the
 * answer, and a sixth framework never requires a portal change.
 *
 * WHAT THIS ADDS ON TOP OF THE ADAPTER
 * ------------------------------------
 * The adapter returns section-level groups, which is right for a 1080px
 * report image. A browser has room for the level below it — the indicators,
 * each carrying the quoted evidence from her own lesson that justifies its
 * score. That is the most useful thing in the payload and it has never been
 * visible on any surface.
 */

const { buildScoreViewModel } = require('./report-v2/score-adapter.service');
const { logToFile } = require('../../utils/logger');

/**
 * Domain display order.
 *
 * Strongest first, weakest last, so the page can open the weakest section by
 * default without the caller re-sorting and without the ORDER carrying an
 * implied judgement of its own. The section letters (B/C/D/F) travel with each
 * group, so a trainer cross-referencing the printed rubric still can.
 */
function byStrength(groups) {
  return [...groups].sort((a, b) => (b.pct || 0) - (a.pct || 0));
}

/**
 * The indicators under one domain, with their evidence.
 *
 * `applicable: false` is meaningful rather than missing — FICO gates seven
 * Section F indicators on the subject, so a maths lesson is scored out of 42
 * and a literacy lesson out of 44. An indicator that did not apply is not a
 * zero she lost; it is a question that was never asked, and the UI has to be
 * able to tell those apart.
 */
/**
 * A domain the framework does not list, shaped like one that is.
 *
 * The score adapter iterates the FRAMEWORK's canonical domains, which is right
 * for the WhatsApp report image — a fixed four-row scorecard. But 17 of 172
 * completed sessions were scored on a five-domain vocabulary
 * (classroom_climate, lesson_structure, instructional_quality,
 * assessment_feedback, student_engagement). For those the adapter matches one
 * key, reports the other three canonical ones as 0/0, and the session's own
 * three real domains never appear at all.
 *
 * That is the same defect this whole change exists to remove — a reader asking
 * for keys the data does not have and rendering zeros instead of saying so —
 * so the browser, which has no fixed row count to honour, shows what is there.
 *
 * `key` is empty rather than invented: the section letters (B/C/D/F) are the
 * printed rubric's, and giving an unlisted domain a made-up letter would send
 * a trainer looking for a row that does not exist.
 */
function extraGroup(domainKey, d) {
  const score = d.domain_score ?? d.area_score ?? 0;
  const max = d.domain_max ?? d.area_max ?? 0;
  return {
    key: '',
    domainKey,
    // snake_case -> Title Case. The framework owns display names for the
    // domains it lists; for one it does not, the key itself is the only
    // honest source.
    name: domainKey.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    score,
    max,
    pct: max > 0 ? Math.round((score / max) * 100) : 0,
  };
}

function indicatorsFor(domain) {
  return (domain.indicators || []).map((i) => ({
    id: i.id || null,
    name: i.name || null,
    score: typeof i.score === 'number' ? i.score : null,
    // Both are stored; the summary is the short form, `evidence` the full
    // quote with its timestamps. Send both and let the surface choose.
    evidence: i.evidence || null,
    evidence_summary: i.evidence_summary || null,
    applicable: i.applicable !== false,
  }));
}

/**
 * A session's scores, ready to render.
 *
 * Returns null when there is nothing scored yet — a caller must be able to
 * tell "not analysed" from "analysed and scored zero", which is precisely the
 * distinction `|| 0` destroyed.
 */
function buildBreakdown(analysisData, language = 'en') {
  if (!analysisData || typeof analysisData !== 'object') return null;

  let vm;
  try {
    vm = buildScoreViewModel(analysisData, language);
  } catch (err) {
    logToFile('[coaching-breakdown] score adapter failed', { error: err.message });
    return null;
  }
  if (!vm) return null;

  const domains = analysisData.domains || analysisData.areas || {};

  // Everything the adapter produced, MINUS the canonical domains this session
  // was not actually scored on — those come back as 0/0 and are noise, not
  // information. Then plus the domains it WAS scored on that the framework
  // does not list.
  const adapted = (vm.groups || []).filter((g) => domains[g.domainKey]);
  const known = new Set(adapted.map((g) => g.domainKey));
  const extra = Object.keys(domains)
    .filter((k) => !known.has(k))
    .map((k) => extraGroup(k, domains[k] || {}));
  const groups = [...adapted, ...extra];

  // The adapter derives `overall` from ITS OWN groups when the session carries
  // no overall_percentage. For a five-domain session those groups are the four
  // canonical ones — one matched, three at 0/0 — so it computed 13/58 = 22%
  // for a lesson actually scored 73/84 = 87%. Having just replaced the groups,
  // we have to recompute the headline from the ones being rendered, or it
  // contradicts the bars directly beneath it.
  //
  // A stored overall_percentage still wins: it is the bot's own recorded
  // figure and the same value that went out on her WhatsApp report.
  const storedPct = parseFloat(analysisData.scores?.overall_percentage);
  const sumScore = groups.reduce((t, g) => t + (Number(g.score) || 0), 0);
  const sumMax = groups.reduce((t, g) => t + (Number(g.max) || 0), 0);
  const overall = Number.isFinite(storedPct)
    ? Math.round(storedPct)
    : (sumMax > 0 ? Math.round((sumScore / sumMax) * 100) : (vm.overall ?? null));

  return {
    framework: vm.framework || null,
    language: vm.language || language,
    overall,
    marks: vm.marks ?? (sumMax > 0 ? sumScore : null),
    max: vm.max ?? (sumMax > 0 ? sumMax : null),
    // Strongest first. The caller opens the last one.
    groups: byStrength(groups).map((g) => ({
      ...g,
      indicators: indicatorsFor(domains[g.domainKey] || {}),
    })),
  };
}

module.exports = { buildBreakdown, byStrength };
