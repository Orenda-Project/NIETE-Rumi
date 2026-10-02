'use strict';

/**
 * The child test, the coach's side (bd-s1oo0.4). The coach collects and confirms; Rumi marks.
 *
 *   /egra or the observe2 offer → today's list (one list message: 5 children, 2 alternates)
 *   tap a child → Present / Absent / Refused
 *     absent, refused → draw.markOutcome promotes the next alternate; nothing more is asked
 *     present → session → for each block (urdu, english, maths):
 *        the child's cards (image; on a failed send, the text) + one coach-script line with the cue
 *        → ONE voice note, acknowledged at once, stored to R2, scored off the critical path
 *   after maths: the strip photo is asked for and may arrive while the next child is going
 *   all three blocks scored → the check (L6 checkFlow.sendCheck)
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
const C = require('./context');
const { langOf, t, clip, blockName } = require('./copy');
const { evaluateChildTestTrigger, isChildTestAvailable } = require('./gate');

const BLOCKS = ['urdu', 'english', 'maths'];
const SCRIPT_KEY = { urdu: 'childTestScriptUrdu', english: 'childTestScriptEnglish', maths: 'childTestScriptMaths' };
const OUTCOME_OF = { p: 'present', a: 'absent', r: 'refused' };
const SCORED_BLOCKS_PER_SESSION = BLOCKS.length;
const CANCEL_RX = /^(?:\/cancel|cancel|stop|منسوخ|روکیں)$/i;
const MENU_RX = /^\/menu$/i;
// L3 keeps an absent or refused child on the visit's main list, marked; they are not one of "the five".
const INACTIVE = new Set(['absent', 'refused', 'absent_final']);
const active = (children) => (children || []).filter((c) => !INACTIVE.has(c.status));
const nameFor = (lang, c) => (lang === 'en' ? c.displayName : (c.displayNameUrdu || c.displayName)) || '';

const nowIso = () => new Date().toISOString();
const r2Env = () => process.env.CHILD_TEST_R2_ENV || process.env.RAILWAY_ENVIRONMENT || 'local';
const audioKey = (schoolId, sessionId, block) => `child-test/${r2Env()}/${schoolId}/${sessionId}/${block}.ogg`;
const photoKey = (schoolId, sessionId) => `child-test/${r2Env()}/${schoolId}/${sessionId}/maths-strip.jpg`;

// ------------------------------------------------------------------ off the critical path

const inflight = new Set();
function offPath(label, fn) {
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

async function timing(sessionId, key, at = new Date()) {
  if (!sessionId) return;
  try {
    const r = await ports.store.recordTiming(sessionId, key, at);
    if (!r || !r.ok) logError('child_test.timing_failed', { sessionId, key, error: r && r.error });
  } catch (err) {
    logError('child_test.timing_failed', { sessionId, key, error: err.message });
  }
}

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

async function fetchList(user, ctx) {
  return ports.draw.todaysList({
    coachUserId: user.id, schoolId: ctx.schoolId, visitId: ctx.visitId,
    observedGrade: ctx.observedGrade, observedClassId: ctx.observedClassId,
  });
}

/** Per drawId: the session (if any) and whether its check is still waiting. */
async function sessionsByDraw(ctx) {
  const out = {};
  if (!ctx.visitId) return out;
  const r = await ports.store.listSessionsForVisit(ctx.visitId);
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
  const res = await fetchList(user, ctx);
  if (!res || !res.ok) {
    if (res && res.reason === 'no_class_list') return say(from, t(lang, 'childTestNoClassList'));
    if (res && res.reason === 'missing_visit') return say(from, t(lang, 'childTestNeedsVisit'));
    logError('child_test.list_failed', { coachUserId: user.id, visitId: ctx.visitId, reason: res && (res.reason || res.error) });
    return say(from, t(lang, 'childTestListFailed'));
  }
  const prev = await S.get(user.id);
  const sameCtx = prev && prev.ctx && prev.ctx.schoolId === ctx.schoolId && prev.ctx.visitId === ctx.visitId;
  const state = {
    ctx,
    step: sameCtx && prev.step === 'block' ? 'block' : 'list',
    current: sameCtx && prev.step === 'block' ? prev.current : null,
    pendingPhotos: (prev && prev.pendingPhotos) || [],
    listOpenedAt: (sameCtx && prev.listOpenedAt) || nowIso(),
  };
  await S.set(user.id, state);
  return sendList(user, from, ctx, res, state);
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
      if (!ctx && prev && prev.ctx) ctx = prev.ctx;
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

  const base = { drawId, rollNumber: child.rollNumber, childNo: idx + 1, total: five.length, tappedAt: nowIso(),
    listIds: res.children.map((c) => c.drawId) };
  if (child.status === 'tested') {
    const r = await ports.store.getSessionByDraw(drawId);
    const sess = r && r.ok ? r.session : null;
    if (sess && sess.status === 'completed') {
      if (await S.checkSent(sess.id)) {
        const b = await ports.store.listBlocks(sess.id);
        const allChecked = b && b.ok && (b.blocks || []).length && b.blocks.every((x) => x.checked_at);
        if (!allChecked) return openCheck(sess.id, from, lang, child.rollNumber);
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
  const res = await ports.draw.markOutcome({ drawId, outcome, note: null, visitId: state.ctx.visitId });
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
    drawId: cur.drawId, coachUserId: user.id, visitId: state.ctx.visitId, channel: 'whatsapp',
  });
  if (!cs || !cs.ok || !cs.session) {
    logError('child_test.session_create_failed', { drawId: cur.drawId, error: cs && cs.error });
    return say(from, t(lang, 'childTestSessionFailed'));
  }
  const session = cs.session;
  let block = 'urdu';
  if (cs.created === false) {
    const b = await ports.store.listBlocks(session.id);
    const recorded = new Set(((b && b.blocks) || []).filter((x) => x.audio_r2_key).map((x) => x.block));
    block = BLOCKS.find((x) => !recorded.has(x)) || 'maths';
    if (session.status !== 'in_progress') await ports.store.setSessionStatus(session.id, 'in_progress');
  }
  await timing(session.id, 'list.opened', state.listOpenedAt || nowIso());
  await timing(session.id, 'child.tapped', cur.tappedAt || nowIso());
  await timing(session.id, 'child.present');
  const next = {
    ...state, step: 'block',
    current: { ...cur, sessionId: session.id, grade: session.grade, form: session.form, schoolId: session.school_id, block },
  };
  logToFile('child_test.session_started', { sessionId: session.id, drawId: cur.drawId, block, resumed: cs.created === false });
  return sendBlock(user, from, next);
}

/** The block's cards, then the coach-script prompt. The state is saved first, so a quick note lands. */
async function sendBlock(user, from, state) {
  const cur = state.current;
  cur.promptAt = nowIso();
  await S.set(user.id, state);
  await sendCards(user, from, cur, 'main');
  return sendPrompt(user, from, state);
}

async function sendCards(user, from, cur, variant) {
  const lang = langOf(user);
  let cards;
  try {
    cards = await cardsFor(cur.grade, cur.form, cur.block, variant);
  } catch (err) {
    logError('child_test.card_render_failed', { sessionId: cur.sessionId, block: cur.block, variant, error: err.message });
    return say(from, t(lang, 'childTestCardTextHeader'));
  }
  let n = 0;
  for (const card of cards || []) {
    n += 1;
    const ok = await WhatsAppService.sendImageFromBuffer(from, card.png, '', 'image/png');
    if (ok === false || ok === null || ok === undefined) {
      logError('child_test.card_send_failed', { sessionId: cur.sessionId, block: cur.block, variant, index: n });
      await say(from, `${t(lang, 'childTestCardTextHeader')}\n\n${card.text || ''}`);
    }
    if (variant === 'main') await timing(cur.sessionId, `${cur.block}.card_sent.${n}`);
  }
  return true;
}

async function sendPrompt(user, from, state) {
  const lang = langOf(user);
  const cur = state.current;
  const body = `*${progressBlock(lang, cur)}*\n\n${t(lang, SCRIPT_KEY[cur.block], { cue: ports.cueFor(cur.block) })}`;
  const btns = [];
  if (cur.block !== 'maths') btns.push({ id: 'ctst_fb', title: clip(t(lang, 'childTestFallbackButton'), 20) });
  btns.push({ id: 'ctst_stop', title: clip(t(lang, 'childTestStopChild'), 20) });
  btns.push({ id: 'ctst_menu', title: clip(t(lang, 'childTestMenu'), 20) });
  const ok = await buttons(from, body, btns);
  await timing(cur.sessionId, `${cur.block}.prompt_sent`);
  return ok;
}

async function onFallbackCards(user, from) {
  const state = await S.get(user.id);
  if (!state || state.step !== 'block' || !state.current) return say(from, t(langOf(user), 'childTestNothingOpen'));
  await sendCards(user, from, state.current, 'fallback');
  return timing(state.current.sessionId, `${state.current.block}.fallback_sent`);
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
  const block = cur.block;
  const bi = BLOCKS.indexOf(block);
  const sentAtMs = Number(message.timestamp) * 1000;
  if (bi > 0 && sentAtMs && cur.promptAt && sentAtMs < Date.parse(cur.promptAt) - 2000) {
    logToFile('child_test.voice_before_prompt', { sessionId: cur.sessionId, block });
    await say(from, t(lang, 'childTestVoiceEarly', { block: blockName(lang, block), prev: blockName(lang, BLOCKS[bi - 1]) }));
    return true;
  }

  await say(from, t(lang, 'childTestVoiceAck', { block: blockName(lang, block) }));
  await timing(cur.sessionId, `${block}.voice_received`);
  const key = audioKey(cur.schoolId, cur.sessionId, block);
  try {
    const buf = await WhatsAppService.downloadMedia(audioId);
    await r2.uploadBuffer(buf, key, 'audio/ogg');
    const r = await ports.store.attachBlockMedia({ sessionId: cur.sessionId, block, audioR2Key: key });
    if (!r || (!r.ok && !r.alreadyScored)) throw new Error((r && r.error) || 'attach failed');
  } catch (err) {
    logError('child_test.audio_save_failed', { sessionId: cur.sessionId, block, error: err.message });
    await S.forget(audioId);
    await say(from, t(lang, 'childTestVoiceSaveFailed', { block: blockName(lang, block) }));
    return true;
  }
  await timing(cur.sessionId, `${block}.audio_saved`);
  logToFile('child_test.audio_saved', { sessionId: cur.sessionId, block });

  const sessionRef = { sessionId: cur.sessionId, grade: cur.grade, form: cur.form, rollNumber: cur.rollNumber };
  if (block !== 'maths') {
    offPath('score', () => scoreBlock(sessionRef, block, from, lang));
    return sendBlock(user, from, { ...state, current: { ...cur, block: BLOCKS[bi + 1] } }).then(() => true);
  }

  // Maths: the strip photo comes later, possibly during the next child. Maths is scored once, with it.
  const pending = [...(state.pendingPhotos || []), { ...sessionRef, schoolId: cur.schoolId }];
  const next = { ...state, step: 'list', current: null, pendingPhotos: pending };
  await S.set(user.id, next);
  await buttons(from, t(lang, 'childTestPhotoAsk', { roll: cur.rollNumber }),
    [{ id: `ctst_nophoto:${cur.sessionId}`, title: clip(t(lang, 'childTestNoPhoto'), 20) }]);
  await timing(cur.sessionId, 'maths.photo_requested');
  const res = await fetchList(user, state.ctx);
  if (res && res.ok) await sendList(user, from, state.ctx, res, next);
  return true;
}

async function handleImage(message, from, user) {
  if (!isChildTestAvailable(user)) return false;
  const state = await S.get(user.id);
  const pending = (state && state.pendingPhotos) || [];
  if (!pending.length) return false;
  const imageId = message.image && message.image.id;
  if (!imageId) return false;
  if (!(await S.firstSight(imageId))) return true;
  try {
    await processImage(from, user, pending[0], imageId);
  } catch (err) {
    logError('child_test.photo_failed', { sessionId: pending[0].sessionId, error: err.message });
  }
  return true;
}

async function processImage(from, user, p, imageId) {
  const lang = langOf(user);
  const key = photoKey(p.schoolId, p.sessionId);
  try {
    const buf = await WhatsAppService.downloadMedia(imageId);
    await r2.uploadBuffer(buf, key, 'image/jpeg');
    const r = await ports.store.attachBlockMedia({ sessionId: p.sessionId, block: 'maths', photoR2Key: key });
    if (!r || (!r.ok && !r.alreadyScored)) throw new Error((r && r.error) || 'attach failed');
  } catch (err) {
    logError('child_test.photo_save_failed', { sessionId: p.sessionId, error: err.message });
    await S.forget(imageId);
    await say(from, t(lang, 'childTestPhotoSaveFailed', { roll: p.rollNumber }));
    return true;
  }
  await timing(p.sessionId, 'maths.photo_received');
  await dropPending(user.id, p.sessionId);
  await say(from, t(lang, 'childTestPhotoSaved', { roll: p.rollNumber }));
  await finishChild(p, from, lang);
  return true;
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
  offPath('score', () => scoreBlock(p, 'maths', from, lang));
  return true;
}

// ------------------------------------------------------------------ marking → the check

async function scoreBlock(ref, block, from, lang) {
  let r;
  try {
    r = await ports.scoring.scoreBlock({ sessionId: ref.sessionId, block, grade: ref.grade, form: ref.form });
  } catch (err) {
    r = { ok: false, aiStatus: 'failed', reason: err.message };
  }
  if (!r || r.aiStatus === 'failed' || r.ok === false) {
    logError('child_test.score_failed', { sessionId: ref.sessionId, block, reason: r && r.reason });
  }
  await timing(ref.sessionId, `${block}.scored`);
  const n = await S.countScored(ref.sessionId);
  if (n >= SCORED_BLOCKS_PER_SESSION && await S.claimCheck(ref.sessionId)) {
    await openCheck(ref.sessionId, from, lang, ref.rollNumber);
  }
}

async function openCheck(sessionId, from, lang, rollNumber) {
  let ok;
  try {
    ok = await ports.checkFlow.sendCheck(sessionId);
  } catch (err) {
    ok = false;
    logError('child_test.check_send_failed', { sessionId, error: err.message });
  }
  if (!ok || ok.ok === false) {
    logError('child_test.check_send_failed', { sessionId });
    return say(from, t(lang, 'childTestCheckFailed', { roll: rollNumber }));
  }
  await timing(sessionId, 'check.sent');
  logToFile('child_test.check_sent', { sessionId });
  return true;
}

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
    case 'ctst_fb': await onFallbackCards(user, from); return true;
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
};
