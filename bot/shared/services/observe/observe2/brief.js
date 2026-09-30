'use strict';

/**
 * /observe2 — the brief for the coach's conversation with the teacher, built from the checked
 * record only (no model call): two things that went well, the thing to work on first with what
 * was seen and the next step up, and one confirmed moment from the recording to bring up.
 *
 * The indicator phrases come from fico17 (English for the pilot); the frame around them is in the
 * coach's language. Urdu addresses the coach with imperatives only.
 */

const { CODES, MOMENTS, PLAIN, ROW, PRIORITY } = require('./fico17');

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
    went_well: 'Start with what went well:',
    find_one: '• Name one thing you saw the teacher do well.',
    work_on: (p) => `Work on first: *${p}*`,
    now: (x) => `What you saw: ${x}`,
    next: (x) => `The next step: ${x}`,
    moment: (minute, quote) => `A moment to bring up (${minute}): "${quote}"`,
    saved: 'Your full record, all 17 levels, is saved.',
  },
  ur: {
    title: (name) => (name ? `📋 ${name} سے بات چیت کے لیے بریف` : '📋 استاد سے بات چیت کے لیے بریف'),
    went_well: 'جو اچھا ہوا، اس سے شروع کریں:',
    find_one: '• ایک چیز بتائیں جو استاد نے اچھی کی۔',
    work_on: (p) => `پہلے اس پر کام: *${p}*`,
    now: (x) => `جو دیکھا: ${x}`,
    next: (x) => `اگلا قدم: ${x}`,
    moment: (minute, quote) => `بات کرنے کے لیے ایک لمحہ (${minute}): "${quote}"`,
    saved: 'آپ کا پورا ریکارڈ، تمام 17 درجے، محفوظ ہے۔',
  },
};

const numeric = (v) => (/^[1-4]$/.test(String(v)) ? Number(v) : null);

/**
 * @param {object} form observation_field_forms row after the check
 * @param {{teacherName?: string|null, lang?: string}} opts
 * @returns {string}
 */
function buildBrief(form, { teacherName = null, lang = 'en' } = {}) {
  const F = FRAME[lang === 'ur' ? 'ur' : 'en'];
  const finals = form.final_levels || {};
  const review = form.evidence_review || {};
  const priority = review.priority_final || (form.answers || {}).priority || null;
  const moments = (form.rumi_moments && form.rumi_moments.moments) || [];
  const confirmed = moments.filter((m) => review[`heard_${m.id}`] === 'yes');

  const lines = [F.title(teacherName), '', F.went_well];
  const strengths = CODES
    .filter((c) => c !== priority && numeric(finals[c]) >= 3)
    .sort((a, b) => numeric(finals[b]) - numeric(finals[a]))
    .slice(0, 2);
  if (strengths.length) {
    for (const c of strengths) lines.push(`• ${ROW[c]}: ${PLAIN[c][numeric(finals[c]) - 1]}`);
  } else {
    lines.push(F.find_one);
  }

  if (priority && PRIORITY[priority]) {
    const level = numeric(finals[priority]);
    lines.push('', F.work_on(PRIORITY[priority]));
    if (level) lines.push(F.now(PLAIN[priority][level - 1]));
    if (level && level < 4) lines.push(F.next(PLAIN[priority][level]));
    const group = (MOMENTS.find((m) => m.codes.includes(priority)) || {}).id;
    const moment = confirmed.find((m) => TYPE_CODE[m.type] === priority)
      || confirmed.find((m) => m.moment === group);
    if (moment) lines.push(F.moment(moment.minute, moment.quote));
  }

  lines.push('', F.saved);
  return lines.join('\n');
}

module.exports = { buildBrief, TYPE_CODE };
