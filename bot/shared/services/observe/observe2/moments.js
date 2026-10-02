'use strict';

/**
 * /observe2 — the moments in the recording, and when the coach gets to check them.
 *
 * After an /observe2 recording is transcribed (its session is linked to a field form), one model
 * call reads the timestamped transcript and returns the moments that matter for the heard
 * indicators, grouped the way the coach checks them (asking, wrong answers, working, explaining),
 * each with its minute and the words said, plus two counts that only separate levels 1 and 2.
 * The levels those moments add up to on their own are stored beside them and never shown: they
 * are the recording's half of the comparison with the coach's sealed record.
 *
 * The check opens when the record is sealed AND the moments are in, whichever comes last (this
 * module after the moments; the form endpoint after the seal).
 *
 * coaching_sessions.status moves through statuses of its own, so no /observe sweeper, list or
 * watchdog acts on the row:
 *   observe2_moments        reading the recording
 *   observe2_ready          moments stored, waiting for the seal
 *   observe2_checking       the check was sent
 *   observe2_checked        the coach submitted it
 *   observe2_no_timestamps  the transcript has no [MM:SS] timings, so no moment can be placed
 *   observe2_failed         the model call or the write failed (logged at error)
 */

const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const Store = require('./field-form.store');
const { heardLevels } = require('./rules');
const { observe2Strings } = require('./strings');
const { logToFile } = require('../../../utils/logger');

const PROMPT_VERSION = 'observe2-moments-v1';
const SLOTS = 8;
const QUOTE_MAX = 280;
const TIMED_RX = /\[\d{1,3}:\d{2}\]/;

// Type → the short label the check shows after the minute ("12:41 · open question"); each fits the
// 30-code-point radio label with the minute in front.
const TYPES = {
  ask: {
    open_q_one: 'open question', open_q_choral: 'answered in chorus', probe: "'why' follow-up",
    reasoning: 'child explained why', long_answer: 'longer answer', beyond: 'went beyond the ask',
    content_q: "child's own question", proc_q: "'which page' question", beyond_q: 'question beyond lesson',
  },
  wrong: {
    wrong_reason: 'reason for the error', wrong_fixed: 'child fixed it', wrong_ignored: 'wrong answer left',
    strategy: 'tried a new way', praise_effort: 'praise for effort', praise_generic: "'well done' only",
    mistake_useful: 'mistake put to use', disagree: 'disagreement welcomed', hedged: 'tried while unsure',
    unprompted: 'tried without asking',
  },
  work: { choice: 'a real choice', handover: 'children led a part' },
  explain: {
    content_error: 'content error', term_defined: 'word explained', why_explained: 'why it works',
    life_link: 'link to real life',
  },
};
const GROUPS = Object.keys(TYPES);
const GROUP_OF = Object.fromEntries(GROUPS.flatMap((g) => Object.keys(TYPES[g]).map((t) => [t, g])));

const seconds = (mmss) => { const [m, s] = String(mmss).split(':').map(Number); return m * 60 + s; };
const clip = (text, max) => { const cps = [...text]; return cps.length > max ? `${cps.slice(0, max - 1).join('')}…` : text; };
const whole = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : 0; };

