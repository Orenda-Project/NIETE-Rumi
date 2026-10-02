'use strict';

/**
 * The child test, the coach's side (bd-s1oo0.4). The coach collects and confirms; Rumi marks.
 *
 *   /egra or the observe2 offer → today's list (one list message: 5 children, 2 alternates)
 *   tap a child → Present / Absent / Refused
 *     absent, refused → draw.markOutcome promotes the next alternate; nothing more is asked
 *     present → session → for each block (urdu, english, maths):
 *        one coach-script line with the cue (the printed card is the stimulus, CONTRACT §11; card
 *        images only with CHILD_TEST_INCHAT_CARDS=on, after the line, ≤ 3, or on the card button)
 *        → ONE voice note: it claims its block first (Redis setNX, bd-s1oo0.14), the state moves on
 *          and the ack + next line go out, then it is stored to R2 and scored off the critical path
 *   after maths: the strip photo is asked for and may arrive while the next child is going
 *   all three blocks scored → the check (L6 checkFlow.sendCheck)
 *   scoring and the check run through recovery.js: claimed in the database, gated on
 *   the store, and picked up by its sweep when the process that saved a note dies before scoring it
 *
 * The five-minute protocol (bd-s1oo0.12): the list tells the coach to give the class teacher the roll
 * numbers in order (and "Send to teacher" does it, only for the class teacher of the drawn class); each
 * block prompt is one line (card page + exact cue + locked note) because the full script is on the
 * printed coach sheet; at Present the coach hands the maths strip to the next child to write while
 * waiting; strip photos are taken any time or batched at the end and each is claimed for the oldest
 * child on the list whose strip is missing (held under the draw until that child's session exists).
 *
 * /cancel and /menu work in every state; stopping a child never releases the draw (no markOutcome),
 * and tapping the child again resumes at the first block without a recording. Every save failure is
 * told to the coach and logged at error. Every step is time-stamped in the session's timings.
 */

const WhatsAppService = require('../../whatsapp.service');
const r2 = require('../../../storage/r2');
const { logToFile, logError } = require('../../../utils/logger');
const ports = require('./ports');
const S = require('./state');
const R = require('./recovery');
const C = require('./context');
const { langOf, t, clip, blockName, digits } = require('./copy');
const { evaluateChildTestTrigger, isChildTestAvailable } = require('./gate');
const { visitKeyFor, parseVisitKey, pktDate } = require('../draw/visit-key');

const BLOCKS = ['urdu', 'english', 'maths'];
const CUE_KEY = { urdu: 'childTestCueUrdu', english: 'childTestCueEnglish', maths: 'childTestCueMaths' };
const OUTCOME_OF = { p: 'present', a: 'absent', r: 'refused' };
const CANCEL_RX = /^(?:\/cancel|cancel|stop|منسوخ|روکیں)$/i;
const MENU_RX = /^\/menu$/i;
// L3 keeps an absent or refused child on the visit's main list, marked; they are not one of "the five".
const INACTIVE = new Set(['absent', 'refused', 'absent_final']);
const active = (children) => (children || []).filter((c) => !INACTIVE.has(c.status));
const nameFor = (lang, c) => (lang === 'en' ? c.displayName : (c.displayNameUrdu || c.displayName)) || '';

const nowIso = () => new Date().toISOString();
// This process's claims: a claim with no audio from another boot (or older than CLAIM_STALE_MS) died mid-upload.
const BOOT = `${process.pid}-${Date.now()}`;
const CLAIM_STALE_MS = 2 * 60 * 1000;
const CARDS_PER_TAP = 3;   // WhatsApp folds 4+ images in a row into an album (CONTRACT §11)
const inchatCards = () => String(process.env.CHILD_TEST_INCHAT_CARDS || '').toLowerCase() === 'on';
const r2Env = () => process.env.CHILD_TEST_R2_ENV || process.env.RAILWAY_ENVIRONMENT || 'local';
const audioKey = (schoolId, sessionId, block) => `child-test/${r2Env()}/${schoolId}/${sessionId}/${block}.ogg`;
const photoKey = (schoolId, sessionId) => `child-test/${r2Env()}/${schoolId}/${sessionId}/maths-strip.jpg`;
// A strip photographed before its child's session exists (the child wrote it while waiting).
const heldPhotoKey = (schoolId, drawId) => `child-test/${r2Env()}/${schoolId}/held/${drawId}/maths-strip.jpg`;
const rollsLine = (lang, children, { named = false } = {}) => children
  .map((c) => (named && nameFor(lang, c)
    ? t(lang, 'childTestRollItemNamed', { roll: c.rollNumber, name: nameFor(lang, c) })
    : t(lang, 'childTestRollItem', { roll: c.rollNumber })))
  .join(lang === 'en' ? ', ' : '، ');
const bareRolls = (lang, children) => children.map((c) => digits(lang, c.rollNumber)).join(lang === 'en' ? ', ' : '، ');
const listClassIds = (list) => (list.classIds && list.classIds.length ? list.classIds
  : [...new Set((list.children || []).map((c) => c.classId).filter(Boolean))]);

// ------------------------------------------------------------------ off the critical path

const inflight = new Set();
let offPathHook = null;   // tests only: ('drop') simulates the process dying before the job runs
function offPath(label, fn, meta) {
  if (offPathHook && offPathHook(label, meta) === 'drop') return Promise.resolve();
  const p = new Promise((resolve) => setImmediate(resolve))
    .then(fn)
    .catch((err) => logError('child_test.offpath_failed', { label, error: err.message }))
    .finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}
/** Tests (and a graceful shutdown) can wait for scoring and checks that are still running. */
async function drain() {
  while (inflight.size) await Promise.all([...inflight]);
}

// ------------------------------------------------------------------ small helpers

const { timing } = R;

async function say(to, text) {
  const ok = await WhatsAppService.sendMessage(to, text);
  if (ok === false) logError('child_test.send_failed', { kind: 'text' });
  return ok;
}

async function buttons(to, body, btns) {
  const ok = await WhatsAppService.sendInteractiveButtons(to, { body, buttons: btns });
  if (ok === false) {
    logError('child_test.send_failed', { kind: 'buttons', ids: btns.map((b) => b.id) });
    await say(to, body);
  }
  return ok;
}

const progressChild = (lang, cur) => t(lang, 'childTestProgressChild', { n: cur.childNo, total: cur.total });
const progressBlock = (lang, cur) => t(lang, 'childTestProgress', {
  n: cur.childNo, total: cur.total, block: blockName(lang, cur.block), b: BLOCKS.indexOf(cur.block) + 1,
});

