'use strict';
/**
 * ClassService — the write surface for the classes model.
 *
 * A class belongs to a SCHOOL, sits for a SESSION, is at one GRADE, and is
 * taught by one-or-more TEACHERS across one-or-more SUBJECTS, at most one of
 * whom is the prime-responsible class teacher. Students are enrolled into it.
 *
 * THE MIRROR. This is the single teacher-facing way to create a class, but
 * attendance and the existing quizzes still read the legacy `student_lists`
 * roster. So `createClass()` also writes (or ADOPTS) a mirror roster row and
 * links it through `student_lists.class_id`. Two consequences worth stating:
 *
 *   - Adoption, not just insertion. `student_lists` is unique on
 *     (user_id, LOWER(class_name), academic_year) WHERE is_active, so a teacher
 *     who already added "Grade 4" the old way must have that row adopted — with
 *     its students intact — rather than hitting a duplicate-key error.
 *   - A failed mirror does not fail the class. Losing the class the teacher just
 *     created is unrecoverable; a missing mirror only degrades attendance
 *     visibility and is repairable. The caller is told via `mirrored: false`.
 *
 * The mirror, `student_lists.class_id`, and `MIRROR_LABELS` below all disappear
 * in the cutover PR that moves attendance onto class_id.
 *
 * ERRORS ARE VALUES. Every function resolves to a plain object carrying an
 * `error` string ('unknown_grade', 'unknown_session', 'class_teacher_exists',
 * 'unknown_subject', …) rather than throwing, because every caller is a
 * WhatsApp Flow endpoint or an HTTP route that must turn a failure into a screen
 * rather than a stack trace.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const vocabulary = require('./class-vocabulary.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sections are stored normalized (upper, trimmed, NULL when blank) so 'a', 'A '
 * and '' cannot become three classes. The DB CHECK enforces the same rule; this
 * is what makes the write satisfy it rather than fail it.
 */
function normalizeSection(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}

/**
 * The legacy roster's `class_name`. LEGACY MIRROR ONLY — this is not a source of
 * teacher-facing copy (that lives in ux-strings keyed by grade code); it exists
 * because student_lists.class_name is NOT NULL and attendance renders it today.
 */
function mirrorLabel(gradeOrdinal, section = null, shiftCode = 'morning') {
  const base = gradeOrdinal === 0 ? 'Early Years' : `Grade ${gradeOrdinal}`;
  const withSection = section ? `${base} - ${section}` : base;
  // student_lists is unique on (user_id, LOWER(class_name), academic_year). The
  // name used to be the GRADE alone, so one teacher's 4-A and 4-B collided and the
  // second class silently ADOPTED the first's roster. Shift would have made it
  // worse. Both axes are in the name now, so distinct classes stay distinct.
  return shiftCode === 'morning' ? withSection : `${withSection} (${shiftCode})`;
}

/**
 * Is this a seeded value in a small reference table? Sections and shifts are closed
 * vocabularies with no aliases, so a plain membership check is the whole job — the
 * alias machinery in class-vocabulary is for the legacy grade/subject spellings.
 */
async function isSeeded(table, code) {
  if (typeof code !== 'string' || !code.trim()) return false;
  const { data, error } = await supabase
    .from(table)
    .select('code')
    .eq('is_active', true);
  if (error || !data) {
    logToFile(`⚠️ ClassService: ${table} load failed`, { error: error && error.message }, 'error');
    return false;
  }
  return data.some((r) => r.code === code.trim());
}

async function findSession(sessionCode) {
  if (typeof sessionCode !== 'string' || !sessionCode.trim()) return null;
  const { data, error } = await supabase
    .from('academic_sessions')
    .select('code, kind, starts_on, ends_on')
    .eq('is_active', true);
  if (error || !data) {
    logToFile('⚠️ ClassService: academic_sessions load failed', { error: error && error.message });
    return null;
  }
  return data.find((s) => s.code === sessionCode.trim()) || null;
}

// ---------------------------------------------------------------------------
// createClass
// ---------------------------------------------------------------------------

/**
 * Create (or return) a class, and mirror it into the legacy roster.
 *
 * @param {object} p
 * @param {string} p.schoolId
 * @param {string} p.gradeCode      canonical `grade_levels.code`
 * @param {string} [p.section]      normalized to upper-case; blank → null
 * @param {string} p.sessionCode    `academic_sessions.code`
 * @param {string} p.teacherUserId  the teacher creating it — owns the mirror row
 * @returns {Promise<{class?: object, created?: boolean, mirrored?: boolean, error?: string}>}
 */
