'use strict';

/**
 * bd-ra8xu.40 — an FDE (obs612) visit's form, filled on the PORTAL (operator 12 Nov: a coach can do on the portal
 * everything the WhatsApp review Flow does, "and the same for FDE obs612 visits"). The portal's draft routes
 * (portal-observe.service getDraft / saveDraft) hand an FDE session here at their top; nothing below is FICO.
 *
 * Nothing is re-implemented. The form is the WhatsApp Flow's own (obs612/flow.js): its parts in the Flow's screen
 * order, each field with the Flow's name, input, options and required flag. A save is the Flow's merge and check
 * (obs612/form-model.js) into answers.obs612 through store.saveDraft. Submit is the Flow's Submit, step for step: every
 * screen's check and record.whatIsMissing must be clean, then record.buildAnalysis and store.submit (the session merged
 * and moved to observer_review_complete / debrief done, the form sealed once). So the stored result is the Flow's.
 *
 * What is NOT done, by design (portal-observe.service's header): no WhatsApp message. The Flow's Submit sends the coach
 * her summary in chat (obs612/summary.js); a portal Submit does not. An open Flow on her phone then finds the form sealed
 * ("Already submitted"), so there is no chat state to release.
 *
 * The visit's status:
 *   editable    from the recording landing (the form row is made at capture) until Submit, while the visit is not
 *               cancelled or abandoned (store.submit refuses those: session-terminal);
 *   read-only   once sealed (her submitted answers), or for a cancelled visit.
 *
 * Words: FDE's own wording (items, levels, labels it prints) comes as data, in English as FDE printed it, exactly as
 * on WhatsApp. Our own words (Item n, Comments, the error lines …) are the portal's copy (en/ur): a field carries a
 * `role`, an error a code (form-model), and the portal says them.
 *
 * The draft, as the portal reads it (GET, and every save):
 *   { status: 'ok', kind: 'obs612', label ('FDE v1', rubricLabelOf), rubricId, tool, toolName, toolTitle, sheet,
 *     grade, subject,
 *     sections: [{ id, parts: [part] }]     the Flow's screens on this visit's path, in order
 *     values   { field: value }             answers.obs612 as saved
 *     errors   { field: code }              every screen's check on the saved draft
 *     missing  [field]                      record.whatIsMissing: what Submit still needs
 *     editable, sealed, submittedAt }
 *   part: { type: 'heading', text } | { type: 'sub', text } | { type: 'sub', role: 'plan'|'second'|'feedback' }
 *       | { type: 'context', rows: [{ key, label, value }] }                     (English & Urdu Section 1)
 *       | { type: 'levels', label, rows: [{ key, n, name, level }] }             (M&S: each indicator as scored)
 *       | { type: 'score', total, max, pct, band }                              (English & Urdu: so far)
 *       | { type: 'field', name, role, input, kind, n, short, text, options, required, max }
 *   role: item | comment | observation | context | plan_area | plan_goal | plan_action | feedback | line
 */

const O = require('../../coaching/frameworks/obs612');
const F = require('./flow');
const Record = require('./record');
const Model = require('./form-model');
const { rubricLabelOf } = require('../../coaching/rubric-label');
const { isTerminalStatus } = require('../../coaching/session-terminal');

// I/O, loaded on use: each requires the database client.
const Store = () => require('./store');
const FieldForms = () => require('../observe2/field-form.store');
const log = (...args) => require('../../../utils/logger').logToFile(...args);

// A generous cap on any one posted value before the merge (the Flow's own caps then apply: TextArea 600, text 80).
const VALUE_CAP = 2000;

/** Is this coaching_sessions row an FDE visit? Its stamp (set when the recording lands) or its stored analysis. */
function isFdeSession(row) {
  if (!row) return false;
  const ad = row.analysis_data || {};
  return O.isObs612Id(row.framework) || O.isObs612Id(ad.framework);
}

// ── the form's parts ──────────────────────────────────────────────────────────

// Each scored item's number as FDE prints it (General form and English & Urdu: per section; Maths & Science: 1-11).
const ITEM_N = Object.fromEntries([
  ...O.TOOLS.gen.sections.flatMap((s) => s.items.map((i) => [i.key, i.n])),
  ...O.TOOLS.enur.sections.flatMap((s) => s.items.map((i) => [i.key, i.n])),
  ...O.TOOLS.msci.indicators.map((i) => [i.key, i.n]),
]);
const DP_COLUMNS = O.TOOLS.msci.development_plan.columns; // Development area, Current level, Teacher goal, Action plan …
const LEVEL_LABELS = O.TOOLS.msci.scale.labels;