const cardCache = new Map();
function cardsFor(grade, form, block, variant) {
  const k = `${grade}:${form}:${block}:${variant}`;
  if (!cardCache.has(k)) {
    const p = Promise.resolve(ports.render.renderInlineCards({ grade, form, block, variant }));
    p.catch(() => cardCache.delete(k));
    cardCache.set(k, p);
  }
  return cardCache.get(k);
}

// ------------------------------------------------------------------ today's list

/** How the draw names this list's visit: the observe2 field form, else a visit key (CONTRACT §12 CR-1). */
function visitOf(ctx) {
  if (ctx.visitId) return { visitId: ctx.visitId };
  return ctx.visitKey ? { visitKey: ctx.visitKey } : {};
}

/** A list with no field form gets its key: cs:<session> after classic /observe, else today's day key. */
function keyed(user, ctx) {
  if (ctx.visitId || ctx.visitKey) return ctx;
  const visitKey = visitKeyFor(ctx.coachingSessionId
    ? { coachingSessionId: ctx.coachingSessionId }
    : { coachUserId: user.id, schoolId: ctx.schoolId });
  return visitKey ? { ...ctx, visitKey } : ctx;
}

function staleDayKey(ctx, now = new Date()) {
  const k = parseVisitKey(ctx.visitKey);
  return !!k && k.kind === 'day' && k.date !== pktDate(now);
}

async function fetchList(user, ctx) {
  return ports.draw.todaysList({
    coachUserId: user.id, schoolId: ctx.schoolId, ...visitOf(ctx),
    observedGrade: ctx.observedGrade, observedClassId: ctx.observedClassId,
  });
}

/** Per drawId: the session (if any) and whether its check is still waiting. */
async function sessionsByDraw(ctx) {
  const out = {};
  const visit = ctx.visitId || ctx.visitKey;
  if (!visit) return out;
  const r = await ports.store.listSessionsForVisit(visit);
  if (!r || !r.ok) return out;
  for (const s of r.sessions || []) {
    let checkWaiting = false;
    if (s.status === 'completed' && await S.checkSent(s.id)) {
      const b = await ports.store.listBlocks(s.id);
      checkWaiting = !(b && b.ok && (b.blocks || []).length && b.blocks.every((x) => x.checked_at));
    }
    out[s.draw_id] = { ...s, checkWaiting };
  }
  return out;
}

function rowDescription(lang, child, sess, currentDrawId) {
  const parts = [t(lang, child.role === 'returning' ? 'childTestRoleReturning' : 'childTestRoleNew')];
  if (INACTIVE.has(child.status)) parts.push(t(lang, child.status === 'refused' ? 'childTestStatusRefused' : 'childTestStatusAbsent'));
  else if (child.drawId === currentDrawId) parts.push(t(lang, 'childTestStatusInProgress'));
  else if (sess && sess.status === 'completed') {
    parts.push(t(lang, 'childTestStatusTested'));
    if (sess.checkWaiting) parts.push(t(lang, 'childTestStatusCheckWaiting'));
  } else if (sess) parts.push(t(lang, 'childTestStatusInProgress'));
  return clip(parts.join(' · '), 72);
}

async function sendList(user, from, ctx, list, state) {
  const lang = langOf(user);
  const sess = await sessionsByDraw(ctx);
  const currentDrawId = state && state.current && state.current.sessionId ? state.current.drawId : null;
  const children = active(list.children);
  const inactive = (list.children || []).filter((c) => INACTIVE.has(c.status));
  const done = children.filter((c) => sess[c.drawId] && sess[c.drawId].status === 'completed').length;
  const shown = [...children, ...inactive].slice(0, 10);
  const checks = Object.values(sess).filter((s) => s.checkWaiting).length;
  const sections = [{
    title: clip(t(lang, 'childTestSectionChildren'), 24),
    rows: shown.map((c) => ({
      id: `ctst_child:${c.drawId}`,
      title: clip(t(lang, 'childTestRowTitle', { roll: c.rollNumber, name: nameFor(lang, c) }), 24),
      description: rowDescription(lang, c, sess[c.drawId], currentDrawId),
    })),
  }];
  const alts = (list.alternates || []).slice(0, Math.max(0, 10 - shown.length));
  if (alts.length) {
    sections.push({
      title: clip(t(lang, 'childTestSectionAlternates'), 24),
      rows: alts.map((c) => ({
        id: `ctst_alt:${c.drawId}`,
        title: clip(t(lang, 'childTestRowTitle', { roll: c.rollNumber, name: nameFor(lang, c) }), 24),
        description: clip(t(lang, 'childTestAlternateRow'), 72),
      })),
    });
  }
  const sectionsLabel = [...new Set(children.map((c) => c.section).filter(Boolean))].join(', ') || '—';
  let body = t(lang, 'childTestListBody', { done, total: children.length });
  const waiting = children.filter((c) => c.status === 'listed');
  if (waiting.length) body += `\n${t(lang, 'childTestListTeacherLine', { rolls: bareRolls(lang, waiting) })}`;
  if (checks) body += `\n${t(lang, 'childTestListChecks', { n: checks })}`;
  if (children.length && done === children.length) body += `\n${t(lang, 'childTestListAllDone')}`;
  const ok = await WhatsAppService.sendInteractiveMessage(from, {
    header: { type: 'text', text: clip(t(lang, 'childTestListHeader', { grade: list.grade, cls: sectionsLabel }), 60) },
    body: { text: body },
    action: { button: clip(t(lang, 'childTestListButton'), 20), sections },
  });
  if (ok === false) {
    logError('child_test.list_send_failed', { coachUserId: user.id, visitId: ctx.visitId });
    await say(from, t(lang, 'childTestListFailed'));
  }
  logToFile('child_test.list_sent', { coachUserId: user.id, visitId: ctx.visitId, children: children.length, done, checks });
  return ok;
}

