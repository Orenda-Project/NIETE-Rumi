'use strict';

/**
 * bd-31ziu8.3 — the FICO-S v1.1 form's side of the grade 6-12 form endpoint (POST /api/flows/obs612). routes/obs612-
 * endpoint.js hands it every request whose token is '<coachUserId>:obs612:<formId>:fs' (the FICO-S Flow), with its own
 * form loader, store, record and summary sender, so a FICO-S form is read, saved, refused and sealed exactly as an FDE
 * form; only the screens differ (obs612/fico-s-flow.js).
 *
 *   INIT            FS_START, pre-filled from the saved draft; a refused form gets NOTICE (why, in the observer's
 *                   language).
 *   <form screen>   1. the screen's values are merged into the draft and saved (only while unsealed), BEFORE anything
 *                      is checked, so nothing typed is lost;
 *                   2. the screen's answers are checked (a level, and evidence of at least 20 characters, on every
 *                      indicator screen): anything missing keeps the observer on the screen, a line and a message under
 *                      each field;
 *                   3. the next screen, or on FS_FEEDBACK: Submit (record.whatIsMissing, record.buildAnalysis,
 *                      store.submit, then the coach summary after the response is ready).
 *   NOTICE          closes on DONE.
 *
 * Every word is in the observer's language (users.preferred_language through observeLang: en | ur). Never a `version`
 * field in a response (whatsapp-flows rule 1).
 */

const FS = require('../services/observe/obs612/fico-s-flow');
const { logToFile } = require('../utils/logger');

function userIdOf(flowToken) {
  return String(flowToken || '').split(':')[0] || null;
}

async function observerLang(userId) {
  if (!userId) return 'en';
  try {
    const supabase = require('../config/supabase');
    const { data } = await supabase.from('users').select('preferred_language').eq('id', userId).maybeSingle();
    return require('../services/coaching/frameworks/fico-s').langOf(require('../services/observe/observe-strings').observeLang(data || {}));
  } catch (_) {
    return 'en';
  }
}

// Queue #184: Rumi's pre-fill on the form row (a Digital Coach visit), for the screens' lines and the change check.
const dcOf = (form) => require('../services/observe/obs612/fico-s-dc').dcOf(form);

// Queue #218: the form's own version (v1.1 or v1.2) from its row, so a form finishes on the version it was made with.
const rubricOf = (ctx) => (ctx && ctx.form ? ctx.form.rubric_version : undefined);
const done = (outcome, formId, lang, lines, rubric) => ({ screen: 'DONE', data: FS.doneData(outcome, formId, lang, lines, rubric) });
const show = (screenId, draft, lang, opts) => ({ screen: screenId, data: FS.screenData(screenId, draft, lang, opts) });

async function handleInit(flowToken, deps) {
  const lang = await observerLang(userIdOf(flowToken));
  const ctx = await deps.load(flowToken);
  if (ctx.refusal) {
    logToFile('[fico-s] form refused at open', { formId: ctx.formId || null, refusal: ctx.refusal }, 'warn');
    return { screen: 'NOTICE', data: FS.noticeData(ctx.refusal, lang) };
  }
  return show(FS.FIRST_SCREEN, deps.Store.draftOf(ctx.form), lang, { dc: dcOf(ctx.form), rubric: rubricOf(ctx) });
}

async function submit(ctx, step, draft, lang, deps) {
  const missing = deps.Record.whatIsMissing(ctx.form, draft);
  if (missing.length) {
    logToFile('[fico-s] Submit with answers missing', { formId: ctx.formId, missing: missing.slice(0, 10), count: missing.length }, 'warn');
    return show(step, draft, lang, { note: FS.missingNote(missing, lang), dc: dcOf(ctx.form), rubric: rubricOf(ctx) });
  }
  let analysis;
  try {
    analysis = deps.Record.buildAnalysis(ctx.form, draft);
  } catch (err) {
    logToFile('[fico-s] the analysis could not be built', { formId: ctx.formId, error: err.message }, 'error');
    return done('error', ctx.formId, lang);
  }
  const res = await deps.Store.submit(ctx.form, draft, analysis);
  if (!res.ok) {
    if (res.alreadySealed) return done('already', ctx.formId, lang, FS.STR[lang].refused.sealed);
    if (res.closed) {
      logToFile('[fico-s] Submit refused: the visit was cancelled', { formId: ctx.formId, sessionId: ctx.form.coaching_session_id }, 'warn');
      return done('closed', ctx.formId, lang);
    }
    return show(step, draft, lang, { note: FS.STR[lang].submit_failed, dc: dcOf(ctx.form), rubric: rubricOf(ctx) });
  }
  logToFile('[fico-s] form submitted', {
    formId: ctx.formId, sessionId: res.sessionId, pct: analysis.obs612 && analysis.obs612.result ? analysis.obs612.result.pct : null,
  });
  const response = done('submitted', ctx.formId, lang, null, rubricOf(ctx));
  deps.sendSummaryLater({ coachUserId: ctx.coachUserId, sessionId: res.sessionId, analysis, formId: ctx.formId });
  return response;
}

async function handleDataExchange(flowToken, screen, payload, deps) {
  const posted = payload || {};
  const step = String(posted.screen || screen || '');
  const lang = await observerLang(userIdOf(flowToken));
  const ctx = await deps.load(flowToken);
  const s = FS.STR[lang];

  if (step === 'NOTICE') {
    const refusal = ctx.refusal || 'error';
    return done(refusal === 'sealed' ? 'already' : 'refused', ctx.formId, lang, s.refused[refusal] || s.refused.error);
  }
  if (ctx.refusal) {
    logToFile('[fico-s] screen refused', { formId: ctx.formId || null, screen: step, refusal: ctx.refusal }, 'warn');
    if (ctx.refusal === 'sealed') return done('already', ctx.formId, lang, s.refused.sealed);
    return done(ctx.refusal === 'error' ? 'error' : 'refused', ctx.formId, lang, s.refused[ctx.refusal] || s.refused.error);
  }
  if (!FS.pathFor().includes(step)) {
    logToFile('[fico-s] a screen that is not on the FICO-S form', { formId: ctx.formId, screen: step }, 'warn');
    return done('error', ctx.formId, lang);
  }

  // 1. Save first: nothing the observer typed is lost to a check below.
  const draft = FS.mergeDraft(deps.Store.draftOf(ctx.form), step, posted);
  if (FS.fieldsOf(step).length) {
    const saved = await deps.Store.saveDraft(ctx.form, draft);
    if (!saved.ok) {
      if (saved.sealed) return done('already', ctx.formId, lang, s.refused.sealed);
      return show(step, draft, lang, { note: s.save_failed, dc: dcOf(ctx.form), rubric: rubricOf(ctx) });
    }
    ctx.form = saved.form;
  }

  // 2. This screen's answers.
  const dc = dcOf(ctx.form);
  const rubric = rubricOf(ctx);
  const errors = FS.checkScreen(step, draft, { dc, rubric });
  if (Object.keys(errors).length) {
    const footer = FS.isSubmitScreen(step) ? s.submit : s.next;
    return show(step, draft, lang, { errors, note: s.fix_note(footer), dc, rubric });
  }

  // 3. On, or Submit.
  const next = FS.nextOf(step);
  if (next) return show(next, draft, lang, { dc, rubric });
  return submit(ctx, step, draft, lang, deps);
}

module.exports = { handleInit, handleDataExchange, observerLang };
