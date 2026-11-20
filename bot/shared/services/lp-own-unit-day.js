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
  if (unit.start === 'goals') return lines; // bd-snkn32.59.4 — the goal day's own lines are goalDayLines (lp-k5-own)
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

/*
 * bd-snkn32.59.4 (queue #165, phase 2) — a day of a GOAL unit (Amena 20 Nov: no textbook for learning goals). There is
 * no book day under it: her goals are the only source.
 *   { unit_id, day_no, of, kind: lesson|practice|review|test, period, start: 'goals', grade 1–5, subject, lang,
 *     goals: [1–8 goal texts this day works on], recap? }
 *   parseGoalUnit(raw)  → { ok, unit } | { ok: false, error }
 *   goalDayScript(u)    → the empty frame the rewrite fills (the five parts, her period, her goals at the top)
 *   goalDayLines(u)     → the prompt lines that replace "use the day's plan" (no plan, no book: write it yourself)
 */
const GOAL_KINDS = ['lesson', 'practice', 'review', 'test'];
const SUBJECT = /^[a-z_]{2,40}$/;
const GOAL_MAX = 400;

function parseGoalUnit(raw) {
  const u = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!u || u.start !== 'goals') return fail('unit.start');
  if (typeof u.unit_id !== 'string' || !UUID.test(u.unit_id)) return fail('unit.unit_id');
  if (!whole(u.of, 1, 80) || !whole(u.day_no, 1, u.of)) return fail('unit.day_no / unit.of');
  if (!GOAL_KINDS.includes(u.kind)) return fail('unit.kind');
  if (!whole(u.period, 20, 90)) return fail('unit.period');
  if (!whole(u.grade, 1, 5)) return fail('unit.grade');
  if (typeof u.subject !== 'string' || !SUBJECT.test(u.subject)) return fail('unit.subject');
  if (!['en', 'ur'].includes(u.lang)) return fail('unit.lang');
  const goals = Array.isArray(u.goals) ? u.goals.map((g) => (typeof g === 'string' ? g.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim() : '')) : [];
  if (!goals.length || goals.length > 8 || goals.some((g) => g.length < 3 || g.length > GOAL_MAX)) return fail('unit.goals');
  if ((u.kind === 'lesson' && goals.length > 2) || (u.kind === 'practice' && goals.length !== 1)) return fail('unit.goals');
  if (u.recap != null && (typeof u.recap !== 'string' || u.recap.length > GOAL_MAX)) return fail('unit.recap');
  const unit = { unit_id: u.unit_id, day_no: u.day_no, of: u.of, kind: u.kind, period: u.period, start: 'goals',
    grade: u.grade, subject: u.subject, lang: u.lang, goals };
  if (u.recap) unit.recap = u.recap.replace(/["“”]/g, '').trim();
  return { ok: true, unit };
}

const goalsText = (u) => u.goals.join(' • ');

function goalDayScript(u) {
  const write = 'Write this part for the goal above.';
  return {
    goal: goalsText(u),
    meta: { day: u.day_no, topic: u.goals[0], minutes: u.period },
    hook: { action: write },
    iDo: { action: write, steps: [write] },
    weDo: { action: write, steps: [write] },
    youDo: { action: write, problems: [write] },
    wrap: { exitOptions: [{ prompt: write }] },
  };
}

const DAY_JOB = {
  lesson: (g) => (g.length > 1 ? `Teach BOTH of her goals today, one after the other, with shorter steps for each: ${g.map((x) => `"${x}"`).join(' and ')}.`
    : `Teach her goal today: "${g[0]}".`),
  practice: (g) => `This is a PRACTICE day for the goal already taught ("${g[0]}"): no new content. More We Do and You Do on it, then a mixed check.`,
  review: (g) => `This is a REVIEW day: no new content. Go back over these goals already taught, a little on each, then mixed practice: ${g.map((x) => `"${x}"`).join('; ')}.`,
  test: (g) => `This is the CHECK day that closes her unit. A short reminder (I Do), practice together (We Do), then in You Do each child answers one or two short check questions per goal, alone: ${g.map((x) => `"${x}"`).join('; ')}. The wrap: mark together and note who needs help with which goal.`,
};

function goalDayLines(u) {
  return [
    DAY_JOB[u.kind](u.goals),
    'There is NO textbook and NO ready plan behind this day: the plan you get is an EMPTY FRAME of five parts. Write every part yourself, '
      + `for grade ${u.grade}, simple and correct: only facts you are sure of, at this grade's level.`,
    'Her class has NO TEXTBOOK. Never send the children to a book page or say "open your book". Write into the plan the letters, words, sentences, short passage or sums the children read, say or solve, short enough for her to say aloud, show with objects or write on the board if she has one.',
    'Wherever these rules say the children work in or hold up "the book", they use their copies instead.',
    'Keep `goal` exactly as given (her goals). Replace every "Write this part" line with real teaching.',
  ];
}

const SUBJECT_NAMES = { math: 'Mathematics', english: 'English', urdu: 'Urdu', general_science: 'General Science' };

/** A goal-unit row (no segment, no book day): the worker's "day" for it, from answers.unit alone; null otherwise. */
function goalDay(row) {
  const u = row && !row.lesson_id && !row.segment_id && row.answers && row.answers.unit;
  if (!u || u.start !== 'goals') return null;
  return { lang: u.lang, grade: u.grade, subject: u.subject, subjectName: SUBJECT_NAMES[u.subject] || u.subject, pages: null,
    script: goalDayScript(u), key: `unit_${String(u.unit_id).slice(0, 8)}_d${u.day_no}` };
}

module.exports = { parseUnit, withUnitPeriod, unitLines, withUnitLines, parseGoalUnit, goalDayScript, goalDayLines, goalDay };
