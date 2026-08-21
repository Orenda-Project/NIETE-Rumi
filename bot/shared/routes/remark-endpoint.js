/**
 * bd-2712 — /remark Supervisor Remark FLOW endpoint (docs/flows/remark-flow.json).
 *
 * Screens: PICK_TEACHER → RUBRIC → SUCCESS.
 *
 * ── Why a Flow and not the chat walk it was built for ──────────────────────
 * bd-2531 shipped remark-flow.js / remark-screens.js / remark-write.repository.js
 * as a TEXT walk and never wired them, so nothing consumed them (bd-2712). The
 * chat route also needs a "she is mid-rubric" flag to decide whether a bare "1"
 * belongs to remark or to normal chat — and the obvious holder for that flag,
 * users.conversation_state, EXISTS ON STAGING BUT NOT ON PROD (bd-2714). A Flow
 * reply arrives as a flow-response with a token, so there is nothing to
 * disambiguate and nothing to hijack.
 *
 * ── The one atomic write ───────────────────────────────────────────────────
 * All 5 scores + the comment + the submit stamp are written in ONE data_exchange
 * at the end. Nothing persists while she is still filling the form, so a
 * half-finished rubric cannot exist and the resume machinery in remark-flow.js
 * has nothing to resume WITHIN a teacher. Resume ACROSS teachers still works and
 * is still derived from rows: nextStep() answers "who is left?".
 *
 * ── The 10-second rule ─────────────────────────────────────────────────────
 * Meta times the endpoint out at ~10s (whatsapp-flows rule 8). Narrative
 * generation is an LLM call, so submitRemark() is fired via setImmediate AFTER
 * the response is returned. The durable write happens BEFORE that boundary, so a
 * submission is never lost to a slow model; remark-narrative-retry.worker.js
 * sweeps anything whose narrative or delivery failed.
 *
 * ── Copy ───────────────────────────────────────────────────────────────────
 * Rubric content (indicator names, the 4 anchors, the scale) comes from
 * remark-rubric.js — the published contract STEPS reads. Flow chrome comes from
 * the ux-strings catalog via resolveUx. Neither is duplicated here.
 */

const { INDICATORS, SCALE, INDICATOR_COUNT } = require('../services/remark/remark-rubric');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const { logToFile, logError } = require('../utils/logger');

// Lazy — config/supabase calls process.exit(78) without env vars, which would
// kill any test process that merely imports this file. (Fourth sighting of this
// trap in this feature.)
function repo() {
  return {
    cycle: require('../services/remark/remark-cycle.repository'),
    write: require('../services/remark/remark-write.repository'),
    score: require('../services/remark/remark-score.repository'),
    delivery: require('../services/remark/remark-delivery.service'),
  };
}

function db() {
  return require('../config/supabase');
}

/**
 * The scale, as a Dropdown data-source for ONE indicator.
 *
 * title = the scale label ("Proficient"), description = the VERBATIM Appendix A
 * anchor. Meta's Dropdown supports `description` on data-source items — proven
 * by the live teacher-training module picker, not assumed.
 *
 * Descending so Exemplary is first: the same order the paper form uses.
 */
function anchorOptions(indicator, language) {
  return [4, 3, 2, 1].map((score) => ({
    id: String(score),
    title: SCALE[score][language],
    description: indicator.anchors[score][language],
  }));
}

/**
 * A displayable teacher label. Mirrors remark-screens :: renderTeacherName —
 * some NIETE teachers have first_name = null in production, and rendering
 * "undefined" to a principal reads as a broken product.
 */
function teacherLabel(teacher, language) {
  const name = (teacher.first_name || '').trim();
  if (name) return name;
  const tail = String(teacher.phone_number || '').slice(-4);
  return tail
    ? resolveUx('remarkPickerLabel', { language }) + ' ' + tail
    : resolveUx('remarkPickerLabel', { language });
}

