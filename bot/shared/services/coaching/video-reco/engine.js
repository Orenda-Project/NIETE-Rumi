'use strict';
/**
 * The training-video recommendation for one coaching report (bd-gzfdu9, SPEC v1.2.1 §3.2).
 *
 * recommendForReport NEVER throws and never blocks the report: the report hook starts it and does not
 * await it (the sender awaits it after the report has gone). It returns the stored row, or null when the
 * flag is off, the analysis is not FICO, or anything failed. Order: flag → stored row (retries never
 * recompute) → arm → target (target.js) → teacher context (languages, ladder level, history, grade) →
 * shortlist (BM25 + the ⛔ filters) → transcript moments, names redacted → ONE completeJson pick →
 * validation → one row. Control-arm rows, and every row in VIDEO_RECO_MODE=shadow, are 'shadow'.
 */
const { logToFile } = require('../../../utils/logger');
const { getCurrentCorrelationId } = require('../../../utils/structured-logger');
const { clampLanguage } = require('../../../config/ux-strings');
const { videoRecoEnabled, videoRecoAbEnabled, videoRecoMode } = require('./flags');
const { assignArm, AB_SALT } = require('./arm');
const target = require('./target');
const shortlist = require('./shortlist');
const prompt = require('./prompt');
const select = require('./select');

const ENGINE_TIMEOUT_MS = 30000;
const BAND_GRADES = Object.freeze({ PRIMARY: [1, 5], MIDDLE: [6, 8], HIGH: [9, 12] });

class Timeout extends Error {
  constructor(ms) { super(`video recommendation took longer than ${ms} ms`); this.name = 'Timeout'; }
}

/** The lesson's grade: subject_resolution.grade, else the teacher's training_bands (H7), else unknown. */
async function gradeOf(analysis, userId, store) {
  const g = analysis && analysis.subject_resolution && analysis.subject_resolution.grade;
  const n = parseInt(String(g === null || g === undefined ? '' : g).replace(/[^0-9]/g, ''), 10);
  if (Number.isFinite(n)) return { lo: n, hi: n };
  const spans = (await store.trainingBands(userId)).map((b) => BAND_GRADES[String(b).toUpperCase()]).filter(Boolean);
  return spans.length ? { lo: Math.min(...spans.map((x) => x[0])), hi: Math.max(...spans.map((x) => x[1])) } : null;
}

function inapplicableRows(analysis) {
  const out = [];
  for (const d of Object.values((analysis && analysis.domains) || {})) {
    for (const r of (d && d.indicators) || []) if (r && r.applicable === false) out.push(String(r.id));
  }
  return out;
}

function signalOf(t, analysis, nextStep, card) {
  const fa = (analysis && analysis.focus_area) || {};
  const up = (analysis && analysis.uptake) || {};
  const step = (nextStep && nextStep.target) || {};
  const row = t.row || {};
  return [row.evidence, row.evidence_summary, step.rationale, step.try, fa.rationale, fa.try_this_tomorrow,
    card && card.action, ...((card && card.highlights) || []), up.evidence, up.moment]
    .filter((x) => typeof x === 'string' && x.trim()).join('\n');
}