/** What a field is, for the portal's words: its role, and FDE's own wording where FDE prints one. */
function roleOf(f) {
  const n = f.name;
  if (f.answer) return { role: 'item', text: f.description || null };
  if (n.startsWith('comment_')) return { role: 'comment', text: null };
  if (n.startsWith('obs_')) return { role: 'observation', text: null };
  if (n.startsWith('ctx_')) return { role: 'context', text: (O.TOOLS.enur.context.find((c) => c.key === n) || {}).label || null };
  if (n.startsWith('dp_area')) return { role: 'plan_area', text: DP_COLUMNS[0] };
  if (n.startsWith('dp_goal')) return { role: 'plan_goal', text: DP_COLUMNS[2] };
  if (n.startsWith('dp_action')) return { role: 'plan_action', text: DP_COLUMNS[3] };
  if (n === 'fb_line') return { role: 'line', text: null };
  if (n.startsWith('fb_')) return { role: 'feedback', text: (O.TOOLS.enur.feedback.find((x) => `fb_${x.key}` === n) || {}).label || null };
  return { role: 'other', text: f.label || null };
}

function fieldPart(f, tool) {
  const { role, text } = roleOf(f);
  return {
    type: 'field',
    name: f.name,
    role,
    input: f.input,
    kind: f.answer || null,
    n: role === 'item' ? (ITEM_N[f.name] || null) : null,
    short: role === 'item' && tool === 'msci' ? (O.SHORT.msci[f.name] || null) : null,
    text,
    options: f.options ? f.options.map((o) => ({ id: o.id, title: o.title, ...(o.description ? { description: o.description } : {}) })) : null,
    required: Boolean(f.required),
    max: f.max || null,
  };
}

// Our own sub-headings (the Flow's English) are said by the portal: named by the field they introduce.
const SUB_ROLE = { dp_area: 'plan', dp_area_2: 'second', fb_line: 'feedback' };

function bodyPart(key, ctx, draft) {
  if (key === 'ctx_lines') return { type: 'context', rows: Model.contextRows(ctx.form, ctx.lesson.grade, ctx.people) };
  if (key === 'levels_line') {
    return {
      type: 'levels',
      label: DP_COLUMNS[1],
      rows: O.TOOLS.msci.indicators.map((i) => {
        const v = O.normAnswer('level', draft[i.key]);
        return { key: i.key, n: i.n, name: O.SHORT.msci[i.key], level: v === null ? null : LEVEL_LABELS[Number(v)] };
      }),
    };
  }
  if (key === 'score_line') {
    const r = O.score(ctx.form.rubric_version, ctx.sheet, draft);
    return { type: 'score', total: r.total, max: r.max, pct: r.pct, band: r.band ? r.band.label : null };
  }
  return null;
}

function sectionsOf(ctx, draft) {
  return F.pathFor(ctx.tool, ctx.sheet).map((id) => {
    const s = F.screenById(id);
    const parts = [];
    s.parts.forEach((p, i) => {
      if (p.heading) parts.push({ type: 'heading', text: p.heading });
      else if (p.sub) {
        const next = s.parts.slice(i + 1).find((q) => q.field);
        const role = next ? SUB_ROLE[next.field.name] : null;
        parts.push(role ? { type: 'sub', role } : { type: 'sub', text: p.sub });
      } else if (p.body) {
        const b = bodyPart(p.body, ctx, draft);
        if (b) parts.push(b);
      } else if (p.field) parts.push(fieldPart(p.field, ctx.tool));
    });
    return { id, parts };
  });
}

/** Every screen's check on the draft, as one { field: code }. */
function errorsOf(ctx, draft) {
  return Object.assign({}, ...F.pathFor(ctx.tool, ctx.sheet).map((id) => Model.checkScreen(id, draft)));
}

// ── the visit ─────────────────────────────────────────────────────────────────

/** The session's FDE form and its lesson, or the answer to give instead. */
async function loadVisit(userId, row) {
  const got = await FieldForms().findBySession(row.id);
  if (!got.ok) return { answer: { status: 'error', reason: 'form_read_failed' } };
  const form = got.form;
  if (!form) {
    log('❌ obs612 portal: an FDE session has no FDE form row', { sessionId: row.id }, 'error');
    return { answer: { status: 'not_ready', reason: 'no_fde_form' } };
  }
  if (form.observer_user_id !== userId) return { answer: { status: 'not_found' } };
  if (!O.toolById(form.rubric_version)) {
    log('❌ obs612 portal: the visit\'s form is not a known FDE rubric', { sessionId: row.id, rubric: form.rubric_version }, 'error');
    return { answer: { status: 'not_ready', reason: 'not_obs612' } };
  }
  const lesson = Record.lessonOf(form);
  // record.js reads a sheet it does not know as English (frameworks/obs612 enurSections); so does the Flow, so does this.
  const sheet = lesson.tool === 'enur' ? O.normSheet(lesson.sheet) : null;
  return { ctx: { form, lesson, tool: lesson.tool, sheet, people: [] } };
}