async function openList(user, from, ctx) {
  const lang = langOf(user);
  ctx = keyed(user, ctx);
  const res = await fetchList(user, ctx);
  if (!res || !res.ok) {
    if (res && res.reason === 'no_class_list') return say(from, t(lang, 'childTestNoClassList'));
    if (res && res.reason === 'missing_visit') return say(from, t(lang, 'childTestNeedsVisit'));
    logError('child_test.list_failed', { coachUserId: user.id, visitId: ctx.visitId, reason: res && (res.reason || res.error) });
    return say(from, t(lang, 'childTestListFailed'));
  }
  const prev = await S.get(user.id);
  const sameCtx = prev && prev.ctx && prev.ctx.schoolId === ctx.schoolId && prev.ctx.visitId === ctx.visitId
    && prev.ctx.visitKey === ctx.visitKey;
  const state = {
    ctx,
    step: sameCtx && prev.step === 'block' ? 'block' : 'list',
    current: sameCtx && prev.step === 'block' ? prev.current : null,
    pendingPhotos: (prev && prev.pendingPhotos) || [],
    handed: (sameCtx && prev.handed) || [],
    strips: (sameCtx && prev.strips) || {},
    teacherOffered: !!(sameCtx && prev.teacherOffered),
    listOpenedAt: (sameCtx && prev.listOpenedAt) || nowIso(),
  };
  await S.set(user.id, state);
  const ok = await sendList(user, from, ctx, res, state);
  if (!state.teacherOffered) await offerTeacherSend(user, from, state, res);
  return ok;
}

// ------------------------------------------------------------------ the class teacher sends the children

/** Once per visit, and only when the observed teacher is a class teacher of a class on the list. */
async function offerTeacherSend(user, from, state, list) {
  if (!state.ctx.teacherUserId || !(await C.isClassTeacherOf(state.ctx.teacherUserId, listClassIds(list)))) return;
  const fresh = (await S.get(user.id)) || state;
  await S.set(user.id, { ...fresh, teacherOffered: true });
  const lang = langOf(user);
  await buttons(from, t(lang, 'childTestTeacherOfferBody'),
    [{ id: 'ctst_tsend', title: clip(t(lang, 'childTestSendToTeacher'), 20) }]);
}

/** "Send to teacher": one short message to the class teacher with the roll numbers still to come, in order. */
async function onSendToTeacher(user, from) {
  const lang = langOf(user);
  const state = await S.get(user.id);
  if (!state || !state.ctx || !state.ctx.teacherUserId) return say(from, t(lang, 'childTestExpired'));
  const { ctx } = state;
  const res = await fetchList(user, ctx);
  if (!res || !res.ok) return say(from, t(lang, 'childTestListFailed'));
  // Re-checked at the tap: the button is only a pointer, never a permission.
  if (!(await C.isClassTeacherOf(ctx.teacherUserId, listClassIds(res)))) {
    logToFile('child_test.teacher_send_refused', { visitId: ctx.visitId, teacherUserId: ctx.teacherUserId }, 'warn');
    return say(from, t(lang, 'childTestExpired'));
  }
  const waiting = active(res.children).filter((c) => c.status === 'listed');
  const teacher = await C.teacherContact(ctx.teacherUserId);
  if (!teacher || !waiting.length) {
    logError('child_test.teacher_send_failed', { visitId: ctx.visitId, teacherUserId: ctx.teacherUserId, reason: teacher ? 'nothing_waiting' : 'no_phone' });
    return say(from, t(lang, 'childTestTeacherSendFailed'));
  }
  const tl = teacher.preferred_language === 'en' ? 'en' : 'ur';
  // The teacher's own class: roll + the name the teacher already has, nothing else.
  const ok = await WhatsAppService.sendMessage(teacher.phone_number,
    t(tl, 'childTestTeacherMessage', { rolls: rollsLine(tl, waiting, { named: true }) }));
  if (ok === false) {
    logError('child_test.teacher_send_failed', { visitId: ctx.visitId, teacherUserId: ctx.teacherUserId, reason: 'send' });
    return say(from, t(lang, 'childTestTeacherSendFailed'));
  }
  logToFile('child_test.teacher_order_sent', { visitId: ctx.visitId, teacherUserId: ctx.teacherUserId, children: waiting.length });
  return say(from, t(lang, 'childTestTeacherSent'));
}

// ------------------------------------------------------------------ entry

async function start(user, from, arg) {
  const lang = langOf(user);
  let ctx = null;
  if (arg) {
    const schools = await C.coachSchools(user.id);
    const hit = schools.find((s) => s.emis === arg || s.schoolId === arg);
    if (!hit) return say(from, t(lang, 'childTestSchoolNotFound'));
    ctx = (await C.fromSchool({ coachUserId: user.id, schoolId: hit.schoolId })).ctx;
  } else {
    // A child mid-test keeps the list it belongs to. Otherwise today's latest observe2 visit wins
    // (the coach may have observed again since), and the last list is the fallback.
    const prev = await S.get(user.id);
    const midTest = prev && prev.ctx && (prev.step === 'block' || prev.step === 'presence');
    if (midTest) ctx = prev.ctx;
    else {
      const visitId = await C.todaysVisitId(user.id);
      if (visitId && prev && prev.ctx && prev.ctx.visitId === visitId) ctx = prev.ctx;
      else if (visitId) {
        const v = await C.fromVisit({ coachUserId: user.id, visitId });
        if (v.ok) ctx = v.ctx;
      }
      // The last list again — but a day key is only today's, so a list from an earlier day is redrawn.
      if (!ctx && prev && prev.ctx) ctx = staleDayKey(prev.ctx) ? { ...prev.ctx, visitKey: undefined } : prev.ctx;
    }
  }
  if (!ctx) {
    const schools = await C.coachSchools(user.id);
    if (!schools.length) return say(from, t(lang, 'childTestNoSchool'));
    if (schools.length === 1) ctx = (await C.fromSchool({ coachUserId: user.id, schoolId: schools[0].schoolId })).ctx;
    else return pickSchool(user, from, schools);
  }
  return openList(user, from, ctx);
}

async function pickSchool(user, from, schools) {
  const lang = langOf(user);
  let body = t(lang, 'childTestPickSchoolBody');
  if (schools.length > 10) body += `\n${t(lang, 'childTestPickSchoolMore')}`;
  return WhatsAppService.sendInteractiveMessage(from, {
    body: { text: body },
    action: {
      button: clip(t(lang, 'childTestPickSchoolButton'), 20),
      sections: [{
        title: clip(t(lang, 'childTestPickSchoolSection'), 24),
        rows: schools.slice(0, 10).map((s) => ({
          id: `ctst_school:${s.schoolId}`, title: clip(s.name, 24), description: s.emis ? clip(`EMIS ${s.emis}`, 72) : undefined,
        })),
      }],
    },
  });
}

