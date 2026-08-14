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
  GRADE_LABELS,
  SUBJECT_LABELS,
} = require('../config/ux-strings');

// What ADD chose, while the teacher is on SUBJECTS. Keyed by the Flow token (the
// user id). The Flow carries nothing between screens by itself.
const pending = new Map();

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
function classDisplay(gradeCode, section, who) {
  const grade = gradeLabelFor(gradeCode, who) || gradeCode;
  return section ? `${grade} - ${section}` : grade;
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
    const display = classDisplay(c.gradeCode, c.section, who);
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

  return {
    screen: 'CLASSES',
    data: {
      heading: resolveUx('classesHeading', { user: who }),
      summary: lines.length ? lines.join('\n') : resolveUx('classesEmpty', { user: who }),
      add_label: resolveUx('classesAdd', { user: who }),
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

  return {
    screen: 'ADD',
    data: {
      heading: resolveUx('classAddHeading', { user: who }),
      grade_label: resolveUx('classGradeLabel', { user: who }),
      section_label: resolveUx('classSectionLabel', { user: who }),
      section_helper: resolveUx('classSectionHelper', { user: who }),
      next_label: resolveUx('classNext', { user: who }),
      grades,
    },
  };
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

// ---------------------------------------------------------------------------
// data_exchange
// ---------------------------------------------------------------------------

async function handleClassManagerDataExchange(userId, screen, screenData) {
  const teacher = await loadTeacher(userId);
  const who = teacher || {};

  // CLASSES footer → the add form.
  if (screen === 'CLASSES') {
    const add = await buildAddScreen(who);
    if (!add) return await handleClassesInit(userId);
    return add;
  }

  // ADD → remember the choice, ask what they teach.
  if (screen === 'ADD') {
    const gradeCode = screenData && screenData.grade;
    const section = ClassService.normalizeSection(screenData && screenData.section);

    if (!gradeCode || !GRADE_LABELS[gradeCode]) {
      // Re-ask rather than proceeding with a grade we cannot store.
      const add = await buildAddScreen(who);
      return add || (await handleClassesInit(userId));
    }

    rememberChoice(userId, { gradeCode, section });
    return buildSubjectsScreen(who, classDisplay(gradeCode, section, who));
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

    pending.delete(userId);

    const display = classDisplay(choice.gradeCode, choice.section, who);
    return {
      screen: 'SAVED',
      data: {
        heading: resolveUx('classSavedHeading', { user: who }),
        detail: resolveUx('classSavedDetail', {
          user: who,
          params: { class: display, session: sessionCode },
        }),
        done_label: resolveUx('classDone', { user: who }),
      },
    };
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
function normalizeSubjectSelection(raw) {
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
  return list.filter((code) => typeof code === 'string' && Object.prototype.hasOwnProperty.call(SUBJECT_LABELS, code));
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
  return await handleClassesInit(userId);
}

module.exports = {
  handleClassesInit,
  handleClassManagerDataExchange,
  handleClassManagerBack,
  // Exported for tests.
  normalizeSubjectSelection,
  classDisplay,
  currentSessionCode,
};