async function createClass({
  schoolId, gradeCode, section, shiftCode = 'morning', sessionCode, teacherUserId,
} = {}) {
  if (!schoolId) return { error: 'missing_school' };
  if (!teacherUserId) return { error: 'missing_teacher' };

  const grade = await vocabulary.resolveGradeLevel(gradeCode);
  if (!grade || grade.code !== gradeCode) return { error: 'unknown_grade' };

  const session = await findSession(sessionCode);
  if (!session) return { error: 'unknown_session' };

  const normalizedSection = normalizeSection(section);

  // Sections are a CLOSED set (A-E as seeded). A teacher wanting another asks
  // support, who adds a row — storing free text here would recreate exactly the
  // problem this model exists to remove.
  if (normalizedSection && !(await isSeeded('sections', normalizedSection))) {
    return { error: 'unknown_section', section: normalizedSection };
  }

  const shift = typeof shiftCode === 'string' && shiftCode.trim() ? shiftCode.trim() : 'morning';
  if (!(await isSeeded('shifts', shift))) return { error: 'unknown_shift', shift };

  // Idempotent by class identity. Re-adding is a teacher repeating herself, not
  // an error to show her.
  const existingQuery = supabase
    .from('classes')
    .select('id, school_id, grade_code, section, shift_code, session_code, is_active')
    .eq('school_id', schoolId)
    .eq('grade_code', grade.code)
    .eq('session_code', session.code)
    .eq('shift_code', shift)
    .eq('is_active', true);

  const { data: candidates, error: findErr } = await existingQuery;
  if (findErr) {
    logToFile('⚠️ ClassService.createClass: lookup failed', { error: findErr.message });
    return { error: 'lookup_failed' };
  }

  const existing = (candidates || []).find(
    (c) => (c.section || null) === normalizedSection,
  );

  let classRow = existing;
  let created = false;

  if (!classRow) {
    const { data: inserted, error: insErr } = await supabase
      .from('classes')
      .insert({
        school_id: schoolId,
        grade_code: grade.code,
        section: normalizedSection,
        shift_code: shift,
        session_code: session.code,
        created_by_user_id: teacherUserId,
        is_active: true,
      })
      .select()
      .single();

    if (insErr || !inserted) {
      logToFile('⚠️ ClassService.createClass: insert failed', { error: insErr && insErr.message });
      return { error: 'insert_failed' };
    }
    classRow = inserted;
    created = true;
  }

  const mirrored = await mirrorToRoster({
    classRow,
    teacherUserId,
    gradeOrdinal: grade.ordinal,
    section: normalizedSection,
    shiftCode: shift,
    sessionCode: session.code,
  });

  return { class: classRow, created, mirrored };
}

/**
 * Write or adopt the legacy `student_lists` row for a class.
 * @returns {Promise<boolean>} false when the mirror could not be written — the
 *          class still stands.
 */
