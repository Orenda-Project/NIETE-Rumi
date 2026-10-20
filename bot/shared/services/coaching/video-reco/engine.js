'use strict';
/**
 * The training-video recommendation for one coaching report (bd-gzfdu9, SPEC §3.2).
 *
 * recommendForReport NEVER throws and never blocks the report: the report hook starts it and does not
 * await it (the sender awaits it after the report has gone). It returns the stored row, or null when the
 * flag is off, the analysis is not FICO, or anything failed. Order: flag → stored row (retries never
 * recompute) → arm → target (target.js) → teacher context (language, ladder level, history) → shortlist
 * (BM25 + the ⛔ filters) → ONE completeJson pick → validation → one row. Control-arm rows are 'shadow'.
 */
const { logToFile } = require('../../../utils/logger');
const { getCurrentCorrelationId } = require('../../../utils/structured-logger');
const { clampLanguage } = require('../../../config/ux-strings');
const { videoRecoEnabled, videoRecoAbEnabled } = require('./flags');
const { assignArm, AB_SALT } = require('./arm');
const target = require('./target');
const shortlist = require('./shortlist');
const prompt = require('./prompt');
const select = require('./select');

const ENGINE_TIMEOUT_MS = 30000;

class Timeout extends Error {
  constructor(ms) { super(`video recommendation took longer than ${ms} ms`); this.name = 'Timeout'; }
}

function gradeOf(analysis) {
  const g = analysis && analysis.subject_resolution && analysis.subject_resolution.grade;
  const n = parseInt(String(g === null || g === undefined ? '' : g).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function lessonOf(analysis, session) {
  const sr = (analysis && analysis.subject_resolution) || {};
  return {
    subject: sr.code && sr.confidence !== 'none' ? sr.code : null,
    grade: gradeOf(analysis),
    topic: (analysis && analysis.topic) || (session && session.lesson_plan_structured && session.lesson_plan_structured.topic) || null,
  };
}

function signalOf(t, analysis, nextStep, card) {
  const fa = (analysis && analysis.focus_area) || {};
  const up = (analysis && analysis.uptake) || {};
  const step = (nextStep && nextStep.target) || {};
  const row = t.row || {};
  return [row.evidence, row.evidence_summary, step.rationale, step.try, fa.rationale, fa.try_this_tomorrow,
    card && card.action, up.evidence, up.moment].filter((x) => typeof x === 'string' && x.trim()).join('\n');
}

async function compute(a, d, state) {
  const { session, analysis, loop, card, coachingSessionId } = a;
  // The observe path (hook A2) has no next step of its own: the coach-edited analysis decides it, as the hero did.
  const nextStep = a.nextStep === undefined ? require('../next-step').selectNextStep(analysis, null) : a.nextStep; // eslint-disable-line global-require
  const { store, catalog } = d;
  const existing = await store.readForSession(coachingSessionId);
  if (existing) return existing;

  const arm = assignArm(session.user_id, d.env);
  const t = target.pick(analysis, nextStep, card, catalog.aliases);
  const language = clampLanguage(session.users && session.users.preferred_language);
  const [recent, ladder] = await Promise.all([store.recentModules(session.user_id, 180), store.ladderProgress(session.user_id)]);
  const level = ladder.level === null || ladder.level === undefined ? 2 : ladder.level;
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
    target_source: t.source || null,
    loop_angle: (loop && loop.state && loop.state.angle) || null,
    observation_type: a.observationType || (session.observer_user_id ? 'leader_observation' : 'self'),
    language,
    teacher_level: level,
    catalog_version: catalog.version,
    prompt_version: prompt.PROMPT_VERSION,
    experiment: videoRecoAbEnabled(d.env) ? AB_SALT : null,
    v10_group: v10Group,
    differs_from_step: false,
    repeat_module: false,
  };
  const finish = async (row) => {
    if (state.abandoned) return null;
    return store.write({ ...row, engine_ms: Date.now() - state.t0 });
  };
  state.base = base;

  if (t.none) return finish({ ...base, status: 'none', none_reason: t.none });

  const lesson = lessonOf(analysis, session);
  const ctx = { language, level, history: [...new Set([...recent, ...(ladder.completed || [])])] };
  const list = shortlist.build(catalog, t, ctx, signalOf(t, analysis, nextStep, card), lesson);
  base.repeat_module = list.repeatModule;
  if (!list.candidates.length) return finish({ ...base, status: 'none', none_reason: list.noneReason || 'hole' });

  const row = t.row || {};
  const up = (analysis && analysis.uptake) || {};
  const ex = prompt.excerpts(session, { timestamp: row.timestamp, uptakeMoment: up.moment });
  const step = (nextStep && nextStep.target) || {};
  const fa = (analysis && analysis.focus_area) || {};
  const text = prompt.build({
    target: t,
    rationale: step.rationale || fa.rationale || '',
    tryText: (card && card.action) || step.try || fa.try_this_tomorrow || '',
    subject: lesson.subject,
    excerpts: ex,
    candidates: list.candidates,
    catalog,
    topRung: t.scheme === 'fico_main_37' ? 3 : 2,
  });
  const res = await select.pick({ prompt: text, deps: d, timeoutMs: a.llmTimeoutMs });
  const withLlm = { ...base, candidates: list.candidates, model: res.model, usage: res.usage };
  if (res.truncated) return finish({ ...withLlm, status: 'none', none_reason: 'llm_truncated' });
  const v = select.validate(res.pick, list, ex, {
    stepIndicator: t.stepIndicator, forcedDiffer: t.forcedDiffer, catalog, teacherName: session.users && session.users.name,
  });
  if (!v.ok) return finish({ ...withLlm, status: 'none', none_reason: v.none, confidence: v.confidence });

  const hit = catalog.segment(res.pick.seg_id);
  const p = res.pick;
  return finish({
    ...withLlm,
    status: arm === 'video' ? 'shown' : 'shadow',
    module_id: hit.module.module_id,
    seg_id: hit.segment.seg_id,
    start_s: hit.segment.start_s,
    end_s: hit.segment.end_s,
    differs_from_step: v.differs || t.forcedDiffer,
    reason_en: String(p.reason_en).trim(),
    reason_ur: String(p.reason_ur).trim(),
    moment_at: p.moment && p.moment.at ? String(p.moment.at) : null,
    moment_quote: p.moment && p.moment.quote ? String(p.moment.quote) : null,
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
