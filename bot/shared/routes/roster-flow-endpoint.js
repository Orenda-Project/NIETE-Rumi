'use strict';
/**
 * /roster Flow endpoint — SCHOOL → PHOTOS → CLASS → (WORKING) → REVIEW → SAVED,
 * with a search side-path off SCHOOL.
 *
 * WHY THE SCREENS ARE IN THIS ORDER. Reading a register page takes about eight
 * seconds and Meta kills a data_exchange at roughly ten, so extraction cannot run
 * inside the submit that receives the photos. The PHOTOS submit therefore returns
 * immediately and starts the work in the background; the coach then spends ten or
 * fifteen seconds choosing grade, section and class teacher, and by the time CLASS
 * submits the result is usually waiting. The class picker exists to buy that
 * latency. When the work is still running, CLASS routes to WORKING rather than
 * stalling or failing.
 *
 * WHY REVIEW IS ONE SCREEN. Flows have no repeater, table or inline row editing,
 * and the attendance setup Flow already records what the alternative costs: its
 * predecessor asked for one student per screen round trip, so "a 40-student class
 * was 40 submissions to Meta and nobody ever finished one". The whole class is
 * therefore READ in a TextBody, which flows down the screen, and EDITED in
 * prefilled TextAreas — a TextArea has no height property and no scrollbar, so a
 * coach reading a 40-name class through one saw four names and concluded that was
 * the whole extraction (field test, 2026-08-30).
 *
 * WHY THE WRITE GOES THROUGH ClassService. The first version wrote `classes`,
 * `students` and `class_enrollments` from here, which made this the fourth
 * independent writer of the students model and skipped the legacy `student_lists`
 * mirror. Sixteen children were correctly enrolled and the teacher who teaches that
 * class could not see one of them, because attendance reads the mirror. Everything
 * now goes through ClassService.importRoster, which owns that mirror.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { isSchoolLeader, LEADER_ROLES } = require('../services/observe/observe-gate');
const { decryptMedia } = require('../services/roster/roster-media');
const { extractPages } = require('../services/roster/roster-extraction.service');
const { toChunks, parseChunk, reconcile, renderList, MAX_BOXES } = require('../services/roster/roster-lines');
const rosterStorage = require('../services/roster/roster-storage');
const ClassService = require('../services/classes/class.service');

// A register page is one class; a whole school is many /roster runs. Cap the paste
// surface so one mis-upload cannot write hundreds of rows.
const MAX_STUDENTS = 120;
// How long CLASS will wait for extraction before routing to WORKING instead.
const CLASS_WAIT_MS = 6000;
// Meta's Dropdown cap. Coaches carry a median of 7 schools and 123 teachers.
const OPTION_CAP = 200;

/**
 * In-flight state for one coach, keyed by the Flow token (their user id). The Flow
 * carries the class between screens; this only has to remember what cannot go in a
 * screen payload — the decrypted extraction and the identity of what we rendered.
 */
const pending = new Map();

// Returning { data: { error } } from a data_exchange makes WhatsApp render its own
// generic "Something went wrong. Try again later." — the coach learns nothing and we
// get no field report worth having. Anything the coach can act on is therefore shown
// as TEXT on a real screen. err() is kept only for states that are genuinely our bug.
const err = (message) => ({ data: { error: { message } } });

/** A dead end the coach can read, on a screen that exists. */
const stop = (message) => ({
  screen: 'WORKING',
  data: { message: String(message).slice(0, 4000) },
});

function getCurrentAcademicYear() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** Dropdown chrome must stay Latin and short — Meta truncates and its list
 *  secondary text fails outright on Urdu script. */
const opt = (id, title) => ({ id: String(id), title: String(title || '').slice(0, 30) });

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
    return (data || []).map((s) => ({ id: s.id, title: s.name || 'School' }));
  }

  const { data } = await supabase
    .from('leader_schools')
    .select('school_id, school_name')
    .eq('leader_user_id', user.id)
    .not('school_id', 'is', null)
    .limit(500);

  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    if (seen.has(r.school_id)) continue;
    seen.add(r.school_id);
    out.push({ id: r.school_id, title: r.school_name || 'School' });
  }
  return out;
}

