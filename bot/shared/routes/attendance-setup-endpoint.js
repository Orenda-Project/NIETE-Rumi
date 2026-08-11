/**
 * Attendance — class setup Flow endpoint (data_exchange, encrypted).
 *
 * Screens: CLASS → ROSTER → REVIEW  (docs/flows/attendance-setup-flow.json)
 *
 * The whole point of this endpoint is ROSTER: the teacher pastes or types the
 * entire class in one box and we parse it server-side. The version this replaces
 * added one student per screen round-trip, which is why no class was ever
 * finished on this deployment.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { GRADES_DROPDOWN } = require('../config/registration-data');

// A paste is cheap to make enormous by accident (a whole school, a copied
// spreadsheet column). Cap it so one mis-paste cannot write thousands of rows;
// the REVIEW screen tells the teacher when the cap bit.
const MAX_ROSTER = 300;

// Session state for an in-flight setup, keyed by the Flow token (the user id).
// The Flow itself carries the class between screens; we only need to remember
// what CLASS chose while the teacher is on ROSTER.
const pending = new Map();

/** Academic year as "2026-2027", rolling in August (start of the school year). */
function getCurrentAcademicYear() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * Turn one pasted block into a clean, ordered, de-duped list of names.
 *
 * Handles what teachers actually paste: numbered registers ("1. Ayesha"),
 * bullets, Windows line endings from Excel, blank lines, and the same child
 * typed twice in different case.
 *
 * @param {string} raw
 * @returns {string[]}
 */
function parseRoster(raw) {
  if (!raw || typeof raw !== 'string') return [];

  const seen = new Set();
  const names = [];

  for (const line of raw.split(/\r?\n/)) {
    let name = line.trim();
    if (!name) continue;

    // Leading list markers only — "1." / "2)" / "3 -" / "04." / "-" / "•" / "*".
    // Requires a separator after the digits so a name like "7up Khan" survives.
    name = name.replace(/^\s*(?:\d{1,3}\s*[.)\-:]|[-•*])\s*/, '').trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;          // keep the first spelling
    seen.add(key);
    names.push(name);

    if (names.length >= MAX_ROSTER) break;
  }

  return names;
}

/** Human label for a grade id, from the shared registration catalogue. */
function gradeLabel(id) {
  const g = GRADES_DROPDOWN.find((x) => x.id === id);
  return g ? g.title : id;
}

/**
 * INIT — build the grade picker.
 *
 * Teachers already told us which grades they teach at registration, so lead with
 * those (in curriculum order) and keep the rest reachable below. Asking the same
 * person the same question twice and accepting a worse answer is what the old
 * free-text field did.
 */
async function handleSetupInit(userId) {
  logToFile('📋 Class setup INIT', { userId });

  let taught = [];
  try {
    const { data } = await supabase
      .from('users')
      .select('grades_taught')
      .eq('id', userId)
      .single();
    if (Array.isArray(data?.grades_taught)) taught = data.grades_taught;
  } catch (error) {
    logToFile('⚠️ Could not read grades_taught; offering all grades', { userId, error: error.message });
  }

  const mine = GRADES_DROPDOWN.filter((g) => taught.includes(g.id));
  const rest = GRADES_DROPDOWN.filter((g) => !taught.includes(g.id));
  const grades = mine.length ? [...mine, ...rest] : [...GRADES_DROPDOWN];

  const grade_hint = mine.length
    ? `You told us you teach ${mine.map((g) => g.title).join(' and ')}.`
    : 'Pick the class you want to take attendance for.';

  return { screen: 'CLASS', data: { grades, grade_hint } };
}

