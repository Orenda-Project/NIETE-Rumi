'use strict';
/**
 * How a child-facing surface names the teacher: "Teacher Rifat" / "استاد رفعت",
 * or a language-appropriate "your teacher" when no name is stored. One
 * implementation for the forwarded WhatsApp quiz message and the web quiz page,
 * so the two never name the same teacher differently.
 */
const { resolveUx } = require('../../config/ux-strings');

function teacherLabel(teacherName, language) {
  const name = String(teacherName || '').trim();
  const generic = /^(your teacher|teacher|آپ کے استاد)$/i.test(name);
  if (!name || generic) return resolveUx('tqYourTeacher', { language });
  return resolveUx('tqTeacherNamed', { language, params: { name } });
}

module.exports = { teacherLabel };
