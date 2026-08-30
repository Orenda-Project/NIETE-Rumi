'use strict';
/**
 * /roster Flow endpoint — SCHOOL → PHOTOS → CLASS → (WORKING) → REVIEW → SAVED.
 *
 * WHY THE SCREENS ARE IN THIS ORDER. Reading a register page takes about eight
 * seconds and Meta kills a data_exchange at roughly ten, so extraction cannot run
 * inside the submit that receives the photos. The PHOTOS submit therefore returns
 * immediately and starts the work in the background; the coach then spends ten or
 * fifteen seconds choosing grade and section, and by the time CLASS submits the
 * result is usually waiting. The class picker exists to buy that latency. When the
 * work is still running, CLASS routes to WORKING rather than stalling or failing.
 *
 * WHY REVIEW IS ONE EDITABLE SCREEN. Flows have no repeater, table or inline row
 * editing, and the attendance setup Flow already records what the alternative costs:
 * its predecessor asked for one student per screen round trip, so "a 40-student class
 * was 40 submissions to Meta and nobody ever finished one". A prefilled TextArea is
 * the only edit surface the platform offers, and the roster is chunked across six of
 * them to stay inside Meta's 600-character cap.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { isSchoolLeader } = require('../services/observe/observe-gate');
const { decryptMedia } = require('../services/roster/roster-media');
const { extractPages } = require('../services/roster/roster-extraction.service');
const { toChunks, parseChunk, reconcile, MAX_BOXES } = require('../services/roster/roster-lines');

// A register page is one class; a whole school is many /roster runs. Cap the paste
// surface so one mis-upload cannot write hundreds of rows.
const MAX_STUDENTS = 120;
// How long CLASS will wait for extraction before routing to WORKING instead.
const CLASS_WAIT_MS = 6000;

/**
 * In-flight state for one coach, keyed by the Flow token (their user id). The Flow
 * carries the class between screens; this only has to remember what cannot go in a
 * screen payload — the decrypted extraction and the identity of what we rendered.
 */
const pending = new Map();

const err = (message) => ({ data: { error: { message } } });

function getCurrentAcademicYear() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ---------------------------------------------------------------------------
// SCHOOL
// ---------------------------------------------------------------------------

/**
 * The schools this user may build a roster for. A coach gets their allocated
 * schools; a principal gets their own. Rows with no resolved school_id are skipped
 * — a class cannot hang off a school we cannot point at.
 */
async function schoolsFor(user) {
  if (user.role === 'principal' && user.school_id) {
    const { data } = await supabase
      .from('schools').select('id, name').eq('id', user.school_id).limit(1);
    return (data || []).map((s) => ({ id: s.id, title: (s.name || 'School').slice(0, 30) }));
  }

  const { data } = await supabase
    .from('leader_schools')
    .select('school_id, school_name')
    .eq('leader_user_id', user.id)
    .not('school_id', 'is', null)
    .limit(200); // Meta's Dropdown cap; coaches carry a median of 7

  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    if (seen.has(r.school_id)) continue;
    seen.add(r.school_id);
    // Dropdown chrome must stay Latin — Meta's list secondary text fails on Urdu script.
    out.push({ id: r.school_id, title: (r.school_name || 'School').slice(0, 30) });
  }
  return out;
}

async function handleRosterInit(userId) {
  const { data: user } = await supabase
    .from('users').select('id, role, school_id, first_name').eq('id', userId).maybeSingle();

  if (!user || !isSchoolLeader(user)) {
    return err('This is for coaches and school leaders.');
  }

  const schools = await schoolsFor(user);
  if (!schools.length) {
    return err('No schools are allocated to you yet. Ask your supervisor to add one.');
  }

  pending.set(userId, { user, startedAt: Date.now() });
  return { screen: 'SCHOOL', data: { schools } };
}

// ---------------------------------------------------------------------------
// PHOTOS — decrypt and extract in the background
// ---------------------------------------------------------------------------