async function compute(a, d, state) {
  const { session, analysis, loop, card, coachingSessionId } = a;
  const { store, catalog } = d;
  // The observe path (hook A2) has no next step of its own: the coach-edited analysis decides it, as the hero did.
  const nextStep = a.nextStep === undefined ? require('../next-step').selectNextStep(analysis, null) : a.nextStep; // eslint-disable-line global-require
  const existing = await store.readForSession(coachingSessionId);
  if (existing) return existing;

  const arm = assignArm(session.user_id, d.env);
  const sr = (analysis && analysis.subject_resolution) || {};
  const subject = sr.code && (sr.confidence === 'high' || sr.confidence === 'medium') ? sr.code : null;
  const t = target.pick(analysis, nextStep, card, catalog, { subject });
  const language = clampLanguage(session.users && session.users.preferred_language);
  const [history, ladder] = await Promise.all([store.recentHistory(session.user_id), store.ladderProgress(session.user_id)]);
  const completed = new Set(ladder.completedModules || []);
  const ladderComplete = catalog.modules.length > 0 && catalog.modules.every((m) => completed.has(Number(m.module_id)));
  let v10Group = null;
  try {
    const g = await (d.v10GroupFor || require('../ab-v10-arms').groupFor)(session.user_id); // eslint-disable-line global-require
    v10Group = (g && g.group) || null;
  } catch (e) { v10Group = null; }

  const base = {
    coaching_session_id: coachingSessionId,
    user_id: session.user_id,
    arm,
    module_id: null,
    seg_id: null,
    start_s: null,
    end_s: null,
    indicator: t.storedIndicator || null,
    catalog_indicator: t.indicator || null,
    indicator_scheme: t.scheme || null,
    step_indicator: t.stepIndicator || null,
    step_at_top: !!t.stepAtTop,
    alias_kind: t.aliasKind || null,
    target_source: t.source || null,
    loop_angle: (loop && loop.state && loop.state.angle) || null,
    observation_type: a.observationType || (session.observer_user_id ? 'leader_observation' : 'self'),
    language,
    teacher_level: ladder.level === undefined ? null : ladder.level,
    teacher_level_source: ladder.level === null || ladder.level === undefined ? 'none' : 'ladder',
    ladder_completed: ladderComplete,
    catalog_version: catalog.version,
    prompt_version: prompt.PROMPT_VERSION,
    experiment: videoRecoAbEnabled(d.env) ? AB_SALT : null,
    v10_group: v10Group,
    differs_from_step: false,
    repeat_module: false,
    image_strip: false,
  };
  const finish = async (row) => {
    if (state.abandoned) return null;
    return store.write({ ...row, engine_ms: Date.now() - state.t0 });
  };
  state.base = base;

  if (t.none) return finish({ ...base, status: 'none', none_reason: t.none });

  const lesson = {
    subject,
    grade: await gradeOf(analysis, session.user_id, store),
    topic: (analysis && analysis.topic) || (session.lesson_plan_structured && session.lesson_plan_structured.topic) || null,
    inapplicable: inapplicableRows(analysis),
  };
  const transcriptLanguage = session.transcript_language ? clampLanguage(session.transcript_language) : null;
  const ctx = {
    language,
    languages: [language, transcriptLanguage, 'mixed'].filter(Boolean),
    level: base.teacher_level,
    ladderComplete,
    history,
  };
  const list = shortlist.build(catalog, t, ctx, signalOf(t, analysis, nextStep, card), lesson);
  base.repeat_module = list.repeatModule;
  base.level_match = list.levelMatch || null;
  if (!list.candidates.length) return finish({ ...base, status: 'none', none_reason: list.noneReason || 'hole' });

  const people = { teacher: session.users && session.users.name };
  const row = t.row || {};
  const up = (analysis && analysis.uptake) || {};
  const ex = prompt.excerpts(session, { timestamp: row.timestamp, uptakeMoment: up.moment }, people);
  const scorerQuote = t.source === 'card_text' ? '' : prompt.redact(target.scorerQuote(t.row), people);
  const uptakeQuote = t.source === 'card_text' && up.moment ? prompt.redact(up.moment, people) : '';
  if (!ex.length && !scorerQuote && !uptakeQuote) {
    return finish({ ...base, status: 'none', none_reason: 'no_moments', candidates: list.candidates });
  }
  const step = (nextStep && nextStep.target) || {};
  const fa = (analysis && analysis.focus_area) || {};
  const text = prompt.build({
    target: t,
    rationale: step.rationale || fa.rationale || '',
    tryText: (card && card.action) || step.try || fa.try_this_tomorrow || '',
    subject,
    excerpts: ex,
    candidates: list.candidates,
    catalog,
    scorerQuote,
    uptakeQuote,
    topRung: t.topRung || (t.scheme === 'fico_main_37' ? 4 : 2),
  });
  const res = await select.pick({ prompt: text, deps: d, timeoutMs: a.llmTimeoutMs });
  const withLlm = { ...base, candidates: list.candidates, model: res.model, usage: res.usage };
  if (res.truncated) return finish({ ...withLlm, status: 'none', none_reason: 'llm_truncated' });
  const v = select.validate(res.pick, list, ex, {
    stepIndicator: t.stepIndicator, indicators: t.indicators, source: t.source, catalog,
    teacherName: people.teacher, scorerQuote: scorerQuote || uptakeQuote,
  });
  if (!v.ok) return finish({ ...withLlm, status: 'none', none_reason: v.none, confidence: v.confidence });

  const p = res.pick;
  const hit = catalog.segment(p.seg_id);
  const cand = list.candidates.find((x) => x.seg_id === hit.segment.seg_id) || {};
  const chosen = t.source === 'card_text' || t.source === 'phase' ? (((hit.segment.fico || [])[0] || {}).indicator || null) : null;
  return finish({
    ...withLlm,
    ...(t.source === 'card_text' ? { indicator: chosen, catalog_indicator: chosen } : {}),
    status: videoRecoMode(d.env) === 'shadow' || arm !== 'video' ? 'shadow' : 'shown',
    module_id: hit.module.module_id,
    seg_id: hit.segment.seg_id,
    start_s: hit.segment.start_s,
    end_s: hit.segment.end_s,
    language_match: cand.language_match || null,
    reason_en: String(p.reason_en).trim(),
    reason_ur: String(p.reason_ur).trim(),
    moment_at: p.moment && p.moment.at ? String(p.moment.at) : null,
    moment_quote: p.moment && p.moment.quote ? String(p.moment.quote) : null,
    moment_source: v.momentSource,
    confidence: v.confidence,
    none_reason: null,
  });
}

