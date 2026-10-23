'use strict';
/**
 * The training-video recommendation for one coaching report (bd-gzfdu9, SPEC v1.3 §3.2).
 *
 * recommendForReport NEVER throws and never blocks the report: the report hook starts it and does not
 * await it (the sender awaits it after the report has gone). It returns the stored row, or null when the
 * flag is off, the analysis is not FICO, or anything failed. Order: flag → stored row (retries never
 * recompute) → arm → target (target.js) → teacher context (languages, ladder level, history, grade) →
 * shortlist (BM25 + the ⛔ filters) → transcript moments, names redacted → ONE completeJson pick →
 * validation (one retry; v1.3c the card-sentence fallback) → names redacted again → one row. Control-arm rows, and every row in VIDEO_RECO_MODE=shadow, are 'shadow'.
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
const { composeReason, stripBidi } = require('./copy');

const ENGINE_TIMEOUT_MS = 60000; // the LLM call is capped at 45 s (select.js); the sender awaits this after the report has gone
const RETRY_MIN_LEFT_MS = 20000; // v1.3b: the one validation retry runs only with ≥ 20 s of the engine budget left
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

function sumUsage(a, b) {
  const out = { ...(a || {}) };
  for (const [k, n] of Object.entries(b || {})) out[k] = typeof n === 'number' && typeof out[k] === 'number' ? out[k] + n : n;
  return out;
}

function inapplicableRows(analysis) {
  const out = [];
  for (const d of Object.values((analysis && analysis.domains) || {})) {
    for (const r of (d && d.indicators) || []) if (r && r.applicable === false) out.push(String(r.id));
  }
  return out;
}

// textReason values under which the target is still a teaching MOVE (null: tag route only; empty: its pool emptied).
const MOVE_REASONS = new Set([null, 'empty']);

/**
 * The chosen chapter does not carry the step indicator (R4). null when there is no step indicator (card_text, phase).
 * A 37-id is compared with fico_main37 only and a v4 id with fico only: the schemes share ids with other meanings
 * (37-B7 = use of the plan, v4-B7 = closure).
 */
function tagMismatch(t, segment) {
  if (t.source === 'card_text' || t.source === 'phase' || !(t.storedIndicator || t.indicator)) return null;
  const is37 = t.scheme === 'fico_main_37';
  const v4 = is37 && t.native37 ? [] : (t.indicators || []).filter(Boolean);
  const v4Ids = (segment.fico || []).map((f) => f && f.indicator);
  const hit37 = is37 && (segment.fico_main37 || []).includes(t.storedIndicator);
  return !(hit37 || v4.some((id) => v4Ids.includes(id)));
}

