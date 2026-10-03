'use strict';

/**
 * How a drawn child is named on WhatsApp (CONTRACT §18, operator 3 Oct 2026): the child's FULL name
 * first, the roll number only as a hint when the roster has one.
 *
 * Why not lead with the roll: NIETE rolls are the register's serial column read off a photo (83% of
 * Grade 3/5 classes are exactly 1…N), registers are rewritten and renumbered every month, and 3.4% of
 * Grade 3/5 children have no roll at all (roster, 3 Oct). A child without a roll is named alone —
 * never "null", never a throw (bd-s1oo0.36: a roll-less child on the list made resolveUx throw).
 *
 * Names go to WhatsApp only: never into logs or model prompts (privacy rule, CONTRACT §7).
 */

const { t, clip } = require('./copy');

const ROW_TITLE_MAX = 24;          // WhatsApp list row.title, code points
const ROW_DESCRIPTION_MAX = 72;    // WhatsApp list row.description, code points
const SEP = ' · ';

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** The child's full name in the coach's language: the Urdu-script name for 'ur' when the roster has one, else the roster spelling. */
function childName(lang, c) {
  const ur = clean(c && c.displayNameUrdu);
  const roster = clean(c && c.displayName);
  return lang === 'en' ? (roster || ur) : (ur || roster);
}

/** A roll worth showing: a positive whole number. Anything else counts as no roll. */
function rollOf(c) {
  const r = c && c.rollNumber;
  if (r === null || r === undefined || typeof r === 'boolean') return null;
  const s = String(r).trim();
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

/** "Ayesha Bibi · roll 8", or "Ayesha Bibi", or "Roll 8", or the no-name label. */
function childLabel(lang, c) {
  const name = childName(lang, c);
  const roll = rollOf(c);
  if (name && roll !== null) return t(lang, 'childTestChildNameRoll', { name, roll });
  if (name) return name;
  if (roll !== null) return t(lang, 'childTestRollItem', { roll });
  return t(lang, 'childTestChildNoName');
}

/** Several children on one line, in the given order. */
function childLabels(lang, children) {
  return (children || []).map((c) => childLabel(lang, c)).join(lang === 'en' ? ', ' : '، ');
}

/**
 * A WhatsApp list row. The title is the full name when it fits in 24 code points; otherwise it is
 * clipped and the description starts with the full name, so the full name is always on screen.
 * The description then carries the roll hint and the caller's status text.
 */
function childRow(lang, c, status) {
  const name = childName(lang, c);
  const roll = rollOf(c);
  const fits = [...name].length <= ROW_TITLE_MAX;
  const title = name ? clip(name, ROW_TITLE_MAX) : clip(childLabel(lang, c), ROW_TITLE_MAX);
  const parts = [];
  if (name && !fits) parts.push(name);
  if (name && roll !== null) parts.push(t(lang, 'childTestRollItem', { roll }));
  if (clean(status)) parts.push(clean(status));
  return { title, description: clip(parts.join(SEP), ROW_DESCRIPTION_MAX) };
}

module.exports = { childName, rollOf, childLabel, childLabels, childRow, ROW_TITLE_MAX, ROW_DESCRIPTION_MAX };