/**
 * @param {object} a
 * @param {object} a.session            coaching_sessions row (+ users.preferred_language, users.name)
 * @param {object} a.analysis           the enhanced analysis the report is built from
 * @param {object} a.nextStep           selectNextStep(...) result
 * @param {object} [a.loop]             the uptake-loop state
 * @param {object} [a.card]             the commitment card the teacher reads ({indicator, action})
 * @param {string} a.coachingSessionId
 * @param {boolean} [a.isRetry]         retries reuse the stored row (step 2), whatever this says
 * @param {object} [a.deps]             {env, catalog, store, completeJson, v10GroupFor} — tests and the evals harness
 * @returns {Promise<object|null>}      resolves, never rejects
 */
async function recommendForReport(args = {}) {
  const d0 = (args && args.deps) || {};
  const env = d0.env || process.env;
  let a;
  try {
    if (!videoRecoEnabled(env)) return null;
    if (!args.analysis || args.analysis.framework !== 'fico' || !args.session || !args.coachingSessionId) return null;
    // A snapshot taken before the first await: the report goes on rendering (and may add to the analysis) while this runs.
    const snap = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
    a = { ...args, analysis: snap(args.analysis), nextStep: snap(args.nextStep), card: snap(args.card), loop: snap(args.loop) };
  } catch (e) {
    return null;
  }
  const state = { t0: Date.now(), abandoned: false, base: null };
  let d;
  let timer;
  try {
    d = {
      ...d0,
      env,
      catalog: d0.catalog || require('./catalog').load(), // eslint-disable-line global-require
      store: d0.store || require('./store'), // eslint-disable-line global-require
    };
    const ms = a.timeoutMs || ENGINE_TIMEOUT_MS;
    const cap = new Promise((_, reject) => { timer = setTimeout(() => reject(new Timeout(ms)), ms); });
    return await Promise.race([compute(a, d, state), cap]);
  } catch (error) {
    state.abandoned = true;
    logToFile('[video-reco] failed (non-fatal)', {
      coachingSessionId: a.coachingSessionId, correlationId: getCurrentCorrelationId(), error: error && error.message,
    }, 'warn');
    try {
      if (d && d.store && a.session && a.session.user_id) {
        await d.store.write({
          ...(state.base || {
            coaching_session_id: a.coachingSessionId, user_id: a.session.user_id, arm: assignArm(a.session.user_id, env),
          }),
          status: 'error',
          none_reason: `error:${(error && error.name) || 'Error'}`,
          engine_ms: Date.now() - state.t0,
        });
      }
    } catch (e) { /* best effort */ }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { recommendForReport, ENGINE_TIMEOUT_MS };