/** The step-text route's words (v1.3 R3): the card's action, the scorer's try-tomorrow, the thing to try, the indicator's name. */
function stepTextOf(t, analysis, card) {
  const fa = (analysis && analysis.focus_area) || {};
  const thing = card && card.thing_to_try;
  return {
    action: (card && card.action) || '',
    tryTomorrow: typeof fa.try_this_tomorrow === 'string' ? fa.try_this_tomorrow : '',
    thingToTry: typeof thing === 'string' ? thing : (thing && typeof thing.text === 'string' ? thing.text : ''),
    name: t.source === 'card_text' ? '' : (t.name || (t.row && t.row.name) || ''),
  };
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

/**
 * The card as the engine reads it. The observe path (hook A2) passes the stored prioritized_action record, whose
 * indicator sits under `target` (uptake-loop buildRecord); a phase target has none and stays a card_text card.
 */
function cardOf(card) {
  if (!card || typeof card !== 'object' || card.indicator) return card;
  const t = card.target;
  return t && t.indicator && t.kind !== 'phase' ? { ...card, indicator: t.indicator } : card;
}

async function compute(a, d, state) {
  const { session, analysis, loop, coachingSessionId } = a;
  const card = cardOf(a.card);
  const { store, catalog } = d;
  // The observe path (hook A2) has no next step of its own: the coach-edited analysis decides it, as the hero did.
  const nextStep = a.nextStep === undefined ? require('../next-step').selectNextStep(analysis, null) : a.nextStep; // eslint-disable-line global-require
  const existing = await store.readForSession(coachingSessionId);
  if (existing) return existing;

  const arm = assignArm(session.user_id, d.env);
  const sr = (analysis && analysis.subject_resolution) || {};
  const subject = sr.code && (sr.confidence === 'high' || sr.confidence === 'medium') ? sr.code : null;
  const t = target.pick(analysis, nextStep, card, catalog, { subject });
  // A teacher with no stored language reads the copy in the lesson's language (⛔3, red-team 19:50Z): never a 'preferred'.
  const pref = session.users && session.users.preferred_language;
  const hasPref = typeof pref === 'string' && pref.trim() !== '';
  // A lesson language outside {en, ur} (a 'hindi' transcript) is unknown, never clamped to en (red-team 19:55Z).
  const rawTranscript = typeof session.transcript_language === 'string' ? session.transcript_language.trim().toLowerCase() : '';
  const transcriptLanguage = ['en', 'ur'].includes(rawTranscript) ? rawTranscript : null;
  const language = hasPref ? clampLanguage(pref) : (transcriptLanguage || 'ur');
  const [history, ladder] = await Promise.all([store.recentHistory(session.user_id), store.ladderProgress(session.user_id)]);
  const completed = new Set(ladder.completedModules || []);
  // The ladder a teacher can finish = the recommendable modules (review_3313 F6): a retired module never blocks "complete".
  const ladderModules = catalog.modules.filter((m) => m && m.recommendable !== false);
  const ladderComplete = ladderModules.length > 0 && ladderModules.every((m) => completed.has(Number(m.module_id)));
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
    tag_mismatch: null,
    route: null,
    step_text_query: null,
    repeat_module: false,
    image_strip: false,
  };
  const finish = async (row) => {
    if (state.abandoned) return null;
    return store.write({ ...row, engine_ms: Date.now() - state.t0 });
  };
  state.base = base;

  // An unknown indicator is no longer a none here: the shortlist's step-text route takes it (SPEC v1.3 R3).
  if (t.none && t.none !== 'unknown_indicator' && t.none !== 'unscored_step') {
    // v1.3b NO_MOVE: no route ran, so the row says so (route null, an empty list).
    return finish({ ...base, status: 'none', none_reason: t.none, ...(t.none === 'hole:no_move' ? { candidates: [] } : {}) });
  }

  const lesson = {
    subject,
    grade: await gradeOf(analysis, session.user_id, store),
    topic: (analysis && analysis.topic) || (session.lesson_plan_structured && session.lesson_plan_structured.topic) || null,
    inapplicable: inapplicableRows(analysis),
  };
  const ctx = {
    language,
    preferred: hasPref ? language : null,
    languages: hasPref ? [language, transcriptLanguage, 'mixed'].filter(Boolean) : [language, 'mixed'],
    level: base.teacher_level,
    ladderComplete,
    history,
  };
  const list = shortlist.build(catalog, t, ctx, signalOf(t, analysis, nextStep, card), lesson, stepTextOf(t, analysis, card));
  base.repeat_module = list.repeatModule;
  base.level_match = list.levelMatch || null;
  base.route = list.route || null;
  // bd-8hhqhf r7: the lesson's subject terms + topic words are never a child's name, in the prompt or the stored text.
  const vocab = select.subjectVocab();
  const oovVocab = select.topicVocab(analysis && analysis.topic);
  const people = { teacher: session.users && session.users.name, vocab, oovVocab };
  // F1: the card's action (it opens with the teacher's name in prod) is stored redacted (V1.7.1 "no names"); the BM25
  // query itself ran on the raw words. Only the action: the redactor masks Title-Case indicator names too.
  const st = stepTextOf(t, analysis, card);
  base.step_text_query = list.stepTextQuery ? shortlist.stepQuery({ ...st, action: prompt.redact(st.action, people) }) || null : null;
  if (list.route === 'step_text') base.alias_kind = list.textReason;
  if (!list.candidates.length) return finish({ ...base, status: 'none', none_reason: list.noneReason || 'hole' });

  const row = t.row || {};
  const up = (analysis && analysis.uptake) || {};
  const ex = prompt.excerpts(session, { timestamp: row.timestamp, uptakeMoment: up.moment }, people);
  const rawEx = prompt.rawExcerpts(session, { timestamp: row.timestamp, uptakeMoment: up.moment }); // bd-8hhqhf: placeholder check
  // vr-3: only the `Quote:` part of the scorer's evidence is shown or citable; without one the line is omitted.
  const scorerQuote = t.source === 'card_text' ? '' : prompt.redact(target.scorerQuoteOnly(t.row), people);
  const uptakeQuote = t.source === 'card_text' && up.moment ? prompt.redact(up.moment, people) : '';
  // scale-run 081240: an empty transcript has no moment, whatever the scorer wrote ("No transcript recorded.")
  const noTranscript = !prompt.transcriptLines(session).length;
  if (noTranscript || (!ex.length && !scorerQuote && !uptakeQuote)) {
    return finish({ ...base, status: 'none', none_reason: 'no_moments', candidates: list.candidates });
  }
  const step = (nextStep && nextStep.target) || {};
  const fa = (analysis && analysis.focus_area) || {};
  const text = prompt.build({
    target: t.none ? { ...t, indicator: t.storedIndicator } : t, // unknown 37-id: the prompt names the id the report scored
    // Names never reach the model: the card's action opens with the teacher's name in prod; the rationale is free text.
    rationale: prompt.redact(step.rationale || fa.rationale || '', people),
    tryText: prompt.redact((card && card.action) || step.try || fa.try_this_tomorrow || '', people),
    subject,
    excerpts: ex,
    candidates: list.candidates,
    catalog,
    scorerQuote,
    uptakeQuote,
    topRung: t.topRung || (t.scheme === 'fico_main_37' ? 4 : 2),
    reportLanguage: language, // vr-5: a report language ≠ the lesson's → paraphrase the moment, quote ≤ 6 words
    lessonLanguage: transcriptLanguage,
  });
  const vopts = {
    stepIndicator: t.stepIndicator, indicators: t.indicators, source: t.source, catalog, textRoute: !!list.textReason,
    teacherName: people.teacher, scorerQuote: scorerQuote || uptakeQuote, // §3.5 [v1.3] d: the Quote: part, never evidence_summary
    rawExcerpts: rawEx, vocab, oovVocab,
    // red7 074627: a scorer-path quote must be a transcript line; redacted once, only when that path is reached
    fullLines: (() => { let all = null; return () => (all = all || prompt.transcriptLines(session).map((l) => prompt.redact(l, people))); })(),
  };
  const check = (r) => (r.truncated ? { ok: false, none: 'llm_truncated', confidence: undefined } : select.validate(r.pick, list, ex, vopts));
  let res = await select.pick({ prompt: text, deps: d, timeoutMs: a.llmTimeoutMs });
  let v = check(res);
  let attempts = 1;
  let firstNone = null;
  // v1.3b: ONE more call when the answer broke a validation rule and the budget allows; the appendix names the rule.
  const left = (a.timeoutMs || ENGINE_TIMEOUT_MS) - (Date.now() - state.t0);
  if (!v.ok && /^validation:/.test(v.none) && left >= RETRY_MIN_LEFT_MS) {
    attempts = 2;
    firstNone = v.none;
    try {
      const again = await select.pick({
        prompt: text + prompt.retryAppendix(v.none), deps: d, timeoutMs: Math.min(a.llmTimeoutMs || select.LLM_TIMEOUT_MS, left - 1000),
      });
      res = { ...again, usage: sumUsage(res.usage, again.usage) };
      v = check(again);
    } catch (e) { /* the first answer's none stands */ }
  }
  // r-ab EVENTS_SCHEMA §3b (V1.7.2): the language facts the STOP_lang_null guardrail reads, on every row with a call.
  const withLlm = {
    ...base, candidates: list.candidates, model: res.model, usage: res.usage, attempts, first_none_reason: firstNone,
    report_language_null: !hasPref, lesson_language: hasPref ? transcriptLanguage : language,
  };
  // v1.3c (b): the retry failed too, on a validation rule, but the pick is a shortlisted chapter → the card's own sentence.
  let fallback = null;
  if (!v.ok && attempts === 2 && res.pick && res.pick.seg_id) {
    const seg = catalog.segment(String(res.pick.seg_id));
    fallback = seg && select.cardFallback({
      none: v.none, segId: res.pick.seg_id, shortlist: list, sentence: (card && card.action) || step.try || fa.try_this_tomorrow || '',
      startS: seg.segment.start_s, endS: seg.segment.end_s, teacherName: people.teacher, module: seg.module, subject, vocab,
    });
  }
  if (!v.ok && !fallback) return finish({ ...withLlm, status: 'none', none_reason: v.none, ...(v.confidence === undefined ? {} : { confidence: v.confidence }) });

  const p = res.pick;
  const hit = catalog.segment(String(p.seg_id));
  // bd-8hhqhf: the model's own bidi controls are dropped before the quotes are isolated (red7 C3: a stray PDI).
  const said = fallback || { reason_en: stripBidi(String(p.reason_en)).trim(), reason_ur: stripBidi(String(p.reason_ur)).trim() };
  const c = Number(p.confidence);
  // v1.3c (a) ⛔9: the reasons and the quote are stored (and so sent) after the non-strict name redactor.
  const clean = (x) => select.postRedact(x, people.teacher, vocab);
  const cand = list.candidates.find((x) => x.seg_id === hit.segment.seg_id) || {};
  const chosen = t.source === 'card_text' || t.source === 'phase' ? (((hit.segment.fico || [])[0] || {}).indicator || null) : null;
  // bd-8hhqhf (scale-run 070730, COS 070808): `indicator` is in the analysis's own scheme. On fico_main_37 that is the
  // chapter's main-37 tag, never a v4 id under a 37 label; `catalog_indicator` keeps the v4 tag.
  const stored = t.scheme === 'fico_main_37' ? ((hit.segment.fico_main37 || [])[0] || null) : chosen;
  // red7 070727: the isolate goes around the span the validator accepted as the moment (inner quotes stay one run).
  const accepted = !fallback && p.moment && p.moment.quote ? clean(stripBidi(String(p.moment.quote))) : null;
  const mismatch = tagMismatch(t, hit.segment);
  const route = cand.route || list.route || null;
  return finish({
    ...withLlm,
    ...(t.source === 'card_text' ? { indicator: stored, catalog_indicator: chosen } : {}),
    route,
    alias_kind: route === 'step_text' ? list.textReason : base.alias_kind,
    level_match: cand.level_match || base.level_match,
    tag_mismatch: mismatch,
    // R4: "a second ask" — on a move indicator it is the raw mismatch; on a label / hole / unknown / card target
    // the step IS the card's sentence and the chapter was retrieved by it, so it is false (tag_mismatch says the rest).
    differs_from_step: MOVE_REASONS.has(list.textReason) ? mismatch === true : false,
    status: videoRecoMode(d.env) === 'shadow' || arm !== 'video' ? 'shadow' : 'shown',
    module_id: hit.module.module_id,
    seg_id: hit.segment.seg_id,
    start_s: hit.segment.start_s,
    end_s: hit.segment.end_s,
    language_match: cand.language_match || null,
    chapter_language: hit.segment.language || hit.module.language || null,
    reason_en: composeReason(clean(said.reason_en), 'en', accepted), // bd-8hhqhf: no log-line prefix; the moment renders in place
    reason_ur: composeReason(clean(said.reason_ur), 'ur', accepted),
    moment_at: !fallback && p.moment && p.moment.at ? String(p.moment.at) : null,
    moment_quote: accepted,
    moment_source: fallback ? 'card' : v.momentSource, // 'card' = the v1.3c fallback: no moment, the card's sentence
    confidence: fallback ? (Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0) : v.confidence,
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