/**
 * The teachers a coach can name as the class teacher.
 *
 * ONLY people who have a Rumi account, because `class_teachers.teacher_user_id` is
 * a NOT NULL foreign key and because the whole point of naming her is that the
 * roster lands in HER attendance list. A teacher on the coach's patch who has never
 * registered cannot own either, so offering her would be a promise we cannot keep.
 *
 * Two sources, in order: the coach's own mapped patch (`leader_teachers`, matched to
 * accounts by phone), then anyone whose account already says they are at this
 * school. A principal has no patch, so the second source is what serves them.
 */
async function teachersFor(user, schoolId) {
  const byId = new Map();

  const { data: mapped } = await supabase
    .from('leader_teachers')
    .select('teacher_name, teacher_phone_e164, school_id')
    .eq('leader_user_id', user.id)
    .eq('school_id', schoolId)
    .limit(OPTION_CAP * 2);

  const phones = [...new Set((mapped || []).map((t) => t.teacher_phone_e164).filter(Boolean))];
  if (phones.length) {
    const { data: accounts } = await supabase
      .from('users').select('id, phone_number, first_name, last_name').in('phone_number', phones);
    const byPhone = new Map((accounts || []).map((u) => [u.phone_number, u]));
    for (const t of mapped || []) {
      const u = byPhone.get(t.teacher_phone_e164);
      if (u && !byId.has(u.id)) byId.set(u.id, t.teacher_name || fullName(u));
    }
  }

  const { data: atSchool } = await supabase
    .from('users')
    .select('id, first_name, last_name, role')
    .eq('school_id', schoolId)
    .limit(OPTION_CAP * 2);
  for (const u of atSchool || []) {
    // Coaches and principals are at the school too; they are not its class teachers.
    if (LEADER_ROLES.includes(u.role)) continue;
    if (!byId.has(u.id)) byId.set(u.id, fullName(u));
  }

  const list = [...byId.entries()]
    .filter(([, name]) => name && name.trim())
    .slice(0, OPTION_CAP - 1)
    .map(([id, name]) => opt(id, name));

  // Always offer the way out. A coach who cannot find the teacher must still be
  // able to save the register — the children matter more than the attribution.
  return [...list, opt('none', 'Not listed / skip')];
}

function fullName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
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

  const state = { user, schools, startedAt: Date.now() };
  pending.set(userId, state);
  return { screen: 'SCHOOL', data: { schools: schools.slice(0, OPTION_CAP).map((s) => opt(s.id, s.title)) } };
}

// ---------------------------------------------------------------------------
// PHOTOS — decrypt, store, and extract in the background
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

  // Store the pages BEFORE extraction and independently of it. The photo is the
  // evidence: if the model misreads a name, the only way to settle it later is to
  // look at the same pixels the model saw. Failures here are logged and ignored —
  // a bucket outage must not cost the coach her class.
  state.stored = [];
  for (let i = 0; i < files.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await rosterStorage.putPage({
      schoolId: state.schoolId, runId: state.runId, index: i, buffer: files[i].data,
    });
    if (res.ok) state.stored.push(res.key);
  }

  if (!files.length) {
    state.extraction = { students: [], problems: ['none of the photos could be opened'], raw: [] };
    return;
  }

  const result = await extractPages(files);
  state.extraction = result;
  logToFile('[roster] extraction complete', {
    runId: state.runId,
    pages: files.length,
    stored: state.stored.length,
    students: result.students.length,
    problems: result.problems.length,
  });
}