async function viewOf(row, ctx) {
  const form = ctx.form;
  if (ctx.tool === 'enur' && !ctx.people.length) {
    const got = await Store().getPeople([form.observer_user_id, form.teacher_user_id]);
    ctx.people = got.ok ? got.people : [];
  }
  const draft = Store().draftOf(form);
  const sealed = Boolean(form.sealed_at);
  const label = rubricLabelOf({ session: row, form });
  return {
    status: 'ok',
    kind: 'obs612',
    label: label ? label.label : O.LABEL,
    rubricId: form.rubric_version,
    tool: ctx.tool,
    toolName: O.SHORT.tools[ctx.tool],
    toolTitle: O.TOOLS[ctx.tool].title,
    sheet: ctx.sheet,
    grade: ctx.lesson.grade,
    subject: ctx.lesson.subject,
    sections: sectionsOf(ctx, draft),
    values: draft,
    errors: errorsOf(ctx, draft),
    missing: Record.whatIsMissing(form, draft),
    editable: !sealed && !isTerminalStatus(row.status),
    sealed,
    submittedAt: form.sealed_at || null,
  };
}

/** GET: the visit's FDE form, as the portal shows it. */
async function portalDraft({ userId, row }) {
  const v = await loadVisit(userId, row);
  if (v.answer) return v.answer;
  return viewOf(row, v.ctx);
}

/**
 * The posted values the merge may take: only this visit's fields, only strings (or numbers), only a real option (or
 * '' to clear) for a choice. Anything else is as if never posted, so it can never reach answers.obs612.
 */
function cleanPosted(fields, edits) {
  const src = edits && typeof edits === 'object' && !Array.isArray(edits) ? edits : {};
  const out = {};
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(src, f.name)) continue;
    const raw = src[f.name];
    if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') continue;
    const v = raw === null ? '' : String(raw).slice(0, VALUE_CAP);
    if (f.options && v.trim() !== '' && !f.options.some((o) => o.id === v.trim())) continue;
    out[f.name] = v;
  }
  return out;
}

/**
 * POST: save her answers (the Flow's merge), and with `submit` the Flow's Submit.
 * @returns the draft view ({ saved: true }, or { submitted: true, coachingSessionId } after a Submit) |
 *   { status: 'invalid', reason: 'obs612_incomplete', missing, errors }   (a Submit with anything missing; saved)
 *   { status: 'not_ready', reason: 'sealed' | 'visit_closed' }              (nothing changed)
 *   { status: 'error', reason }                                              (the database refused; logged)
 */
async function portalSave({ userId, row, edits, submit = false }) {
  const v = await loadVisit(userId, row);
  if (v.answer) return v.answer;
  const { ctx } = v;
  if (ctx.form.sealed_at) return { status: 'not_ready', reason: 'sealed' };
  if (isTerminalStatus(row.status)) return { status: 'not_ready', reason: 'visit_closed' };

  // 1. Save first, as the Flow does: nothing she wrote is lost to a check below.
  const fields = F.pathFor(ctx.tool, ctx.sheet).flatMap((id) => F.fieldsOf(id));
  const draft = Model.mergeDraft(Store().draftOf(ctx.form), fields, cleanPosted(fields, edits));
  const saved = await Store().saveDraft(ctx.form, draft);
  if (!saved.ok) {
    if (saved.sealed) return { status: 'not_ready', reason: 'sealed' };
    return { status: 'error', reason: 'save_failed' };
  }
  ctx.form = saved.form;
  if (!submit) return { ...(await viewOf(row, ctx)), saved: true };

  // 2. Submit: every screen's check (the Flow checks each on the way to Submit), then nothing missing.
  const errors = errorsOf(ctx, draft);
  const missing = Record.whatIsMissing(ctx.form, draft);
  if (missing.length || Object.keys(errors).length) {
    for (const k of missing) if (!errors[k]) errors[k] = k.startsWith('fb_') ? 'text' : 'item';
    log('[obs612] portal Submit with answers missing', { formId: ctx.form.id, sessionId: row.id, missing, errors: Object.keys(errors) }, 'warn');
    return { status: 'invalid', reason: 'obs612_incomplete', missing, errors };
  }

  // 3. The Flow's record and the Flow's seal.
  let analysis;
  try {
    analysis = Record.buildAnalysis(ctx.form, draft);
  } catch (err) {
    log('[obs612] portal Submit: the analysis could not be built', { formId: ctx.form.id, error: err.message }, 'error');
    return { status: 'error', reason: 'analysis_failed' };
  }
  const res = await Store().submit(ctx.form, draft, analysis);
  if (!res.ok) {
    if (res.alreadySealed) return { status: 'not_ready', reason: 'sealed' };
    if (res.closed) return { status: 'not_ready', reason: 'visit_closed' };
    return { status: 'error', reason: 'submit_failed' };
  }
  log('🖥️ obs612: form submitted from the portal — no WhatsApp message', { formId: ctx.form.id, sessionId: res.sessionId, rubric: analysis.framework });
  ctx.form = res.form;
  return { ...(await viewOf({ ...row, status: 'observer_review_complete' }, ctx)), submitted: true, coachingSessionId: res.sessionId };
}

module.exports = { isFdeSession, portalDraft, portalSave };