async function runExtraction(state, pages) {
  const files = [];
  for (const p of pages) {
    try {
      const dec = await decryptMedia(p);
      files.push({ data: dec.data, mimeType: 'image/jpeg', fileName: dec.fileName });
    } catch (e) {
      logToFile('[roster] media decrypt failed', { error: e.message }, 'error');
    }
  }

  if (!files.length) {
    state.extraction = { students: [], problems: ['none of the photos could be opened'] };
    return;
  }

  const result = await extractPages(files);
  state.extraction = result;
  logToFile('[roster] extraction complete', {
    pages: files.length, students: result.students.length, problems: result.problems.length,
  });
}

async function handleRosterDataExchange(userId, screen, screenData = {}) {
  const state = pending.get(userId);
  if (!state) return err('That session expired. Send /roster again.');

  if (screen === 'SCHOOL') {
    state.schoolId = screenData.school_id;
    const { data: school } = await supabase
      .from('schools').select('name').eq('id', state.schoolId).maybeSingle();
    state.schoolName = (school && school.name) || 'This school';
    return {
      screen: 'PHOTOS',
      data: {
        school_name: state.schoolName.slice(0, 80),
        hint: 'One photo per register page, for ONE class. Get the whole name column in frame.',
      },
    };
  }

  if (screen === 'PHOTOS') {
    const pages = Array.isArray(screenData.pages) ? screenData.pages : [];
    if (!pages.length) return err('No photos came through. Try again.');

    state.extraction = null;
    state.extractionStarted = Date.now();
    // Do NOT await: Meta kills this call at ~10s and one page alone takes ~8.
    setImmediate(() => {
      runExtraction(state, pages).catch((e) => {
        state.extraction = { students: [], problems: [`extraction failed: ${e.message}`] };
        logToFile('[roster] extraction threw', { error: e.message }, 'error');
      });
    });

    const [{ data: grades }, { data: sections }] = await Promise.all([
      supabase.from('grade_levels').select('code, ordinal').eq('band', 'primary').order('ordinal'),
      supabase.from('sections').select('code').eq('is_active', true).order('sort_order'),
    ]);

    return {
      screen: 'CLASS',
      data: {
        grades: (grades || []).map((g) => ({ id: g.code, title: `Grade ${g.ordinal}` })),
        sections: (sections || []).map((s) => ({ id: s.code, title: s.code })),
        caption: 'Reading the register while you do this.',
      },
    };
  }

  if (screen === 'CLASS') {
    state.gradeCode = screenData.grade_code;
    state.section = screenData.section || null;
    state.teacherName = (screenData.teacher_name || '').trim() || null;
    return waitThenReview(state);
  }

  if (screen === 'WORKING') {
    return waitThenReview(state);
  }

  if (screen === 'REVIEW') {
    return saveRoster(state, screenData);
  }

  return err('Unexpected screen.');
}

// ---------------------------------------------------------------------------
// REVIEW
// ---------------------------------------------------------------------------

async function waitThenReview(state) {
  const deadline = Date.now() + CLASS_WAIT_MS;
  while (!state.extraction && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!state.extraction) {
    return {
      screen: 'WORKING',
      data: { message: 'Still reading the register. Give it a few seconds and tap again.' },
    };
  }

  const students = state.extraction.students.slice(0, MAX_STUDENTS).map((s, i) => ({
    // No id yet — nothing is written until the coach saves. keyOf() falls back to
    // the ordinal when a register carries no roll number.
    id: `new-${i}`,
    roll_number: s.roll_number,
    student_name: s.student_name,
    father_name: s.father_name,
  }));
  state.rendered = students;

  if (!students.length) {
    return err('No student names could be read from those photos. Try a closer, straighter photo.');
  }

  const { chunks, labels, visible, overflow } = toChunks(students);
  const classLabel = `Grade ${String(state.gradeCode || '').replace('grade_', '')}${state.section ? `-${state.section}` : ''}`;

  const notes = [`${classLabel}. Fix any name that is wrong, then save.`];
  if (overflow) notes.push(`${overflow} more did not fit — run /roster again for the rest.`);
  if (state.extraction.problems.length) notes.push(state.extraction.problems[0]);

  const data = {
    heading: `${students.length} students found`,
    note: notes.join(' ').slice(0, 400),
  };
  for (let i = 0; i < MAX_BOXES; i += 1) {
    data[`chunk${i + 1}`] = chunks[i];
    data[`label${i + 1}`] = labels[i];
    if (i > 0) data[`show${i + 1}`] = visible[i];
  }
  return { screen: 'REVIEW', data };
}

