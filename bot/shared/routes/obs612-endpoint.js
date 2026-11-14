'use strict';

/**
 * bd-pni007 — the FDE (obs612) coach form's endpoint (POST /api/flows/obs612). ONE Flow serves FDE's three tools;
 * the visit's form row decides which (bot/shared/services/observe/obs612/flow.js lists the screens).
 *
 * Token: <coachUserId>:obs612:<formId>. Every request re-reads the form (observation_field_forms) and refuses it
 * when it is not this coach's, not an obs612 rubric, or already sealed.
 *
 *   INIT            the visit's tool, first screen (GEN_ENV, MSCI_OVERVIEW or ENUR_CONTEXT), pre-filled from the saved
 *                   draft; a refused form gets NOTICE ("Already submitted", or why it is not available).
 *   <form screen>   1. the screen's values are merged into answers.obs612 and saved (only while unsealed), BEFORE
 *                      anything is checked, so nothing typed is lost;
 *                   2. the screen's required answers are checked: anything missing keeps the coach on the screen,
 *                      with a line and a message under each field;
 *                   3. the next screen on the visit's path (English & Urdu: the sheet picks Section 2's screen).
 *   Submit          the last screen of the path. Nothing may be missing (record.whatIsMissing); if something is,
 *                   the coach stays on this screen with where it is (routes are forward only, so the Flow cannot
 *                   send them back; the header arrow can). Then record.buildAnalysis, and store.submit: the
 *                   visit's coaching_sessions row (merged, or made and linked), then ONE guarded seal. After the
 *                   response is ready, the coach summary is sent (summary.js), never blocking the Flow.
 *   NOTICE          closes on DONE.
 *
 * Never a `version` field in a response (whatsapp-flows rule 1). Every response is a few reads and writes:
 * well inside Meta's 10 s.
 */

const Store = require('../services/observe/obs612/store');
const Record = require('../services/observe/obs612/record');
const F = require('../services/observe/obs612/flow');
// bd-ra8xu.40 — the merge, the per-screen check and Section 1's rows, shared with the portal's door to this form.
const Model = require('../services/observe/obs612/form-model');
const O = require('../services/coaching/frameworks/obs612');
const { logToFile } = require('../utils/logger');

const MARKER = 'obs612';

function parseToken(flowToken) {
  const [userId, marker, formId] = String(flowToken || '').split(':');
  if (!userId || marker !== MARKER || !formId) return null;
  return { userId, formId };
}

// ── what the coach reads ──────────────────────────────────────────────────────

const REFUSED = {
  not_found: { title: 'Not available', body: 'This form could not be found. Start the visit again from the chat.' },
  not_yours: { title: 'Not available', body: "This form belongs to another coach's visit." },
  not_obs612: { title: 'Not available', body: 'This visit does not use an FDE form.' },
  sealed: { title: 'Already submitted', body: 'This form was submitted before. Nothing was changed.' },
  error: { title: 'Not available', body: 'Something went wrong. Close this and open the form again from the chat. Your answers so far are kept.' },
};

const DONE = {
  submitted: { title: 'Submitted', body: 'Your FDE form is saved. Your summary follows in the chat.' },
  already: REFUSED.sealed,
  closed: { title: 'Not submitted', body: 'This visit was cancelled, so the form was not submitted. Your answers are kept.' },
  error: { title: 'Not saved', body: 'Something went wrong. Close this and open the form again from the chat. Your answers so far are kept.' },
};

// The check's codes (form-model.checkScreen), as the Flow says them.
const MSG = {
  item: 'Choose an answer.',
  choice: 'Choose one.',
  text: 'Write a few words here.',
  number: 'Enter a whole number.',
  row_two: 'Fill this in too, or leave the second area empty.',
  same_area: 'Pick an area other than the first.',
};
const fixNote = (footer) => `Some answers are missing. Fill in the ones marked below, then tap ${footer}.`;
const SAVE_FAILED = 'Your answers were not saved: something went wrong. Tap the button again.';
const SUBMIT_FAILED = 'Not submitted: something went wrong while saving. Tap Submit again.';

