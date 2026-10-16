'use strict';

/**
 * /observe2 — the brief for the coach's conversation with the teacher, built from the checked
 * record only (no model call): questions that let the teacher reflect first (2 Oct call: "make the
 * debrief more reflective"), two things that went well, how much of the lesson plan was taught, the
 * thing to work on first with what was seen and the next step up, and one confirmed moment to bring
 * up with a question about it, then up to two more things to work on (R14); the first pick may be the
 * lesson plan's own steps. A level the rule only fills in "for now" (a gap in the rubric) is
 * described by what was seen, never by the level's label.
 *
 * The indicator phrases come from fico17 (English for the pilot); the frame around them is in the
 * coach's language. Urdu addresses the coach with imperatives only.
 *
 * Last come the coach's own notes from the visit, word for word, grouped by part (pilot sheet R13,
 * 14 Oct: "this evidence disappears after the form is saved"). Each note gets its own line under its
 * label, so a note typed in English reads in its own direction inside an Urdu brief.
 */

const { CODES, MOMENTS, PLAIN, ROW, PRIORITY, FOCUS, PLAN_FOCUS, THINKING, pickAlso } = require('./fico17');
const { THINK_SAID, usedPhrase } = require('./rules');
const { clampLanguage } = require('../../../config/ux-strings');

// Which indicator a moment type speaks to, so the moment offered is about the thing to work on.
const TYPE_CODE = {
  open_q_one: 'C1', open_q_choral: 'C1', probe: 'C1',
  reasoning: 'D1', long_answer: 'D1', beyond: 'D1',
  content_q: 'D5', proc_q: 'D5', beyond_q: 'D5',
  wrong_reason: 'C2', wrong_fixed: 'C2', wrong_ignored: 'C2', strategy: 'C2',
  praise_effort: 'C6', praise_generic: 'C6', mistake_useful: 'C6', disagree: 'C6',
  hedged: 'D4', unprompted: 'D4',
  choice: 'C4', handover: 'C4',
  content_error: 'F1', term_defined: 'F2', why_explained: 'F3', life_link: 'F4',
};