async function onSchoolPicked(user, from, schoolId) {
  const schools = await C.coachSchools(user.id);
  if (!schools.some((s) => s.schoolId === schoolId)) return say(from, t(langOf(user), 'childTestSchoolNotFound'));
  return openList(user, from, (await C.fromSchool({ coachUserId: user.id, schoolId })).ctx);
}

async function onOffer(user, from, kind, id) {
  const v = kind === 's'
    ? await C.fromCoachingSession({ coachUserId: user.id, sessionId: id })
    : await C.fromVisit({ coachUserId: user.id, visitId: id });
  if (!v.ok) {
    logToFile('child_test.offer_refused', { coachUserId: user.id, kind, reason: v.reason }, 'warn');
    return say(from, t(langOf(user), v.reason === 'no_school' ? 'childTestNoSchool' : 'childTestExpired'));
  }
  return openList(user, from, v.ctx);
}

// ------------------------------------------------------------------ a child

async function onChildTapped(user, from, drawId, { alternate = false } = {}) {
  const lang = langOf(user);
  const state = await S.get(user.id);
  if (!state || !state.ctx) return say(from, t(lang, 'childTestExpired'));
  const res = await fetchList(user, state.ctx);
  if (!res || !res.ok) {
    logError('child_test.list_failed', { coachUserId: user.id, reason: res && (res.reason || res.error) });
    return say(from, t(lang, 'childTestListFailed'));
  }
  const marked = (res.children || []).find((c) => c.drawId === drawId && INACTIVE.has(c.status));
  if (marked) {
    return say(from, t(lang, marked.status === 'refused' ? 'childTestOutcomeRefused' : 'childTestOutcomeAbsent', { roll: marked.rollNumber }));
  }
  const five = active(res.children);
  const idx = five.findIndex((c) => c.drawId === drawId);
  if (idx < 0) {
    if (alternate || (res.alternates || []).some((c) => c.drawId === drawId)) return say(from, t(lang, 'childTestAlternateTapped'));
    await say(from, t(lang, 'childTestNotOnList'));
    return sendList(user, from, state.ctx, res, state);
  }
  const child = five[idx];
  const cur = state.current;
  if (state.step === 'block' && cur && cur.drawId !== drawId) {
    return say(from, t(lang, 'childTestBusy', { roll: cur.rollNumber, block: blockName(lang, cur.block) }));
  }
  if (state.step === 'block' && cur && cur.drawId === drawId) return sendPrompt(user, from, state);

  // The next child on the list who has not been tested or handed a strip writes the strip while waiting.
  const handed = state.handed || [];
  const nextUp = five.slice(idx + 1).find((c) => c.status === 'listed' && !handed.includes(c.drawId));
  const base = { drawId, rollNumber: child.rollNumber, childNo: idx + 1, total: five.length, tappedAt: nowIso(),
    listIds: res.children.map((c) => c.drawId),
    handOver: nextUp ? { drawId: nextUp.drawId, rollNumber: nextUp.rollNumber } : null };
  if (child.status === 'tested') {
    const r = await ports.store.getSessionByDraw(drawId);
    const sess = r && r.ok ? r.session : null;
    if (sess && sess.status === 'completed') {
      if (await S.checkSent(sess.id)) {
        const b = await ports.store.listBlocks(sess.id);
        const allChecked = b && b.ok && (b.blocks || []).length && b.blocks.every((x) => x.checked_at);
        if (!allChecked) return R.openCheck(sess.id, from, lang, child.rollNumber);
      }
      return say(from, t(lang, 'childTestAlreadyDone', { roll: child.rollNumber }));
    }
    return beginSession(user, from, { ...state, step: 'presence', current: base });
  }
  await S.set(user.id, { ...state, step: 'presence', current: base });
  return buttons(from,
    `*${progressChild(lang, base)}*\n${t(lang, 'childTestPresenceBody', { roll: child.rollNumber, name: nameFor(lang, child) })}`,
    [
      { id: `ctst_pres:${drawId}:p`, title: clip(t(lang, 'childTestPresent'), 20) },
      { id: `ctst_pres:${drawId}:a`, title: clip(t(lang, 'childTestAbsent'), 20) },
      { id: `ctst_pres:${drawId}:r`, title: clip(t(lang, 'childTestRefused'), 20) },
    ]);
}

async function onPresence(user, from, drawId, code) {
  const lang = langOf(user);
  const outcome = OUTCOME_OF[code];
  const state = await S.get(user.id);
  if (!outcome || !state || state.step !== 'presence' || !state.current || state.current.drawId !== drawId) {
    return say(from, t(lang, 'childTestExpired'));
  }
  const cur = state.current;
  const res = await ports.draw.markOutcome({ drawId, outcome, note: null, ...visitOf(state.ctx) });
  if (!res || !res.ok) {
    if (outcome === 'present' && res && res.reason === 'already_marked') return beginSession(user, from, state);
    logError('child_test.outcome_failed', { drawId, outcome, reason: res && (res.reason || res.error) });
    return say(from, t(lang, 'childTestOutcomeFailed'));
  }
  logToFile('child_test.outcome', { drawId, outcome, visitId: state.ctx.visitId });
  if (outcome === 'present') return beginSession(user, from, state);

  const list = res.list;
  const promoted = (list.children || []).find((c) => !(cur.listIds || []).includes(c.drawId));
  const next = { ...state, step: 'list', current: null };
  await S.set(user.id, next);
  await say(from, [
    t(lang, outcome === 'absent' ? 'childTestOutcomeAbsent' : 'childTestOutcomeRefused', { roll: cur.rollNumber }),
    promoted ? t(lang, 'childTestPromoted', { roll: promoted.rollNumber }) : t(lang, 'childTestNoAlternate'),
  ].join('\n'));
  return sendList(user, from, state.ctx, list, next);
}