/** CLASS submitted → remember it, move to the roster paste. */
async function handleClassSubmit(userId, screenData) {
  const grade = screenData?.grade;
  const section = (screenData?.section || '').trim();

  if (!grade) {
    return {
      screen: 'CLASS',
      data: { ...(await handleSetupInit(userId)).data, grade_hint: 'Please choose a class first.' },
    };
  }

  const class_display = section ? `${gradeLabel(grade)} - ${section}` : gradeLabel(grade);
  pending.set(userId, { grade, section, class_display });

  return {
    screen: 'ROSTER',
    data: {
      class_display,
      existing_note: 'Paste or type the whole list — one name per line.',
    },
  };
}

/** ROSTER submitted → parse, echo the result back, do NOT write yet. */
async function handleRosterSubmit(userId, screenData) {
  const names = parseRoster(screenData?.roster);
  const ctx = pending.get(userId) || {};

  if (!names.length) {
    return {
      screen: 'ROSTER',
      data: {
        class_display: ctx.class_display || '',
        existing_note: "I couldn't find any names in that. One name per line, then try again.",
      },
    };
  }

  pending.set(userId, { ...ctx, names });

  const preview = names.slice(0, 10).map((n, i) => `${i + 1}. ${n}`).join('\n');
  const more = names.length > 10 ? `\n…and ${names.length - 10} more` : '';
  const warning = names.length >= MAX_ROSTER
    ? `That is a very long list, so I kept the first ${MAX_ROSTER}. Add the rest later with "edit class".`
    : 'Wrong? Go back and paste the list again.';

  return {
    screen: 'REVIEW',
    data: {
      heading: `${names.length} students in ${ctx.class_display || 'this class'}`,
      preview: preview + more,
      warning,
    },
  };
}

/** REVIEW confirmed → write the class and its students. */
async function handleReviewConfirm(userId) {
  const ctx = pending.get(userId);
  if (!ctx?.names?.length) {
    return { screen: 'ROSTER', data: { class_display: '', existing_note: 'That list expired. Please paste it again.' } };
  }

  const { data: list, error: listError } = await supabase
    .from('student_lists')
    .insert({
      user_id: userId,
      class_name: gradeLabel(ctx.grade),
      section: ctx.section || null,
      academic_year: getCurrentAcademicYear(),
      student_count: ctx.names.length,
    })
    .select('id')
    .single();

  if (listError || !list) {
    logToFile('❌ Class insert failed', { userId, error: listError?.message });
    return {
      screen: 'REVIEW',
      data: {
        heading: 'Could not save the class',
        preview: 'Nothing was saved. Please tap Save again.',
        warning: '',
      },
    };
  }

  const rows = ctx.names.map((student_name, i) => ({
    list_id: list.id,
    student_name,
    roll_number: i + 1,
  }));

  const { error: studentsError } = await supabase.from('students').insert(rows);
  if (studentsError) {
    // The class exists but is empty — say so rather than reporting success.
    logToFile('❌ Student insert failed', { userId, listId: list.id, error: studentsError.message });
    return {
      screen: 'REVIEW',
      data: {
        heading: 'Saved the class, but not the students',
        preview: 'Say "edit class" to add them.',
        warning: '',
      },
    };
  }

  pending.delete(userId);
  logToFile('✅ Class created', { userId, listId: list.id, students: rows.length });

  return {
    screen: 'SUCCESS',
    data: {
      heading: `${ctx.class_display} is ready`,
      preview: `${rows.length} students saved. Say "attendance" whenever you want to mark them.`,
      warning: '',
    },
  };
}

async function handleSetupDataExchange(userId, screen, screenData) {
  logToFile('📋 Class setup data_exchange', { userId, screen });

  if (screen === 'CLASS') return handleClassSubmit(userId, screenData);
  if (screen === 'ROSTER') return handleRosterSubmit(userId, screenData);
  if (screen === 'REVIEW') return handleReviewConfirm(userId);

  logToFile('⚠️ Unknown class-setup screen', { userId, screen });
  return { screen: 'CLASS', data: (await handleSetupInit(userId)).data };
}

module.exports = {
  handleSetupInit,
  handleSetupDataExchange,
  parseRoster,
  getCurrentAcademicYear,
  MAX_ROSTER,
};