const FRAME = {
  en: {
    title: (name) => (name ? `📋 Your brief for the conversation with ${name}` : '📋 Your brief for the conversation with the teacher'),
    reflect: ['Open with questions for the teacher:', '• "How do you think the lesson went?"', '• "What did you want the children to learn, and how could you tell?"'],
    went_well: 'Start with what went well:',
    plan: (done, total, pct, partly) => `The lesson plan: ${done} of ${total} planned steps done${partly ? `, ${partly} partly` : ''} (${pct}%).`,
    // A plan was added but not graded: what happened to it, then what to do next time (bd-eal7zn.2).
    plan_not_checked: {
      lp_not_lesson_plan: "The lesson plan: no lesson steps were found in what you added, so the lesson wasn't checked against the plan. Next time, pick the teacher's plan from the list in the form, or add a clear photo of each page.",
      lp_unreadable: "The lesson plan: the file or photos you added couldn't be read, so the lesson wasn't checked against the plan. Next time, pick the teacher's plan from the list in the form, or add a clear photo of each page.",
      other: "The lesson plan: its steps couldn't be checked this time.",
    },
    moment_ask: 'Ask: "What were you hoping for at that moment? What else could you try?"',
    find_one: '• Name one thing you saw the teacher do well.',
    work_on: (p) => `Work on first: *${p}*`,
    now: (x) => `What you saw: ${x}`,
    next: (x) => `The next step: ${x}`,
    moment: (minute, quote) => `A moment to bring up (${minute}): "${quote}"`,
    also: (p, seen) => `Also work on: *${p}*${seen ? ` (what you saw: ${seen})` : ''}`,
    plan_missed: 'Steps not done, or only partly:',
    plan_none: 'there was no lesson plan for this lesson',
    plan_notfollowed: 'the teacher had a plan and did not follow it',
    plan_unchecked: "the plan's steps could not be checked this time",
    plan_done: (done, total) => `${done} of ${total} planned steps done`,
    thinking: "Children's thinking:",
    think_seen: (x) => `• You saw: ${x}`,
    think_teacher: (x) => `• The teacher: ${x}`,
    think_children: (x) => `• The children: ${x}`,
    notes_title: '📝 Your notes, as you wrote them:',
    note_label: {
      part1: 'Part 1',
      part1_group: 'Part 1, with a group',
      part2: 'Part 2',
      part2_group: 'Part 2, with a group',
      not_recorded: 'Not in the recording',
      incident: 'What happened',
      why: 'Why you changed it at the check',
    },
    saved: 'Your full record, all 17 levels, is saved.',
  },
  ur: {
    title: (name) => (name ? `📋 ${name} سے بات چیت کے لیے بریف` : '📋 استاد سے بات چیت کے لیے بریف'),
    reflect: ['پہلے استاد سے یہ سوال کریں:', '• "آپ کے خیال میں سبق کیسا رہا؟"', '• "بچوں کو کیا سیکھنا تھا، اور کیسے پتا چلا کہ انہوں نے سیکھ لیا؟"'],
    went_well: 'جو اچھا ہوا، اس سے شروع کریں:',
    plan: (done, total, pct, partly) => `سبق کا منصوبہ: ${total} میں سے ${done} مراحل مکمل${partly ? `، ${partly} جزوی` : ''} (${pct}%)۔`,
    plan_not_checked: {
      lp_not_lesson_plan: 'سبق کا منصوبہ: جو منسلک کیا گیا اس میں سبق کے مراحل نہیں ملے، اس لیے سبق کو منصوبے سے نہیں جانچا گیا۔ اگلی بار فارم کی فہرست سے استاد کا منصوبہ چنیں، یا ہر صفحے کی صاف تصویر لگائیں۔',
      lp_unreadable: 'سبق کا منصوبہ: منسلک فائل یا تصاویر پڑھی نہیں جا سکیں، اس لیے سبق کو منصوبے سے نہیں جانچا گیا۔ اگلی بار فارم کی فہرست سے استاد کا منصوبہ چنیں، یا ہر صفحے کی صاف تصویر لگائیں۔',
      other: 'سبق کا منصوبہ: اس بار مراحل نہیں جانچے جا سکے۔',
    },
    moment_ask: 'پوچھیں: "اس لمحے آپ کا ارادہ کیا تھا؟ اور کیا آزمایا جا سکتا ہے؟"',
    find_one: '• ایک چیز بتائیں جو استاد نے اچھی کی۔',
    work_on: (p) => `پہلے اس پر کام: *${p}*`,
    now: (x) => `جو دیکھا: ${x}`,
    next: (x) => `اگلا قدم: ${x}`,
    moment: (minute, quote) => `بات کرنے کے لیے ایک لمحہ (${minute}): "${quote}"`,
    also: (p, seen) => `اس پر بھی کام: *${p}*${seen ? ` (جو دیکھا: ${seen})` : ''}`,
    plan_missed: 'جو مراحل نہیں ہوئے، یا جزوی ہوئے:',
    plan_none: 'اس سبق کا کوئی منصوبہ نہیں تھا',
    plan_notfollowed: 'منصوبہ موجود تھا، مگر اس پر عمل نہیں ہوا',
    plan_unchecked: 'اس بار منصوبے کے مراحل نہیں جانچے جا سکے',
    plan_done: (done, total) => `${total} میں سے ${done} مراحل مکمل`,
    thinking: 'بچوں کی سوچ:',
    think_seen: (x) => `• جو دیکھا: ${x}`,
    think_teacher: (x) => `• استاد: ${x}`,
    think_children: (x) => `• بچے: ${x}`,
    notes_title: '📝 آپ کے نوٹس، جیسے آپ نے لکھے:',
    note_label: {
      part1: 'پہلا حصہ',
      part1_group: 'پہلا حصہ، گروپ کے ساتھ',
      part2: 'دوسرا حصہ',
      part2_group: 'دوسرا حصہ، گروپ کے ساتھ',
      not_recorded: 'جو ریکارڈنگ میں نہیں',
      incident: 'کیا ہوا',
      why: 'جانچ میں تبدیلی کی وجہ',
    },
    saved: 'آپ کا پورا ریکارڈ، تمام 17 درجے، محفوظ ہے۔',
  },
};