function buildPrompt(transcript, form) {
  const period = Number(form && form.period_minutes) || 40;
  const half = Math.round(period / 2);
  const list = (g) => Object.keys(TYPES[g]).join(', ');
  return [
    'You are reading the transcript of one classroom lesson, recorded by a coach who sat in the room.',
    'Each line reads "[MM:SS] Speaker (LANG): words": the minute the line starts, who spoke (Teacher, or',
    'Student, which may be several children), the language, and the words (often Urdu, sometimes English).',
    '',
    'Find the moments a coach would want to confirm, in four parts of the lesson. Use only what the',
    'transcript says. Quote the words exactly as written, in their own language, cut to the key sentence.',
    'Never invent a moment, a minute or a name. If a part has no such moment, return none for it.',
    '',
    'ASKING — the teacher\'s questions, the children\'s answers and questions:',
    '- open_q_one: an open question (why, how, what do you think; more than one right answer) answered by one child',
    '- open_q_choral: an open question answered by the class together',
    '- probe: the teacher follows an answer with "why?" or a question that pushes the same child further',
    '- reasoning: a child gives a reason ("because ...")',
    '- long_answer: a child answers in a full sentence or more, without a reason',
    '- beyond: a child reasons beyond what was asked (a link or example of their own)',
    '- content_q: a child asks a question about the content',
    '- proc_q: a child asks only about procedure ("which page?", "in the copy?")',
    '- beyond_q: a child asks a question that goes beyond the lesson',
    '',
    'WRONG ANSWERS — what happens when a child is wrong, and how safe it is to be wrong:',
    '- wrong_reason: the teacher explains why an answer is wrong',
    '- wrong_fixed: the child corrects their own answer',
    '- wrong_ignored: a wrong answer is passed over with no reason ("no, anyone else?")',
    '- strategy: after a wrong answer the teacher tries a new way (an example, a picture, a simpler question)',
    '- praise_effort: specific praise for effort or thinking',
    '- praise_generic: general praise ("good", "shabash", "well done")',
    '- mistake_useful: the teacher uses a mistake to teach the class',
    '- disagree: the teacher welcomes a child disagreeing',
    '- hedged: a child answers while openly unsure ("maybe", "I think", "shayad")',
    '- unprompted: a child tries without being asked, or keeps trying after a wrong answer',
    '',
    'WORKING — while the children work:',
    '- choice: the children get a real choice (which task, how to show it, who to work with) and it is acted on',
    '- handover: the children lead part of the lesson',
    '',
    'EXPLAINING — the teacher\'s content:',
    '- content_error: the teacher says something factually wrong and it is not corrected',
    '- term_defined: a subject word is explained or defined',
    '- why_explained: the teacher explains why a method or fact works, not only how',
    '- life_link: the teacher links the content to daily life or another subject',
    '',
    `At most ${SLOTS} moments per part: the clearest ones, of different types where possible.`,
    'Also count, across the whole lesson: closed_q (questions with a yes/no or one-word answer, or answered',
    'in chorus) and praise_generic (lines of general praise).',
    '',
    `The lesson is ${period} minutes; Part 1 is minute 0 to ${half}, Part 2 is minute ${half} to ${period}.`,
    '',
    'Return JSON only, in this shape:',
    '{"moments":[{"moment":"ask|wrong|work|explain","type":"<one type above>","minute":"MM:SS","quote":"<the words>"}],',
    ' "counts":{"closed_q":0,"praise_generic":0}}',
    `Allowed types — ask: ${list('ask')}; wrong: ${list('wrong')}; work: ${list('work')}; explain: ${list('explain')}.`,
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n');
}

/** Keep only what the check can show: known types, real minutes, a quote; SLOTS per group. */
function normalise(raw) {
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const m of Array.isArray(raw && raw.moments) ? raw.moments : []) {
    const type = String((m && m.type) || '');
    const group = GROUP_OF[type];
    const minuteRaw = String((m && m.minute) || '').trim().replace(/^\[|\]$/g, '');
    const quote = String((m && m.quote) || '').trim();
    if (!group || !/^\d{1,3}:\d{2}$/.test(minuteRaw) || !quote) continue;
    const [mm, ss] = minuteRaw.split(':');
    byGroup[group].push({ moment: group, type, minute: `${mm.padStart(2, '0')}:${ss}`, quote: clip(quote, QUOTE_MAX) });
  }
  const moments = [];
  for (const g of GROUPS) {
    byGroup[g].slice(0, SLOTS)
      .sort((a, b) => seconds(a.minute) - seconds(b.minute))
      .forEach((m, i) => moments.push({ id: `${g}_${i + 1}`, ...m, label: TYPES[g][m.type] }));
  }
  const counts = raw && raw.counts ? raw.counts : {};
  return { moments, counts: { closed_q: whole(counts.closed_q), praise_generic: whole(counts.praise_generic) } };
}

