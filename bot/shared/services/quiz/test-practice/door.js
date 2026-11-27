'use strict';
/**
 * The practice door (A/B test ict-quiz-practice-door). `context(st)` answers who is asking, for the finish hook and
 * for every practice call: the switch on, a genuine session token whose share code matches, an eligible child
 * (arm.js) and that child's arm. `field(body, out)` is the finish screen's `{practice_door}`: arm B, under the day's
 * cap. Switch off → `{}` and nothing past the switch is read.
 *
 * Arm: QA's force_b list → B. Else the arm the ledger holds. Else a draw by phone group (assignArm, launch gate G1),
 * recorded only once the test is in ab/registry.json, so no child is pinned to the control arm before the test
 * starts. A child with no live phone binding draws on their own id (logged, no ids).
 */
const path = require('path');
const AB = require('../../ab-assign.service');
const T = require('../web-quiz-token');
const Bindings = require('../child-phone-bindings.repo');
const { logToFile } = require('../../../utils/logger');
const Arm = require('./arm');
const Cap = require('./cap');
const Pool = require('./pool.repo');
const Ledger = require('./ledger');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const warn = (m) => logToFile(`⚠️ practice_door ${m}`);
const abLog = (m) => logToFile(m);
let registeredCache = null;

function registered() {
  if (registeredCache === null) {
    const reg = AB.readRegistry(REPO_ROOT);
    registeredCache = Boolean(reg && reg.ok && reg.entries.some((e) => e.flag_key === Arm.FLAG_KEY && e.test_id === Arm.TEST_ID));
  }
  return registeredCache;
}

async function armOf(flag, studentId) {
  if (flag.forceB.has(studentId)) return 'b';
  const held = await Ledger.readArm(studentId);
  if (held === 'a' || held === 'b') return held;
  let bindings = [];
  try { bindings = await Bindings.activeForChild(studentId); } catch (e) { warn(`bindings ${e.message}`); }
  const g = Arm.groupKeyOf(bindings, studentId);
  if (g.fallback) warn('unit fallback: no live phone binding, drawn on the child');
  const arm = Arm.drawArm({ flag, studentId, groupKey: g.key, assign: (t) => AB.assignArm(t, { log: abLog }) });
  if (registered()) await Ledger.writeArm(studentId, arm, g.key);
  return arm;
}

async function flagOn() {
  const flag = Arm.parseFlag(await AB.readSwitch(Arm.FLAG_KEY));
  return flag.on ? flag : null;
}

/** {flag, s, quiz, arm} for an eligible child, else null. Never throws. */
async function context(st, flag = null) {
  try {
    const f = flag || (await flagOn());
    if (!f) return null;
    const tok = T.verify(st, 's');
    if (!tok || !tok.sid) return null;
    const s = await Pool.sessionOf(tok.sid);
    if (!s || s.share_code_id !== tok.sc) return null;
    const quiz = await Pool.quizOf(s.quiz_id);
    if (!Arm.eligible(s, quiz)) return null;
    return { flag: f, s, quiz, arm: await armOf(f, s.student_id) };
  } catch (e) {
    warn(`context ${e.message}`);
    return null;
  }
}

/** Rounds the child may still play today (0 = capped). */
async function roundsLeft(studentId, now = new Date()) {
  const n = Pool.roundsSince(await Pool.practiceRows(studentId), Cap.pktDayStart(now));
  return Math.max(0, Cap.ROUNDS_PER_DAY - n);
}

async function field(body = {}, out = {}, { now = new Date() } = {}) {
  try {
    const flag = await flagOn();
    if (!flag || !out || !out.score) return {};
    const ctx = await context(body.st, flag);
    if (!ctx || ctx.arm !== 'b') return {};
    const left = await roundsLeft(ctx.s.student_id, now);
    return left > 0 ? { practice_door: { rounds_left: left } } : {};
  } catch (e) {
    warn(`field ${e.message}`);
    return {};
  }
}

module.exports = { context, roundsLeft, field, _reset: () => { registeredCache = null; } };
