'use strict';
/**
 * P2 — format one LP into a coaching-selection row (design: Option A).
 *
 * A teacher who generates 5–6 LPs/day recognises her plan by the SAME anchors she saw when she made it
 * (the delivery caption: Grade · Subject · Chapter · Topic · pages). Her recent LPs cluster in one
 * chapter, so the disambiguators are day/segment · pages · recency — not grade/subject. Hence:
 *   title       = the topic (her headline)
 *   description = Grade {g} {Subject} · Ch{n} {day} · p.{pages} · {today|yesterday|DD Mon}
 * Sourced from niete_lp_downloads + the V8 catalog (which also carries the version keys P3.3 resolves).
 * Caps measured in CODE POINTS (language-protocol): title ≤24, description ≤72 — Urdu-safe.
 */

const TITLE_MAX = 24;
const DESC_MAX = 72;

// Urdu/emoji-safe truncation: count code points, not UTF-16 units (language-protocol invariant).
function truncateCp(str, maxCp) {
  const s = String(str || '');
  const cps = [...s];
  if (cps.length <= maxCp) return s;
  return cps.slice(0, maxCp - 1).join('') + '…';
}

function titleCase(s) {
  const t = String(s || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function relTime(created, now) {
  if (!created) return '';
  const d = new Date(created);
  if (isNaN(d)) return '';
  const hrs = (now - d) / 3600000;
  if (hrs < 24) return 'today';
  if (hrs < 48) return 'yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Special segment ids (chapter close-out): 995 = revision, 990 = assessment (curriculum convention).
function segmentLabel(lessonId) {
  if (/seg995$/.test(lessonId || '')) return 'Revision';
  if (/seg990$/.test(lessonId || '')) return 'Assessment';
  return '';
}

/**
 * @param {object} lp  enriched LP: { id, lesson_id, topic, grade, subject, chapter_number,
 *                                     day_label, pages_label, created_at }
 * @param {{now?: Date}} opts
 * @returns {{ id, title, description, lesson_id }}
 */
function formatLpRow(lp = {}, opts = {}) {
  const now = opts.now || new Date();
  const dayOrSeg = lp.day_label || segmentLabel(lp.lesson_id);

  // headline: topic → day/segment label → generic
  const headline = lp.topic || dayOrSeg || 'Lesson plan';

  // context line: only the pieces we actually have, joined with " · " (no empty/doubled separators)
  const chapterBit = lp.chapter_number != null
    ? `Ch${lp.chapter_number}${dayOrSeg ? ` ${dayOrSeg}` : ''}`
    : (dayOrSeg || '');
  const parts = [
    lp.grade ? `Grade ${lp.grade}${lp.subject ? ` ${titleCase(lp.subject)}` : ''}` : (lp.subject ? titleCase(lp.subject) : ''),
    chapterBit,
    lp.pages_label ? String(lp.pages_label) : '',
    relTime(lp.created_at, now),
  ].filter((p) => p && p.length);

  return {
    id: lp.id,
    lesson_id: lp.lesson_id,
    title: truncateCp(headline, TITLE_MAX),
    description: truncateCp(parts.join(' · '), DESC_MAX),
  };
}

module.exports = { formatLpRow, truncateCp, relTime, segmentLabel };
