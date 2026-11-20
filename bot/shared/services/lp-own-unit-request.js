'use strict';
/**
 * bd-snkn32.59.4 (queue #165, phase 2) — "Make my own" for one day of her GOAL unit: no segment, no book day (Amena
 * 20 Nov: "pls dont link the textbook for learning goals"). The own-plan row names neither (V1.10.9 lets a goal-unit
 * row do that); answers.unit holds the day (lp-own-unit-day.parseGoalUnit) and answers.goal its goals, so the worker
 * makes it book-less and runs the goal check before she sees it. Gated by the unit switch (the portal's, read again
 * here), the daily limit and the same parse as every make. Dependencies are lp612-own.service's.
 */
const { parseOwnAnswers } = require('./lp612-own-instruction');
const { dailyLimit, karachiDayStart } = require('./lp-own-edit-guard');

async function requestGoalUnitDay(d, queue, { userId, answers, correlationId = null, tv }) {
  const parsed = parseOwnAnswers(answers, { goalUnit: true });
  if (!parsed.ok) return { outcome: 'bad_request', error: parsed.error };
  let on = false;
  try { on = !!d.unitOn && (await d.unitOn(userId)) === true; } catch (_) { on = false; }
  if (!on) return { outcome: 'not_found' };
  if ((await d.countToday(userId, karachiDayStart(d.now()))) >= dailyLimit(d.env || process.env)) return { outcome: 'daily_limit' };
  const row = await d.insertOwn({
    user_id: userId,
    lang: parsed.answers.unit.lang,
    template_version: tv,
    status: 'authoring',
    answers: parsed.answers,
    correlation_id: correlationId,
  });
  if (!row || !row.id) return { outcome: 'error' };
  const out = await queue(row, `unit_${parsed.answers.unit.unit_id}`, correlationId);
  return parsed.answers.noteDropped && out.outcome === 'queued' ? { ...out, noteDropped: true } : out;
}

module.exports = { requestGoalUnitDay };