async function defaultLlm(prompt) {
  const GPT5MiniService = require('../../gpt5-mini.service');
  const { result } = await GPT5MiniService.completeJson(prompt, { maxTokens: 16000, label: 'observe2.moments' });
  return result;
}

async function setStatus(sessionId, status) {
  const { TERMINAL_IN_FILTER } = require('../../coaching/session-terminal');
  const { data, error } = await supabase.from('coaching_sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .not('status', 'in', TERMINAL_IN_FILTER)
    .select('id');
  if (error) {
    logToFile('[observe2] session status not written', { sessionId, status, error: error.message }, 'error');
    return false;
  }
  return (data || []).length > 0;
}

async function coachOf(form) {
  const { data, error } = await supabase.from('users')
    .select('phone_number, preferred_language').eq('id', form.observer_user_id).maybeSingle();
  if (error || !data || !data.phone_number) {
    logToFile('[observe2] the coach could not be found to message', { formId: form.id, error: error && error.message }, 'error');
    return null;
  }
  return data;
}

async function tell(form, key) {
  const coach = await coachOf(form);
  if (!coach) return false;
  return WhatsAppService.sendMessage(coach.phone_number, observe2Strings(coach.preferred_language)[key]);
}

/** Send the check to the coach. @returns {Promise<boolean>} */
async function openCheck(form) {
  const flowId = process.env.OBSERVE2_CHECK_FLOW_ID;
  if (!flowId) {
    logToFile('[observe2] the check cannot open: OBSERVE2_CHECK_FLOW_ID is not set', { formId: form.id }, 'error');
    return false;
  }
  const coach = await coachOf(form);
  if (!coach) return false;
  const S = observe2Strings(coach.preferred_language);
  const n = ((form.rumi_moments && form.rumi_moments.moments) || []).length;
  const sent = await WhatsAppService.sendFlow(coach.phone_number, {
    flowId,
    body: S.check_body(n),
    buttonText: S.check_cta,
    flowToken: `${form.observer_user_id}:observe2-check:${form.id}`,
  });
  if (!sent) logToFile('[observe2] the check did not send', { formId: form.id }, 'error');
  else logToFile('[observe2] check sent', { formId: form.id, moments: n });
  return sent;
}

// /observe reads each classroom photo once with the v2 vision pass and hands what it saw to the plan
// grader (analysis-processor, D34), under COACHING_PHOTO_VISION=v2 and LP_FIDELITY_PHOTO. The same here,
// for the photos the coach stored at the seal: numbered as taken, a photo that is not a classroom photo
// (or carries writing addressed to a grader) left out, and the same 90-second reading budget.
const PHOTO_READ_BUDGET_MS = 90000;
async function photoEvidence(form, deps = {}) {
  const F = require('../../coaching/fidelity/fidelity-orchestrator');
  if (!F.isPhotoEvidenceOn()) return [];
  if (String(process.env.COACHING_PHOTO_VISION || '').trim().toLowerCase() !== 'v2') return [];
  const keys = Array.isArray(form.photos) ? form.photos : [];
  if (!keys.length) return [];
  const download = deps.download || ((key) => require('../../../storage/r2').downloadFromR2(key));
  const read = deps.read || ((buf, mime, ctx) => require('../../coaching/classroom-photo/photo-analysis.service').analyzeClassroomPhotoV2(buf, mime, ctx));
  const started = Date.now();
  const evidence = [];
  for (const [i, key] of keys.entries()) {
    const n = i + 1;
    if (Date.now() - started > PHOTO_READ_BUDGET_MS) {
      logToFile('[observe2] photo reading budget spent: photo left out of the plan grading', { formId: form.id, photo: n });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await read(await download(key), 'image/jpeg', { formId: form.id, photo: n });
      if (r && r.ok && !r.exclude && r.evidence) evidence.push({ n, ...r.evidence });
    } catch (err) {
      logToFile('[observe2] a classroom photo could not be read for the plan grading', { formId: form.id, photo: n, error: err.message }, 'error');
    }
  }
  return evidence;
}

/**
 * Grade the lesson plan against the transcript with the fidelity orchestrator /observe uses: the same
 * move lists, grader, runs, photo evidence and scorer.
 *   - a plan picked from the list (answers.lp_ref): the bot's own move list for it (corpus);
 *   - a plan the coach added (answers.lp_upload): read the way /observe reads an uploaded plan, then the
 *     orchestrator's uploaded-plan path. One that can't be read, or doesn't read as a lesson plan, is not
 *     graded and says which (lp_unreadable / lp_not_lesson_plan), so the brief can tell the coach.
 * @returns {Promise<object|null>} null when there is no plan to grade or LP_FIDELITY_ENABLED is off.
 */
async function gradeFidelity(form, transcript, audioDurationSeconds, fidelityDeps, planDeps, photoDeps) {
  const a = form.answers || {};
  const ref = a.lp_ref && a.lp_ref.lesson_id ? a.lp_ref : null;
  const added = !ref && a.lp_upload && a.lp_upload.kind ? a.lp_upload : null;
  if (!ref && !added) return null;
  const graded = (out) => ({ ...out, graded_at: new Date().toISOString() });
  try {
    const F = require('../../coaching/fidelity/fidelity-orchestrator');
    if (!F.isFidelityEnabled()) {
      logToFile('[observe2] a plan was given but LP_FIDELITY_ENABLED is off: fidelity not graded', { formId: form.id }, 'warn');
      return null;
    }
    let input;
    let planSource = null;
    if (ref) {
      input = {
        corpusKey: { lesson_id: ref.lesson_id, version_stamp: ref.version_stamp, content_hash: ref.content_hash },
        meta: { lesson_id: ref.lesson_id, ...(ref.subject ? { subject: ref.subject } : {}), ...(ref.grade ? { grade: ref.grade } : {}) },
      };
    } else {
      const P = require('./added-plan');
      const read = await P.readAddedPlan(added, planDeps);
      planSource = { kind: read.kind, files: read.files, read: read.read, parsers: read.parsers, chars: read.text.length };
      if (!read.text) {
        logToFile('[observe2] the added lesson plan could not be read: not graded', { formId: form.id, ...planSource }, 'error');
        return graded({ status: 'lp_unreadable', plan_source: planSource });
      }
      if (await P.looksLikeLessonPlan(read.text, planDeps) === false) {
        logToFile('[observe2] the added lesson plan does not read as a lesson plan: not graded', { formId: form.id, ...planSource }, 'warn');
        return graded({ status: 'lp_not_lesson_plan', plan_source: planSource });
      }
      input = { uploadedText: read.text, meta: {} };
    }
    const photos = await photoEvidence(form, photoDeps);
    const out = await F.computeLpFidelity({
      ...input, transcript, audioDurationSeconds: audioDurationSeconds || null, ...(photos.length ? { photoEvidence: photos } : {}),
    }, fidelityDeps || {});
    if (!out) return null;
    if (out.status !== 'ok') logToFile('[observe2] fidelity not graded', { formId: form.id, status: out.status, error: out.error || null }, 'error');
    return graded({ ...out, ...(planSource ? { plan_source: planSource } : {}) });
  } catch (err) {
    logToFile('[observe2] fidelity grading threw', { formId: form.id, error: err.message }, 'error');
    return { status: 'fidelity_unavailable', error: err.message };
  }
}

async function finish(sessionId, form) {
  if (!form.sealed_at) {
    await setStatus(sessionId, 'observe2_ready');
    return { handled: true, action: 'waiting_for_seal' };
  }
  if (form.checked_at) {
    await setStatus(sessionId, 'observe2_checked');
    return { handled: true, action: 'already_checked' };
  }
  const sent = await openCheck(form);
  await setStatus(sessionId, sent ? 'observe2_checking' : 'observe2_ready');
  return { handled: true, action: sent ? 'check_sent' : 'check_not_sent' };
}

/**
 * After transcription. @returns {Promise<{handled:boolean, action?:string}>} handled:false → not an
 * /observe2 recording; the classic path goes on.
 */
async function runForSession(sessionId, from, deps = {}) {
  const linked = await Store.findBySession(sessionId);
  if (!linked.ok || !linked.form) return { handled: false };
  let form = linked.form;

  if (form.moments_ready_at) {
    logToFile('[observe2] moments already stored; not read again', { sessionId, formId: form.id });
    return finish(sessionId, form);
  }
  if (!(await setStatus(sessionId, 'observe2_moments'))) {
    logToFile('[observe2] the session is over; moments not read', { sessionId, formId: form.id }, 'warn');
    return { handled: true, action: 'session_closed' };
  }

  const { data: row, error } = await supabase.from('coaching_sessions')
    .select('transcript_text, audio_duration_seconds').eq('id', sessionId).maybeSingle();
  const transcript = (row && row.transcript_text) || '';
  if (error || !TIMED_RX.test(transcript)) {
    logToFile('❌ [observe2] no timed transcript: moments not read', {
      sessionId, formId: form.id, error: error && error.message, length: transcript.length,
    }, 'error');
    await setStatus(sessionId, 'observe2_no_timestamps');
    await tell(form, 'moments_untimed');
    return { handled: true, action: 'untimed' };
  }

  try {
    // The plan's fidelity is graded from the same transcript, at the same time, by the grader /observe
    // uses. It never fails the moments: the orchestrator returns a status instead of throwing.
    const [raw, fidelity] = await Promise.all([
      (deps.llm || defaultLlm)(buildPrompt(transcript, form)),
      gradeFidelity(form, transcript, row && row.audio_duration_seconds, deps.fidelityDeps, deps.planDeps, deps.photoDeps),
    ]);
    const { moments, counts } = normalise(raw);
    const stored = await Store.setMoments(form.id, { moments, counts, prompt_version: PROMPT_VERSION, fidelity }, heardLevels(moments, counts));
    if (!stored.ok) throw new Error(stored.error || 'moments not stored');
    const again = await Store.getForm(form.id);
    form = (again.ok && again.form) || form;
    logToFile('[observe2] moments stored', {
      sessionId, formId: form.id, moments: moments.length,
      fidelity: fidelity ? fidelity.status : 'no_plan', fidelityPct: fidelity && fidelity.fidelity_pct != null ? fidelity.fidelity_pct : null,
    });
  } catch (err) {
    logToFile('❌ [observe2] moments failed', { sessionId, formId: form.id, error: err.message }, 'error');
    await setStatus(sessionId, 'observe2_failed');
    await tell(form, 'moments_failed');
    return { handled: true, action: 'failed' };
  }
  return finish(sessionId, form);
}

/** After the seal: the moments may already be in (the recording came first). */
async function onSealed(form) {
  if (!form || !form.moments_ready_at || form.checked_at) return false;
  const sent = await openCheck(form);
  if (sent && form.coaching_session_id) await setStatus(form.coaching_session_id, 'observe2_checking');
  return sent;
}

module.exports = {
  PROMPT_VERSION, SLOTS, TYPES, GROUPS,
  buildPrompt, normalise, runForSession, openCheck, onSealed, setStatus,
  // For the test that proves its default reader is /observe's (added-plan-defaults.test.js).
  __photoEvidence: photoEvidence,
};
