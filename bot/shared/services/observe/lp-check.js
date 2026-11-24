'use strict';
/**
 * The lesson plan check in a HITL debrief — the ICT HITL owner's spec "Lesson Plan Check: changes for Rumi" (23 Nov 2026).
 *
 * Three places, one source:
 *   NOTES   the debrief notes' last section, after "For your own conversation" (guide.lp_check): plan done (x of N
 *           moves), one step done as planned, the move most missed (with its time when the recording shows one), every
 *           move of the plan by step (Opening, Explain, We Do, You Do, Check), ✓ done or ✗ missed with what happened, five
 *           ready lines with the coach's cues, and the reminder. No plan linked: one question. Built from the lesson's
 *           own lesson-plan check (analysis_data.lp_fidelity: the plan's moves graded against the classroom recording);
 *           a model only puts the moves in short plain words in the coach's language and fills the five lines, and a
 *           fallback in code writes them when it cannot.
 *   JUDGE   after the debrief, the coach's talk about the plan is judged in five parts, SEPARATELY (feedback.lp_discussion):
 *           covered / the quote / what happened. A part needs a quote; a general line about "the plan" never covers one
 *           (checked here in code, not only asked of the model). NOT SCORED: apart from the 8 behaviours, the score and
 *           FICO, and its own model call, so the 8 behaviours' judge reads exactly what it read before.
 *   WEEK    full discussions (5 of 5) this week against last, the part missed most often, and debriefs with no plan
 *           linked, counted apart and never as a miss (summariseWeek, read by the coach's weekly report).
 *
 * Rides the HITL switch (portal_coach_flow_v2, the portal's own rule: observer-report-copy flowV6OnFor): an observer off
 * it gets notes, report and week exactly as before. The section is written once, with the notes; the judge runs only for
 * notes that carry it, so the switch is read in one place.
 *
 * The plan was for a different lesson (the grader's lesson_mismatch flag), the recording could not be checked, or the
 * check failed: "not assessed", no checklist, no parts — counted with "no plan linked" in the week, never as a miss.
 *
 * FICO 6-12 has none of it (queue #255, bd-o15qnr.51; the operator 24 Nov: "lesson plan moves/fideltiy step to be removed
 * from the fico 6-12"): a FICO-S visit (isFicoSVisit) gets no section, no words call, no judge, and no report or week
 * block; notes written before that are shown and sent without the section (notesFor). FICO17 v6 (grades 1-5) is unchanged.
 */

const STEPS = ['opening', 'explain', 'we_do', 'you_do', 'check'];
const STEP_NAMES = { opening: 'Opening', explain: 'Explain', we_do: 'We Do', you_do: 'You Do', check: 'Check' };
// The plan's phases (fidelity upload-extractor vocabulary) under the spec's five steps; homework is part of Check.
const STEP_OF_PHASE = {
  warm_up: 'opening', hook: 'opening', recall: 'opening', announce: 'opening',
  explain: 'explain',
  guided: 'we_do', peer_review: 'we_do',
  independent: 'you_do',
  exit: 'check', homework: 'check',
};
const DONE = new Set(['executed', 'substituted_equivalent', 'substituted_better']);
// The five parts of the coach's talk about the plan, in the spec's order.
const PARTS = ['name_step', 'as_planned', 'gap', 'ask', 'next_step'];
// Cues after line 4 and line 5 (the notes' existing cue words).
const LINE_CUES = { 3: 'guide_cue_wait', 4: 'guide_cue_name_it' };

const TIME_RX = /\[?(\d{1,2}:\d{2})\]?/;
const SCORE_RX = [/\d+\s*\/\s*\d+/, /\d+\s*%/, /\bscore\b/i];

