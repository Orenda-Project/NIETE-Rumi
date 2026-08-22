/**
 * Class manager Flow endpoint (data_exchange, encrypted).
 *
 * Screens: CLASSES → ADD → SUBJECTS → SAVED  (docs/flows/class-manager-flow.json)
 *
 * This is the teacher-facing surface for the classes model. CLASSES is the entry
 * screen and doubles as "view my classes"; the footer walks into "add a class".
 *
 * THREE THINGS THIS ENDPOINT IS CAREFUL ABOUT.
 *
 * 1. EVERY teacher-facing string is supplied as screen data, resolved through the
 *    catalog for this teacher's language. A Flow asset is per-WABA and cannot be
 *    re-rendered per teacher, so an Urdu-preferring teacher only sees Urdu if the
 *    endpoint sends it. The Flow JSON therefore hardcodes no copy.
 *
 * 2. It NEVER opens on a screen with incoming edges. CLASSES is the only entry
 *    screen; Meta refuses to open a Flow on a screen that has incoming routes, and
 *    an "empty state" branch that returned a mid-flow screen is exactly how a
 *    graceful path became the only hard failure on this deployment before.
 *
 * 3. An empty class list is a NORMAL state, not an error. It renders as a sentence
 *    plus the add affordance, never a dead end.
 *
 * The school check lives in the CALLER, not here: `classes.school_id` is NOT NULL,
 * so a teacher with no school on file cannot have a class created, and the right
 * answer is a chat message rather than a Flow that cannot succeed. See the
 * `classNoSchool` catalog key.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const ClassService = require('../services/classes/class.service');
const {
  resolveUx,
  gradeLabelFor,
  subjectLabelFor,
  shiftLabelFor,
  GRADE_LABELS,
  SUBJECT_LABELS,
  SHIFT_LABELS,
} = require('../config/ux-strings');

// What ADD chose, while the teacher is on SUBJECTS. Keyed by the Flow token (the
// user id). The Flow carries nothing between screens by itself.
const pending = new Map();

/** The "create one instead" choice on the class picker. */
const ADD_NEW = '__add__';

// Meta caps a CheckboxGroup at 20 options.
const REMOVE_OPTION_CAP = 20;

/**
 * Radio and checkbox item titles are a capped field, and a long student name (or a
 * class with a shift suffix) will exceed it. Measured in CODE POINTS, because the
 * count that matters at the Graph API diverges from .length on Urdu.
 */