async function handleRosterDataExchange(userId, screen, screenData = {}) {
  const state = pending.get(userId);
  if (!state) return stop('That session has expired. Close this and send /roster again.');

  // The dropdown on SCHOOL and the dropdown on SCHOOL_RESULTS pick the same thing.
  if (screen === 'SCHOOL' || screen === 'SCHOOL_RESULTS') {
    if (!screenData.school_id || screenData.school_id === 'none') {
      return stop('No school was chosen. Close this and send /roster again.');
    }
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

  // The search filters the coach's OWN schools — the ones she may build a roster
  // for. Searching the whole universe would offer her schools she cannot write to.
  if (screen === 'SCHOOL_SEARCH') {
    const term = String(screenData.term || '').trim().toLowerCase();
    const all = state.schools || [];
    const hits = (term ? all.filter((s) => String(s.title).toLowerCase().includes(term)) : all)
      .slice(0, OPTION_CAP);
    return {
      screen: 'SCHOOL_RESULTS',
      data: {
        schools: hits.length
          ? hits.map((s) => opt(s.id, s.title))
          : [opt('none', 'No match — go back')],
      },
    };
  }

  if (screen === 'PHOTOS') {
    const pages = Array.isArray(screenData.pages) ? screenData.pages : [];
    if (!pages.length) return stop('No photos came through. Close this and try again.');

    state.extraction = null;
    state.runId = rosterStorage.newRunId();
    state.extractionStarted = Date.now();
    // Do NOT await: Meta kills this call at ~10s and one page alone takes ~8.
    setImmediate(() => {
      runExtraction(state, pages).catch((e) => {
        state.extraction = { students: [], problems: [`extraction failed: ${e.message}`], raw: [] };
        logToFile('[roster] extraction threw', { runId: state.runId, error: e.message }, 'error');
      });
    });

    const [{ data: grades }, { data: sections }, teachers] = await Promise.all([
      supabase.from('grade_levels').select('code, ordinal').eq('band', 'primary').order('ordinal'),
      supabase.from('sections').select('code').eq('is_active', true).order('sort_order'),
      teachersFor(state.user, state.schoolId).catch(() => [opt('none', 'Not listed / skip')]),
    ]);

    return {
      screen: 'CLASS',
      data: {
        grades: (grades || []).map((g) => opt(g.code, `Grade ${g.ordinal}`)),
        sections: (sections || []).map((s) => opt(s.code, s.code)),
        teachers,
        caption: 'Reading the register while you do this.',
      },
    };
  }

  if (screen === 'CLASS') {
    state.gradeCode = screenData.grade_code;
    state.section = screenData.section || null;
    const picked = screenData.teacher_user_id;
    state.classTeacherUserId = picked && picked !== 'none' ? picked : null;
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

function classLabelOf(state) {
  return `Grade ${String(state.gradeCode || '').replace('grade_', '')}${state.section ? `-${state.section}` : ''}`;
}

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
    // No id yet — nothing is written until the coach saves. A null roll_number is
    // rendered as '?' rather than as its position, so the coach can see which ones
    // the camera could not read and type them in.
    id: `new-${i}`,
    roll_number: s.roll_number,
    student_name: s.student_name,
    father_name: s.father_name,
    parent_phone: s.parent_phone || null,
  }));
  state.rendered = students;

  if (!students.length) {
    // Say WHY where we know why. The extractor records a per-page reason, and a coach
    // standing in a school can act on "the photo was too blurry" but not on a shrug.
    const why = (state.extraction.problems || [])[0];
    return stop(why
      ? `I could not read a student list from those photos.\n\n${why}\n\nClose this and send /roster again.`
      : 'I could not read any student names from those photos. Try a closer, straighter photo of the name column, then send /roster again.');
  }

  const { chunks, labels, helpers, visible, overflow } = toChunks(students);
  const classLabel = classLabelOf(state);

  const notes = [`${classLabel}. Read the list, fix anything wrong in the boxes, then save.`];
  if (overflow) notes.push(`${overflow} more did not fit — run /roster again for the rest.`);
  if (state.extraction.problems.length) notes.push(state.extraction.problems[0]);

  const data = {
    heading: `${students.length} students found`,
    note: notes.join(' ').slice(0, 400),
    // The readable copy. A TextArea cannot be made taller and has no scrollbar, so
    // the class is read here and only edited below.
    roster_text: renderList(students),
  };
  for (let i = 0; i < MAX_BOXES; i += 1) {
    data[`chunk${i + 1}`] = chunks[i];
    data[`label${i + 1}`] = labels[i];
    data[`help${i + 1}`] = helpers[i];
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

  // The parent phone is not on the review screen — it is not the coach's job to
  // check a number she cannot see on the page from here — so it is carried across
  // from what was extracted, matched on the line the coach left in place.
  const phoneByKey = new Map();
  (state.rendered || []).forEach((s) => {
    if (s.parent_phone && s.roll_number) phoneByKey.set(String(s.roll_number), s.parent_phone);
  });

  const finalList = edits.map((e) => ({
    roll_number: e.roll,
    student_name: e.student_name,
    father_name: e.father_name,
    parent_phone: e.roll ? (phoneByKey.get(String(e.roll)) || null) : null,
  })).filter((s) => s.student_name).slice(0, MAX_STUDENTS);

  if (!finalList.length) return stop('The list came back empty, so nothing was saved.');

  const saved = await ClassService.importRoster({
    runId: state.runId,
    schoolId: state.schoolId,
    gradeCode: state.gradeCode,
    section: state.section,
    sessionCode: getCurrentAcademicYear(),
    classTeacherUserId: state.classTeacherUserId,
    createdByUserId: state.user.id,
    students: finalList,
  });

  if (saved.error && !saved.added) {
    logToFile('[roster] save failed', { runId: state.runId, error: saved.error }, 'error');
    return stop(`${IMPORT_FAILURES[saved.error] || 'The roster could not be saved.'} Nothing was changed.`);
  }

  const classLabel = classLabelOf(state);
  logToFile('[roster] saved', {
    runId: state.runId,
    classId: saved.classId,
    students: finalList.length,
    added: saved.added,
    skipped: saved.skipped,
    corrected: diff.updated.length,
    addedByCoach: diff.added.length,
    removedByCoach: diff.removed.length,
    classTeacherAssigned: saved.classTeacherAssigned,
    mirrored: saved.mirrored,
  });

  // The audit record, beside the photos it describes. Everything an auditor needs
  // to ask "was this read correctly?" lives in the bucket — which is why this
  // feature adds no tables (root CLAUDE.md rule 15).
  await rosterStorage.putManifest({
    schoolId: state.schoolId,
    runId: state.runId,
    manifest: {
      run_id: state.runId,
      saved_at: new Date().toISOString(),
      school_id: state.schoolId,
      school_name: state.schoolName,
      class_id: saved.classId,
      class_label: classLabel,
      grade_code: state.gradeCode,
      section: state.section,
      session_code: getCurrentAcademicYear(),
      coach_user_id: state.user.id,
      class_teacher_user_id: state.classTeacherUserId,
      model: state.extraction && state.extraction.model,
      pages: state.stored || [],
      problems: (state.extraction && state.extraction.problems) || [],
      model_output: (state.extraction && state.extraction.raw) || [],
      shown_to_coach: state.rendered || [],
      saved_students: finalList,
      coach_edits: {
        corrected: diff.updated, added: diff.added, removed: diff.removed.map((s) => s.student_name),
      },
      write_result: {
        added: saved.added, skipped: saved.skipped, mirrored: saved.mirrored,
        class_teacher_assigned: saved.classTeacherAssigned, error: saved.error || null,
      },
    },
  });

  const teacherLine = saved.classTeacherAssigned
    ? ' The class teacher can see them in her attendance now.'
    : '';
  const skippedLine = saved.skipped ? ` ${saved.skipped} were already there.` : '';
  // What the coach cares about is how many children are on the class roster now,
  // not how many rows this particular submit inserted — a re-scan that adds nobody
  // is a successful confirmation, not "0 students".
  const onRoster = (saved.added || 0) + (saved.skipped || 0);

  return {
    screen: 'SAVED',
    data: {
      heading: `${classLabel} saved`,
      body: `${onRoster} students are on the roster.${skippedLine}${teacherLine}`,
      // FLAT, not nested. The first version put these inside an
      // extension_message_response whose `properties` were declared `{}`; Meta
      // dropped the whole sub-object, flow-type-detector answered 'unknown', and a
      // successful save was acknowledged with the catch-all reply.
      roster_action: 'saved',
      roster_class: classLabel,
      roster_count: String(onRoster),
    },
  };
}

/** ClassService returns error VALUES; these are the sentences for the ones a coach can see. */
const IMPORT_FAILURES = {
  save_in_progress: 'This roster is already being saved — give it a minute, then check the class before scanning again.',
  unknown_grade: 'That grade is not one this school uses.',
  unknown_section: 'That section is not set up for this school.',
  unknown_session: 'The school year is not set up yet.',
  no_students: 'The list came back empty, so nothing was saved.',
  missing_school: 'No school was chosen.',
  insert_failed: 'A student could not be saved.',
};

module.exports = {
  handleRosterInit,
  handleRosterDataExchange,
  // Exported for tests — the save is where the idempotency contract lives.
  saveRoster,
  teachersFor,
  MAX_STUDENTS,
  CLASS_WAIT_MS,
  _pending: pending,
};
