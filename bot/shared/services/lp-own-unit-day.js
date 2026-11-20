'use strict';
/**
 * bd-snkn32.59 (queue #165) — one day of her unit, made on demand by the grades 1–5 "Make my own" rewrite. The day's
 * place in the unit rides in the own plan's answers (answers.unit, JSONB, no new column; answers.extend's pattern):
 *   { unit_id, day_no, of, kind: lesson|practice, period, lessons: [1–12 lesson ids], part?: 1|2, recap? }
 * Pure (no I/O).
 *   parseUnit(raw, lessonId)    → { ok, unit } | { ok: false, error } — the started-from day must be one of `lessons`
 *   withUnitPeriod(script, u)   → the day's script with meta.minutes = HER period (a copy), so every existing period
 *                                 rule (prompt timing line, the fit and the gate) plans for her period
 *   unitLines(u, { topicOf })   → the prompt lines: day N of M, yesterday's 3-minute recap, practice / joined / part
 *   withUnitLines(messages, u)  → the rewrite's messages with those lines put first in her (user) message
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LESSON_ID = /^[a-z0-9_]{1,80}$/;
const KINDS = ['lesson', 'practice'];
const MAX_LESSONS = 12;
const RECAP_MAX = 200;

const fail = (error) => ({ ok: false, error });
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function parseUnit(raw, lessonId) {
  const u = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!u) return fail('unit must be an object');
  if (typeof u.unit_id !== 'string' || !UUID.test(u.unit_id)) return fail('unit.unit_id');
  if (!whole(u.of, 1, 80) || !whole(u.day_no, 1, u.of)) return fail('unit.day_no / unit.of');
  if (!KINDS.includes(u.kind)) return fail('unit.kind');
  if (!whole(u.period, 20, 90)) return fail('unit.period');
  const lessons = Array.isArray(u.lessons) ? u.lessons : [];
  if (!lessons.length || lessons.length > MAX_LESSONS || !lessons.every((l) => typeof l === 'string' && LESSON_ID.test(l))) return fail('unit.lessons');
  if (!lessons.includes(lessonId)) return fail('unit.lessons does not name this day');
  if (u.kind === 'lesson' && lessons.length > 2) return fail('unit.lessons');
  if (u.part != null && (![1, 2].includes(u.part) || lessons.length !== 1)) return fail('unit.part');
  if (u.recap != null && (typeof u.recap !== 'string' || u.recap.length > RECAP_MAX)) return fail('unit.recap');
  const unit = { unit_id: u.unit_id, day_no: u.day_no, of: u.of, kind: u.kind, period: u.period, lessons: [...lessons] };
  if (u.part != null) unit.part = u.part;
  if (u.recap) unit.recap = u.recap.replace(/["“”]/g, '').trim();
  return { ok: true, unit };
}

function withUnitPeriod(script, unit) {
  if (!unit || !script || typeof script !== 'object') return script;
  return { ...script, meta: { ...(script.meta || {}), minutes: unit.period } };
}

function unitLines(unit, { topicOf = () => null } = {}) {
  if (!unit) return [];
  const lines = [`This is Day ${unit.day_no} of ${unit.of} of her unit, in her ${unit.period}-minute period.`];
  if (unit.recap) lines.push(`Open the hook with a 3-minute recap of yesterday's lesson ("${unit.recap}"), then today's new work.`);
  if (unit.kind === 'practice') {
    const topics = unit.lessons.map(topicOf).filter(Boolean);
    lines.push(`This is a PRACTICE day after the topic: no new content. Give more We Do and You Do on the outcomes already taught${topics.length ? ` (${topics.join('; ')})` : ''}, with a mixed check at the end.`);
  } else if (unit.lessons.length === 2) {
    const second = topicOf(unit.lessons[1]);
    lines.push(`Today also covers the next book day${second ? ` ("${second}")` : ''}: teach both in this one period, with shorter steps for each.`);
  }
  if (unit.part === 1) lines.push('This book day is split over two periods. This is part 1 of 2: teach the first half of the steps, and end with a check.');
  if (unit.part === 2) lines.push('This book day is split over two periods. This is part 2 of 2: open with a short recap of part 1, then teach the rest of the steps.');
  return lines;
}

/** A catalogue day's topic (for a joined or practice day's line); null when unknown. */
function catalogTopic(lessonId) {
  const hit = require('./lp-v8-catalog.service').lessonById(lessonId);
  return (hit && hit.lesson && hit.lesson.topic) || null;
}

function withUnitLines(messages, unit, { topicOf = catalogTopic } = {}) {
  if (!unit || !Array.isArray(messages) || messages.length < 2) return messages;
  const [system, user, ...rest] = messages;
  return [system, { ...user, content: `${unitLines(unit, { topicOf }).join('\n')}\n${user.content}` }, ...rest];
}

module.exports = { parseUnit, withUnitPeriod, unitLines, withUnitLines };