/** Create (or pick up) the session for the current child and send the first block still to record. */
async function beginSession(user, from, state) {
  const lang = langOf(user);
  const cur = state.current;
  const cs = await ports.store.createSession({
    drawId: cur.drawId, coachUserId: user.id, ...visitOf(state.ctx), channel: 'whatsapp',
  });
  if (!cs || !cs.ok || !cs.session) {
    logError('child_test.session_create_failed', { drawId: cur.drawId, error: cs && cs.error });
    return say(from, t(lang, 'childTestSessionFailed'));
  }
  const session = cs.session;
  let block = 'urdu';
  let allStored = false;
  if (cs.created === false) {
    const recorded = await reconcileClaims(session.id);
    block = (await firstFree(session.id)) || 'maths';
    allStored = BLOCKS.every((x) => recorded.has(x));
    if (session.status !== 'in_progress') await ports.store.setSessionStatus(session.id, 'in_progress');
  }
  await timing(session.id, 'list.opened', state.listOpenedAt || nowIso());
  await timing(session.id, 'child.tapped', cur.tappedAt || nowIso());
  await timing(session.id, 'child.present');
  const strips = await attachHeldStrip(state, cur.drawId, session);
  const handed = [...(state.handed || [])];
  const handOver = block === 'urdu' && cs.created !== false ? cur.handOver : null;
  if (handOver && !handed.includes(handOver.drawId)) handed.push(handOver.drawId);
  const next = {
    ...state, step: 'block', handed, strips,
    current: { ...cur, handOver, sessionId: session.id, grade: session.grade, form: session.form, schoolId: session.school_id, block, claims: true },
  };
  logToFile('child_test.session_started', { sessionId: session.id, drawId: cur.drawId, block, resumed: cs.created === false });
  if (allStored) {
    // All three notes were stored before a stop or a restart: what follows maths is all that is left.
    await S.set(user.id, next);
    return afterAllStored(user, from, next.current, lang);
  }
  return sendBlock(user, from, next);
}

// ------------------------------------------------------------------ block claims (bd-s1oo0.14)

/**
 * The claims agree with the store: a block with audio is held ('stored'); a claim with no audio is
 * released unless an upload for it may still be running in this process. → Set of recorded blocks.
 */
async function reconcileClaims(sessionId) {
  const b = await ports.store.listBlocks(sessionId);
  const recorded = new Set(((b && b.blocks) || []).filter((x) => x.audio_r2_key).map((x) => x.block));
  for (const block of BLOCKS) {
    if (recorded.has(block)) {
      await S.claimBlock(sessionId, block, { audioId: 'stored', at: nowIso() });
      continue;
    }
    const c = await S.blockClaim(sessionId, block);
    const live = c && c.boot === BOOT && Date.now() - Date.parse(c.at || 0) < CLAIM_STALE_MS;
    if (c && !live) {
      await S.releaseBlock(sessionId, block);
      logToFile('child_test.block_claim_released', { sessionId, block, reason: 'stale' }, 'warn');
    }
  }
  return recorded;
}

/** The earliest of the child's blocks no note has claimed (a released hole comes first). → block | null */
async function firstFree(sessionId) {
  for (const block of BLOCKS) if (!(await S.blockClaim(sessionId, block))) return block;
  return null;
}

/** Atomically take the earliest free block for this note, in BLOCKS order. → block | null (all taken). */
async function claimNext(sessionId, claim) {
  for (const block of BLOCKS) if (await S.claimBlock(sessionId, block, claim)) return block;
  return null;
}

/** Re-read the state and point it at the first free block — only while it is still this session's. */
async function moveTo(userId, sessionId, { stamp = false } = {}) {
  const block = await firstFree(sessionId);
  const fresh = await S.get(userId);
  if (!fresh || fresh.step !== 'block' || !fresh.current || fresh.current.sessionId !== sessionId) return null;
  const target = block || 'maths';
  const changed = fresh.current.block !== target;
  const next = { ...fresh, current: { ...fresh.current, block: target, promptAt: changed || stamp ? nowIso() : fresh.current.promptAt } };
  await S.set(userId, next);
  return { state: next, block };
}

/** The coach-script prompt (then, only with in-chat cards on, ≤ 3 card images). State saved first. */
async function sendBlock(user, from, state) {
  const cur = state.current;
  cur.promptAt = nowIso();
  await S.set(user.id, state);
  return openBlock(user, from, state);
}

/** The prompt goes first, so a card image never holds it up behind the send pacer (bd-s1oo0.15). */
async function openBlock(user, from, state) {
  const ok = await sendPrompt(user, from, state);
  if (inchatCards()) await sendCardPage(user, from, state.current, 0);
  return ok;
}

/** A block's cards in send order: the main cards, then (language blocks) the letters-and-words fallback. */
async function blockCards(cur) {
  const main = await cardsFor(cur.grade, cur.form, cur.block, 'main');
  const fb = cur.block === 'maths' ? [] : await cardsFor(cur.grade, cur.form, cur.block, 'fallback');
  return [...(main || []), ...(fb || [])];
}

/** One page of ≤ 3 card images, then a short text so the next page never joins it in an album. → next page */
async function sendCardPage(user, from, cur, page) {
  const lang = langOf(user);
  let cards;
  try {
    cards = await blockCards(cur);
  } catch (err) {
    logError('child_test.card_render_failed', { sessionId: cur.sessionId, block: cur.block, error: err.message });
    await say(from, t(lang, 'childTestCardTextHeader'));
    return page;
  }
  if (!cards.length) return page;
  const pages = Math.ceil(cards.length / CARDS_PER_TAP);
  const p = ((page % pages) + pages) % pages;
  const slice = cards.slice(p * CARDS_PER_TAP, (p + 1) * CARDS_PER_TAP);
  let n = p * CARDS_PER_TAP;
  for (const card of slice) {
    n += 1;
    const ok = await WhatsAppService.sendImageFromBuffer(from, card.png, '', 'image/png');
    if (ok === false || ok === null || ok === undefined) {
      logError('child_test.card_send_failed', { sessionId: cur.sessionId, block: cur.block, part: card.part, index: n });
      await say(from, `${t(lang, 'childTestCardTextHeader')}\n\n${card.text || ''}`);
    }
    await timing(cur.sessionId, `${cur.block}.card_sent.${n}`);
  }
  await say(from, t(lang, 'childTestCardsPage', { from: p * CARDS_PER_TAP + 1, to: n, total: cards.length }));
  return (p + 1) % pages;
}

/** One line: progress · card page · the exact cue · the locked note (+ the strip hand-over on Urdu). */
async function sendPrompt(user, from, state) {
  const lang = langOf(user);
  const cur = state.current;
  const cue = t(lang, CUE_KEY[cur.block], {
    form: cur.form || 'A',
    cue: ports.cueFor(cur.block),
    numbersCue: ports.sectionCueFor('maths', 'numbers') || ports.cueFor('maths'),
    seconds: ports.quickSumsSeconds(cur.grade, cur.form),
  });
  let body = `*${progressBlock(lang, cur)}* · ${cue}`;
  if (cur.block === 'urdu' && cur.handOver) body += `\n${t(lang, 'childTestStripHandOver', { roll: cur.handOver.rollNumber })}`;
  const btns = [{ id: 'ctst_fb', title: clip(t(lang, 'childTestCardsButton'), 20) }];
  btns.push({ id: 'ctst_stop', title: clip(t(lang, 'childTestStopChild'), 20) });
  btns.push({ id: 'ctst_menu', title: clip(t(lang, 'childTestMenu'), 20) });
  const ok = await buttons(from, body, btns);
  await timing(cur.sessionId, `${cur.block}.prompt_sent`);
  return ok;
}