async function mirrorToRoster({ classRow, teacherUserId, gradeOrdinal, section, shiftCode, sessionCode }) {
  const className = mirrorLabel(gradeOrdinal, section, shiftCode);

  try {
    const { data: rosters, error: readErr } = await supabase
      .from('student_lists')
      .select('id, user_id, class_name, academic_year, class_id, is_active')
      .eq('user_id', teacherUserId)
      .eq('academic_year', sessionCode)
      .eq('is_active', true);

    if (readErr) {
      logToFile('⚠️ ClassService: mirror lookup failed — class kept, attendance will not see it yet', {
        classId: classRow.id, error: readErr.message,
      });
      return false;
    }

    // Same teacher, same year, same name (case-insensitively) = the row the
    // unique index would collide with. Adopt it, students and all.
    const collision = (rosters || []).find(
      (r) => String(r.class_name || '').toLowerCase() === className.toLowerCase(),
    );

    if (collision) {
      const { error: updErr } = await supabase
        .from('student_lists')
        .update({ class_id: classRow.id, updated_at: new Date().toISOString() })
        .eq('id', collision.id);

      if (updErr) {
        logToFile('⚠️ ClassService: adopting the legacy roster failed', { error: updErr.message });
        return false;
      }
      return true;
    }

    const { error: insErr } = await supabase
      .from('student_lists')
      .insert({
        user_id: teacherUserId,
        class_name: className,
        section,
        academic_year: sessionCode,
        class_id: classRow.id,
        is_active: true,
      })
      .select()
      .single();

    if (insErr) {
      logToFile('⚠️ ClassService: mirror insert failed — class kept', {
        classId: classRow.id, error: insErr.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    logToFile('⚠️ ClassService: mirror threw — class kept', { error: err.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// assignTeacher
// ---------------------------------------------------------------------------

/**
 * Assign a teacher to a class, with a role and any number of subjects.
 *
 * ONE row per (class, teacher) — the role lives on that row, and the subjects
 * hang off it. A teacher taking Math AND Science who is also the class teacher
 * is one row plus two subject rows, never two rows with an ambiguous flag.
 *
 * @param {object} p
 * @param {string} p.classId
 * @param {string} p.teacherUserId
 * @param {boolean} [p.isClassTeacher=false]  prime-responsible for the class
 * @param {string[]} [p.subjectCodes=[]]      canonical `subjects.code` values
 * @returns {Promise<{assignment?: object, created?: boolean, error?: string}>}
 */
async function assignTeacher({ classId, teacherUserId, isClassTeacher = false, subjectCodes = [] } = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };

  // Validate every subject BEFORE writing anything — all-or-nothing, so a typo
  // in the third code cannot leave the first two assigned.
  const resolved = [];
  for (const code of subjectCodes) {
    const hit = await vocabulary.resolveSubject(code);
    if (!hit || hit !== code) return { error: 'unknown_subject', subject: code };
    resolved.push(hit);
  }

  const { data: assignments, error: readErr } = await supabase
    .from('class_teachers')
    .select('id, class_id, teacher_user_id, is_class_teacher, is_active')
    .eq('class_id', classId)
    .eq('is_active', true);

  if (readErr) {
    logToFile('⚠️ ClassService.assignTeacher: lookup failed', { error: readErr.message });
    return { error: 'lookup_failed' };
  }

  const mine = (assignments || []).find((a) => a.teacher_user_id === teacherUserId);

  // At most one prime-responsible teacher. Caught here so the caller can show a
  // sentence rather than surfacing a 23505 from the partial unique index.
  //
  // A REFUSED ROLE MUST NOT COST HER THE CLASS. This used to return early, which
  // meant a teacher joining a colleague's existing class while ticking "I am the
  // class teacher" got no assignment row at all, lost the subjects she picked, and
  // could not see the class — found on staging by creating the same class twice as
  // two teachers. Now the role is simply declined and the rest proceeds, with
  // `classTeacherTaken` telling the caller what to say.
  let classTeacherTaken = false;
  let wantsRole = Boolean(isClassTeacher);

  if (wantsRole) {
    const other = (assignments || []).find(
      (a) => a.is_class_teacher && a.teacher_user_id !== teacherUserId,
    );
    if (other) {
      classTeacherTaken = true;
      wantsRole = false;
    }
  }

  let assignment = mine;
  let created = false;

  if (!assignment) {
    const { data: inserted, error: insErr } = await supabase
      .from('class_teachers')
      .insert({
        class_id: classId,
        teacher_user_id: teacherUserId,
        is_class_teacher: wantsRole,
        assigned_on: new Date().toISOString().slice(0, 10),
        is_active: true,
      })
      .select()
      .single();

    if (insErr || !inserted) {
      logToFile('⚠️ ClassService.assignTeacher: insert failed', { error: insErr && insErr.message });
      return { error: 'insert_failed' };
    }
    assignment = inserted;
    created = true;
  } else if (wantsRole && !assignment.is_class_teacher) {
    // Promoting an existing subject teacher to prime-responsible.
    const { error: updErr } = await supabase
      .from('class_teachers')
      .update({ is_class_teacher: true, updated_at: new Date().toISOString() })
      .eq('id', assignment.id);
    if (updErr) return { error: 'update_failed' };
    assignment.is_class_teacher = true;
  }

  // ONE TEACHER PER SUBJECT PER CLASS. Read every subject claim on this class, not
  // just this teacher's, so a subject a COLLEAGUE already teaches is declined.
  //
  // Declined, not fatal — the same reasoning as the class-teacher role above: a
  // conflict on one subject must not discard the rest of her request. Note this
  // differs deliberately from `unknown_subject`, which IS all-or-nothing: that is a
  // caller bug, whereas this is a legitimate real-world clash between colleagues.
  const subjectsTaken = [];

  if (resolved.length) {
    const { data: claims, error: subReadErr } = await supabase
      .from('class_teacher_subjects')
      .select('class_teacher_id, subject_code, class_id')
      .eq('class_id', classId);

    if (subReadErr) {
      logToFile('⚠️ ClassService.assignTeacher: subject lookup failed', { error: subReadErr.message });
      return { error: 'lookup_failed' };
    }

    const byTeacher = new Map((assignments || []).map((a) => [a.id, a.teacher_user_id]));
    const mineAlready = new Set();
    const heldByOthers = new Map();

    for (const claim of claims || []) {
      if (claim.class_teacher_id === assignment.id) {
        mineAlready.add(claim.subject_code);
      } else {
        heldByOthers.set(claim.subject_code, byTeacher.get(claim.class_teacher_id) || null);
      }
    }

    const toAdd = [];
    for (const code of resolved) {
      if (heldByOthers.has(code)) {
        subjectsTaken.push({ code, heldBy: heldByOthers.get(code) });
        continue;
      }
      if (!mineAlready.has(code)) toAdd.push(code);
    }

    for (const code of toAdd) {
      const { error: subInsErr } = await supabase
        .from('class_teacher_subjects')
        // class_id is what the unique index spans, so it must be stamped here and
        // not left to the backfill.
        .insert({ class_teacher_id: assignment.id, subject_code: code, class_id: classId })
        .select()
        .single();
      if (subInsErr) {
        logToFile('⚠️ ClassService.assignTeacher: subject insert failed', {
          subject: code, error: subInsErr.message,
        });
        return { error: 'insert_failed' };
      }
    }
  }

  return { assignment, created, classTeacherTaken, subjectsTaken };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The classes a teacher is assigned to.
 *
 * Fails to an EMPTY LIST rather than an error: an empty "my classes" screen is a
 * recoverable state a teacher can act on, whereas an error screen is a dead end.
 * Contrast with the vocabulary resolver, which fails closed because a wrong
 * grade is worse than no answer.
 *
 * @param {string} teacherUserId
 * @returns {Promise<Array<{classId, schoolId, gradeCode, section, sessionCode, isClassTeacher, subjectCodes}>>}
 */
async function listClassesForTeacher(teacherUserId) {
  if (!teacherUserId) return [];

  const { data: assignments, error: aErr } = await supabase
    .from('class_teachers')
    .select('id, class_id, teacher_user_id, is_class_teacher, is_active')
    .eq('teacher_user_id', teacherUserId)
    .eq('is_active', true);

  if (aErr || !assignments || !assignments.length) {
    if (aErr) logToFile('⚠️ ClassService.listClassesForTeacher: lookup failed', { error: aErr.message });
    return [];
  }

  const classIds = assignments.map((a) => a.class_id);

  const { data: classes, error: cErr } = await supabase
    .from('classes')
    .select('id, school_id, grade_code, section, shift_code, session_code, is_active')
    .in('id', classIds)
    .eq('is_active', true);

  if (cErr || !classes) {
    if (cErr) logToFile('⚠️ ClassService.listClassesForTeacher: class read failed', { error: cErr.message });
    return [];
  }

  const { data: subjectRows } = await supabase
    .from('class_teacher_subjects')
    .select('class_teacher_id, subject_code')
    .in('class_teacher_id', assignments.map((a) => a.id));

  const subjectsByAssignment = new Map();
  for (const row of subjectRows || []) {
    const list = subjectsByAssignment.get(row.class_teacher_id) || [];
    list.push(row.subject_code);
    subjectsByAssignment.set(row.class_teacher_id, list);
  }

  const byId = new Map(classes.map((c) => [c.id, c]));

  return assignments
    .filter((a) => byId.has(a.class_id))
    .map((a) => {
      const cls = byId.get(a.class_id);
      return {
        classId: cls.id,
        schoolId: cls.school_id,
        gradeCode: cls.grade_code,
        section: cls.section || null,
        shiftCode: cls.shift_code || 'morning',
        sessionCode: cls.session_code,
        isClassTeacher: Boolean(a.is_class_teacher),
        subjectCodes: (subjectsByAssignment.get(a.id) || []).sort(),
      };
    });
}

/**
 * Enroll a student into a class. Membership is a ROW with a date range, not a
 * pointer on the student — which is what lets a child be promoted or retained
 * at session rollover without being duplicated.
 *
 * @returns {Promise<{enrollment?: object, created?: boolean, error?: string}>}
 */
async function enrollStudent({ classId, studentId, rollNumber = null, enrolledOn = null } = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!studentId) return { error: 'missing_student' };

  const { data: existing, error: readErr } = await supabase
    .from('class_enrollments')
    .select('id, class_id, student_id, is_active')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .eq('is_active', true);

  if (readErr) {
    logToFile('⚠️ ClassService.enrollStudent: lookup failed', { error: readErr.message });
    return { error: 'lookup_failed' };
  }
  if (existing && existing.length) return { enrollment: existing[0], created: false };

  const { data: inserted, error: insErr } = await supabase
    .from('class_enrollments')
    .insert({
      class_id: classId,
      student_id: studentId,
      roll_number: rollNumber,
      enrolled_on: enrolledOn,
      is_active: true,
    })
    .select()
    .single();

  if (insErr || !inserted) {
    logToFile('⚠️ ClassService.enrollStudent: insert failed', { error: insErr && insErr.message });
    return { error: 'insert_failed' };
  }
  return { enrollment: inserted, created: true };
}

// ---------------------------------------------------------------------------
// Editing, leaving, removing
//
// A teacher may change HER RELATIONSHIP to a class. She may not change the CLASS.
// Identity — school, grade, section, shift, session — is all a class is, so
// "editing the class" means changing what other teachers' assignments, students'
// enrollments and attendance sessions already point at. That is a school-level
// action with no surface here, deliberately (operator, 2026-08-14).
//
// Nothing below ever hard-deletes a class. Every table referencing classes(id)
// cascades, so a DELETE would take enrollments with it, and the legacy mirror —
// which is where attendance history actually hangs today — would survive with a
// null link as a ghost roster still offered to the teacher. Soft delete also frees
// the identity slot, because the identity index is partial on is_active.
// ---------------------------------------------------------------------------

/** Her active assignment on a class, or null. */
async function findAssignment(classId, teacherUserId) {
  const { data, error } = await supabase
    .from('class_teachers')
    .select('id, class_id, teacher_user_id, is_class_teacher, is_active')
    .eq('class_id', classId)
    .eq('teacher_user_id', teacherUserId)
    .eq('is_active', true);
  if (error) {
    logToFile('⚠️ ClassService: assignment lookup failed', { error: error.message }, 'error');
    return null;
  }
  return (data || [])[0] || null;
}

/** Deactivate the legacy mirror rows for a class — optionally just one teacher's. */
async function deactivateMirrors(classId, teacherUserId = null) {
  let q = supabase
    .from('student_lists')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('class_id', classId);
  if (teacherUserId) q = q.eq('user_id', teacherUserId);
  const { error } = await q;
  if (error) {
    logToFile('⚠️ ClassService: could not deactivate the legacy mirror', { classId, error: error.message }, 'error');
    return false;
  }
  return true;
}

/**
 * Change what a teacher teaches on a class, and whether she is its class teacher.
 *
 * `subjectCodes`, when given, is the COMPLETE set she teaches — subjects missing
 * from it are removed, which is what frees them for a colleague. Omit it to leave
 * her subjects alone. Likewise omit `isClassTeacher` to leave the role alone;
 * `false` releases it.
 *
 * Any identity fields passed in are IGNORED. See the note above.
 *
 * @returns {Promise<{assignment?, subjectsTaken?, classTeacherTaken?, error?}>}
 */
async function updateAssignment({ classId, teacherUserId, subjectCodes, isClassTeacher } = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };

  const assignment = await findAssignment(classId, teacherUserId);
  if (!assignment) return { error: 'not_assigned' };

  const { data: peers, error: peerErr } = await supabase
    .from('class_teachers')
    .select('id, teacher_user_id, is_class_teacher, is_active')
    .eq('class_id', classId)
    .eq('is_active', true);
  if (peerErr) return { error: 'lookup_failed' };

  // ---- the role ----
  let classTeacherTaken = false;
  if (isClassTeacher === true && !assignment.is_class_teacher) {
    const holder = (peers || []).find((p) => p.is_class_teacher && p.teacher_user_id !== teacherUserId);
    if (holder) {
      classTeacherTaken = true;
    } else {
      const { error } = await supabase
        .from('class_teachers')
        .update({ is_class_teacher: true, updated_at: new Date().toISOString() })
        .eq('id', assignment.id);
      if (error) return { error: 'update_failed' };
      assignment.is_class_teacher = true;
    }
  } else if (isClassTeacher === false && assignment.is_class_teacher) {
    const { error } = await supabase
      .from('class_teachers')
      .update({ is_class_teacher: false, updated_at: new Date().toISOString() })
      .eq('id', assignment.id);
    if (error) return { error: 'update_failed' };
    assignment.is_class_teacher = false;
  }

  // ---- the subjects ----
  const subjectsTaken = [];
  if (Array.isArray(subjectCodes)) {
    const resolved = [];
    for (const code of subjectCodes) {
      const hit = await vocabulary.resolveSubject(code);
      if (!hit || hit !== code) return { error: 'unknown_subject', subject: code };
      resolved.push(hit);
    }

    const { data: claims, error: claimErr } = await supabase
      .from('class_teacher_subjects')
      .select('class_teacher_id, subject_code, class_id')
      .eq('class_id', classId);
    if (claimErr) return { error: 'lookup_failed' };

    const byTeacher = new Map((peers || []).map((p) => [p.id, p.teacher_user_id]));
    const mine = new Set();
    const others = new Map();
    for (const c of claims || []) {
      if (c.class_teacher_id === assignment.id) mine.add(c.subject_code);
      else others.set(c.subject_code, byTeacher.get(c.class_teacher_id) || null);
    }

    const want = new Set();
    for (const code of resolved) {
      if (others.has(code) && !mine.has(code)) {
        subjectsTaken.push({ code, heldBy: others.get(code) });
        continue;
      }
      want.add(code);
    }

    // Removals FIRST: dropping a subject is what unlocks it, and the documented
    // consequence of (class, subject) uniqueness is that a row left behind keeps
    // the subject bound to a teacher who no longer teaches it.
    for (const code of mine) {
      if (want.has(code)) continue;
      const { error } = await supabase
        .from('class_teacher_subjects')
        .delete()
        .eq('class_teacher_id', assignment.id)
        .eq('subject_code', code);
      if (error) return { error: 'update_failed' };
    }

    for (const code of want) {
      if (mine.has(code)) continue;
      const { error } = await supabase
        .from('class_teacher_subjects')
        .insert({ class_teacher_id: assignment.id, subject_code: code, class_id: classId })
        .select()
        .single();
      if (error) return { error: 'update_failed' };
    }
  }

  return { assignment, subjectsTaken, classTeacherTaken };
}

/**
 * Remove a teacher from a class. The class survives for everyone else.
 *
 * Her subject rows are DELETED rather than left inert, so a colleague can pick those
 * subjects up. Her mirror row is deactivated so attendance stops offering the class.
 *
 * @returns {Promise<{left: boolean, error?: string}>} left:false when she was not on it.
 */
async function leaveClass({ classId, teacherUserId } = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };

  const assignment = await findAssignment(classId, teacherUserId);
  if (!assignment) return { left: false };

  const { error: subErr } = await supabase
    .from('class_teacher_subjects')
    .delete()
    .eq('class_teacher_id', assignment.id);
  if (subErr) {
    logToFile('⚠️ ClassService.leaveClass: could not free her subjects', { error: subErr.message }, 'error');
    return { error: 'update_failed' };
  }

  const { error: aErr } = await supabase
    .from('class_teachers')
    .update({
      is_active: false,
      ended_on: new Date().toISOString().slice(0, 10),
      is_class_teacher: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assignment.id);
  if (aErr) return { error: 'update_failed' };

  await deactivateMirrors(classId, teacherUserId);
  return { left: true };
}

/**
 * Retire a class — soft, and only when it is hers alone and nobody is enrolled.
 *
 * Refuses with a NAMED reason so the caller can offer "leave" instead:
 *   not_assigned    she is not on this class
 *   other_teachers  someone else still teaches it; retiring it would remove theirs
 *   has_students    enrollments exist, and a hard delete would cascade them away
 *
 * @returns {Promise<{deactivated?: boolean, error?: string, count?: number}>}
 */
async function deactivateClass({ classId, teacherUserId } = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };

  const assignment = await findAssignment(classId, teacherUserId);
  if (!assignment) return { error: 'not_assigned' };

  const { data: peers, error: peerErr } = await supabase
    .from('class_teachers')
    .select('id, teacher_user_id, is_active')
    .eq('class_id', classId)
    .eq('is_active', true);
  if (peerErr) return { error: 'lookup_failed' };

  const others = (peers || []).filter((p) => p.teacher_user_id !== teacherUserId);
  if (others.length) return { error: 'other_teachers', count: others.length };

  const { data: enrolled, error: enrErr } = await supabase
    .from('class_enrollments')
    .select('id')
    .eq('class_id', classId)
    .eq('is_active', true);
  if (enrErr) return { error: 'lookup_failed' };
  if ((enrolled || []).length) return { error: 'has_students', count: enrolled.length };

  const { error: clsErr } = await supabase
    .from('classes')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', classId);
  if (clsErr) return { error: 'update_failed' };

  // Her assignment goes with it, and her subjects are freed — if this class is ever
  // recreated it starts clean rather than inheriting a stale claim.
  await supabase.from('class_teacher_subjects').delete().eq('class_id', classId);
  await supabase
    .from('class_teachers')
    .update({ is_active: false, ended_on: new Date().toISOString().slice(0, 10) })
    .eq('class_id', classId);
  await deactivateMirrors(classId);

  return { deactivated: true };
}

// ---------------------------------------------------------------------------
// The roster
//
// Students belong to the CLASS, so every teacher assigned to it sees the same
// children. That is the payoff of enrollment-as-a-row, and the reason a removal
// must be SOFT: a hard delete would remove the child for every teacher at once and
// orphan the attendance records that reference her. `left_on` and `outcome` exist
// for exactly this.
//
// ONE KNOWN LIMIT, deliberate. The legacy mirror is per-teacher and
// `students.list_id` is a single FK, so a shared roster cannot be mirrored into
// every teacher's legacy list. A new child is attached to the list of the teacher
// who added her, which preserves exactly today's attendance behaviour for that
// teacher. Colleagues see the child in the class roster but not yet in their own
// legacy attendance — that closes when attendance moves onto class_id.
// ---------------------------------------------------------------------------

/**
 * The children currently enrolled in a class.
 *
 * Returns [] for a teacher who is not assigned to the class — a roster is not
 * public, and an empty list is a state the caller can render, unlike an error.
 */
async function listStudents({ classId, teacherUserId } = {}) {
  if (!classId || !teacherUserId) return [];
  if (!(await findAssignment(classId, teacherUserId))) return [];

  const { data: enrollments, error } = await supabase
    .from('class_enrollments')
    .select('id, student_id, roll_number, enrolled_on, is_active')
    .eq('class_id', classId)
    .eq('is_active', true);

  if (error || !enrollments || !enrollments.length) {
    if (error) logToFile('⚠️ ClassService.listStudents: lookup failed', { error: error.message }, 'error');
    return [];
  }

  const { data: kids, error: kidErr } = await supabase
    .from('students')
    .select('id, student_name, father_name, roll_number, is_active')
    .in('id', enrollments.map((e) => e.student_id));

  if (kidErr || !kids) {
    logToFile('⚠️ ClassService.listStudents: student read failed', { error: kidErr && kidErr.message }, 'error');
    return [];
  }

  const byId = new Map(kids.map((k) => [k.id, k]));
  return enrollments
    .filter((e) => byId.has(e.student_id))
    .map((e) => {
      const kid = byId.get(e.student_id);
      return {
        studentId: kid.id,
        studentName: kid.student_name,
        fatherName: kid.father_name || null,
        rollNumber: e.roll_number != null ? e.roll_number : (kid.roll_number != null ? kid.roll_number : null),
        enrolledOn: e.enrolled_on || null,
      };
    })
    .sort((a, b) => {
      if (a.rollNumber != null && b.rollNumber != null) return a.rollNumber - b.rollNumber;
      if (a.rollNumber != null) return -1;
      if (b.rollNumber != null) return 1;
      return String(a.studentName).localeCompare(String(b.studentName));
    });
}

/**
 * Add a child to a class: one `students` row, one enrollment, and an attachment to
 * the adding teacher's legacy list (see the limit noted above).
 *
 * @returns {Promise<{student?, enrollment?, error?}>}
 */
async function addStudent({
  classId, teacherUserId, studentName, fatherName = null, rollNumber = null,
} = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };

  const name = typeof studentName === 'string' ? studentName.trim() : '';
  if (!name) return { error: 'missing_name' };

  if (!(await findAssignment(classId, teacherUserId))) return { error: 'not_assigned' };

  // Her legacy list for this class, so attendance keeps working for her.
  const { data: mirrors } = await supabase
    .from('student_lists')
    .select('id, user_id, class_id, is_active')
    .eq('class_id', classId)
    .eq('user_id', teacherUserId)
    .eq('is_active', true);
  const listId = (mirrors || [])[0] ? mirrors[0].id : null;

  const { data: student, error: insErr } = await supabase
    .from('students')
    .insert({
      student_name: name,
      father_name: fatherName || null,
      roll_number: rollNumber,
      list_id: listId,
      is_active: true,
    })
    .select()
    .single();

  if (insErr || !student) {
    logToFile('⚠️ ClassService.addStudent: insert failed', { error: insErr && insErr.message }, 'error');
    return { error: 'insert_failed' };
  }

  const enrolled = await enrollStudent({
    classId,
    studentId: student.id,
    rollNumber,
    enrolledOn: new Date().toISOString().slice(0, 10),
  });

  if (enrolled.error) {
    logToFile('⚠️ ClassService.addStudent: enrolled failed after the student row was written', {
      studentId: student.id, error: enrolled.error,
    }, 'error');
    return { error: enrolled.error, student };
  }

  return { student, enrollment: enrolled.enrollment };
}

/**
 * Take a child off a class roster — SOFTLY.
 *
 * Closes the enrollment (`left_on`, `outcome`) and leaves both the child and the
 * history intact. Any teacher on the class may do it, because the roster is the
 * class's, not hers.
 *
 * @returns {Promise<{removed: boolean, error?: string}>}
 */
async function removeStudent({
  classId, teacherUserId, studentId, outcome = 'left',
} = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };
  if (!studentId) return { error: 'missing_student' };

  if (!(await findAssignment(classId, teacherUserId))) return { error: 'not_assigned' };

  const { data: rows, error: readErr } = await supabase
    .from('class_enrollments')
    .select('id, class_id, student_id, is_active')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .eq('is_active', true);

  if (readErr) return { error: 'lookup_failed' };
  if (!rows || !rows.length) return { removed: false };

  const { error: updErr } = await supabase
    .from('class_enrollments')
    .update({
      is_active: false,
      left_on: new Date().toISOString().slice(0, 10),
      outcome,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rows[0].id);

  if (updErr) return { error: 'update_failed' };
  return { removed: true };
}

/**
 * The most a single paste may add. Carried over from the attendance flow, where a
 * mis-paste — a whole school, a copied spreadsheet column — could otherwise write
 * thousands of rows. The caller is told what was dropped rather than left guessing.
 */
const MAX_PASTE = 300;

/**
 * Add a whole class from one pasted block.
 *
 * The attendance flow's own source records why this shape matters: the version it
 * replaced added one student per screen round-trip, "which is why no class was ever
 * finished on this deployment". A register is pasted.
 *
 * Parsing is StudentListService.parseStudentText — it already handles what teachers
 * actually paste ("Name, Father", "Name s/o Father", numbered and bulleted lines) and
 * returns the two columns we store. It has no dedupe and no cap, so those two guards
 * are applied here; attendance's parser has them but drops father names. Reusing one
 * parser and carrying the other's guards beats writing a third.
 *
 * @returns {Promise<{added, duplicates, dropped, students?, error?}>}
 */
async function addStudents({ classId, teacherUserId, rawText } = {}) {
  if (!classId) return { error: 'missing_class' };
  if (!teacherUserId) return { error: 'missing_teacher' };
  if (!(await findAssignment(classId, teacherUserId))) return { error: 'not_assigned' };

  // Required lazily: student-list.service is a heavier legacy module and this keeps
  // the classes services loadable without it.
  const StudentListService = require('../student-list.service');
  const parsed = StudentListService.parseStudentText(typeof rawText === 'string' ? rawText : '');
  if (!parsed.length) return { error: 'no_names' };

  // Who is already on the roster, so a re-paste is not a duplicate.
  const onRoster = await listStudents({ classId, teacherUserId });
  const seen = new Set(onRoster.map((s) => String(s.studentName).trim().toLowerCase()));
  let nextRoll = onRoster.reduce((m, s) => Math.max(m, s.rollNumber || 0), 0);

  let duplicates = 0;
  const wanted = [];
  for (const row of parsed) {
    const key = String(row.studentName).trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) { duplicates += 1; continue; }   // keeps the first spelling
    seen.add(key);
    wanted.push(row);
  }

  const dropped = Math.max(0, wanted.length - MAX_PASTE);
  const toAdd = wanted.slice(0, MAX_PASTE);

  const students = [];
  for (const row of toAdd) {
    nextRoll += 1;
    const res = await addStudent({
      classId,
      teacherUserId,
      studentName: row.studentName,
      fatherName: row.fatherName || null,
      rollNumber: nextRoll,
    });
    if (res.error) {
      logToFile('⚠️ ClassService.addStudents: stopped part-way', {
        classId, added: students.length, error: res.error,
      }, 'error');
      // Report what DID land rather than pretending none of it did — the teacher
      // needs to know what to re-paste.
      return { error: res.error, added: students.length, duplicates, dropped, students };
    }
    students.push(res.student);
  }

  return { added: students.length, duplicates, dropped, students };
}


// ---------------------------------------------------------------------------
// importRoster — a whole class, scanned off a register by someone who is not
// the class teacher
// ---------------------------------------------------------------------------

/**
 * Write a scanned register into the classes model, as ONE class with ONE roster.
 *
 * This is /roster's only write path. It exists because the first version of that
 * feature wrote `classes`, `students` and `class_enrollments` itself, making it the
 * fourth independent writer of this model — and it skipped the legacy `student_lists`
 * mirror, which is the thing that decides whether attendance can see a child.
 * Measured on a real save: 16 children correctly enrolled, `list_id` null on every
 * one, and the teacher who teaches that class saw an empty roster. The coach's work
 * was invisible to the only person who needed it.
 *
 * WHOSE LIST. The mirror is per-teacher and `students.list_id` is a single FK, so a
 * roster can live in exactly one person's legacy list. It goes to the class teacher
 * the coach named, because she is the one who will mark the attendance. With no
 * teacher named it falls back to the coach: the class and the children are still
 * written and nothing is lost, they are simply not in anyone's attendance yet.
 *
 * IDEMPOTENT, because someone will re-scan the same page. A child already on the
 * roster at the same roll number — or by name, where the register carried no
 * readable roll — is skipped, not duplicated.
 *
 * @param {object} p
 * @param {Array<{roll_number: string|null, student_name: string,
 *                father_name?: string|null, parent_phone?: string|null}>} p.students
 * @returns {Promise<{classId?, added?, skipped?, mirrored?, classTeacherAssigned?, error?}>}
 */
async function importRoster({
  schoolId, gradeCode, section, shiftCode = 'morning', sessionCode,
  classTeacherUserId = null, createdByUserId, students = [],
} = {}) {
  if (!createdByUserId) return { error: 'missing_teacher' };

  const incoming = (students || [])
    .map((s) => ({
      roll_number: s.roll_number === null || s.roll_number === undefined || s.roll_number === ''
        ? null : String(s.roll_number).trim(),
      student_name: String(s.student_name || '').trim(),
      father_name: (s.father_name && String(s.father_name).trim()) || null,
      parent_phone: (s.parent_phone && String(s.parent_phone).trim()) || null,
    }))
    .filter((s) => s.student_name);

  // Refuse BEFORE creating the class. An empty scan that leaves an empty class
  // behind is worse than no scan: the next run adopts it and looks successful.
  if (!incoming.length) return { error: 'no_students' };

  // The mirror owner. Named teacher first — see WHOSE LIST above.
  const mirrorOwner = classTeacherUserId || createdByUserId;

  const made = await createClass({
    schoolId, gradeCode, section, shiftCode, sessionCode, teacherUserId: mirrorOwner,
  });
  if (made.error) return { error: made.error, section: made.section, shift: made.shift };
  const classId = made.class.id;

  let classTeacherAssigned = false;
  if (classTeacherUserId) {
    const assigned = await assignTeacher({
      classId, teacherUserId: classTeacherUserId, isClassTeacher: true,
    });
    // A refused role must not cost the roster — same rule assignTeacher itself
    // follows. The class and the children matter more than the flag.
    classTeacherAssigned = !assigned.error;
    if (assigned.error) {
      logToFile('⚠️ ClassService.importRoster: teacher not assigned — roster kept', {
        classId, error: assigned.error,
      });
    }
  }

  // The mirror row createClass just wrote or adopted, so every child lands in it.
  const { data: mirrors } = await supabase
    .from('student_lists')
    .select('id, user_id, class_id, is_active')
    .eq('class_id', classId)
    .eq('user_id', mirrorOwner)
    .eq('is_active', true);
  const listId = (mirrors || [])[0] ? mirrors[0].id : null;

  // Who is already here, so a re-scan is a no-op. Matched on roll where the
  // register gave us one, and on name where it did not.
  const { data: existingEnrollments } = await supabase
    .from('class_enrollments')
    .select('id, student_id, roll_number, is_active')
    .eq('class_id', classId)
    .eq('is_active', true);

  const takenRolls = new Set();
  const studentIds = [];
  for (const e of existingEnrollments || []) {
    if (e.roll_number !== null && e.roll_number !== undefined) takenRolls.add(Number(e.roll_number));
    studentIds.push(e.student_id);
  }

  const takenNames = new Set();
  if (studentIds.length) {
    const { data: kids } = await supabase
      .from('students').select('id, student_name').in('id', studentIds);
    for (const k of kids || []) takenNames.add(String(k.student_name || '').trim().toLowerCase());
  }

  let added = 0;
  let skipped = 0;

  for (const s of incoming) {
    // students.roll_number is INTEGER. Anything that is not a plain number reached
    // here as null already (roster-extraction sanitises it) — this is the belt.
    const roll = s.roll_number !== null && /^\d{1,3}$/.test(s.roll_number)
      ? Number(s.roll_number) : null;
    const nameKey = s.student_name.toLowerCase();

    if (roll !== null ? takenRolls.has(roll) : takenNames.has(nameKey)) {
      skipped += 1;
      continue;
    }

    const { data: student, error: insErr } = await supabase
      .from('students')
      .insert({
        student_name: s.student_name,
        father_name: s.father_name,
        parent_phone: s.parent_phone,
        roll_number: roll,
        list_id: listId,
        enrolled_by_user_id: createdByUserId,
        is_active: true,
      })
      .select()
      .single();

    if (insErr || !student) {
      logToFile('⚠️ ClassService.importRoster: stopped part-way', {
        classId, added, error: insErr && insErr.message,
      }, 'error');
      // Report what DID land. The coach needs to know what is already saved before
      // she re-scans, or she will end up with the class written twice.
      return { classId, added, skipped, mirrored: made.mirrored, classTeacherAssigned, error: 'insert_failed' };
    }

    const enrolled = await enrollStudent({
      classId, studentId: student.id, rollNumber: roll,
      enrolledOn: new Date().toISOString().slice(0, 10),
    });
    if (enrolled.error) {
      logToFile('⚠️ ClassService.importRoster: enrolment failed after the student row was written', {
        classId, studentId: student.id, error: enrolled.error,
      }, 'error');
      return { classId, added, skipped, mirrored: made.mirrored, classTeacherAssigned, error: enrolled.error };
    }

    if (roll !== null) takenRolls.add(roll); else takenNames.add(nameKey);
    added += 1;
  }

  return {
    classId, added, skipped, created: made.created,
    mirrored: made.mirrored, mirrorOwnerUserId: mirrorOwner, classTeacherAssigned,
  };
}

module.exports = {
  createClass,
  importRoster,
  assignTeacher,
  updateAssignment,
  leaveClass,
  deactivateClass,
  listClassesForTeacher,
  enrollStudent,
  listStudents,
  addStudent,
  addStudents,
  removeStudent,
  MAX_PASTE,
  // Exported for tests and for the cutover PR that removes the mirror.
  normalizeSection,
  mirrorLabel,
};
