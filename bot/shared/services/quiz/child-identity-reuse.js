'use strict';
/**
 * One loose child across a teacher's codes on one device (switch web_quiz_identity_canon).
 *
 * Identity v2 makes a loose child (list_id NULL) for a typed name the class list does not hold, and reuses it
 * only on the SAME code (provisionalOnDevice). The same child opening the same teacher's next code on the same
 * device typed the same name and got a second record. Under the switch, before that insert: an ACTIVE loose
 * student with the same folded name whose sessions carry this device AND a code of this teacher — exactly one —
 * is that child. Two or more, or none → null (the caller inserts as today). Never throws.
 */
const { read: dbRead } = require('./web-quiz-db-deadline');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Identity = require('./web-quiz-identity');
const IdFlags = require('./web-quiz-identity-flags');

const SESSIONS_MAX = 200;

/** → {id, student_name, self_reported_class} of the one loose child to reuse, or null. */
async function looseOnDevice({ teacherUserId, deviceRef, name } = {}) {
  try {
    if (!teacherUserId || !deviceRef) return null;
    const want = Identity.canon(name);
    if (!want) return null;
    if (!(await IdFlags.flags()).canon) return null;
    const { data: sessions } = await dbRead('looseOnDevice:quiz_sessions:1', (db) => db.from('quiz_sessions')
      .select('student_id, student_name, share_code_id').eq('device_ref', deviceRef).is('user_id', null).limit(SESSIONS_MAX));
    const named = (sessions || []).filter((s) => s.student_id && s.share_code_id && Identity.canon(s.student_name) === want);
    if (!named.length) return null;
    const codeIds = [...new Set(named.map((s) => s.share_code_id))];
    const { data: codes } = await dbRead('looseOnDevice:quiz_share_codes:1', (db) => db.from('quiz_share_codes')
      .select('id, teacher_user_id').in('id', codeIds));
    const mine = new Set((codes || []).filter((c) => c.teacher_user_id === teacherUserId).map((c) => c.id));
    const ids = [...new Set(named.filter((s) => mine.has(s.share_code_id)).map((s) => s.student_id))];
    if (!ids.length) return null;
    const { data: kids } = await dbRead('looseOnDevice:students:1', (db) => db.from('students')
      .select('id, student_name, self_reported_class, list_id, status, is_active').in('id', ids));
    const hits = (kids || []).filter((k) => !k.list_id && (k.status || 'active') === 'active' && k.is_active !== false
      && Identity.canon(k.student_name) === want);
    if (hits.length !== 1) return null;
    logEvent('web_quiz.identity_reused', { w: 's', via: 'device_name' });
    const k = hits[0];
    return { id: k.id, student_name: k.student_name, self_reported_class: k.self_reported_class || null };
  } catch (err) {
    logToFile('⚠️ child identity: loose reuse lookup failed — a new child', { error: err.message });
    return null;
  }
}

module.exports = { looseOnDevice };
