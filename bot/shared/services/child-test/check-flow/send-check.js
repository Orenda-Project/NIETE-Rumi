'use strict';

/**
 * Child test check Flow — the "Check" message L4 sends when a child's marks are back:
 * a Flow message with the child (full name first), the headline numbers the form shows FILLED IN, what
 * the coach must fill in, and «جانچ کریں». It opens in
 * data_exchange mode (a flow token, no screen), so Meta calls the endpoint's INIT for screen 1.
 */

const WhatsAppService = require('../../whatsapp.service');
const { logError } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const { loadSession, whoOf } = require('./context');
const { planBlock } = require('./prefill');
const { buildToken, enabled } = require('./token');
const { clip, digits } = require('../conversation/copy');

const BLOCKS = ['urdu', 'english', 'maths'];

/**
 * What the check form will show for one block, from the same plan the endpoint renders it with
 * (bd-s1oo0.27): its headline number and whether it arrives filled ('sure'), filled but unsure (assist)
 * or empty, and how many of each kind of field arrive empty for the coach to fill.
 */
function blockSummary(block, row, items) {
  const aiMarks = (row && row.ai_marks) || null;
  const coachMarks = (row && row.coach_marks) || null;
  const plan = planBlock(block, { aiMarks, coachMarks, items });
  const out = { block, nothing: !aiMarks && !coachMarks, headline: null, empty: [] };
  const open = (rows) => (rows || []).filter((r) => !r.prefilled).length;
  const add = (kind, n = 1) => { if (n > 0) out.empty.push({ kind, n }); };
  if (block === 'maths') {
    const qs = plan.quickSums;
    if (qs.filled) out.headline = { kind: 'sums', n: qs.mark.correct, fill: qs.fill };
    add('num', open(plan.numbers.rows));
    if (!qs.filled) add('qs');
    add('w', open(plan.written));
    if (plan.wordProblem && !plan.wordProblem.fill) add('wp');
    return out;
  }
  if (plan.fallback) {
    if (plan.fallback.filled) out.headline = { kind: 'letters', n: plan.fallback.mark.letters && plan.fallback.mark.letters.correct, fill: plan.fallback.fill };
    else add('fb');
  } else if (plan.story.filled) out.headline = { kind: 'words', n: plan.story.mark.words_correct, fill: plan.story.fill };
  else add('story');
  add('q', open(plan.questions));
  add('fs', open(plan.firstSounds));
  add('nw', open(plan.nonwords.rows));
  return out;
}

/** The three blocks, in order. */
function summarise(blocks, items) {
  return BLOCKS.map((b) => blockSummary(b, blocks[b], items));
}

/**
 * The message body: the child; the numbers the form shows filled in (and, in assist, the ones filled but
 * unsure); what the coach must fill in, per block; how long it takes. A number the form leaves empty is
 * never stated (sandbox5-syn-2032: "Urdu 57 words" in the message, an empty Urdu count in the form).
 */
function messageBody(S, lang, who, summary) {
  const headline = (s) => {
    const h = s.headline;
    const n = h.kind === 'words' ? S.words_line(h.n) : (h.kind === 'letters' ? S.letters_line(h.n) : S.sums_line(h.n));
    return `${S.block_name[s.block]} ${n}`;
  };
  const sure = summary.filter((s) => s.headline && s.headline.fill === 'sure').map(headline);
  const unsure = summary.filter((s) => s.headline && s.headline.fill === 'unsure').map(headline);
  const toFill = summary
    .filter((s) => s.nothing || s.empty.length)
    .map((s) => `${S.block_name[s.block]}: ${s.nothing ? S.f_all : s.empty.map((e) => S[`f_${e.kind}`](e.n)).join(S.list_sep)}`);
  const lines = [];
  if (sure.length) lines.push(S.msg_filled(sure.join(S.list_sep)));
  if (unsure.length) lines.push(S.msg_unsure(unsure.join(S.list_sep)));
  if (!sure.length && !unsure.length) lines.push(S.msg_none_filled);
  lines.push(toFill.length ? S.msg_fill(toFill.join(S.block_sep)) : S.msg_all_filled);
  lines.push(S.msg_tail);
  const rest = lines.join('\n');
  // Urdu lines carry Urdu digits (language-protocol §9.4); the child's label is already localised.
  return `${S.msg_intro(who)}\n${lang === 'en' ? rest : digits('ur', rest)}`;
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
async function sendCheck(sessionId) {
  if (!enabled()) return { ok: false, reason: 'disabled' };
  const flowId = process.env.CHILD_TEST_CHECK_FLOW_ID;
  if (!flowId) {
    logError('[child_test] check not sent: CHILD_TEST_CHECK_FLOW_ID is not set', { sessionId });
    return { ok: false, reason: 'flow_not_configured' };
  }
  const ctx = await loadSession(sessionId);
  if (!ctx) return { ok: false, reason: 'no_session' };
  if (!ctx.coach || !ctx.coach.phone_number) {
    logError('[child_test] check not sent: the coach has no phone number', { sessionId });
    return { ok: false, reason: 'no_coach' };
  }
  const { S } = ctx;
  const lang = ctx.lang === 'en' ? 'en' : 'ur';
  // The child's name goes to the coach's WhatsApp only; nothing here logs it.
  const who = whoOf(ctx);
  const summary = summarise(ctx.blocks, ctx.items);
  const sent = await WhatsAppService.sendFlow(ctx.coach.phone_number, {
    flowId,
    header: clip(S.check_header(who), 60),
    body: clip(messageBody(S, lang, who, summary), 1024),
    buttonText: S.check_cta,
    flowToken: buildToken(ctx.session.coach_user_id, ctx.session.id),
  });
  if (!sent) {
    logError('[child_test] check not sent: WhatsApp refused the Flow message', { sessionId });
    return { ok: false, reason: 'send_failed' };
  }
  logEvent('child_test.check_sent', {
    sessionId,
    filled: summary.filter((s) => s.headline && s.headline.fill === 'sure').map((s) => s.block),
    toFill: summary.filter((s) => s.nothing || s.empty.length).map((s) => s.block),
  });
  return { ok: true };
}

module.exports = { sendCheck, summarise, messageBody };