/** "No printed card": this block's cards on demand, ≤ 3 per tap; each tap shows the next three. */
async function onCardsTapped(user, from) {
  const state = await S.get(user.id);
  if (!state || state.step !== 'block' || !state.current) return say(from, t(langOf(user), 'childTestNothingOpen'));
  const cur = state.current;
  const pages = cur.cardPages || {};
  const page = pages[cur.block] != null ? pages[cur.block] : (inchatCards() ? 1 : 0);
  const next = await sendCardPage(user, from, cur, page);
  const fresh = await S.get(user.id);
  if (fresh && fresh.current && fresh.current.sessionId === cur.sessionId) {
    await S.set(user.id, { ...fresh, current: { ...fresh.current, cardPages: { ...(fresh.current.cardPages || {}), [cur.block]: next } } });
  }
  return timing(cur.sessionId, `${cur.block}.cards_tapped`);
}

// ------------------------------------------------------------------ media

async function handleVoice(message, from, user) {
  if (!isChildTestAvailable(user)) return false;
  const state = await S.get(user.id);
  if (!state || state.step !== 'block' || !state.current || !state.current.sessionId) return false;
  const audioId = (message.audio && message.audio.id) || (message.voice && message.voice.id);
  if (!audioId) return false;
  if (!(await S.firstSight(audioId))) return true;
  // Claimed from here on: whatever goes wrong next is logged and told, never handed to another handler.
  try {
    await processVoice(message, from, user, state, audioId);
  } catch (err) {
    logError('child_test.voice_failed', { sessionId: state.current.sessionId, block: state.current.block, error: err.message });
  }
  return true;
}

async function processVoice(message, from, user, state, audioId) {
  const lang = langOf(user);
  const cur = state.current;
  const sid = cur.sessionId;
  const sentAtMs = Number(message.timestamp) * 1000 || null;
  if (!cur.claims) await reconcileClaims(sid);   // a child started before claims existed

  // 1. Claim the block before any I/O: N quick notes take N distinct blocks, in arrival order.
  const block = await claimNext(sid, { audioId, sentAt: sentAtMs, at: nowIso(), boot: BOOT });
  if (!block) {
    logToFile('child_test.voice_all_in', { sessionId: sid });
    await say(from, t(lang, 'childTestVoiceAllIn', { roll: cur.rollNumber }));
    return true;
  }
  let stored = false;
  try {
    // A re-delivered older note is not the next block's: it was sent before the previous block's note.
    const bi = BLOCKS.indexOf(block);
    if (bi > 0 && sentAtMs) {
      const prev = await S.blockClaim(sid, BLOCKS[bi - 1]);
      const ref = prev && prev.sentAt ? prev.sentAt : (cur.promptAt ? Date.parse(cur.promptAt) - 2000 : null);
      if (ref && sentAtMs < ref) {
        await S.releaseBlock(sid, block);
        logToFile('child_test.voice_before_prompt', { sessionId: sid, block });
        await say(from, t(lang, 'childTestVoiceEarly', { block: blockName(lang, block), prev: blockName(lang, BLOCKS[bi - 1]) }));
        return true;
      }
    }

    // 2. The state moves on at once; the ack names the claimed block; the next line follows. Then the I/O.
    const moved = await moveTo(user.id, sid);
    try {
      await say(from, t(lang, 'childTestVoiceAck', { block: blockName(lang, block) }));
      // The ack may have waited on the send pacer; a note that came in meanwhile may hold the next block.
      if (moved && moved.block && BLOCKS.indexOf(moved.block) > bi && !(await S.blockClaim(sid, moved.block))) {
        await openBlock(user, from, moved.state);
      }
    } catch (err) {
      logError('child_test.voice_failed', { sessionId: sid, block, stage: 'reply', error: err.message });
    }
    await timing(sid, `${block}.voice_received`);

    const key = audioKey(cur.schoolId, sid, block);
    try {
      const buf = await WhatsAppService.downloadMedia(audioId);
      await r2.uploadBuffer(buf, key, 'audio/ogg');
      const r = await ports.store.attachBlockMedia({ sessionId: sid, block, audioR2Key: key });
      if (!r || (!r.ok && !r.alreadyScored)) throw new Error((r && r.error) || 'attach failed');
    } catch (err) {
      logError('child_test.audio_save_failed', { sessionId: sid, block, error: err.message });
      return saveFailed(user, from, cur, block, audioId, lang);
    }
    stored = true;
  } finally {
    // Anything that threw before the note was stored gives its block back, so the hole is re-recorded.
    if (!stored && (await S.blockClaim(sid, block) || {}).audioId === audioId) {
      await S.releaseBlock(sid, block);
      await S.forget(audioId);
      await moveTo(user.id, sid);
      await say(from, t(lang, 'childTestVoiceSaveFailed', { block: blockName(lang, block) }));
    }
  }
  await timing(sid, `${block}.audio_saved`);
  logToFile('child_test.audio_saved', { sessionId: sid, block });

  const sessionRef = { sessionId: sid, grade: cur.grade, form: cur.form };
  const notify = { from, lang, rollNumber: cur.rollNumber };
  if (block !== 'maths') offPath('score', () => R.runScoring(sessionRef, block, { notify }), { sessionId: sid, block });

  // 3. Whichever note completes the three runs what follows maths — once.
  const b = await ports.store.listBlocks(sid);
  const recorded = new Set(((b && b.blocks) || []).filter((x) => x.audio_r2_key).map((x) => x.block));
  if (BLOCKS.every((x) => recorded.has(x)) && await S.claimDone(sid)) await afterAllStored(user, from, cur, lang);
  return true;
}

/** The note did not save: its block is free again, the coach is told, and the next note fills it first. */
async function saveFailed(user, from, cur, block, audioId, lang) {
  await S.releaseBlock(cur.sessionId, block);
  await S.forget(audioId);
  await moveTo(user.id, cur.sessionId);
  await say(from, t(lang, 'childTestVoiceSaveFailed', { block: blockName(lang, block) }));
  return true;
}