function noticeData(refusal) {
  const l = REFUSED[refusal] || REFUSED.error;
  return { rubric_label: O.LABEL, notice_title: l.title, notice_body: l.body };
}

/** The DONE screen: outcome submitted | already | closed | refused | error. */
function renderDone(outcome, formId, lines) {
  const l = lines || DONE[outcome] || DONE.error;
  return {
    screen: 'DONE',
    data: { rubric_label: O.LABEL, done_title: l.title, done_body: l.body, outcome, form_id: String(formId || '') },
  };
}

// ── the form ──────────────────────────────────────────────────────────────────

/** The form behind a token, or why it is refused: not_found | not_yours | not_obs612 | sealed | error. */
async function load(flowToken) {
  const t = parseToken(flowToken);
  if (!t) return { refusal: 'not_found' };
  const got = await Store.getForm(t.formId);
  if (!got.ok) return { refusal: 'error', formId: t.formId };
  const form = got.form;
  if (!form) return { refusal: 'not_found', formId: t.formId };
  if (form.observer_user_id !== t.userId) return { refusal: 'not_yours', formId: t.formId };
  if (!O.toolById(form.rubric_version)) return { refusal: 'not_obs612', formId: t.formId };
  if (form.sealed_at) return { refusal: 'sealed', formId: t.formId };
  const lesson = Record.lessonOf(form);
  // record.js reads a sheet it does not know as English (frameworks/obs612 enurSections); so does the Flow.
  const sheet = lesson.tool === 'enur' ? O.normSheet(lesson.sheet) : null;
  return { form, formId: form.id, coachUserId: t.userId, lesson, tool: lesson.tool, sheet };
}

const SUBJECT_OPTION = { english: 'English', urdu: 'Urdu' };
const LEVEL_LABELS = O.TOOLS.msci.scale.labels;
const DP_CURRENT = O.TOOLS.msci.development_plan.columns[1];
const { has } = Model;

function prefill(f, ctx, draft) {
  let v = has(draft[f.name]) ? String(draft[f.name]) : '';
  if (!v && f.name === 'ctx_5') v = SUBJECT_OPTION[ctx.lesson.subject] || '';
  if (!v && f.name === 'dp_area') v = (O.lowestIndicator(draft) || {}).key || '';
  // A list is never sent a value it cannot show.
  if (v && f.options && !f.options.some((o) => o.id === v)) v = '';
  return v;
}

// Section 1's read-only rows (FDE's labels): school, observer, teacher, grade.
async function contextLines(ctx) {
  const form = ctx.form;
  const got = await Store.getPeople([form.observer_user_id, form.teacher_user_id]);
  const people = got.ok ? got.people : [];
  return Model.contextRows(form, ctx.lesson.grade, people).map((r) => `${r.label}: ${r.value === null ? '—' : r.value}`).join('\n');
}

// The development plan's "Current level": what the coach gave each indicator.
function levelsLine(draft) {
  const rows = O.TOOLS.msci.indicators.map((i) => {
    const v = O.normAnswer('level', draft[i.key]);
    return `${i.n}. ${O.SHORT.msci[i.key]}: ${v === null ? 'not scored' : LEVEL_LABELS[Number(v)]}`;
  });
  return [`${DP_CURRENT}, as you scored each indicator:`, ...rows].join('\n');
}

function scoreLine(ctx, draft) {
  const r = O.score(ctx.form.rubric_version, ctx.sheet, draft);
  return `Score so far: ${r.total} / ${r.max} (${r.pct}%)${r.band ? `\nRating: ${r.band.label}` : ''}`;
}

