'use strict';
/**
 * How a child-facing surface names the teacher: "Teacher Rifat" / "استاد رفعت",
 * or a language-appropriate "your teacher" when no name is stored. One
 * implementation for the forwarded WhatsApp quiz message and the web quiz page,
 * so the two never name the same teacher differently.
 */
const { resolveUx } = require('../../config/ux-strings');

// A stored name that already carries a title ("Mr Kamran", "Teacher Rifat", «استانی رفعت», «رفعت صاحبہ»)
// loses it: the label adds its own "Teacher" / «استاد», so the title would print twice. Whole words only
// ("Mrinal", "Sirajuddin" stay as they are).
const LEAD_TITLE = /^(?:(?:teacher|sir|miss|madam|mrs|mr|ms)\.?(?=\s|$)|(?:استاد|استانی|سر|مس|میڈم)(?=\s|$))\s*/i;
const TAIL_TITLE = /\s+(?:صاحبہ|صاحب)$/;
function withoutTitle(name) {
  let out = name;
  for (let k = 0; k < 2 && LEAD_TITLE.test(out); k += 1) out = out.replace(LEAD_TITLE, '');
  return out.replace(TAIL_TITLE, '').trim();
}

function teacherLabel(teacherName, language) {
  const stored = String(teacherName || '').trim();
  const generic = /^(your teacher|آپ کے استاد)$/i.test(stored);
  const name = generic ? '' : withoutTitle(stored);
  if (!name) return resolveUx('tqYourTeacher', { language });
  return resolveUx('tqTeacherNamed', { language, params: { name } });
}

module.exports = { teacherLabel };