const numeric = (v) => (/^[1-4]$/.test(String(v)) ? Number(v) : null);
const DONE = new Set(['executed', 'substituted_equivalent', 'substituted_better']);

// The boxes a coach types in, in the order they are met: Part 1 and Part 2 ("Anything else", and
// "Something else" when they sat with a group), the seal screen ("Not in the recording", and "What
// happened" for an incident), then the check ("Why you changed").
const NOTE_BOXES = [
  ['part1', (f) => (f.answers || {}).p1_notes],
  ['part1_group', (f) => (f.answers || {}).p1_listen_other],
  ['part2', (f) => (f.answers || {}).p2_notes],
  ['part2_group', (f) => (f.answers || {}).p2_listen_other],
  ['not_recorded', (f) => (f.answers || {}).note],
  ['incident', (f) => (f.answers || {}).detail],
  ['why', (f) => (f.evidence_review || {}).why],
];
// The brief is one WhatsApp message (4,096 code points). With every box full (600 each), clipping each
// note here keeps it inside with room for the rest. Of the 114 notes on prod by 15 Oct, one is longer.
const NOTE_CAP = 400;

function clipNote(text) {
  const chars = [...text];
  return chars.length <= NOTE_CAP ? text : `${chars.slice(0, NOTE_CAP - 1).join('').trimEnd()}…`;
}

function coachNotes(form) {
  return NOTE_BOXES
    .map(([key, read]) => [key, String(read(form) || '').trim()])
    .filter(([, text]) => text)
    .map(([key, text]) => ({ key, text: clipNote(text) }));
}

// The plan as the coach confirmed it in the check, else as the recording graded it.
function planResult(form) {
  const review = form.evidence_review || {};
  const graded = form.rumi_moments && form.rumi_moments.fidelity;
  const lp = review.fidelity || (graded && graded.status === 'ok' ? graded : null);
  if (!lp || lp.fidelity_pct == null) return null;
  const counted = (lp.moves || []).filter((m) => m.counted);
  return {
    done: counted.filter((m) => DONE.has(m.verdict)).length,
    partly: counted.filter((m) => m.verdict === 'partial').length,
    total: lp.prescribed_count != null ? lp.prescribed_count : counted.length,
    pct: Math.round(lp.fidelity_pct),
    missed: counted.filter((m) => m.verdict === 'not_done' || m.verdict === 'partial').map((m) => String(m.text || '').trim()).filter(Boolean),
  };
}

const clip = (text, n) => { const c = [...String(text)]; return c.length <= n ? c.join('') : `${c.slice(0, n - 1).join('')}…`; };

// The plan as the thing to work on (R14): the steps that were not done, or why there is no count.
function planFocusLines(form, F) {
  const plan = planResult(form);
  if (plan) {
    if (!plan.missed.length) return [F.now(F.plan_done(plan.done, plan.total))];
    return [F.plan_missed, ...plan.missed.slice(0, 2).map((t) => `• ${clip(t, 160)}`)];
  }
  const lp = (form.answers || {}).lp;
  return [F.now(lp === 'none' ? F.plan_none : lp === 'notfollowed' ? F.plan_notfollowed : F.plan_unchecked)];
}

// Children's thinking (R16): what the coach saw of it in Part 2, then the levels of the six indicators
// that score it, the teacher's practice and the children's responses. Nothing when there is neither.
function thinkingLines(form, F) {
  const finals = form.final_levels || {};
  const ticks = Object.keys(THINK_SAID).filter((k) => ((form.answers || {}).p2_think || []).includes(k));
  const phrases = (codes) => codes.filter((c) => numeric(finals[c])).map((c) => PLAIN[c][numeric(finals[c]) - 1].toLowerCase()).join(' · ');
  const teacher = phrases(THINKING.teacher);
  const children = phrases(THINKING.children);
  if (!ticks.length && !teacher && !children) return [];
  return [
    F.thinking,
    ...(ticks.length ? [F.think_seen(ticks.map((k) => THINK_SAID[k]).join('; '))] : []),
    ...(teacher ? [F.think_teacher(teacher)] : []),
    ...(children ? [F.think_children(children)] : []),
  ];
}