async function bodyValue(key, ctx, draft, screenId) {
  if (key === 'ctx_lines') return contextLines(ctx);
  if (key === 'levels_line') return levelsLine(draft);
  if (key === 'score_line') return scoreLine(ctx, draft);
  // 13 Nov: an English & Urdu section's opening screen lists its parts; Section 7 is computed from the answers.
  if (key === 'parts_line') return F.introPartTitles(screenId, ctx.sheet).join('\n');
  if (key === 'seven_lines') return F.sevenLines(O.score(ctx.form.rubric_version, ctx.sheet, draft));
  return '';
}

/** A form screen's data: the label, the error line and messages, every pre-fill, the endpoint's text blocks. */
async function screenData(screenId, ctx, draft, { errors = {}, note = '' } = {}) {
  const data = { rubric_label: O.LABEL, err_v: Boolean(note), err_note: note, error_messages: errors };
  for (const f of F.fieldsOf(screenId)) if (f.prefill) data[F.initKey(f.name)] = prefill(f, ctx, draft);
  for (const key of F.bodiesOf(screenId)) data[key] = await bodyValue(key, ctx, draft, screenId);
  return data;
}

async function renderScreen(screenId, ctx, draft, opts) {
  return { screen: screenId, data: await screenData(screenId, ctx, draft, opts) };
}

// ── save, check ───────────────────────────────────────────────────────────────

// The saved draft with one screen's posted values on top (form-model.mergeDraft: shared with the portal).
const mergeDraft = Model.mergeDraft;

/** One screen's problems, { field: message }, from the merged draft: form-model's codes in the Flow's words. */
function validate(screenId, draft) {
  return Object.fromEntries(Object.entries(Model.checkScreen(screenId, draft)).map(([k, code]) => [k, MSG[code]]));
}

// Where a missing answer is: 'LESSON DELIVERY, "Teacher checks prior knowledge" (Part 2 of 6)'.
const clipItem = (t) => { const c = [...String(t)]; return c.length <= 48 ? c.join('') : `${c.slice(0, 47).join('').trimEnd()}…`; };
function whereIs(ctx, key) {
  for (const id of F.pathFor(ctx.tool, ctx.sheet)) {
    const s = F.screenById(id);
    let heading = null;
    let sub = null;
    for (const p of s.parts) {
      if (p.heading) { heading = p.heading; sub = null; } else if (p.sub) sub = p.sub;
      else if (p.field && p.field.name === key) {
        // An item is named by FDE's words for it (its label is only FDE's number), cut short.
        const what = p.field.answer && p.field.description ? `"${clipItem(p.field.description)}"` : p.field.label;
        return `${[heading, sub, what].filter(Boolean).join(', ')} (${s.title})`;
      }
    }
  }
  return key;
}

function missingNote(ctx, missing) {
  const shown = missing.slice(0, 3).map((k) => whereIs(ctx, k));
  const more = missing.length > shown.length ? ` and ${missing.length - shown.length} more` : '';
  return `Not submitted yet. Still to answer: ${shown.join('; ')}${more}. Go back with the arrow at the top, answer it, then come forward again with Next.`;
}

// ── Submit ────────────────────────────────────────────────────────────────────

function sendSummaryLater({ coachUserId, sessionId, analysis, formId }) {
  setImmediate(() => {
    Promise.resolve()
      .then(() => require('../services/observe/obs612/summary').sendCoachSummary({ coachUserId, sessionId, analysis }))
      .catch((err) => logToFile('[obs612] the coach summary failed', { formId, sessionId, error: err && err.message }, 'error'));
  });
}