// ---------------------------------------------------------------------------
// SAVE
// ---------------------------------------------------------------------------

async function saveRoster(state, screenData) {
  const edits = [];
  for (let i = 1; i <= MAX_BOXES; i += 1) {
    edits.push(...parseChunk(screenData[`chunk${i}`]));
  }
  const diff = reconcile(state.rendered || [], edits);

  // Everything is "added" on a first run — nothing was written before REVIEW.
  const finalList = edits.map((e) => ({
    roll_number: e.roll,
    student_name: e.student_name,
    father_name: e.father_name,
  })).filter((s) => s.student_name).slice(0, MAX_STUDENTS);

  if (!finalList.length) return err('The list came back empty. Nothing was saved.');

  const saved = await persist(state, finalList);
  if (saved.error) {
    logToFile('[roster] save failed', { error: saved.error }, 'error');
    return err(saved.message || 'Could not save the roster. Nothing was changed.');
  }

  const classLabel = `Grade ${String(state.gradeCode || '').replace('grade_', '')}${state.section ? `-${state.section}` : ''}`;
  logToFile('[roster] saved', {
    classId: saved.classId, students: finalList.length,
    corrected: diff.updated.length, added: diff.added.length, removed: diff.removed.length,
  });

  return {
    screen: 'SAVED',
    data: {
      heading: `${classLabel} saved`,
      body: `${finalList.length} students are on the roster.`,
      extension_message_response: {
        params: { roster_action: 'saved', roster_class: classLabel, roster_count: String(finalList.length) },
      },
    },
  };
}

/**
 * Write the class and its enrollments.
 *
 * Deliberately additive and idempotent: the class is looked up before it is created,
 * and a student already enrolled at the same roll number is left alone. Re-running
 * /roster on the same register must be a no-op, because someone will do it.
 */
async function persist(state, students) {
  const sessionCode = getCurrentAcademicYear();

  // classes is unique on (school_id, grade_code, section, session_code), so this is
  // the natural lookup. Section is nullable, and `.eq(col, null)` does NOT match a
  // NULL in PostgREST — it has to be `.is()`, which is why this is branched rather
  // than built with a ternary inside one call.
  let q = supabase
    .from('classes')
    .select('id')
    .eq('school_id', state.schoolId)
    .eq('grade_code', state.gradeCode)
    .eq('session_code', sessionCode)
    .eq('is_active', true);
  q = state.section ? q.eq('section', state.section) : q.is('section', null);

  const { data: existing } = await q.limit(1);
  let classId = existing && existing[0] && existing[0].id;

  if (!classId) {
    const { data: created, error } = await supabase
      .from('classes')
      .insert({
        school_id: state.schoolId,
        grade_code: state.gradeCode,
        section: state.section,
        session_code: sessionCode,
        shift_code: 'morning',
        created_by_user_id: state.user.id,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) return { error: error.message, message: 'That class could not be created.' };
    classId = created.id;
  }

  const { data: alreadyIn } = await supabase
    .from('class_enrollments')
    .select('roll_number')
    .eq('class_id', classId)
    .eq('is_active', true);
  const taken = new Set((alreadyIn || []).map((r) => String(r.roll_number || '')));

  let written = 0;
  for (const s of students) {
    if (s.roll_number && taken.has(String(s.roll_number))) continue;

    const { data: student, error: sErr } = await supabase
      .from('students')
      .insert({
        student_name: s.student_name,
        father_name: s.father_name,
        roll_number: s.roll_number,
        enrolled_by_user_id: state.user.id,
        is_active: true,
      })
      .select('id')
      .single();
    if (sErr) return { error: sErr.message, message: 'A student could not be saved.' };

    const { error: eErr } = await supabase.from('class_enrollments').insert({
      class_id: classId,
      student_id: student.id,
      roll_number: s.roll_number,
      enrolled_on: new Date().toISOString().slice(0, 10),
      is_active: true,
    });
    if (eErr) return { error: eErr.message, message: 'A student could not be enrolled.' };
    written += 1;
  }

  return { classId, written };
}

module.exports = {
  handleRosterInit,
  handleRosterDataExchange,
  MAX_STUDENTS,
  CLASS_WAIT_MS,
  _pending: pending,
};