const ITEM_CAP = 30;
function cap(text, limit = ITEM_CAP) {
  const chars = [...String(text == null ? '' : text)];
  return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit - 1).join('')}…`;
}

// A Flow left open indefinitely should not pin memory, and a stale choice is
// worse than asking again.
const PENDING_TTL_MS = 30 * 60 * 1000;

function rememberChoice(userId, choice) {
  pending.set(userId, { ...choice, at: Date.now() });
}

function recallChoice(userId) {
  const hit = pending.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > PENDING_TTL_MS) {
    pending.delete(userId);
    return null;
  }
  return hit;
}

/**
 * The teacher row we need for language, school and the class list.
 * @returns {Promise<{id, school_id, preferred_language}|null>}
 */
async function loadTeacher(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id, school_id, preferred_language')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logToFile('⚠️ class-manager: user load failed', { userId, error: error.message });
    return null;
  }
  return data || null;
}

/** "Grade 4 - A" in the teacher's language; the section is appended verbatim. */
function classDisplay(gradeCode, section, who, shiftCode = 'morning') {
  const grade = gradeLabelFor(gradeCode, who) || gradeCode;
  const base = section ? `${grade} - ${section}` : grade;
  // Morning is the unmarked default; naming it on every row would be noise, and
  // naming neither would make the two classes indistinguishable.
  if (shiftCode && shiftCode !== 'morning') {
    return `${base} (${shiftLabelFor(shiftCode, who) || shiftCode})`;
  }
  return base;
}

/**
 * The current session, by date predicate rather than a stored flag — with mixed
 * annual/semester schools more than one session can legitimately contain today,
 * so this picks the shortest span containing it (the most specific answer).
 */
async function currentSessionCode() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('academic_sessions')
    .select('code, starts_on, ends_on')
    .eq('is_active', true);

  if (error || !data || !data.length) {
    logToFile('⚠️ class-manager: no academic_sessions available', { error: error && error.message });
    return null;
  }

  const containing = data
    .filter((s) => s.starts_on <= today && today <= s.ends_on)
    .sort((a, b) => (a.ends_on < b.ends_on ? -1 : 1));

  return containing.length ? containing[0].code : null;
}

// ---------------------------------------------------------------------------
// CLASSES — entry screen, doubles as "view my classes"
// ---------------------------------------------------------------------------

async function handleClassesInit(userId) {
  const teacher = await loadTeacher(userId);
  const who = teacher || {};

  const classes = await ClassService.listClassesForTeacher(userId);

  const lines = classes.map((c) => {
    const display = classDisplay(c.gradeCode, c.section, who, c.shiftCode);
    const subjects = c.subjectCodes
      .map((code) => subjectLabelFor(code, who))
      .filter(Boolean)
      .join(', ');
    // Kept to one line per class: a Flow TextBody is 1024 code points, and a
    // teacher with a dozen classes should still see all of them.
    const parts = [display, c.sessionCode];
    if (subjects) parts.push(subjects);
    return parts.join(' · ');
  });

  // Her classes as choices, with "add a new one" last. This is the model in the UI:
  // pick the class you teach — creating one is the fallback, not the front door.
  const options = classes.map((c) => ({
    id: c.classId,
    title: cap(classDisplay(c.gradeCode, c.section, who, c.shiftCode)),
  }));
  options.push({ id: ADD_NEW, title: cap(resolveUx('classAddNewOption', { user: who })) });

  return {
    screen: 'CLASSES',
    data: {
      heading: resolveUx('classesHeading', { user: who }),
      summary: lines.length ? lines.join('\n') : resolveUx('classesEmpty', { user: who }),
      add_label: resolveUx('classesAdd', { user: who }),
      choose_label: resolveUx('classChooseLabel', { user: who }),
      next_label: resolveUx('classNext', { user: who }),
      options,
    },
  };
}

// ---------------------------------------------------------------------------
// ADD — grade + section
// ---------------------------------------------------------------------------

async function buildAddScreen(who) {
  // Ordered by the reference table's ordinal, so the picker reads
  // Early Years → Grade 12 rather than alphabetically.
  const { data: rows, error } = await supabase
    .from('grade_levels')
    .select('code, ordinal, sort_order')
    .eq('is_active', true);

  if (error || !rows) {
    logToFile('⚠️ class-manager: grade_levels load failed', { error: error && error.message });
    return null;
  }

  const grades = [...rows]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((r) => ({ id: r.code, title: gradeLabelFor(r.code, who) }))
    .filter((g) => Boolean(g.title));

  // Sections and shifts are closed vocabularies read from their tables, so the
  // picker cannot drift from what the FKs will accept. A free-text section would
  // now be REFUSED by the database, which is why this is a dropdown.
  const sections = await listSeeded('sections');
  const shifts = await listSeeded('shifts');

  return {
    screen: 'ADD',
    data: {
      heading: resolveUx('classAddHeading', { user: who }),
      grade_label: resolveUx('classGradeLabel', { user: who }),
      section_label: resolveUx('classSectionLabel', { user: who }),
      section_helper: resolveUx('classSectionHelperClosed', { user: who }),
      shift_label: resolveUx('classShiftLabel', { user: who }),
      next_label: resolveUx('classNext', { user: who }),
      grades,
      sections: sections.map((code) => ({ id: code, title: code })),
      shifts: shifts.map((code) => ({ id: code, title: shiftLabelFor(code, who) || code })),
    },
  };
}

/**
 * The codes in a small closed reference table, in their seeded order. Read from the
 * table rather than hardcoded so a section added by support appears in the picker
 * without a deploy — which is the whole reason sections are a table.
 */
async function listSeeded(table) {
  const { data, error } = await supabase
    .from(table)
    .select('code, sort_order')
    .eq('is_active', true);

  if (error || !data) {
    logToFile(`⚠️ class-manager: ${table} load failed`, { error: error && error.message });
    return [];
  }
  return [...data].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((r) => r.code);
}

// ---------------------------------------------------------------------------
// SUBJECTS — what this teacher teaches, and whether they are the class teacher
// ---------------------------------------------------------------------------

function buildSubjectsScreen(who, display) {
  const subjects = Object.keys(SUBJECT_LABELS)
    .map((code) => ({ id: code, title: subjectLabelFor(code, who) }))
    .filter((s) => Boolean(s.title));

  return {
    screen: 'SUBJECTS',
    data: {
      heading: resolveUx('classSubjectsHeading', { user: who, params: { class: display } }),
      subjects_label: resolveUx('classSubjectsLabel', { user: who }),
      class_teacher_label: resolveUx('classTeacherOptIn', { user: who }),
      save_label: resolveUx('classSave', { user: who }),
      subjects,
    },
  };
}

/** The roster as one numbered block, or a sentence when it is empty. */
function rosterText(students, who) {
  if (!students.length) return resolveUx('classRosterEmpty', { user: who });
  // A Flow TextBody holds 1024 code points; a capped class is 300 children, so a
  // full roster does not fit. Show the first 40 and say how many more there are.
  const shown = students.slice(0, 40)
    .map((st) => `${st.rollNumber != null ? `${st.rollNumber}. ` : ''}${st.studentName}`);
  if (students.length > shown.length) shown.push(`… +${students.length - shown.length}`);
  return shown.join('\n');
}

/**
 * ROSTER — the whole edit, on one screen.
 *
 * The list, the removals and the additions together. It used to be a list plus a
 * radio asking which of the two she wanted, and each answer led to a TERMINAL screen —
 * so adding a child and then removing one cost a second /class, which is the same
 * complaint that ended the create path.
 *
 * A merge rather than another screen, because Flow routing is forward-only: there is
 * no legal edge back from a save screen to the roster, and ROSTER → ADD → ROSTER_2 →
 * REMOVE → … is unbounded. One screen, one submit, both halves applied.
 */
async function buildRosterScreen(who, classId, display) {
  const students = await ClassService.listStudents({ classId, teacherUserId: who.id });

  // Meta caps a CheckboxGroup at 20 options. The roster TEXT still lists everyone, so
  // the cap costs a second pass to remove the 21st child rather than hiding her —
  // and the hint says which, because a silently short list reads as missing data.
  const options = students.slice(0, REMOVE_OPTION_CAP).map((st) => ({
    id: st.studentId,
    title: `${st.rollNumber != null ? `${st.rollNumber}. ` : ''}${st.studentName}`.slice(0, 30),
  }));
  const capped = students.length > options.length;

  return {
    screen: 'ROSTER',
    data: {
      heading: display,
      roster: rosterText(students, who),
      hint: capped
        ? resolveUx('classEditHintCapped', { user: who, params: { shown: options.length } })
        : resolveUx('classEditHint', { user: who }),
      remove_label: resolveUx('classRemoveField', { user: who }),
      remove_options: options,
      add_label: resolveUx('classAddField', { user: who }),
      add_hint: resolveUx('classAddStudentsHint', { user: who }),
      save_label: resolveUx('classSaveChanges', { user: who }),
    },
  };
}

/**
 * The class this roster edit is about — the in-flight choice, re-validated.
 *
 * Re-checked against her OWN classes on every hop rather than trusted from the
 * remembered choice: a Flow can sit on a handset for a long time, and an assignment
 * can end in between.
 */
async function rosterContext(userId, who) {
  const choice = recallChoice(userId);
  if (!choice || !choice.rosterClassId) return null;
  const mine = await ClassService.listClassesForTeacher(userId);
  const row = mine.find((c) => c.classId === choice.rosterClassId);
  if (!row) return null;
  return {
    classId: row.classId,
    display: classDisplay(row.gradeCode, row.section, who, row.shiftCode),
  };
}

// ---------------------------------------------------------------------------
// data_exchange
// ---------------------------------------------------------------------------

async function handleClassManagerDataExchange(userId, screen, screenData) {
  const teacher = await loadTeacher(userId);
  const who = teacher || {};

  // CLASSES → either the add form, or the roster of the class she picked.
  if (screen === 'CLASSES') {
    const target = screenData && screenData.target;

    if (!target || target === ADD_NEW) {
      const add = await buildAddScreen(who);
      return add || (await handleClassesInit(userId));
    }

    const mine = await ClassService.listClassesForTeacher(userId);
    const row = mine.find((c) => c.classId === target);
    // A class id she is not assigned to gets no roster — the picker is not
    // authorisation, and a stale asset could send anything.
    if (!row) return await handleClassesInit(userId);

    rememberChoice(userId, { rosterClassId: row.classId });
    return await buildRosterScreen(
      who, row.classId, classDisplay(row.gradeCode, row.section, who, row.shiftCode),
    );
  }

  // ROSTER → apply the removals and the additions, in that order, and finish.
  //
  // Removals FIRST so that re-typing a name she has just ticked leaves her with the
  // new enrollment rather than deleting the one she meant to keep.
  if (screen === 'ROSTER' || screen === 'ADD_STUDENTS' || screen === 'REMOVE_STUDENTS') {
    const ctx = await rosterContext(userId, who);
    if (!ctx) return await handleClassesInit(userId);

    // ADD_STUDENTS and REMOVE_STUDENTS are retired screens. A Flow message already
    // delivered to a handset still submits under those names with their own field
    // names, so both are read here rather than dead-ending a teacher mid-edit.
    const d = screenData || {};
    const removeIds = normalizeMultiSelect(d.remove);
    const rawAdd = d.add != null ? d.add : d.roster;

    let removed = 0;
    for (const studentId of removeIds) {
      // eslint-disable-next-line no-await-in-loop
      const res = await ClassService.removeStudent({ classId: ctx.classId, teacherUserId: userId, studentId });
      if (res.removed) removed += 1;
      else if (res.error) {
        logToFile('⚠️ class-manager: removeStudent failed', { userId, studentId, error: res.error }, 'error');
      }
    }

    let added = null;
    if (rawAdd && String(rawAdd).trim()) {
      added = await ClassService.addStudents({
        classId: ctx.classId, teacherUserId: userId, rawText: rawAdd,
      });
      if (added.error && !added.added) {
        logToFile('⚠️ class-manager: addStudents failed', { userId, error: added.error }, 'error');
      }
    }

    // Report BOTH halves. A teacher who did two things and is told about one assumes
    // the other silently failed.
    const parts = [];
    if (removed) {
      parts.push(resolveUx('classStudentsRemoved', { user: who, params: { removed, class: ctx.display } }));
    }
    if (added && added.added) {
      parts.push(resolveUx('classStudentsAdded', {
        user: who, params: { added: added.added, class: ctx.display },
      }));
      // Duplicates and a hit cap are notes on a success, not failures — the count
      // otherwise disagrees with what she pasted and she cannot tell why.
      if (added.duplicates) {
        parts.push(resolveUx('classStudentsDuplicates', { user: who, params: { duplicates: added.duplicates } }));
      }
      if (added.dropped) {
        parts.push(resolveUx('classStudentsDropped', { user: who, params: { dropped: added.dropped } }));
      }
    }
    if (!parts.length) {
      parts.push(resolveUx('classNoChanges', { user: who, params: { class: ctx.display } }));
    }

    pending.delete(userId);
    return {
      screen: 'SAVED',
      data: {
        heading: resolveUx('classSavedHeading', { user: who }),
        detail: parts.join(' '),
        done_label: resolveUx('classDone', { user: who }),
      },
    };
  }

  // ADD → remember the choice, ask what they teach.
  if (screen === 'ADD') {
    const gradeCode = screenData && screenData.grade;
    const section = ClassService.normalizeSection(screenData && screenData.section);
    const rawShift = screenData && screenData.shift;
    const shiftCode = typeof rawShift === 'string' && SHIFT_LABELS[rawShift] ? rawShift : 'morning';

    if (!gradeCode || !GRADE_LABELS[gradeCode]) {
      // Re-ask rather than proceeding with a grade we cannot store.
      const add = await buildAddScreen(who);
      return add || (await handleClassesInit(userId));
    }

    rememberChoice(userId, { gradeCode, section, shiftCode });
    return buildSubjectsScreen(who, classDisplay(gradeCode, section, who, shiftCode));
  }

  // SUBJECTS → create the class, assign the teacher, land on SAVED.
  if (screen === 'SUBJECTS') {
    const choice = recallChoice(userId);
    if (!choice) {
      // The Flow sat open past the TTL. Send them back to the start of the add
      // path — never to a mid-flow screen with no context.
      const add = await buildAddScreen(who);
      return add || (await handleClassesInit(userId));
    }

    const sessionCode = await currentSessionCode();
    if (!sessionCode) {
      logToFile('⚠️ class-manager: no current session — cannot create class', { userId });
      return await handleClassesInit(userId);
    }

    const subjectCodes = normalizeSubjectSelection(screenData && screenData.subjects);
    const isClassTeacher = truthy(screenData && screenData.is_class_teacher);

    const result = await ClassService.createClass({
      schoolId: teacher && teacher.school_id,
      gradeCode: choice.gradeCode,
      section: choice.section,
      shiftCode: choice.shiftCode || 'morning',
      sessionCode,
      teacherUserId: userId,
    });

    if (result.error || !result.class) {
      logToFile('⚠️ class-manager: createClass failed', { userId, error: result.error });
      pending.delete(userId);
      return await handleClassesInit(userId);
    }

    const assigned = await ClassService.assignTeacher({
      classId: result.class.id,
      teacherUserId: userId,
      isClassTeacher,
      subjectCodes,
    });

    if (assigned.error) {
      // The class exists; only the assignment failed. Say the class was saved,
      // because it was — overstating the failure would push her to add it again.
      logToFile('⚠️ class-manager: assignTeacher failed after createClass', {
        userId, classId: result.class.id, error: assigned.error,
      });
    }

    // Hand her straight to the roster instead of ending here. Creating
    // a class and then filling it is one intention, not two: SAVED is terminal, so
    // stopping there cost her a second /class and a re-pick to reach ADD_STUDENTS.
    // The new class replaces the in-flight choice rather than clearing it, which is
    // what rosterContext() reads on the next hop.
    rememberChoice(userId, { rosterClassId: result.class.id });

    const display = classDisplay(choice.gradeCode, choice.section, who, choice.shiftCode);

    // A declined claim is ADDITIVE to the confirmation, never a replacement for it:
    // the class really was saved, and copy that reads as failure sends her back to
    // create it again. Subjects first — losing a subject is more consequential to
    // her day than losing the class-teacher badge.
    let detail = resolveUx('classSavedDetail', {
      user: who,
      params: { class: display, session: sessionCode },
    });

    const taken = (assigned.subjectsTaken || [])
      .map((t) => subjectLabelFor(t.code, who) || t.code)
      .filter(Boolean);

    if (taken.length) {
      detail = `${detail}\n\n${resolveUx('classSavedSubjectsTaken', {
        user: who, params: { subjects: taken.join(', ') },
      })}`;
    } else if (assigned.classTeacherTaken) {
      detail = `${detail}\n\n${resolveUx('classSavedRoleTaken', { user: who })}`;
    }

    // The confirmation she would have read on SAVED rides along as the hint, so
    // chaining does not swallow "saved", nor a declined subject/class-teacher claim.
    // Straight onto the edit screen for the class she has just made. The
    // confirmation rides along as the hint, so "saved" is still said out loud on the
    // screen that replaced the terminal one.
    const roster = await buildRosterScreen(who, result.class.id, display);
    roster.data.hint = detail;
    return roster;
  }

  logToFile('⚠️ class-manager: unknown screen', { screen });
  return await handleClassesInit(userId);
}

/**
 * A CheckboxGroup arrives as an array, but Flow payloads have shown up as a
 * JSON-encoded string and as a single value too. Normalize all three, and drop
 * anything not in the catalog so a stale Flow asset cannot inject a code the
 * subjects table has never heard of.
 */
function normalizeMultiSelect(raw) {
  let list = raw;
  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        list = JSON.parse(trimmed);
      } catch {
        list = [trimmed];
      }
    } else {
      list = [trimmed];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
}

/** @see normalizeMultiSelect — plus a catalog filter, so a stale asset cannot inject
 *  a subject the table has never heard of. */
function normalizeSubjectSelection(raw) {
  return normalizeMultiSelect(raw)
    .filter((code) => Object.prototype.hasOwnProperty.call(SUBJECT_LABELS, code));
}

/** OptIn arrives as a boolean, but 'true'/'false' strings have been seen. */
function truthy(value) {
  return value === true || value === 'true';
}

/** BACK from SUBJECTS returns to the add form; from ADD, to the class list. */
async function handleClassManagerBack(userId, screen) {
  const teacher = await loadTeacher(userId);
  const who = teacher || {};

  if (screen === 'SUBJECTS') {
    const add = await buildAddScreen(who);
    if (add) return add;
  }
  if (screen === 'ADD_STUDENTS' || screen === 'REMOVE_STUDENTS') {
    const ctx = await rosterContext(userId, who);
    if (ctx) return await buildRosterScreen(who, ctx.classId, ctx.display);
  }
  return await handleClassesInit(userId);
}

module.exports = {
  handleClassesInit,
  handleClassManagerDataExchange,
  handleClassManagerBack,
  // Exported for tests.
  normalizeSubjectSelection,
  normalizeMultiSelect,
  classDisplay,
  currentSessionCode,
};