// What was seen for one of the "also work on" picks, in a few words.
function alsoSeen(form, id, F) {
  if (id === PLAN_FOCUS) {
    const plan = planResult(form);
    if (plan) return F.plan_done(plan.done, plan.total);
    const lp = (form.answers || {}).lp;
    return lp === 'none' ? F.plan_none : lp === 'notfollowed' ? F.plan_notfollowed : '';
  }
  const level = numeric((form.final_levels || {})[id]);
  const used = id === 'C8' ? usedPhrase(form.answers) : '';
  return level ? [PLAIN[id][level - 1].toLowerCase(), used].filter(Boolean).join(': ') : '';
}

/**
 * @param {object} form observation_field_forms row after the check
 * @param {{teacherName?: string|null, lang?: string}} opts
 * @returns {string}
 */
function buildBrief(form, { teacherName = null, lang = 'en' } = {}) {
  const F = FRAME[clampLanguage(lang)] || FRAME.en;
  const finals = form.final_levels || {};
  const review = form.evidence_review || {};
  const priority = review.priority_final || (form.answers || {}).priority || null;
  const moments = (form.rumi_moments && form.rumi_moments.moments) || [];
  const confirmed = moments.filter((m) => review[`heard_${m.id}`] === 'yes');

  const lines = [F.title(teacherName), '', ...F.reflect, '', F.went_well];
  const strengths = CODES
    .filter((c) => c !== priority && numeric(finals[c]) >= 3)
    .sort((a, b) => numeric(finals[b]) - numeric(finals[a]))
    .slice(0, 2);
  // The materials used are named wherever C8 appears (R17).
  const used = usedPhrase(form.answers);
  const withUsed = (c, text) => (c === 'C8' && used ? `${text} (${used})` : text);
  if (strengths.length) {
    for (const c of strengths) lines.push(`• ${ROW[c]}: ${withUsed(c, PLAIN[c][numeric(finals[c]) - 1])}`);
  } else {
    lines.push(F.find_one);
  }

  const plan = planResult(form);
  if (plan) lines.push('', F.plan(plan.done, plan.total, plan.pct, plan.partly));
  else {
    // A plan was given but not graded: say which state it is in, never nothing (a silent gap reads as
    // "no plan" to the coach).
    const a = form.answers || {};
    const graded = form.rumi_moments && form.rumi_moments.fidelity;
    if ((a.lp_ref || a.lp_upload) && graded && graded.status && graded.status !== 'ok') {
      lines.push('', F.plan_not_checked[graded.status] || F.plan_not_checked.other);
    }
  }

  const think = thinkingLines(form, F);
  if (think.length) lines.push('', ...think);

  if (priority === PLAN_FOCUS) {
    lines.push('', F.work_on(FOCUS[PLAN_FOCUS]), ...planFocusLines(form, F));
  } else if (priority && PRIORITY[priority]) {
    const level = numeric(finals[priority]);
    lines.push('', F.work_on(PRIORITY[priority]));
    const hole = (review.added_hole || {})[priority];
    const kept = String(finals[priority]) === String((review.added || {})[priority]);
    if (hole && kept) lines.push(F.now(hole));
    else if (level) lines.push(F.now(withUsed(priority, PLAIN[priority][level - 1])));
    if (level && level < 4) lines.push(F.next(PLAIN[priority][level]));
    const group = (MOMENTS.find((m) => m.codes.includes(priority)) || {}).id;
    const moment = confirmed.find((m) => TYPE_CODE[m.type] === priority)
      || confirmed.find((m) => m.moment === group);
    if (moment) lines.push(F.moment(moment.minute, moment.quote), F.moment_ask);
  }

  // "Also work on" (R14): after the first pick, one line each.
  const a = form.answers || {};
  const also = Array.isArray(review.also_final) ? pickAlso(review.also_final, priority) : pickAlso([a.also_1, a.also_2], priority);
  if (also.length) lines.push('', ...also.map((id) => F.also(FOCUS[id], alsoSeen(form, id, F))));
  const notes = coachNotes(form);
  if (notes.length) {
    lines.push('', F.notes_title);
    for (const n of notes) lines.push(`*${F.note_label[n.key]}*`, n.text);
  }

  lines.push('', F.saved);
  return lines.join('\n');
}

module.exports = { buildBrief, TYPE_CODE };