const text = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : '');
const clip = (s, n) => {
  const t = text(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
const firstTime = (s) => {
  const m = String(s || '').match(TIME_RX);
  return m ? m[1] : null;
};

function log(message, detail) {
  try { require('../../utils/logger').logToFile(message, detail); } catch (_) { /* logging never decides */ }
}

function strings(lang) {
  return require('./observe-strings').observeStrings(lang);
}

// ── The plan and what was done ─────────────────────────────────────────────

/**
 * The lesson's plan as the check found it. Pure.
 * @returns {{state:'no_plan'}|{state:'not_assessed', reason:'mismatch'|'recording'|'unavailable'}|
 *   {state:'ok', done:number, total:number, steps:object[], asPlanned:object|null, mostMissed:object|null}}
 */
function planState(analysis) {
  const lf = analysis && analysis.lp_fidelity;
  if (!lf || typeof lf !== 'object' || lf.status === 'lp_absent') return { state: 'no_plan' };
  if (lf.status !== 'ok' || !Array.isArray(lf.moves) || !lf.moves.length) return { state: 'not_assessed', reason: 'unavailable' };
  const note = lf.moderators && lf.moderators.note;
  if (note === 'lesson_mismatch') return { state: 'not_assessed', reason: 'mismatch' };
  if (note === 'recording_unusable' || lf.recording_unusable === true) return { state: 'not_assessed', reason: 'recording' };

  const byStep = new Map(STEPS.map((k) => [k, []]));
  const order = [];
  let lastStep = 'opening';
  for (const m of lf.moves) {
    if (!m || !m.move_id) continue;
    const step = STEP_OF_PHASE[m.phase] || lastStep;
    lastStep = step;
    const verdict = m.verdict || 'not_done';
    const judged = m.adjudicable !== false && verdict !== 'not_adjudicable';
    const row = {
      id: String(m.move_id),
      step,
      mark: !judged ? 'not_assessed' : DONE.has(verdict) ? 'done' : 'missed',
      partial: verdict === 'partial',
      text: text(m.text),
      evidence: text(m.evidence),
      rationale: text(m.rationale),
      time: firstTime(m.evidence),
      must: (m.bucket || 'must_happen') !== 'optional_extension',
    };
    byStep.get(step).push(row);
    order.push(row);
  }
  if (!order.length) return { state: 'not_assessed', reason: 'unavailable' };

  const steps = STEPS.filter((k) => byStep.get(k).length).map((key) => {
    const moves = byStep.get(key);
    return {
      key,
      done: moves.filter((m) => m.mark === 'done').length,
      total: moves.filter((m) => m.mark !== 'not_assessed').length,
      moves,
    };
  });
  const judgedMoves = order.filter((m) => m.mark !== 'not_assessed');

  // Done as planned: a done move the recording shows, Explain first (the spec's example), then the plan's order.
  const shown = order.filter((m) => m.mark === 'done' && m.evidence);
  const asPlanned = shown.find((m) => m.step === 'explain') || shown.find((m) => m.step !== 'opening') || shown[0] || null;
  // Most missed: the first move of the plan not done at all (a must before an optional one), else the first done in part.
  const missed = order.filter((m) => m.mark === 'missed');
  const worst = missed.find((m) => !m.partial && m.must) || missed.find((m) => !m.partial) || missed[0] || null;
  // Its time only from its own evidence (a move done in part): a move not done at all has no moment in the recording,
  // and a time borrowed from another move points the coach at the wrong minute.
  const mostMissed = worst ? { id: worst.id, step: worst.step, time: worst.time || null } : null;

  return {
    state: 'ok',
    done: judgedMoves.filter((m) => m.mark === 'done').length,
    total: judgedMoves.length,
    steps,
    asPlanned: asPlanned ? { id: asPlanned.id, step: asPlanned.step } : null,
    mostMissed,
  };
}

const allMoves = (s) => (s.steps || []).flatMap((x) => x.moves);
const moveById = (s, id) => allMoves(s).find((m) => m.id === id) || null;

// ── The words: the model's, else the fallback's ────────────────────────────

/** A move's own words, short: its first clause, clipped. */
function shortLabel(m) {
  const first = text(m.text).split(/[;:]\s|\.\s/)[0];
  return clip(first || m.text, 70);
}

function fallbackWords(s, lang) {
  const S = strings(lang);
  const moves = {};
  for (const m of allMoves(s)) {
    moves[m.id] = {
      label: shortLabel(m),
      what: m.mark === 'missed' ? clip(m.rationale, 120) || null : null,
    };
  }
  const ok = s.asPlanned && moveById(s, s.asPlanned.id);
  const miss = s.mostMissed && moveById(s, s.mostMissed.id);
  const okLabel = ok ? moves[ok.id].label : '';
  const missLabel = miss ? moves[miss.id].label : '';
  const missWhat = miss ? moves[miss.id].what || '' : '';
  const tpl = Array.isArray(S.lp_fallback_lines) ? S.lp_fallback_lines : [];
  const missStep = miss ? STEP_NAMES[miss.step] : '';
  const when = s.mostMissed && s.mostMissed.time ? fill(S.lp_when_time, { time: s.mostMissed.time }) : fill(S.lp_when_step, { step: missStep });
  const vars = { step: missStep, ok_step: ok ? STEP_NAMES[ok.step] : '', ok: okLabel, miss: missLabel, what: missWhat, when };
  // No miss at all (every move done): the five lines still name a step and what went as planned.
  const lines = tpl.map((t) => text(fill(t, miss ? vars : { ...vars, step: vars.ok_step, miss: okLabel, what: '' })));
  return {
    moves,
    asPlanned: ok ? okLabel : null,
    mostMissed: miss ? (missWhat || missLabel) : null,
    lines,
  };
}

const scored = (s) => SCORE_RX.some((rx) => rx.test(s));

/**
 * The model's words over the fallback's: every move keeps a label, the five lines are taken whole or not at all.
 * Pure; never throws.
 */
function wordsFrom(result, s, lang) {
  const base = fallbackWords(s, lang);
  const r = result && typeof result === 'object' ? result : {};
  const moves = { ...base.moves };
  const given = r.moves && typeof r.moves === 'object' ? r.moves : {};
  for (const id of Object.keys(moves)) {
    const g = given[id];
    if (!g || typeof g !== 'object') continue;
    const label = clip(g.label, 90);
    const what = clip(g.what_happened, 160);
    if (label && !scored(label)) moves[id] = { ...moves[id], label };
    if (moves[id].what !== null && what && !scored(what)) moves[id] = { ...moves[id], what };
  }
  const lines = Array.isArray(r.lines) && r.lines.length === PARTS.length && r.lines.every((l) => text(l) && !scored(text(l)))
    ? r.lines.map((l) => clip(l, 240)) : base.lines;
  const asPlanned = text(r.as_planned) && !scored(r.as_planned) && base.asPlanned !== null ? clip(r.as_planned, 200) : base.asPlanned;
  const mostMissed = text(r.most_missed) && !scored(r.most_missed) && base.mostMissed !== null ? clip(r.most_missed, 200) : base.mostMissed;
  return { moves, asPlanned, mostMissed, lines };
}

/** What the notes keep (guide.lp_check): the state, and for a plan the words, by step. Pure. */
function buildLpCheck(s, words) {
  if (!s || s.state === 'no_plan') return { v: 1, state: 'no_plan' };
  if (s.state !== 'ok') return { v: 1, state: 'not_assessed', reason: s.reason || 'unavailable' };
  const w = words || { moves: {}, lines: [] };
  const label = (m) => (w.moves[m.id] && w.moves[m.id].label) || shortLabel(m);
  const what = (m) => (m.mark === 'missed' && w.moves[m.id] && w.moves[m.id].what) || null;
  const ok = s.asPlanned && moveById(s, s.asPlanned.id);
  const miss = s.mostMissed && moveById(s, s.mostMissed.id);
  return {
    v: 1,
    state: 'ok',
    done: s.done,
    total: s.total,
    as_planned: ok ? { step: STEP_NAMES[ok.step], text: w.asPlanned || label(ok) } : null,
    most_missed: miss ? { step: STEP_NAMES[miss.step], move: label(miss), time: s.mostMissed.time || null, text: w.mostMissed || what(miss) || null } : null,
    steps: s.steps.map((st) => ({
      key: st.key,
      name: STEP_NAMES[st.key],
      done: st.done,
      total: st.total,
      moves: st.moves.map((m) => ({ id: m.id, mark: m.mark, partial: m.partial, label: label(m), what: what(m) })),
    })),
    lines: (w.lines || []).slice(0, PARTS.length),
  };
}

const LANG_NAME = { ur: 'Urdu (اردو)', en: 'English' };

/** The words prompt: the moves in short plain words, what happened at each miss, and the five lines. */
function wordsPrompt(s, lang) {
  const { URDU_ADDRESS_RULE, URDU_THIRD_PERSON_RULE } = require('../../config/gender-neutral-address');
  const langName = LANG_NAME[lang] || LANG_NAME.en;
  const status = (m) => (m.mark === 'done' ? 'done' : m.mark === 'not_assessed' ? 'not assessed' : m.partial ? 'partly done' : 'missed');
  const plan = s.steps.map((st) => `${STEP_NAMES[st.key]}:\n${st.moves.map((m) => `  - ${m.id} · ${status(m)} · plan: "${clip(m.text, 300)}"${m.evidence ? ` · seen: "${clip(m.evidence, 200)}"` : ''}${m.mark === 'missed' && m.rationale ? ` · what the check found: "${clip(m.rationale, 200)}"` : ''}`).join('\n')}`).join('\n');
  const ok = s.asPlanned && moveById(s, s.asPlanned.id);
  const miss = s.mostMissed && moveById(s, s.mostMissed.id);
  return `You are the NIETE Teaching Assistant, preparing a school officer for the lesson-plan part of their debrief with a teacher they just observed. Below is today's lesson plan, move by move under its steps, with what the lesson-plan check found in the classroom recording. Write in ${langName}. The step names (Opening, Explain, We Do, You Do, Check) stay in English, exactly as given.

1. "moves": for EVERY move id, "label": the move in at most 8 plain words, the way a teacher names it (e.g. "Partner practice: sort the words"); for a move that is missed or partly done, "what_happened": one short line, at most 15 words, on what happened instead, only from what the check found (e.g. "Children answered the teacher instead of each other."); for every other move "what_happened": null.
2. "as_planned": ${ok ? `one short line on move ${ok.id} (${STEP_NAMES[ok.step]}): what the teacher did, as the plan says (e.g. "Explain: showed first, did it together, then children tried alone").` : 'null.'}
3. "most_missed": ${miss ? `one short line on move ${miss.id} (${STEP_NAMES[miss.step]}): what happened instead.` : 'null.'}
4. "lines": exactly 5 lines the officer can say to the teacher, in this order, each only the words said (no stage directions):
   1 name the step: name the ${miss ? STEP_NAMES[miss.step] : 'one'} step of today's plan ("Let's look at the We Do step of today's plan.").
   2 what went as planned: ${ok ? `move ${ok.id}, done as the plan says, with what happened.` : 'one step done as the plan says.'}
   3 the gap, with evidence: ${miss ? `move ${miss.id}, what the plan has there and what happened instead${s.mostMissed.time ? `, at about ${s.mostMissed.time}` : ''}.` : 'the one move to look at again, with the moment.'}
   4 ask what got in the way: ONE open question about what made that move hard today. Never "why didn't you follow the plan?", never yes/no.
   5 the teacher names the next step: an open question so the TEACHER says how they will do that move next time; the officer never supplies it.
Rules: plain words only, never a move id, code or word_with_underscores; no number, score or percentage except a clock time; about the teaching moves, never the teacher as a person. GENDER (mandatory): the officer and the teacher may each be a man or a woman, so every line is gender-neutral. ${URDU_ADDRESS_RULE} ${URDU_THIRD_PERSON_RULE}

Return JSON EXACTLY: { "moves": { "<move id>": { "label": "...", "what_happened": "..." | null } }, "as_planned": "..." | null, "most_missed": "..." | null, "lines": ["<1>", "<2>", "<3>", "<4>", "<5>"] }

TODAY'S PLAN:
${plan}`;
}

// ── FICO 6-12: no lesson plan check ────────────────────────────────────────

/**
 * Whether a visit is FICO 6-12 (FICO-S, any version): its stamp on the row (coaching_sessions.framework, written when the
 * visit starts), on its analysis, or its 6-12 record (analysis_data.obs612, written when the form is in). Pure.
 * @param {object} session  a coaching_sessions row, or { framework, analysis_data } with what of it was read
 */
function isFicoSVisit(session) {
  if (!session || typeof session !== 'object') return false;
  const { isFicoSId } = require('../coaching/frameworks/fico-s');
  const ad = session.analysis_data && typeof session.analysis_data === 'object' ? session.analysis_data : {};
  const rec = ad.obs612 && typeof ad.obs612 === 'object' ? ad.obs612 : {};
  return isFicoSId(session.framework) || isFicoSId(ad.framework) || rec.tool === 'ficos' || isFicoSId(rec.rubric_id);
}

/**
 * The notes as a visit's pages and messages show them: a FICO 6-12 visit's without lp_check (notes written before queue
 * #255 carry one); any other visit's exactly as stored (the same object). The stored notes are never changed. Pure.
 */
function notesFor(session, guide) {
  if (!guide || typeof guide !== 'object' || !Object.prototype.hasOwnProperty.call(guide, 'lp_check')) return guide;
  if (!isFicoSVisit(session)) return guide;
  const { lp_check: _dropped, ...rest } = guide;
  return rest;
}

async function readSwitch(observerUserId, db) {
  const { flowV6OnFor, SWITCH_KEYS } = require('./observer-report-copy');
  const { data: rows, error } = await db.from('app_settings').select('key,value').in('key', SWITCH_KEYS);
  if (error) return false;
  const values = new Map((rows || []).map((r) => [r.key, r.value]));
  const { data: who } = await db.from('users').select('id,role').eq('id', observerUserId).maybeSingle();
  return flowV6OnFor(values, { id: observerUserId, role: who && who.role }) === true;
}

/**
 * The notes' lesson plan check for this visit, or null when the observer is off the HITL switch (or the language has no
 * rubric-shaped notes). Never throws: a failed switch read is off; a failed words call falls back to code's words.
 * buildDebriefGuide starts it beside the notes' own model call, so the notes take no longer to write.
 * @param {object} session  coaching_sessions row (analysis_data, observer_user_id)
 * @param {string} lang     the coach's language
 * @param {object} [deps]   { switchOn(session) → bool, complete(prompt) → {result} } for tests
 */
async function lpCheckFor(session, lang, deps = {}) {
  if (lang !== 'ur' && lang !== 'en') return null;
  // FICO 6-12 (queue #255): no section at all, so no switch read and no model call either.
  if (isFicoSVisit(session)) return null;
  try {
    const switchOn = deps.switchOn || ((s) => (s && s.observer_user_id ? readSwitch(s.observer_user_id, require('../../config/supabase')) : false));
    if (!(await switchOn(session))) return null;
  } catch (err) {
    log('[lp-check] switch read failed — the notes go without the section', { sessionId: session && session.id, error: err && err.message });
    return null;
  }
  const s = planState((session && session.analysis_data) || {});
  if (s.state !== 'ok') return buildLpCheck(s);
  let words;
  try {
    const complete = deps.complete || ((prompt) => require('../gpt5-mini.service').completeJson(prompt, {
      maxTokens: 6000, label: 'observeLpCheck', job: 'coaching.observeDebrief',
    }));
    const { result } = await complete(wordsPrompt(s, lang));
    words = wordsFrom(result, s, lang);
  } catch (err) {
    log('[lp-check] words call failed — the fallback writes them', { sessionId: session && session.id, error: err && err.message });
    words = fallbackWords(s, lang);
  }
  return buildLpCheck(s, words);
}

/**
 * The notes with their lesson plan check, for an observer on the HITL switch; anything else exactly as it came: a guide
 * written whole (the /observe2 brief, an FDE talk), the Swahili steps, an observer off the switch. Never throws.
 * `deps.lpCheck`: the check already started (a promise of lpCheckFor's answer).
 */
async function attachLpCheck(guide, session, lang, deps = {}) {
  if (!guide || typeof guide !== 'object' || typeof guide.text === 'string' || !Array.isArray(guide.conversation)) return guide;
  let lp = null;
  try {
    lp = deps.lpCheck ? await deps.lpCheck : await lpCheckFor(session, lang, deps);
  } catch (err) {
    log('[lp-check] could not be added to the notes', { sessionId: session && session.id, error: err && err.message });
  }
  return lp ? { ...guide, lp_check: lp } : guide;
}

// ── WhatsApp: the section as its own message ───────────────────────────────

// WhatsApp refuses a text body over 4,096 (the send is not clipped): keep the section well inside it.
const WHATSAPP_ROOM = 3900;

/**
 * The section as WhatsApp text, or '' when the notes have none. A long plan first loses the per-move notes, then the
 * checklist; the facts, the five lines and the reminder always stay.
 */
function renderLpCheckMessage(lp, S) {
  for (const detail of ['full', 'labels', 'none']) {
    const text = renderLpCheckText(lp, S, detail);
    if ([...text].length <= WHATSAPP_ROOM || detail === 'none') return text;
  }
  return '';
}

function renderLpCheckText(lp, S, detail) {
  if (!lp || typeof lp !== 'object') return '';
  const out = [`📘 *${S.lp_check_title}*`];
  if (lp.state === 'no_plan') {
    out.push(S.lp_no_plan_question);
    return out.join('\n');
  }
  if (lp.state !== 'ok') {
    out.push(S[`lp_not_assessed_${lp.reason}`] || S.lp_not_assessed_unavailable);
    return out.join('\n');
  }
  out.push(`*${S.lp_plan_done}* ${fill(S.lp_plan_done_line, { done: lp.done, total: lp.total })}`);
  if (lp.as_planned) out.push(`*${S.lp_done_as_planned}* ${lp.as_planned.step} — ${lp.as_planned.text}`);
  if (lp.most_missed) {
    const at = lp.most_missed.time ? ` (${fill(S.lp_about_time, { time: lp.most_missed.time })})` : '';
    out.push(`*${S.lp_most_missed}* ${lp.most_missed.step}${S.lp_comma || ', '}${lp.most_missed.move}${at}${lp.most_missed.text ? ` — ${lp.most_missed.text}` : ''}`);
  }
  if (detail !== 'none') {
    out.push('', `*${S.lp_moves_label}*`);
    for (const st of lp.steps || []) {
      out.push(`_${st.name} ${st.done}/${st.total}_`);
      for (const m of st.moves) {
        const mark = m.mark === 'done' ? '✓' : m.mark === 'missed' ? '✗' : '–';
        const note = m.mark === 'not_assessed' ? ` (${S.lp_move_not_assessed})`
          : m.what && detail === 'full' ? ` — ${m.partial ? `${S.lp_mark_partly} ` : ''}${m.what}` : '';
        out.push(`${mark} ${m.label}${note}`);
      }
    }
  }
  if (Array.isArray(lp.lines) && lp.lines.length) {
    out.push('', `*${S.lp_lines_label}*`);
    const labels = Array.isArray(S.lp_line_labels) ? S.lp_line_labels : [];
    lp.lines.forEach((line, i) => {
      const cue = LINE_CUES[i] ? ` _${S[LINE_CUES[i]]}_` : '';
      out.push(`${i + 1}. ${labels[i] ? `*${labels[i]}* ` : ''}"${line}"${cue}`);
    });
  }
  out.push('', `_${S.lp_check_reminder}_`);
  return out.join('\n');
}

// ── The five parts of the coach's talk about the plan ──────────────────────

// Words that say nothing about a step or move of TODAY's plan ("Follow the lesson plan", "the plan was not followed").
const GENERIC = new Set(`the a an lesson plan plans planned follow followed following follows was were is are be been not no it
you your please should must have has had did didnt didn't do does done according to as per use used using and of on in for
today today's todays always properly correctly fully it's its okay ok yes so very well good
لیسن پلان سبق کا کی کے کو فالو کریں کرنا کیا گیا گئی نہیں ہے ہیں تھا تھی آپ اپنا اپنے مطابق پر عمل استعمال نے ہوا ضرور ہمیشہ چاہیے
یہ وہ اور میں سے ٹھیک جی ہاں بالکل`.split(/\s+/));

const tokens = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** A line that names no step or move of today's plan: only words about "the plan" in general. */
function isGenericPlanLine(quote) {
  return tokens(quote).filter((w) => !GENERIC.has(w) && !GENERIC.has(w.replace(/'/g, ''))).length === 0;
}

/** The quote is in the recording: word for word, or most of its words. */
function inTranscript(quote, transcript) {
  const q = tokens(quote);
  if (!q.length) return false;
  const t = tokens(transcript);
  if (t.join(' ').includes(q.join(' '))) return true;
  const have = new Set(t);
  return q.filter((w) => have.has(w)).length / q.length >= 0.6;
}

function discussionPrompt(transcript, lp, lang) {
  const langName = LANG_NAME[lang] || LANG_NAME.en;
  const plan = (lp.steps || []).map((st) => `${st.name}: ${st.moves.map((m) => `${m.label} (${m.mark === 'done' ? 'done' : m.mark === 'missed' ? 'missed' : 'not assessed'})`).join('; ')}`).join('\n');
  return `You are judging ONE thing about a coaching conversation: how the officer (the coach) talked with the teacher about today's lesson plan. This is NOT scored: judge only these five parts, each SEPARATELY, from the transcript.

1 "name_step" — covered only when the coach names a specific step or move of today's plan (e.g. "the We Do step", "the partner practice"). Not covered by "follow the lesson plan" or "the plan was not followed".
2 "as_planned" — covered only when the coach names one step or move done as the plan says, with what happened. Not covered by "most of it went well".
3 "gap" — covered only when the coach names the missed or changed move, with the moment or the time. Not covered by "some steps were missed".
4 "ask" — covered only when the coach asks an open question about why that step was hard, then pauses for the teacher's answer. Not covered when the coach gives the reason, or asks a yes/no question.
5 "next_step" — covered only when the TEACHER names how they will do that plan move next time. Not covered when the coach gives the step, or the step is not linked to the plan.
General lines about "the plan" never cover any part, however often they are said. No quote, not covered.

For each part: "covered" true or false; "quote": the exact words from the transcript that cover it (the coach's; for part 5 the teacher's), "" when not covered; "what_happened": when not covered, one short line (at most 20 words, in ${langName}, to the coach as "you") on what happened instead, else null. Gender-neutral wording.

Return JSON EXACTLY: { "parts": [ { "part": "name_step", "covered": false, "quote": "", "what_happened": "..." }, ...the five, in this order ] }

TODAY'S PLAN (step: move (done or missed)):
${plan}

DEBRIEF TRANSCRIPT:
${transcript}`;
}

/** The judge's answer, held to the rules in code. null when it is not an answer. Pure. */
function discussionFrom(result, lp, transcript) {
  const parts = result && Array.isArray(result.parts) ? result.parts : null;
  if (!parts) return null;
  const byPart = new Map(parts.filter((p) => p && typeof p === 'object').map((p) => [p.part, p]));
  if (!PARTS.some((k) => byPart.has(k))) return null;
  const out = PARTS.map((key) => {
    const p = byPart.get(key) || {};
    const quote = clip(p.quote, 300);
    const covered = p.covered === true && !!quote && !isGenericPlanLine(quote) && inTranscript(quote, transcript);
    return { key, covered, quote: covered ? quote : null, what: covered ? null : clip(p.what_happened, 200) || null };
  });
  return { v: 1, state: 'ok', covered: out.filter((p) => p.covered).length, total: PARTS.length, parts: out };
}

/**
 * The five parts for one debrief, from the notes' lesson plan check. null when the notes had none (the switch was off
 * when they were written) or the judge failed: the debrief report is written exactly as before. Never throws.
 * `session`: the visit; a FICO 6-12 one is never judged (queue #255), even when notes written before carry a check.
 */
async function judgeDiscussion({ transcript, lpCheck, lang, sessionId, session }, deps = {}) {
  if (isFicoSVisit(session)) return null;
  if (!lpCheck || typeof lpCheck !== 'object' || !lpCheck.state) return null;
  if (lpCheck.state === 'no_plan') return { v: 1, state: 'no_plan' };
  if (lpCheck.state !== 'ok') return { v: 1, state: 'not_assessed', reason: lpCheck.reason || 'unavailable' };
  try {
    const complete = deps.complete || ((prompt) => require('../gpt5-mini.service').completeJson(prompt, {
      maxTokens: 6000, label: 'observeLpDiscussion', job: 'coaching.observeDebrief',
    }));
    const { result } = await complete(discussionPrompt(String(transcript || ''), lpCheck, lang));
    const d = discussionFrom(result, lpCheck, transcript);
    if (!d) log('[lp-check] the judge gave no usable parts — no block', { sessionId });
    return d;
  } catch (err) {
    log('[lp-check] judge failed — no block', { sessionId, error: err && err.message });
    return null;
  }
}

// ── The week ───────────────────────────────────────────────────────────────

/**
 * The week's block: full discussions (5 of 5) out of the debriefs with a plan, this week and last; the part missed most
 * often this week; debriefs with no plan linked (or not assessed), never counted as a miss. null when no debrief this
 * week carries a check. Pure.
 */
function summariseWeek(thisWeek, lastWeek) {
  const valid = (lp) => lp && typeof lp === 'object' && ['ok', 'no_plan', 'not_assessed'].includes(lp.state);
  const now = (thisWeek || []).filter(valid);
  if (!now.length) return null;
  const count = (list) => {
    const ok = list.filter((lp) => lp.state === 'ok');
    return { full: ok.filter((lp) => lp.covered === lp.total && lp.total === PARTS.length).length, of: ok.length };
  };
  const before = (lastWeek || []).filter(valid);
  const lastCount = count(before);
  const ok = now.filter((lp) => lp.state === 'ok');
  const misses = PARTS.map((key) => ({
    key, n: ok.filter((lp) => Array.isArray(lp.parts) && lp.parts.some((p) => p && p.key === key && p.covered === false)).length,
  }));
  const top = misses.reduce((best, m) => (m.n > best.n ? m : best), { key: null, n: 0 });
  return {
    week: count(now),
    last: lastCount.of ? lastCount : null,
    mostMissed: top.n ? { key: top.key, n: top.n, of: ok.length } : null,
    noPlan: now.filter((lp) => lp.state !== 'ok').length,
  };
}

module.exports = {
  STEPS, STEP_NAMES, PARTS,
  isFicoSVisit, notesFor,
  planState, fallbackWords, wordsFrom, buildLpCheck, wordsPrompt, lpCheckFor, attachLpCheck, renderLpCheckMessage,
  isGenericPlanLine, discussionPrompt, discussionFrom, judgeDiscussion, summariseWeek,
};
