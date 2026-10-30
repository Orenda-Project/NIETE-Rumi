'use strict';
/**
 * THE TOPIC-END NUDGE, PURE PART (bd-pw1ccr.4.2) — which topic a lesson finishes, and when to say so.
 *
 * WHICH TOPIC. A lesson plan knows its chapter and its `segment_index` (1..n); a topic knows its
 * curriculum-matrix days (`assessment_topics.days`, a running count across the grade-subject). The two
 * line up by offset: lesson day = the chapter's first topic day + segment_index − 1. A topic ends at the
 * lesson whose day is the topic's last; near the end (bd-pw1ccr.11) also counts the day before the last
 * when the topic runs 3+ days. Checked on sandbox, 29 Oct 2026: 230 of 233 chapters align; the
 * three that do not (G1 Maths ch2-4) fail the guard below and are skipped, never guessed.
 *
 * Worksheet (995) and revision (990) plans are not teaching days. A split day (seg4 + seg4b) shares one
 * segment_index, so both parts map to the same day.
 *
 * WHEN. After the lesson is taught: a plan taken before 14:00 PKT is taught that day, so the nudge goes at
 * 14:30; later, or at the weekend, it waits for 14:30 on the next school day. A shut WhatsApp window
 * retries the next school day in the same week, and never past Friday.
 */
const { pktDate, pktHour, isSchoolDay, nextSchoolDay, atPkt } = require('./pkt-time');

/** Catalog subject_key → assessment_topics.subject. Other subjects have no topics. */
const TOPIC_SUBJECTS = Object.freeze({ english: 'english', urdu: 'urdu', math: 'maths', general_science: 'science' });

/** Plans numbered from here up are worksheets and revision, not teaching days. */
const FIRST_NON_TEACHING = 900;

const CUTOFF_HOUR = 14;
const SEND_HOUR = 14;
const SEND_MINUTE = 30;

function topicsSubject(subjectKey) {
  return TOPIC_SUBJECTS[subjectKey] || null;
}

/**
 * @param {{lessons: {segment_index:number}[], topics: {days:number[]}[], segmentIndex: number}} p
 *   the chapter's catalog lessons, its current topics, and the lesson she took
 * @returns {{topic: Object}|{reason: 'not_a_teaching_day'|'no_topics'|'chapter_unaligned'|'topic_continues'}}
 */
function topicEndingAt({ lessons = [], topics = [], segmentIndex }) {
  const seg = Number(segmentIndex);
  const teaching = [...new Set(lessons.map((l) => Number(l.segment_index)))]
    .filter((i) => Number.isInteger(i) && i < FIRST_NON_TEACHING)
    .sort((a, b) => a - b);
  if (!teaching.includes(seg)) return { reason: 'not_a_teaching_day' };

  const days = topics.flatMap((t) => (Array.isArray(t.days) ? t.days.map(Number) : []));
  if (!days.length) return { reason: 'no_topics' };

  const first = Math.min(...days);
  const span = Math.max(...days) - first + 1;
  const contiguous = teaching.every((i, k) => i === k + 1);
  if (!contiguous || teaching.length !== span) return { reason: 'chapter_unaligned' };

  // bd-pw1ccr.11: the topic's last day, or the day before it when the topic runs 3+ days.
  const day = first + seg - 1;
  const topic = topics.find((t) => {
    const td = Array.isArray(t.days) ? t.days.map(Number) : [];
    if (!td.length) return false;
    const last = Math.max(...td);
    return day === last || (td.length >= 3 && day === last - 1);
  });
  return topic ? { topic } : { reason: 'topic_continues' };
}

/** @returns {{nudgeDate: string, scheduledAt: Date}} */
function scheduleFor(takenAt) {
  const at = new Date(takenAt);
  const day = pktDate(at);
  const nudgeDate = isSchoolDay(day) && pktHour(at) < CUTOFF_HOUR ? day : nextSchoolDay(day);
  return { nudgeDate, scheduledAt: atPkt(nudgeDate, SEND_HOUR, SEND_MINUTE) };
}

/** The next school day in the same Mon-Fri week, or null on Friday. */
function retryDate(nudgeDate) {
  const next = nextSchoolDay(nudgeDate);
  const gap = (Date.parse(`${next}T00:00:00Z`) - Date.parse(`${nudgeDate}T00:00:00Z`)) / 86400000;
  return gap === 1 ? next : null;
}

module.exports = {
  TOPIC_SUBJECTS, SEND_HOUR, SEND_MINUTE, topicsSubject, topicEndingAt, scheduleFor, retryDate,
};