/**
 * All three notes are stored. Maths: the strip may already be in (written while waiting); else it
 * comes later, possibly as a batch at the end. Maths is scored once, with it (or after "No strip photo").
 * Fresh state throughout: notes that arrived together have each moved it on.
 */
async function afterAllStored(user, from, cur, lang) {
  const fresh = (await S.get(user.id)) || {};
  const ctx = fresh.ctx;
  const ref = { sessionId: cur.sessionId, grade: cur.grade, form: cur.form, rollNumber: cur.rollNumber, schoolId: cur.schoolId, drawId: cur.drawId };
  const stripIn = fresh.strips && fresh.strips[cur.drawId] && fresh.strips[cur.drawId].sessionId === cur.sessionId;
  const already = (fresh.pendingPhotos || []).some((p) => p.sessionId === cur.sessionId);
  const pending = stripIn || already ? (fresh.pendingPhotos || []) : [...(fresh.pendingPhotos || []), ref];
  const mine = fresh.current && fresh.current.sessionId === cur.sessionId;
  const next = { ...fresh, step: mine ? 'list' : fresh.step, current: mine ? null : fresh.current, pendingPhotos: pending };
  await S.set(user.id, next);
  const res = ctx ? await fetchList(user, ctx) : null;
  if (stripIn) {
    await say(from, t(lang, 'childTestPhotoAlreadyIn', { roll: cur.rollNumber }));
    await finishChild(ref, from, lang);
  } else {
    await buttons(from, t(lang, 'childTestPhotoAsk', { roll: cur.rollNumber }),
      [{ id: `ctst_nophoto:${cur.sessionId}`, title: clip(t(lang, 'childTestNoPhoto'), 20) }]);
    await timing(cur.sessionId, 'maths.photo_requested');
  }
  // Nobody left to test: ask for the strips still missing, all together, in list order.
  if (res && res.ok && !active(res.children).some((c) => c.status === 'listed') && pending.length) {
    const order = active(res.children).map((c) => c.drawId);
    const missing = [...pending].sort((a, b) => order.indexOf(a.drawId) - order.indexOf(b.drawId));
    await say(from, t(lang, 'childTestStripsBatch', { rolls: rollsLine(lang, missing) }));
  }
  if (res && res.ok && mine) await sendList(user, from, ctx, res, next);
  return true;
}

/**
 * Which child a strip photo is for: the oldest child on today's list whose strip is still missing,
 * among the children who have one (tested, or handed the strip to write while waiting).
 * → { child, session } | null
 */
async function stripTarget(user, state) {
  // A child whose maths note is in and whose strip is awaited is never left without a target:
  // when the list cannot be read (or does not show them), the oldest such child takes the photo.
  const p0 = (state.pendingPhotos || [])[0];
  const pendingFallback = p0 ? { child: { drawId: p0.drawId, rollNumber: p0.rollNumber }, session: { id: p0.sessionId, school_id: p0.schoolId } } : null;
  const res = await fetchList(user, state.ctx);
  if (!res || !res.ok) return pendingFallback;
  const strips = state.strips || {};
  const handed = new Set(state.handed || []);
  const pendingByDraw = new Map((state.pendingPhotos || []).map((p) => [p.drawId, p]));
  for (const child of active(res.children)) {
    if (strips[child.drawId]) continue;
    const hasStrip = child.status === 'tested' || handed.has(child.drawId);
    if (!hasStrip) continue;
    const r = child.status === 'tested' ? await ports.store.getSessionByDraw(child.drawId) : null;
    const session = r && r.ok ? r.session : null;
    // A tested child whose photo was declined (no longer pending, completed) is not waiting for one.
    if (session && session.status === 'completed' && !pendingByDraw.has(child.drawId)) continue;
    return { child, session };
  }
  return pendingFallback;
}

async function handleImage(message, from, user) {
  if (!isChildTestAvailable(user)) return false;
  const state = await S.get(user.id);
  if (!state || !state.ctx) return false;
  if (!(state.pendingPhotos || []).length && !(state.handed || []).length) return false;
  const imageId = message.image && message.image.id;
  if (!imageId) return false;
  const target = await stripTarget(user, state);
  if (!target) return false;
  if (!(await S.firstSight(imageId))) return true;
  try {
    await processImage(from, user, state, target, imageId);
  } catch (err) {
    logError('child_test.photo_failed', { sessionId: target.session && target.session.id, drawId: target.child.drawId, error: err.message });
  }
  return true;
}

async function processImage(from, user, state, { child, session }, imageId) {
  const lang = langOf(user);
  const schoolId = (session && session.school_id) || state.ctx.schoolId;
  const key = session ? photoKey(schoolId, session.id) : heldPhotoKey(schoolId, child.drawId);
  try {
    const buf = await WhatsAppService.downloadMedia(imageId);
    await r2.uploadBuffer(buf, key, 'image/jpeg');
    if (session) {
      const r = await ports.store.attachBlockMedia({ sessionId: session.id, block: 'maths', photoR2Key: key });
      if (!r || (!r.ok && !r.alreadyScored)) throw new Error((r && r.error) || 'attach failed');
    }
  } catch (err) {
    logError('child_test.photo_save_failed', { sessionId: session && session.id, drawId: child.drawId, error: err.message });
    await S.forget(imageId);
    await say(from, t(lang, 'childTestPhotoSaveFailed', { roll: child.rollNumber }));
    return true;
  }
  const at = nowIso();
  if (session) await timing(session.id, 'maths.photo_received', at);
  const fresh = (await S.get(user.id)) || state;
  await S.set(user.id, { ...fresh, strips: { ...(fresh.strips || {}), [child.drawId]: { key, at, sessionId: session ? session.id : null } } });
  logToFile('child_test.strip_saved', { sessionId: session && session.id, drawId: child.drawId, held: !session });
  await say(from, t(lang, 'childTestPhotoSaved', { roll: child.rollNumber }));
  const p = session && (fresh.pendingPhotos || []).find((x) => x.sessionId === session.id);
  if (p) {
    await dropPending(user.id, session.id);
    await finishChild(p, from, lang);
  }
  return true;
}