async function submitForm(ctx, step, draft) {
  const missing = Record.whatIsMissing(ctx.form, draft);
  if (missing.length) {
    logToFile('[obs612] Submit with answers missing', { formId: ctx.formId, missing }, 'warn');
    return renderScreen(step, ctx, draft, { note: missingNote(ctx, missing) });
  }
  let analysis;
  try {
    analysis = Record.buildAnalysis(ctx.form, draft);
  } catch (err) {
    logToFile('[obs612] the analysis could not be built', { formId: ctx.formId, error: err.message }, 'error');
    return renderDone('error', ctx.formId);
  }
  const res = await Store.submit(ctx.form, draft, analysis);
  if (!res.ok) {
    if (res.alreadySealed) return renderDone('already', ctx.formId);
    if (res.closed) {
      logToFile('[obs612] Submit refused: the visit was cancelled', { formId: ctx.formId, sessionId: ctx.form.coaching_session_id }, 'warn');
      return renderDone('closed', ctx.formId);
    }
    return renderScreen(step, ctx, draft, { note: SUBMIT_FAILED });
  }
  const response = renderDone('submitted', ctx.formId);
  sendSummaryLater({ coachUserId: ctx.coachUserId, sessionId: res.sessionId, analysis, formId: ctx.formId });
  return response;
}

// ── handlers ──────────────────────────────────────────────────────────────────

async function handleObs612Init(flowToken) {
  const ctx = await load(flowToken);
  if (ctx.refusal) {
    logToFile('[obs612] form refused at open', { formId: ctx.formId || null, refusal: ctx.refusal }, 'warn');
    return { screen: 'NOTICE', data: noticeData(ctx.refusal) };
  }
  // The entry screens, named here: INIT may only answer with a screen that has no route in.
  const draft = Store.draftOf(ctx.form);
  if (ctx.tool === 'gen') return { screen: 'GEN_ENV', data: await screenData('GEN_ENV', ctx, draft) };
  if (ctx.tool === 'msci') return { screen: 'MSCI_OVERVIEW', data: await screenData('MSCI_OVERVIEW', ctx, draft) };
  return { screen: 'ENUR_CONTEXT', data: await screenData('ENUR_CONTEXT', ctx, draft) };
}

async function handleObs612DataExchange(flowToken, screen, payload = {}) {
  const posted = payload || {};
  const step = String(posted.screen || screen || '');
  const ctx = await load(flowToken);

  if (step === 'NOTICE') {
    const refusal = ctx.refusal || 'error';
    return renderDone(refusal === 'sealed' ? 'already' : 'refused', ctx.formId, REFUSED[refusal]);
  }
  if (ctx.refusal) {
    logToFile('[obs612] screen refused', { formId: ctx.formId || null, screen: step, refusal: ctx.refusal }, 'warn');
    if (ctx.refusal === 'sealed') return renderDone('already', ctx.formId);
    return renderDone(ctx.refusal === 'error' ? 'error' : 'refused', ctx.formId, REFUSED[ctx.refusal]);
  }
  if (!F.pathFor(ctx.tool, ctx.sheet).includes(step)) {
    logToFile('[obs612] a screen that is not on this visit\'s form', { formId: ctx.formId, screen: step, tool: ctx.tool, sheet: ctx.sheet }, 'warn');
    return renderDone('error', ctx.formId);
  }

  // 1. Save first: nothing the coach typed is lost to a check below.
  const fields = F.fieldsOf(step);
  const draft = mergeDraft(Store.draftOf(ctx.form), fields, posted);
  const saved = await Store.saveDraft(ctx.form, draft);
  if (!saved.ok) {
    if (saved.sealed) return renderDone('already', ctx.formId);
    return renderScreen(step, ctx, draft, { note: SAVE_FAILED });
  }
  ctx.form = saved.form;

  // 2. This screen's answers.
  const errors = validate(step, draft);
  if (Object.keys(errors).length) {
    return renderScreen(step, ctx, draft, { errors, note: fixNote(F.screenById(step).footer) });
  }

  // 3. On, or Submit.
  const next = F.nextOf(step, ctx.sheet);
  if (next) return renderScreen(next, ctx, draft);
  return submitForm(ctx, step, draft);
}

module.exports = {
  parseToken,
  handleObs612Init,
  handleObs612DataExchange,
  // For tests: the merge and the per-screen check, as the endpoint applies them.
  _mergeDraft: mergeDraft,
  _validate: validate,
};