async function loadUser(userId) {
  const { data, error } = await db()
    .from('users')
    .select('id, first_name, phone_number, preferred_language, role, school_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`remark-endpoint: user lookup failed — ${error.message}`);
  return data || null;
}

/**
 * INIT → the teacher picker.
 *
 * Only teachers with no submitted remark for the open cycle are offered, so the
 * list shrinks as she works and she cannot double-submit by accident (the
 * UNIQUE (teacher_id, cycle_id) makes that idempotent anyway).
 */
async function handleRemarkInit(userId) {
  const { cycle } = repo();
  const user = await loadUser(userId);
  if (!user) return errorScreen('Account not found.');

  const language = clampLanguage(user.preferred_language);
  const activeCycle = await cycle.getActiveCycle();
  if (!activeCycle) return errorScreen('No evaluation cycle is open.');

  const teachers = await cycle.listSchoolTeachers(user);
  if (teachers.length === 0) {
    return errorScreen(resolveUx('remarkNoTeachers', { language }));
  }

  // The WHOLE roster, annotated — never a filtered one. Handing her only the
  // teachers she has left made absence the single signal, and absence cannot
  // distinguish "done" from "not enrolled" from "something broke". It also
  // dead-ended the flow on an error screen the moment the cycle was complete.
  const progress = await cycle.getProgress(user.id, activeCycle.id);
  const scoreRows = await loadScoreIndex(user.id, activeCycle.id);

  const done = teachers.filter((t) => stateOf(progress, t.id) === 'done').length;

  return {
    screen: 'PICK_TEACHER',
    data: {
      heading: resolveUx('remarkPickHeading', { language }),
      hint: resolveUx('remarkRosterHint', {
        language, params: { done, total: teachers.length },
      }),
      items: teachers.map((t) => rosterRow(t, progress, scoreRows, language)),
    },
  };
}

/** done | in_progress | not_started — absent from progress means untouched. */
function stateOf(progress, teacherId) {
  return (progress[teacherId] || {}).state || 'not_started';
}

/**
 * teacher_id → { s_score, s_pct } for this cycle.
 *
 * The view only carries SUBMITTED remarks, so an un-evaluated teacher is simply
 * missing — which is the right shape: no row means no score, never a zero.
 * A failure here must not take the roster down with it; she can still evaluate
 * without seeing last quarter's numbers.
 */
async function loadScoreIndex(principalUserId, cycleId) {
  const { score } = repo();
  try {
    const rows = await score.getPrincipalScores(principalUserId, cycleId);
    const index = {};
    for (const r of rows || []) index[r.teacher_id] = r;
    return index;
  } catch (err) {
    logToFile('⚠️ remark: score index unavailable — roster renders without percentages', {
      principalUserId, cycleId, error: err.message,
    }, 'warn');
    return {};
  }
}

/**
 * One NavigationList row: name (ticked when complete), where it stands, and the
 * score she gave. The row carries its own action, so tapping IS the submit —
 * there is no separate Continue press.
 */
function rosterRow(teacher, progress, scoreIndex, language) {
  const state = stateOf(progress, teacher.id);
  const pct = (scoreIndex[teacher.id] || {}).s_pct;
  const tick = state === 'done' ? '✅ ' : state === 'in_progress' ? '▶️ ' : '';

  return {
    id: teacher.id,
    'main-content': {
      title: `${tick}${teacherLabel(teacher, language)}`,
      description: resolveUx(ROSTER_STATE_KEY[state], { language }),
      metadata: state === 'done' && pct != null ? `${Math.round(pct)}%` : '',
    },
    'on-click-action': {
      name: 'data_exchange',
      payload: { step: 'pick_teacher', teacher_id: teacher.id },
    },
  };
}

const ROSTER_STATE_KEY = {
  done: 'remarkStateDone',
  in_progress: 'remarkStateInProgress',
  not_started: 'remarkStateNotStarted',
};

/**
 * She picked a teacher → render all five indicators on one screen.
 */
async function handlePickTeacher(userId, screenData) {
  const { cycle } = repo();
  const user = await loadUser(userId);
  if (!user) return errorScreen('Account not found.');

  const language = clampLanguage(user.preferred_language);
  const activeCycle = await cycle.getActiveCycle();
  if (!activeCycle) return errorScreen('No evaluation cycle is open.');

  const teacherId = screenData && screenData.teacher_id;
  const teachers = await cycle.listSchoolTeachers(user);
  const teacher = teachers.find((t) => t.id === teacherId);
  // Not merely "not found" — a teacher outside her school means the id was
  // tampered with or the roster moved under her. Either way she may not score.
  if (!teacher) return errorScreen('That teacher is not on your school roster.');

  // Already submitted → show her what she gave, and stop. Re-opening the rubric
  // on a finished evaluation would let one tap silently supersede a record the
  // teacher has already been told about (operator decision, 2026-08-21).
  const progress = await cycle.getProgress(user.id, activeCycle.id);
  if (stateOf(progress, teacher.id) === 'done') {
    return await buildSummaryScreen(user, teacher, activeCycle, language);
  }

  const data = {
    heading: resolveUx('remarkRubricHeading', { language }),
    // Not a catalog entry: "<name> · <cycle>" contains no WORDS to translate, and
    // a wordless template in the catalog trips the "Urdu must be Perso-Arabic"
    // guard for good reason — it is a format, not copy.
    teacher_line: `${teacherLabel(teacher, language)} · ${activeCycle.name}`,
    teacher_id: teacher.id,
    level_label: resolveUx('remarkLevelLabel', { language }),
    comment_label: resolveUx('remarkCommentLabel', { language }),
    cta: resolveUx('remarkSubmit', { language }),
  };

  // Indicator names are numbered here rather than in the catalog so the ordinal
  // always matches remark-rubric.js — a rubric revision reorders itself.
  for (const ind of INDICATORS) {
    data[`ind${ind.ordinal}_name`] = `${ind.ordinal}. ${ind.name[language]}`;
    data[`ind${ind.ordinal}_options`] = anchorOptions(ind, language);
  }

  return { screen: 'RUBRIC', data };
}

/**
 * The read-only view of a submitted evaluation: per-indicator level in words,
 * the overall, and nothing to change. Levels are rendered from the rubric so the
 * wording matches exactly what she picked when she scored it.
 */
async function buildSummaryScreen(user, teacher, activeCycle, language) {
  const { score } = repo();

  let row = null;
  try {
    row = await score.getTeacherScore(teacher.id, activeCycle.id);
  } catch (err) {
    logToFile('⚠️ remark: could not load a submitted score for review', {
      teacherId: teacher.id, cycleId: activeCycle.id, error: err.message,
    }, 'warn');
  }

  const lines = [];
  for (const ind of INDICATORS) {
    const lvl = row ? row[ind.key] : null;
    const label = lvl != null ? levelWord(ind, lvl, language) : '—';
    lines.push(`${ind.ordinal}. ${ind.name[language]} — ${label}`);
  }

  const pct = row && row.s_pct != null ? `${Math.round(row.s_pct)}%` : '—';

  return {
    screen: 'SUMMARY',
    data: {
      heading: teacherLabel(teacher, language),
      submitted: resolveUx('remarkStateDone', { language }),
      body: lines.join('\n'),
      overall: resolveUx('remarkSummaryOverall', { language, params: { pct } }),
      done_label: resolveUx('remarkSummaryDone', { language }),
    },
  };
}

/** The scale WORD for a level, so the summary reads as she scored it. */
function levelWord(indicator, level, language) {
  const band = SCALE[String(level)];
  return (band && band[language]) || String(level);
}

/**
 * Submit — the only write in the feature.
 *
 * Order matters: validate → ensureRemark → 5 scores → comment → mark submitted.
 * Everything before the setImmediate is durable, so a slow or failing LLM cannot
 * lose a submission.
 */
async function handleSubmit(userId, screenData, flowToken) {
  const { cycle, write, delivery } = repo();
  const user = await loadUser(userId);
  if (!user) return errorScreen('Account not found.');

  const language = clampLanguage(user.preferred_language);
  const activeCycle = await cycle.getActiveCycle();
  if (!activeCycle) return errorScreen('No evaluation cycle is open.');

  const teacherId = screenData && screenData.teacher_id;
  const teachers = await cycle.listSchoolTeachers(user);
  const teacher = teachers.find((t) => t.id === teacherId);
  if (!teacher) return errorScreen('That teacher is not on your school roster.');

  // All five are `required` in the Flow JSON, so a missing one means a tampered
  // or malformed payload — refuse rather than store a partial rubric that the
  // S_pct view would then average over four indicators.
  const scores = [];
  for (let ordinal = 1; ordinal <= INDICATOR_COUNT; ordinal++) {
    const raw = screenData && screenData[`score_${ordinal}`];
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      logError('❌ remark-flow: submit rejected — bad score', {
        userId, teacherId, ordinal, raw: String(raw),
      });
      return errorScreen('Please choose a level for all five.');
    }
    scores.push(n);
  }

  const commentText = typeof screenData.comment === 'string' ? screenData.comment.trim() : '';

  // ensureRemark returns the remark ID as a STRING, not a row.
  const remarkId = await write.ensureRemark({
    cycleId: activeCycle.id,
    teacherId: teacher.id,
    principalUserId: user.id,
    schoolId: user.school_id,
  });

  for (let i = 0; i < scores.length; i++) {
    await write.saveScore(remarkId, i + 1, scores[i]);
  }
  // '' is written deliberately for a skip: saveComment distinguishes "asked and
  // skipped" from "not asked yet", and deriveProgress branches on all three.
  await write.saveComment(remarkId, { text: commentText, language, skipped: !commentText });
  // Durable BEFORE the response — see the persistSubmission note in
  // remark-delivery.deps.js. Scores without submitted_at are invisible to the
  // retry worker, so this write must not sit behind setImmediate.
  await write.markSubmitted(remarkId);

  logToFile('📝 remark-flow: submitted', {
    userId: user.id, teacherId: teacher.id, cycleId: activeCycle.id,
    remarkId, scores,
  });

  // Narrative + teacher delivery are an LLM call and a Graph send — both well
  // past Meta's ~10s endpoint budget. Fired after the response; failures are
  // swept by remark-narrative-retry.worker.js.
  //
  // submitRemark reads only .id / .teacher_id / .comment_text off `remark`, so
  // the literal below is a complete input — no extra round-trip to re-read a row
  // we just wrote.
  const teacherName = teacherLabel(teacher, language);
  setImmediate(async () => {
    try {
      const { makeDeliveryDeps } = require('../services/remark/remark-delivery.deps');
      await delivery.submitRemark(
        {
          remark: { id: remarkId, teacher_id: teacher.id, comment_text: commentText },
          formLanguage: language,
        },
        makeDeliveryDeps({ principal: user, teacherLabelFor: () => teacherName }),
      );
    } catch (err) {
      logError('❌ remark-flow: post-submit narrative/delivery threw', {
        userId: user.id, remarkId, error: err.message,
      });
    }
  });

  const progress = await cycle.getProgress(user.id, activeCycle.id);
  const left = teachers.filter((t) => t.id !== teacher.id && (progress[t.id] || {}).state !== 'done');

  return {
    screen: 'SUCCESS',
    data: {
      success_message: resolveUx('remarkFlowSuccess', {
        language, params: { teacher: teacherLabel(teacher, language) },
      }),
      extension_message_response: {
        params: {
          // Tag for flow-type-detector + the nfm_reply branch, so the chat ack is
          // contextual instead of "Thanks for your response" (rules 10 + 11).
          remark_action: 'submitted',
          remark_teacher: teacherLabel(teacher, language),
          remark_left: String(left.length),
          flow_token: flowToken || '',
        },
      },
    },
  };
}

// NEVER include a `version` field — it makes the Flow fail with a silent
// "Something went wrong" (whatsapp-flows rule 1).
function errorScreen(message) {
  return { data: { error: { message } } };
}

async function handleRemarkDataExchange(userId, screen, screenData, flowToken) {
  const step = (screenData && screenData.step) || '';
  if (step === 'pick_teacher' || screen === 'PICK_TEACHER') {
    return handlePickTeacher(userId, screenData);
  }
  if (step === 'submit' || screen === 'RUBRIC') {
    return handleSubmit(userId, screenData, flowToken);
  }
  logToFile('⚠️ remark-flow: unknown data_exchange step', { screen, step });
  return errorScreen('Something went wrong. Send /remark to start again.');
}

module.exports = {
  handleRemarkInit,
  handleRemarkDataExchange,
  handlePickTeacher,
  handleSubmit,
  anchorOptions,
  teacherLabel,
};
