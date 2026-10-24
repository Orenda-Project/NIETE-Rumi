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
const { clampLanguage, resolveUx } = require('../../../config/ux-strings');
const { videoRecoEnabled, videoRecoAbEnabled, videoRecoMode, videoRecoAllowlist } = require('./flags');
const { assignArm, AB_SALT } = require('./arm');
const target = require('./target');
const shortlist = require('./shortlist');
const prompt = require('./prompt');
const select = require('./select');
const silence = require('./silence');
const { composeReason, stripBidi } = require('./copy');
const { leadingVocative, relabelRecall } = require('./copy-rules');
const terms = require('./urdu-terms');
const { wordCounts, maskedKeys, nameKey, guarded, scrubNames } = require('./redact-names');

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
// R7d §2: the nones after which the enacted chapters are asked once for another moment, rather than silence.
const SECOND_MOMENT = new Set(['llm_none', 'validation:quote', 'validation:placeholder', 'validation:not_moment', 'validation:routine']);
// R7f (COS 223858 1c; panel Q117 Q136): the closure chapters a closing card falls back to, in this order (47-s6 is the
// panel's named clip: «what did we learn today?» in Urdu, 61 s).
const CLOSURE_CHAPTERS = ['47-s6', '11-s5'];
// R7j (COS 022905 §3): the modules that need their own moment in the excerpt for a C/D-row card
const MODULE_MOMENT = Object.freeze({ 96: (ex) => silence.groupMoment(ex), 148: (ex) => silence.assessMoment(ex) });
// R7g (COS 002603 1c): the chapter a why / wait-time card's frame moves to when the model's chapter is another move
const WHY_SWAP_CHAPTER = '51-s1';
// R7f (COS 223858 1b): the rules whose refusal goes straight to the card's own sentence (no retry)
// R7g (1b): …and a reader's Urdu line in the wrong tense or voice (the card frame's Urdu is 94.3% ok on v6)
// R7j (§5): …and a cited greeting, page call, filler or echo («routine»)
const DIRECT_FALLBACK = new Set(['validation:no_gap', 'validation:not_gap', 'validation:urdu_form', 'validation:routine']);

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
    // R7d §4: what the card is about when it carries no indicator (the scorer's focus area; never a route of its own)
    indicator: (card && card.indicator) || fa.indicator || null,
    scheme: t.scheme || null, // R7e: the card_text tag check reads the indicator in the analysis's own scheme
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
/** The step's try sentence when the card has no action (the fallback's sentence, the same order). */
function step0(nextStep, analysis) {
  const step = (nextStep && nextStep.target) || {};
  const fa = (analysis && analysis.focus_area) || {};
  return step.try || fa.try_this_tomorrow || '';
}

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
  // R7d (⛔9, Q086): the teacher's class roster, in memory for this run only (a store without it → no roster check)
  const [history, ladder, rosterWords] = await Promise.all([store.recentHistory(session.user_id), store.ladderProgress(session.user_id),
    typeof store.rosterNames === 'function' ? store.rosterNames(session.user_id) : []]);
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
  const step = (nextStep && nextStep.target) || {};
  const fa = (analysis && analysis.focus_area) || {};
  const cardSentence = (card && card.action) || step0(nextStep, analysis);
  const lines = prompt.transcriptLines(session);
  const grade = await gradeOf(analysis, session.user_id, store);
  // R7b silence (silence.js, panel §6.1): a subject label off its subject, and B6 with no mixed-level moment, are no move.
  // R7f (panel Q102 Q127 Q139): …unless the label's sentence asks for open questions on a lesson whose children answer in
  // a word: then the questioning chapters the engine enacts are its list (the evidence test is the lesson's own answers).
  const labelOpen = silence.labelOffSubject(t.scheme, t.storedIndicator, shortlist.subjectId(subject))
    && silence.openQuestionCard(cardSentence) && silence.closedAnswers(lines, { grade });
  if (!labelOpen && silence.labelOffSubject(t.scheme, t.storedIndicator, shortlist.subjectId(subject))) {
    return finish({ ...base, status: 'none', none_reason: 'silence:label_subject', candidates: [] });
  }
  const levelsMoment = silence.levelsMoment(lines);
  if (t.storedIndicator === 'B6' && !levelsMoment) {
    return finish({ ...base, status: 'none', none_reason: 'silence:no_levels_moment', candidates: [] });
  }

  const lesson = {
    subject,
    grade,
    topic: (analysis && analysis.topic) || (session.lesson_plan_structured && session.lesson_plan_structured.topic) || null,
    inapplicable: inapplicableRows(analysis),
    levelsMoment,
  };
  const ctx = {
    language,
    preferred: hasPref ? language : null,
    languages: hasPref ? [language, transcriptLanguage, 'mixed'].filter(Boolean) : [language, 'mixed'],
    level: base.teacher_level,
    ladderComplete,
    history,
  };
  let list = shortlist.build(catalog, t, ctx, signalOf(t, analysis, nextStep, card), lesson, stepTextOf(t, analysis, card));
  if (labelOpen) {
    const four = shortlist.enacted(catalog, ctx, lesson);
    list = { ...list, candidates: four.candidates, repeatModule: four.repeatModule, noneReason: four.candidates.length ? null : 'no_target', route: 'enacted' };
  }
  // R7c §4: 51-s1 before 51-s3 for a why/how card on a lesson whose children answer in a word
  list.candidates = shortlist.whyFirst(list.candidates, catalog, {
    apply: silence.whyCard(cardSentence) && silence.closedAnswers(lines, { grade: lesson.grade }), history,
  });
  // R7j (COS 022905 §3; Z001 Z218): a goal-on-board D6/B1 card → 47-s1, not 47-s3
  list.candidates = shortlist.goalFirst(list.candidates, catalog, { indicator: t.storedIndicator || (card && card.indicator), sentence: stripBidi(String(cardSentence || '')), history });
  base.repeat_module = list.repeatModule;
  base.level_match = list.levelMatch || null;
  base.route = list.route || null;
  // bd-8hhqhf r7: the lesson's subject terms + topic words are never a child's name, in the prompt or the stored text.
  const vocab = select.subjectVocab();
  const oovVocab = select.topicVocab(analysis && analysis.topic);
  // red7 013349: the lesson's word counts (the redactor's position-rule guard) and the raw roster (the quote/reason check)
  const people = { teacher: session.users && session.users.name, vocab, oovVocab, roster: select.rosterSet(rosterWords), rosterRaw: select.rosterRaw(rosterWords),
    counts: wordCounts(prompt.transcriptLines(session)) };
  // R7j (COS 022905 §1): the lesson's name set — the roster as it is and the strict redactor's guarded masks — for the ONE
  // output gate in emit; never an input to the model, validation or routing (red7 HOLD 023908 H2)
  people.names = new Set([...maskedKeys(prompt.transcriptLines(session), people), ...people.rosterRaw]);
  // F1: the card's action (it opens with the teacher's name in prod) is stored redacted (V1.7.1 "no names"); the BM25
  // query itself ran on the raw words. Only the action: the redactor masks Title-Case indicator names too.
  const st = stepTextOf(t, analysis, card);
  base.step_text_query = list.stepTextQuery ? shortlist.stepQuery({ ...st, action: prompt.redact(st.action, people) }) || null : null;
  if (list.route === 'step_text') base.alias_kind = list.textReason;
  // R7f (COS 223858 1c; panel Q075 Q151 wrong, Q117 Q136 owed): a closure card — B10 (v4 B7), or no indicator and a
  // when-clause at the lesson's end — has its gap at the END of the lesson, whatever its own shortlist holds.
  const cardInd = t.storedIndicator || st.indicator || null;
  const bareCard = stripBidi(String(cardSentence || '')).slice(leadingVocative(stripBidi(String(cardSentence || ''))));
  const closure = (cardInd === 'B10' && t.scheme !== 'fico_v4') || (cardInd === 'B7' && t.scheme === 'fico_v4') || (!cardInd && silence.closingCard(bareCard));
  // red7 E3 (R7f e kept): a D3 card over a lesson where no child speaks keeps its 50-s2 card path even with no route (a v4 hole)
  const d3Monologue = (t.storedIndicator || t.stepIndicator) === 'D3' && silence.monologue(lines);
  if (!list.candidates.length && !closure && !d3Monologue) return finish({ ...base, status: 'none', none_reason: list.noneReason || 'hole' });

  const row = t.row || {};
  const up = (analysis && analysis.uptake) || {};
  const ex = prompt.excerpts(session, { timestamp: row.timestamp, uptakeMoment: up.moment }, people);
  const rawEx = prompt.rawExcerpts(session, { timestamp: row.timestamp, uptakeMoment: up.moment }); // bd-8hhqhf: placeholder check
  // R7j (COS 022905 §3; panel v7 Z192 Z392 Z235 ⛔2): group projects (96) and assessment rubrics (148) serve a C-row, D-row or
  // indicator-less card only when the excerpt shows group work or an assessment; else they are not offered
  if (!cardInd || /^[CD]\d/.test(String(cardInd))) {
    const keep = (c) => { const hit = catalog.segment(c.seg_id); const m = hit && Number(hit.module.module_id); return !MODULE_MOMENT[m] || MODULE_MOMENT[m](ex); };
    list.candidates = list.candidates.filter(keep);
  }
  // vr-3: only the `Quote:` part of the scorer's evidence is shown or citable; without one the line is omitted.
  const scorerQuote = t.source === 'card_text' ? '' : prompt.redact(target.scorerQuoteOnly(t.row), people);
  const uptakeQuote = t.source === 'card_text' && up.moment ? prompt.redact(up.moment, people) : '';
  // scale-run 081240: an empty transcript has no moment, whatever the scorer wrote ("No transcript recorded.")
  const noTranscript = !lines.length;
  if (noTranscript || (!ex.length && !scorerQuote && !uptakeQuote)) {
    return finish({ ...base, status: 'none', none_reason: 'no_moments', candidates: list.candidates });
  }
  // R7c (Q194): a transcript that is mostly a recogniser loop has no moment, whatever the scorer quoted from it
  if (silence.degenerate(lines)) {
    return finish({ ...base, status: 'none', none_reason: 'no_moments:degenerate', candidates: list.candidates });
  }
  // R7e (COS 185329): "proven chapters" — set, a pick off the list is none/'allowlist' in either arm; null = today
  const allow = videoRecoAllowlist(d.env);
  const offList = (segId) => !!allow && !allow.has(String(segId));
  /** R7f: the card's own sentence on the first of `ids` this teacher may get (no model call) → {said, segId, list} | null. */
  const fixedFallback = (ids, none, route) => {
    const pool = shortlist.enacted(catalog, ctx, lesson, ids);
    const cands = pool.candidates.filter((c) => !offList(c.seg_id)).map((c) => ({ ...c, route }));
    const fixedList = { ...list, candidates: cands, repeatModule: pool.repeatModule, route };
    for (const c of cands) {
      const hit = catalog.segment(c.seg_id);
      const said = hit && select.cardFallback({
        none, segId: c.seg_id, shortlist: fixedList, sentence: cardSentence, startS: hit.segment.start_s, endS: hit.segment.end_s,
        teacherName: people.teacher, module: hit.module, subject, vocab, oovVocab, segment: hit.segment, language, roster: people.roster, rosterRaw: people.rosterRaw,
      });
      if (said) return { said, segId: c.seg_id, list: fixedList };
    }
    return null;
  };
  const lessonLanguage = { report_language_null: !hasPref, lesson_language: hasPref ? transcriptLanguage : language };
  // …so when no excerpt line reaches that end, no model is asked: the card's closing move goes to a closure chapter, else nothing.
  // red7 230552 C2: a scorer's quote the model may cite is part of what it sees (the line, found in the transcript)
  const citable = [scorerQuote, uptakeQuote].filter(Boolean).map((q) => lines.find((l) => select.quoteFound(q, [l]))).filter(Boolean);
  if (closure && !silence.reachesEnd([...ex, ...citable], lines)) {
    const fixed = silence.closingMove(bareCard) ? fixedFallback(CLOSURE_CHAPTERS, 'validation:closure_early', 'closure') : null;
    if (!fixed) return finish({ ...base, status: 'none', none_reason: 'closure:no_end', candidates: list.candidates });
    return emit({ res: { pick: { seg_id: fixed.segId }, model: null, usage: {} }, pickList: fixed.list, fallback: fixed.said, v: { ok: false, none: null },
      withLlm: { ...base, candidates: fixed.list.candidates, repeat_module: !!fixed.list.repeatModule, attempts: 0, first_none_reason: null, ...lessonLanguage } });
  }
  if (!list.candidates.length && d3Monologue) {
    const fixed = fixedFallback(['50-s2'], 'validation:no_child_turn', 'enacted');
    if (!fixed) return finish({ ...base, status: 'none', none_reason: list.noneReason || 'hole' });
    return emit({ res: { pick: { seg_id: fixed.segId }, model: null, usage: {} }, pickList: fixed.list, fallback: fixed.said, v: { ok: false, none: null },
      withLlm: { ...base, candidates: fixed.list.candidates, repeat_module: !!fixed.list.repeatModule, attempts: 0, first_none_reason: 'validation:no_child_turn', ...lessonLanguage } });
  }
  if (!list.candidates.length) return finish({ ...base, status: 'none', none_reason: list.noneReason || 'hole' });
  const promptArgs = {
    target: t.none ? { ...t, indicator: t.storedIndicator } : t, // unknown 37-id: the prompt names the id the report scored
    // Names never reach the model: the card's action opens with the teacher's name in prod; the rationale is free text.
    rationale: prompt.redact(step.rationale || fa.rationale || '', people),
    // red7 155809: the card's vocative (the teacher's name, often in a spelling users.name cannot match) never reaches the model
    tryText: prompt.redact(((s) => s.slice(leadingVocative(s)))(stripBidi(String((card && card.action) || step.try || fa.try_this_tomorrow || ''))), people),
    subject,
    excerpts: ex,
    candidates: list.candidates,
    catalog,
    scorerQuote,
    uptakeQuote,
    topRung: t.topRung || (t.scheme === 'fico_main_37' ? 4 : 2),
    reportLanguage: language, // vr-5: a report language ≠ the lesson's → paraphrase the moment, quote ≤ 6 words
    lessonLanguage: transcriptLanguage,
  };
  const text = prompt.build(promptArgs);
  const vopts = {
    stepIndicator: t.stepIndicator, indicators: t.indicators, source: t.source, catalog, textRoute: !!list.textReason,
    teacherName: people.teacher, scorerQuote: scorerQuote || uptakeQuote, // §3.5 [v1.3] d: the Quote: part, never evidence_summary
    rawExcerpts: rawEx, vocab, oovVocab, roster: people.roster, rosterRaw: people.rosterRaw, topic: lesson.topic, grade: lesson.grade, // R7d §5
    cardIndicator: cardInd, // R7f 1a: a B6 card's moment shows the levels
    labelClosed: labelOpen, // R7g 1a (Z199): the label class cites a closed question
    reader: language, // R7g 1b: tense and voice are refused on the reader's Urdu line only
    // red7 074627: a scorer-path quote must be a transcript line; redacted once, only when that path is reached
    fullLines: (() => { let all = null; return () => (all = all || prompt.transcriptLines(session).map((l) => prompt.redact(l, people))); })(),
  };
  let pickList = list; // R7c §7: the enacted-chapters second pass answers from its own list
  // red7 194127 (Q170): a rejected moment from no lesson means the lesson gave none; no card fallback either. R7f (Q090
  // Q179): only a line spoken while no lesson is happening counts — a greeting cited by a retry no longer does.
  let routineSeen = false;
  const check = (r, l = pickList, o = vopts) => {
    const out = r.truncated ? { ok: false, none: 'llm_truncated', confidence: undefined } : select.validate(select.groundReasons(r.pick, catalog), l, ex, o); // R7d §6: the grounded text is what is checked
    if (!out.ok && (out.lessonless || select.lessonlessQuote(r.pick, vopts.fullLines))) routineSeen = true;
    return out;
  };
  let res = await select.pick({ prompt: text, deps: d, timeoutMs: a.llmTimeoutMs });
  let v = check(res);
  let attempts = 1;
  let firstNone = null;
  // v1.3c (b): the retry failed too, on a validation rule, but the pick is a shortlisted chapter → the card's own sentence.
  // `direct` (R7f): a rule whose answer IS the card's sentence takes it on the first answer, with no retry.
  const cardFallbackFor = ({ direct = false } = {}) => {
    if (v.ok || (attempts < 2 && !direct) || routineSeen || !res.pick || !res.pick.seg_id) return null;
    if (silence.testPeriod(lines)) return null; // red7 H1 (210805, T1): no lesson for the sentence to attach to
    // R7f 1a (red7 230552 A1/A3): a step-text pick, or a differentiation card, rests on its moment alone — refused, it is
    // silence (as the levels rule), never the card's sentence on a chapter the card's words or label happened to reach
    const cand = (pickList.candidates || []).find((x) => x.seg_id === String(res.pick.seg_id));
    if ((cand && cand.route === 'step_text') || cardInd === 'B6' || silence.levelsCard(cardSentence)) return null;
    const seg = catalog.segment(String(res.pick.seg_id));
    const sentence = (card && card.action) || step.try || fa.try_this_tomorrow || '';
    // R7g (COS 002603 1c; panel Z040 Z077 Z135 Z063 Z167): "this clip shows one way to do it" only on a chapter whose move the
    // card names; else 51-s1 when the card asks for a why / how / open question or wait time, else silence
    const rescue = seg && !select.cardMoveOk(sentence, seg.segment);
    if (rescue && String(res.pick.seg_id) === WHY_SWAP_CHAPTER && !silence.whyWaitCard(sentence)) return null;
    if (rescue && String(res.pick.seg_id) !== WHY_SWAP_CHAPTER) { // (the pick already is 51-s1 on a why/wait card: its frame stands)
      if (!silence.whyWaitCard(sentence)) return null;
      // G3 (gold b4d78b5e: no second ask): on a move step 51-s1 only when it carries the step's tag, as the second pass
      const why = catalog.segment(WHY_SWAP_CHAPTER);
      if (!why || (MOVE_REASONS.has(list.textReason) && tagMismatch(t, why.segment) === true)) return null;
      const fixed = fixedFallback([WHY_SWAP_CHAPTER], v.none, 'enacted');
      if (!fixed) return null;
      res = { ...res, pick: { ...res.pick, seg_id: fixed.segId } };
      pickList = fixed.list;
      return fixed.said;
    }
    return seg && select.cardFallback({
      none: v.none, segId: res.pick.seg_id, shortlist: pickList, sentence,
      startS: seg.segment.start_s, endS: seg.segment.end_s, teacherName: people.teacher, module: seg.module, subject, vocab, oovVocab,
      segment: seg.segment, // R7b: the clause the clip serves
      language, // R7c: the reader's line is the one that must fit and the one that quotes (was never passed: always 'en')
      roster: people.roster,
      rosterRaw: people.rosterRaw, // S12
      plainIfNamed: select.cardMoveOk(sentence, seg.segment, { strict: true }), // R7g 1e (Z100; Z078 stays silent)
    });
  };
  // R7f (COS 223858 1b): a reason that names no gap, or a cited line that shows none, goes straight to the card's own
  // sentence (96.9% right/acceptable on v5, against 86.9% for a model moment); the retry only when that cannot be built.
  let fallback = !v.ok && DIRECT_FALLBACK.has(v.none) ? cardFallbackFor({ direct: true }) : null;
  if (fallback) firstNone = v.none; // the refused rule stays on the row
  // v1.3b: ONE more call when the answer broke a validation rule and the budget allows; the appendix names the rule.
  const left = (a.timeoutMs || ENGINE_TIMEOUT_MS) - (Date.now() - state.t0);
  if (!v.ok && !fallback && /^validation:/.test(v.none) && left >= RETRY_MIN_LEFT_MS) {
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
  // R7c §7 (panel: 7 of the 8 wrong silences were llm_none): the model returned null for a C1/D3/C3 card (or a card_text
  // card asking why/how) on a lesson whose children answer in a word → ONE more call, the four enacted chapters the only
  // shortlist. Its answer is validated like any other (the step gate does not apply: the list is the gate).
  // R7d §2 (panel: validation:quote 0/4 right, placeholder 2/4, not_moment 2/3): a quote the lesson does not have, a
  // placeholder or a routine line ends the same way only after the card fallback was tried, with the rule named.
  const stepId = t.storedIndicator || t.stepIndicator || null;
  const enactedFits = (none) => SECOND_MOMENT.has(none)
    && (shortlist.ENACTED_STEPS.has(stepId) || (t.source === 'card_text' && silence.whyCard(cardSentence)))
    && silence.closedAnswers(lines, { grade: lesson.grade });
  const secondMoment = async () => {
    const left2 = (a.timeoutMs || ENGINE_TIMEOUT_MS) - (Date.now() - state.t0);
    if (!enactedFits(v.none) || left2 < RETRY_MIN_LEFT_MS) return false;
    const four = shortlist.enacted(catalog, ctx, lesson);
    // R7d (gold be2a6d28, G3 "no second ask"): on a move step only the enacted chapters tagged for the step; 51-s1 on a
    // C3 card was a second ask. A card_text / label / hole step has no tag to keep (the list is the gate, as R7c ruled).
    const why = shortlist.whyFirst(four.candidates, catalog, { apply: silence.whyCard(cardSentence), history });
    const forStep = (MOVE_REASONS.has(list.textReason)
      ? why.filter((c) => { const hit = catalog.segment(c.seg_id); return hit && tagMismatch(t, hit.segment) !== true; })
      : why).filter((c) => !offList(c.seg_id));
    const two = { ...list, repeatModule: four.repeatModule, candidates: forStep };
    if (!two.candidates.length) return false;
    attempts += 1;
    firstNone = firstNone || v.none;
    try {
      const appendix = v.none === 'llm_none' ? '' : prompt.retryAppendix(v.none);
      const again = await select.pick({
        prompt: prompt.build({ ...promptArgs, candidates: two.candidates }) + appendix, deps: d, timeoutMs: Math.min(a.llmTimeoutMs || select.LLM_TIMEOUT_MS, left2 - 1000),
      });
      res = { ...again, usage: sumUsage(res.usage, again.usage) };
      pickList = two;
      v = check(again, two, { ...vopts, textRoute: true });
    } catch (e) { /* the first answer's none stands */ }
    return true;
  };
  if (!fallback && v.none === 'llm_none') await secondMoment();
  // r-ab EVENTS_SCHEMA §3b (V1.7.2): the language facts the STOP_lang_null guardrail reads, on every row with a call.
  const withLlm = {
    ...base, candidates: pickList.candidates, repeat_module: !!pickList.repeatModule, model: res.model, usage: res.usage, attempts, first_none_reason: firstNone,
    ...lessonLanguage,
  };
  // red7 H1 (210805, T1): a test period has no lesson for the card's sentence to attach to, whichever rule refused the quote
  if (!v.ok && silence.testPeriod(lines)) routineSeen = true;
  if (!fallback) fallback = cardFallbackFor();
  // R7e: the card's sentence is never sent on an off-list chapter; the (on-list) second pass may still find a moment
  const listRefused = !!fallback && offList(res.pick.seg_id);
  if (listRefused) fallback = null;
  if (!v.ok && !fallback && v.none !== 'llm_none' && await secondMoment()) {
    Object.assign(withLlm, { candidates: pickList.candidates, repeat_module: !!pickList.repeatModule, model: res.model, usage: res.usage, attempts, first_none_reason: firstNone });
    // R7f (COS 223858 e; Q090 Q179): the second pass's own pick, refused on a fallback rule, takes the card's sentence too
    // (its list is the enacted chapters, so never off the allowlist)
    fallback = cardFallbackFor();
  }
  // R7f (COS 223858 e; panel Q036 Q083): a D3 (student-to-student) card over a lesson where no child speaks at all — the
  // lesson itself is the gap the card names; when the model finds no line, the card's sentence goes on 50-s2.
  if (!v.ok && !fallback && !routineSeen && stepId === 'D3' && silence.monologue(lines)) {
    const fixed = fixedFallback(['50-s2'], 'validation:no_child_turn', 'enacted');
    if (fixed) {
      res = { ...res, pick: { ...(res.pick || {}), seg_id: fixed.segId } };
      pickList = fixed.list;
      fallback = fixed.said;
      Object.assign(withLlm, { candidates: pickList.candidates, repeat_module: !!pickList.repeatModule });
    }
  }
  if (!v.ok && !fallback) {
    if (listRefused) return finish({ ...withLlm, status: 'none', none_reason: 'allowlist' });
    return finish({ ...withLlm, status: 'none', none_reason: v.none, ...(v.confidence === undefined ? {} : { confidence: v.confidence }) });
  }
  return emit({ res, pickList, fallback, v, withLlm });

  /** The shown/shadow row for a validated pick or a card fallback (`v` null-ish ok when `fallback` is set). */
  async function emit({ res, pickList, fallback, v, withLlm }) { // eslint-disable-line no-shadow
  const p = select.groundReasons(res.pick, catalog); // R7d §6: the clip half from the chapter, as validated
  const hit = catalog.segment(String(p.seg_id));
  // R7e: before the arm sets status, so the video and the control arm store the same none for an off-list pick
  if (offList(hit.segment.seg_id)) return finish({ ...withLlm, status: 'none', none_reason: 'allowlist' });
  // bd-8hhqhf: the model's own bidi controls are dropped before the quotes are isolated (red7 C3: a stray PDI).
  const asked = p.moment && p.moment.quote; // R7d §6: a what-question is never labelled recall
  const said = fallback || {
    reason_en: relabelRecall(stripBidi(String(p.reason_en)).trim(), 'en', asked), reason_ur: relabelRecall(stripBidi(String(p.reason_ur)).trim(), 'ur', asked),
  };
  // R7i/R7j (COS 021017 §1, 022905 §1; panel v7 Z049 ⛔9): the quote and each reason were redacted as separate texts, and the
  // `named` rule's turn-end test (redact-names.js) depends on what follows a word in the text it reads: «…؟ X؟» ends the
  // quote (masked) but not the reason that re-quotes it (kept). By construction now: one gate (scrubNames) over every
  // teacher-facing string, against the lesson's names plus every name the quote's own redaction masked.
  const names = new Set(people.names);
  const quoteTrace = [];
  const quoted = !fallback && p.moment && p.moment.quote
    ? select.postRedact(stripBidi(String(p.moment.quote)), people.teacher, vocab, people.counts, null, quoteTrace) : null;
  const quoteMasks = new Map();
  for (const x of quoteTrace) if (x.rep === '[a student]' && x.why !== 'oov') quoteMasks.set(nameKey(x.word), (quoteMasks.get(nameKey(x.word)) || 0) + 1);
  for (const k of guarded(quoteMasks, people.counts)) names.add(k);
  const gate = (x) => scrubNames(x, names);
  const accepted = quoted ? gate(quoted) : null;
  // R7g (COS 002603 1b; panel v6: card frame 94.3% Urdu-ok, model-written 66.0%): an English reader's Urdu line (the portal's)
  // is never the model's translation when the card frame exists — the card frame on a chapter whose move the card names,
  // else the model's line only when it passes every Urdu check, else the plain frame. red7 G2: an Urdu reader's English line
  // (96.4% ok on v6, validated whole) stays the model's unless it carries an article slip («asked a questions», Z011 Z168).
  const frameLines = new Set(fallback ? ['en', 'ur'] : []); // the lines that quote the report's own sentence
  // R7j (COS 022905 §2; ped/urdu_terms.json transcript_frame_ur): an Urdu reader's line for a cited moment is the team's
  // frame — the move term (by the model's id) BEFORE the quote, an answer clause only from the file, the chapter's title;
  // no free model clause after the quote, no stub when no move is named
  if (!fallback && language === 'ur' && accepted) {
    said.reason_ur = terms.transcriptLine({ moveId: p.move, answerId: p.answer, quote: accepted, title: hit.segment.title_ur || hit.segment.title_en });
  }
  if (!fallback && (language === 'en' || !select.englishLineOk(said.reason_en))) {
    const other = language === 'en' ? 'ur' : 'en';
    const sentence = (card && card.action) || step.try || fa.try_this_tomorrow || '';
    const args0 = { startS: hit.segment.start_s, endS: hit.segment.end_s, teacherName: people.teacher, module: hit.module, subject, vocab, oovVocab, segment: hit.segment, language, roster: people.roster, rosterRaw: people.rosterRaw };
    const frame = sentence && select.cardMoveOk(sentence, hit.segment) ? select.cardFrame({ ...args0, sentence, plainIfNamed: true }) : null;
    const n = Math.round(Number(hit.segment.end_s) - Number(hit.segment.start_s));
    const checked = other === 'ur' && select.urduLineOk(said.reason_ur);
    said[`reason_${other}`] = frame ? frame[`reason_${other}`] : checked ? said.reason_ur
      : select.plainFrame(other, hit.segment);
    if (frame) frameLines.add(other);
  }
  const c = Number(p.confidence);
  // v1.3c (a) ⛔9: the reasons and the quote are stored (and so sent) after the non-strict name redactor, then the gate.
  const clean = (x) => gate(select.postRedact(x, people.teacher, vocab, people.counts)); // R7j: the one output gate
  // R7j: a quoted card sentence the gate had to change is never shown with a placeholder in it: that line is the plain frame
  const lineOf = (l) => {
    const redacted = select.postRedact(said[`reason_${l}`], people.teacher, vocab, people.counts);
    if (!frameLines.has(l) || gate(redacted) === redacted) return clean(said[`reason_${l}`]);
    return select.plainFrame(l, hit.segment);
  };
  const cand = pickList.candidates.find((x) => x.seg_id === hit.segment.seg_id) || {};
  const chosen = t.source === 'card_text' || t.source === 'phase' ? (((hit.segment.fico || [])[0] || {}).indicator || null) : null;
  // bd-8hhqhf (scale-run 070730, COS 070808): `indicator` is in the analysis's own scheme. On fico_main_37 that is the
  // chapter's main-37 tag, never a v4 id under a 37 label; `catalog_indicator` keeps the v4 tag.
  const stored = t.scheme === 'fico_main_37' ? ((hit.segment.fico_main37 || [])[0] || null) : chosen;
  // red7 070727: the isolate goes around the span the validator accepted as the moment (inner quotes stay one run): `accepted`, above.
  const mismatch = tagMismatch(t, hit.segment);
  const route = cand.route || pickList.route || null;
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
    reason_en: composeReason(lineOf('en'), 'en', accepted), // bd-8hhqhf: no log-line prefix; the moment renders in place
    reason_ur: composeReason(lineOf('ur'), 'ur', accepted, { subject }), // R7d: «عناصر» is factors only in maths
    moment_at: !fallback && p.moment && p.moment.at ? String(p.moment.at) : null,
    moment_quote: accepted ? select.storedQuote(accepted) : null, // red7 091238: no speaker label or stamp on /v
    moment_source: fallback ? 'card' : v.momentSource, // 'card' = the v1.3c fallback: no moment, the card's sentence
    confidence: fallback ? (Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0) : v.confidence,
    none_reason: null,
  });
  }
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
