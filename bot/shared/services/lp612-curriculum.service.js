'use strict';
/**
 * The GB K-5 lane's helpers (bd-rj6w0n.14.4).
 *
 * WHOSE books a teacher reads is book-curriculum.service (PR #4091, bd-97daxo.4): her registry
 * region's curriculum, 'nbf_snc' for Gilgit-Baltistan, 'ict' for everyone else. This module only
 * names GB's key, reads her menu language, and keeps the GB K-5 shelf list below. Only used while
 * LP_GB_K5_ENABLED is on.
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { ICT } = require('./book-curriculum.service');

const NBF_SNC = 'nbf_snc';

const norm = (v) => String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Her users.preferred_language, or null. A miss or read error is null. Never throws. */
async function languageForUserId(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase.from('users').select('preferred_language').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data && data.preferred_language) || null;
  } catch (err) {
    logToFile('LP GB: language lookup failed', { error: err.message });
    return null;
  }
}

// ── the GB K-5 allow-list ───────────────────────────────────────────────────
// Menu order. `names` are the normalised spellings a book's subject may carry.
const GB_K5_BOOKS = [
  { key: 'english', title: 'English', grades: [1, 2, 3, 4, 5], names: ['english'] },
  { key: 'urdu', title: 'Urdu', grades: [1, 2, 3, 4, 5], names: ['urdu'] },
  { key: 'maths', title: 'Mathematics', grades: [1, 2, 3, 4, 5], names: ['math', 'maths', 'mathematics'] },
  { key: 'science', title: 'Science', grades: [4, 5], names: ['science', 'general_science'] },
  { key: 'gk', title: 'General Knowledge', grades: [1, 2, 3], names: ['gk', 'general_knowledge'] },
  { key: 'sst', title: 'Social Studies', grades: [4, 5], names: ['social_studies', 'sst'] },
  { key: 'islamiat', title: 'Islamiat', grades: [1, 2, 3, 4, 5], names: ['islamiat', 'islamiyat'] },
];

/** The allow-list entry a (grade, subject) belongs to, or null. */
function gbK5BookFor(grade, subject) {
  const g = Number(grade);
  const s = norm(subject);
  return GB_K5_BOOKS.find((b) => b.grades.includes(g) && b.names.includes(s)) || null;
}

const isGbK5Book = (grade, subject) => gbK5BookFor(grade, subject) !== null;

/** The grade's GB books, in menu order. */
const gbK5Subjects = (grade) => GB_K5_BOOKS.filter((b) => b.grades.includes(Number(grade)));

const GB_K5_GRADES = [1, 2, 3, 4, 5];

module.exports = {
  ICT, NBF_SNC, GB_K5_GRADES,
  languageForUserId,
  isGbK5Book, gbK5BookFor, gbK5Subjects,
};