/** A strip photographed while its child waited is attached once the child's session exists. → strips */
async function attachHeldStrip(state, drawId, session) {
  const strips = { ...(state.strips || {}) };
  const held = strips[drawId];
  if (!held || held.sessionId) return strips;
  const r = await ports.store.attachBlockMedia({ sessionId: session.id, block: 'maths', photoR2Key: held.key });
  if (!r || (!r.ok && !r.alreadyScored)) {
    // Not attached: the maths block will ask for the photo again (it stays visible, never silent).
    logError('child_test.held_strip_attach_failed', { sessionId: session.id, drawId, error: r && r.error });
    delete strips[drawId];
    return strips;
  }
  await timing(session.id, 'maths.photo_received', held.at || nowIso());
  strips[drawId] = { ...held, sessionId: session.id };
  return strips;
}

async function dropPending(userId, sessionId) {
  const fresh = await S.get(userId);
  if (!fresh) return;
  const pendingPhotos = (fresh.pendingPhotos || []).filter((x) => x.sessionId !== sessionId);
  if (fresh.step === 'closed' && !pendingPhotos.length) return S.clear(userId);
  return S.set(userId, { ...fresh, pendingPhotos });
}

async function onNoPhoto(user, from, sessionId) {
  const lang = langOf(user);
  const state = await S.get(user.id);
  const p = ((state && state.pendingPhotos) || []).find((x) => x.sessionId === sessionId);
  if (!p) return say(from, t(lang, 'childTestExpired'));
  await dropPending(user.id, sessionId);
  await timing(sessionId, 'maths.photo_declined');
  await say(from, t(lang, 'childTestNoPhotoAck', { roll: p.rollNumber }));
  return finishChild(p, from, lang);
}

/** All the coach's work for this child is in: the session is complete and maths is scored. */
async function finishChild(p, from, lang) {
  const r = await ports.store.setSessionStatus(p.sessionId, 'completed');
  if (!r || !r.ok) logError('child_test.session_complete_failed', { sessionId: p.sessionId, error: r && r.error });
  await say(from, t(lang, 'childTestChildDone', { roll: p.rollNumber }));
  // Maths is scored once, after the strip photo is in or the coach declined it (CONTRACT §12 CR-2).
  // `force` tells L5 to score what is there; without it a photo-less maths block stays 'pending' forever.
  offPath('score', () => R.runScoring({ sessionId: p.sessionId, grade: p.grade, form: p.form }, 'maths',
    { force: true, notify: { from, lang, rollNumber: p.rollNumber } }), { sessionId: p.sessionId, block: 'maths' });
  return true;
}

// ------------------------------------------------------------------ marking → the check

// Scoring and the check: recovery.js (runScoring, maybeOpenCheck, openCheck).

// ------------------------------------------------------------------ /cancel and /menu

/** Stop what is open. → false when nothing of the child test is open (the message is not ours). */
async function cancel(user, from, { quiet = false } = {}) {
  const lang = langOf(user);
  const state = await S.get(user.id);
  if (!state) return false;
  const cur = state.current;
  if ((state.step === 'presence' || state.step === 'block') && cur) {
    if (state.step === 'block' && cur.sessionId) {
      const r = await ports.store.setSessionStatus(cur.sessionId, 'abandoned');
      if (!r || !r.ok) logError('child_test.session_stop_failed', { sessionId: cur.sessionId, error: r && r.error });
      await timing(cur.sessionId, `${cur.block}.stopped`);
    }
    await S.set(user.id, { ...state, step: 'list', current: null });
    logToFile('child_test.child_stopped', { drawId: cur.drawId, step: state.step });
    if (!quiet) await say(from, t(lang, 'childTestCancelledChild', { roll: cur.rollNumber }));
    if (quiet) return closeList(user, from, { ...state, step: 'list', current: null }, { quiet });
    return true;
  }
  return closeList(user, from, state, { quiet });
}

async function closeList(user, from, state, { quiet }) {
  if (state.step !== 'closed' && (state.pendingPhotos || []).length) await S.set(user.id, { ...state, step: 'closed', current: null });
  else await S.clear(user.id);
  if (!quiet) await say(from, t(langOf(user), 'childTestClosed'));
  return true;
}

// ------------------------------------------------------------------ routers

async function handleText(from, messageBody, user) {
  const trimmed = (messageBody || '').trim();
  const ev = evaluateChildTestTrigger({ messageBody: trimmed, user });
  if (ev.match) {
    const lang = langOf(user);
    if (ev.action === 'deny_no_user') { await say(from, t(lang, 'childTestDenyNoUser')); return true; }
    if (ev.action === 'deny_role') { await say(from, t(lang, 'childTestDenyRole')); return true; }
    await start(user, from, ev.arg);
    return true;
  }
  if (!isChildTestAvailable(user)) return false;
  if (CANCEL_RX.test(trimmed)) return cancel(user, from);
  if (MENU_RX.test(trimmed)) { await cancel(user, from, { quiet: true }); return false; }
  return false;
}

async function handleButton(user, from, buttonId) {
  if (!String(buttonId || '').startsWith('ctst_') || !isChildTestAvailable(user)) return false;
  const [head, a, b] = buttonId.split(':');
  switch (head) {
    case 'ctst_offer': await onOffer(user, from, a, b); return true;
    case 'ctst_later': await say(from, t(langOf(user), 'childTestOfferLaterAck')); return true;
    case 'ctst_pres': await onPresence(user, from, a, b); return true;
    case 'ctst_fb': await onCardsTapped(user, from); return true;
    case 'ctst_stop':
      if (!(await cancel(user, from))) await say(from, t(langOf(user), 'childTestNothingOpen'));
      return true;
    case 'ctst_menu': {
      await cancel(user, from, { quiet: true });
      const MenuService = require('../../menu.service');
      await MenuService.sendMenu(from, user.id, null, langOf(user), user);
      return true;
    }
    case 'ctst_nophoto': await onNoPhoto(user, from, a); return true;
    case 'ctst_tsend': await onSendToTeacher(user, from); return true;
    default:
      logToFile('child_test.unknown_button', { buttonId }, 'warn');
      return true;
  }
}

async function handleList(user, from, listId) {
  if (!String(listId || '').startsWith('ctst_') || !isChildTestAvailable(user)) return false;
  const [head, a] = listId.split(':');
  if (head === 'ctst_child') await onChildTapped(user, from, a);
  else if (head === 'ctst_alt') await onChildTapped(user, from, a, { alternate: true });
  else if (head === 'ctst_school') await onSchoolPicked(user, from, a);
  else logToFile('child_test.unknown_list_row', { listId }, 'warn');
  return true;
}

module.exports = {
  handleText, handleButton, handleList, handleVoice, handleImage, drain, recordTiming: timing,
  __setOffPathForTest(fn) { offPathHook = fn || null; },
};
