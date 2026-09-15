'use strict';
/**
 * /roster Flow endpoint — SCHOOL → PHOTOS → CLASS → (WORKING) → REVIEW → SAVED,
 * with a search side-path off SCHOOL. A school already scanned shows SCHOOL_STATUS
 * first, and from there a saved class opens ROSTER_VIEW, which offers the
 * students editor (ROSTER_EDIT), the class-teacher picker (CLASS_TEACHER) and the
 * class-details editor (CLASS_DETAILS → CLASS_MERGE when the target class exists).
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
const { SHIFT_LABELS } = require('../config/ux-strings');
const { decryptMedia } = require('../services/roster/roster-media');
const { extractPages } = require('../services/roster/roster-extraction.service');
const { toChunks, parseChunk, reconcile, pairMoves, renderList, MAX_BOXES } = require('../services/roster/roster-lines');
const rosterStorage = require('../services/roster/roster-storage');
const ClassService = require('../services/classes/class.service');

/** Classes counted for one school's coverage screen. Real max today is 24. */
const CLASS_CAP = 300;
/** Count requests in flight at once — the SCHOOL screen is a ~10s data_exchange. */
const COUNT_CONCURRENCY = 8;
/** A class register beyond this is not a register; the read is bounded either way. */
const CLASS_ROSTER_CAP = 1000;

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

/**
 * A class's identity is (school, grade, SECTION, SHIFT, session) — ClassService is
 * idempotent on exactly that tuple. This screen used to send three of the five: no
 * shift at all, and an optional section. The two it did not send were filled by
 * defaults the coach never saw, so a class whose teacher had registered it as
 * evening (or with no section) became a SECOND row: the coach's row held the
 * children, the teacher's row held nobody, and both were correct to every query we
 * run. Measured before the fix: 11,647 children created by a scan, 11,356 active
 * enrolments, 100% of them morning — not one scanned child in any of the 22 evening
 * classes, because /roster could not produce one.
 */
const DEFAULT_SHIFT = 'morning';
/** No section is a real answer — 69 active classes have none. It has to be sayable. */
const NO_SECTION = 'none';

/**
 * bd-dz6qb.5 — the consequence, said where the choice is made.
 *
 * WhatsApp caps, in CODE POINTS: a Dropdown option title is 30, helper-text is 80.
 * Gender-neutral by rule: a teacher is never "she" or "her" in any copy we ship.
 */
const TEACHER_SKIP_TITLE = 'Not listed \u2014 no attendance';
const TEACHER_HELP = 'Without a class teacher, nobody can mark attendance for these children.';
/** The hand-over picker's escape: leaving is a real answer, and it writes nothing. */
const TEACHER_KEEP_TITLE = 'Not listed \u2014 leave as is';
/** The mark a teacherless class carries in the status list (a Dropdown title is 30 code points). */
const NO_TEACHER_MARK = '\u26a0 ';

/** English, like every other label on this Flow, but keyed off the ONE label map. */
const shiftTitle = (code) => (SHIFT_LABELS[code] && SHIFT_LABELS[code].en) || code;

/**
 * The codes in a small closed reference table, in seeded order. Read from the table
 * rather than hardcoded so the picker cannot drift from what the foreign key will
 * accept — and so /roster offers the coach exactly what /class offers the teacher.
 * If those two lists ever differ, this bug comes straight back.
 */
async function listSeeded(table) {
  const { data, error } = await supabase
    .from(table).select('code, sort_order').eq('is_active', true);
  if (error || !data) {
    logToFile(`\u26a0\ufe0f roster: ${table} load failed`, { error: error && error.message });
    return [];
  }
  return [...data].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((r) => r.code);
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
async function teachersFor(user, schoolId, skip = opt('none', TEACHER_SKIP_TITLE)) {
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
      .from('users').select('id, phone_number, name').in('phone_number', phones);
    const byPhone = new Map((accounts || []).map((u) => [u.phone_number, u]));
    for (const t of mapped || []) {
      const u = byPhone.get(t.teacher_phone_e164);
      if (u && !byId.has(u.id)) byId.set(u.id, t.teacher_name || fullName(u));
    }
  }

  const { data: atSchool } = await supabase
    .from('users')
    .select('id, role, name')
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

  // ALWAYS offer the way out. The Flow field is REQUIRED (rev 3 of the asset):
  // WhatsApp prints "(Optional)" beside any non-required field, and coaches read
  // the one choice that decides attendance as the one they could skip. Required
  // means the coach must say something — and because class_teachers.teacher_user_id
  // is a NOT NULL foreign key onto users, a real class teacher who has never
  // registered still cannot be offered at all. This option is what keeps such a
  // class saveable: it is the sayable "no", mapped to a null class teacher below.
  //
  // Skipping is not FREE or SILENT either. Across 373 saved scans a teacher was
  // named 311 times and written 311 times — the assignment has never once been
  // refused. The 45 classes and 1,526 children sitting unreachable today are all
  // classes where nobody touched what was then an optional field, and two coaches
  // are at 0% named across every run they have ever saved. So the option itself
  // carries the cost.
  return [...list, skip];
}

function fullName(u) {
  return (u.name || '').trim();
}

async function handleRosterInit(userId) {
  const { data: user } = await supabase
    .from('users').select('id, role, school_id, name').eq('id', userId).maybeSingle();

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

    // A school she has already scanned shows its status first — what is done, what
    // of grades 1-5 is missing, and the rosters she can open. A school with nothing
    // scanned keeps the old zero-friction path straight to the camera.
    const status = await schoolStatus(state).catch((e) => {
      logToFile('[roster] status build failed — falling through to camera', { error: e.message }, 'error');
      return null;
    });
    if (status) return status;
    return toPhotosResponse(state);
  }

  if (screen === 'SCHOOL_STATUS') {
    const action = String(screenData.next_action || '');
    if (action === 'scan') return toPhotosResponse(state);
    if (action.startsWith('open:')) return openRosterView(state, action.slice(5));
    return stop('Nothing was chosen. Close this and send /roster again.');
  }

  if (screen === 'ROSTER_VIEW') {
    // The choice travels as `next_step`. It was first named `action`, and on real
    // phones that key never arrived — the Flow envelope owns `action`, so every
    // production submit logged screenDataKeys: [] and every option opened the editor
    // (bd-3e0v5; the same collision broke /class in b2c13f3e). `action` is still read
    // for a hand-built request, and a payload with neither is the pre-rev-3 asset,
    // whose only button meant "edit": all of those open the editor, as before.
    const action = String(screenData.next_step || screenData.action || 'edit');
    if (action === 'teacher') return toClassTeacherPicker(state);
    if (action === 'details') return toClassDetails(state);
    return openRosterEditor(state);
  }

  if (screen === 'CLASS_TEACHER') {
    return saveClassTeacher(state, screenData);
  }

  if (screen === 'CLASS_DETAILS') {
    return saveClassDetails(state, screenData);
  }

  if (screen === 'CLASS_MERGE') {
    return resolveClassMerge(state, screenData);
  }

  if (screen === 'ROSTER_EDIT') {
    return saveRosterEdits(state, screenData);
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

    const [{ data: grades }, sections, shifts, teachers] = await Promise.all([
      supabase.from('grade_levels').select('code, ordinal').eq('band', 'primary').order('ordinal'),
      listSeeded('sections'),
      listSeeded('shifts'),
      teachersFor(state.user, state.schoolId).catch(() => [opt('none', TEACHER_SKIP_TITLE)]),
    ]);

    return {
      screen: 'CLASS',
      data: {
        grades: (grades || []).map((g) => opt(g.code, `Grade ${g.ordinal}`)),
        // Section is now REQUIRED, so "no section" has to be an option rather than an
        // empty submit — otherwise a genuinely single-stream class cannot be saved at
        // all, and we would have traded one bug for a coach who is simply stuck.
        sections: [...sections.map((c) => opt(c, c)), opt(NO_SECTION, 'No section')],
        shifts: shifts.map((c) => opt(c, shiftTitle(c))),
        teachers,
        teacher_help: TEACHER_HELP,
        caption: 'Reading the register while you do this.',
      },
    };
  }

  if (screen === 'CLASS') {
    state.gradeCode = screenData.grade_code;
    const rawSection = screenData.section;
    state.section = rawSection && rawSection !== NO_SECTION ? rawSection : null;

    // BACK-COMPAT, decided deliberately. A payload with no shift_code is either a
    // session opened before the new Flow was published, or the old published Flow
    // still being served — and this is the ONLY code path a coach's scan can take.
    // Refusing the save would break /roster for everyone in that window, and it
    // would refuse AFTER the photos were taken. So the absent case keeps exactly
    // today's behaviour — morning — and is stamped `shift_source: 'default'` on the
    // state, in the log line and in the audit manifest, so the residual is countable
    // instead of invisible. Null here means "nobody chose", not "morning".
    const rawShift = screenData.shift_code;
    state.shiftCode = typeof rawShift === 'string' && rawShift.trim() ? rawShift.trim() : null;

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
  const base = `Grade ${String(state.gradeCode || '').replace('grade_', '')}${state.section ? `-${state.section}` : ''}`;
  // Only a non-default shift is named, the same rule /class renders by — otherwise
  // every label in the fleet grows a "(Morning)" that says nothing.
  const shift = state.shiftCode;
  return shift && shift !== DEFAULT_SHIFT ? `${base} (${shiftTitle(shift)})` : base;
}

function toPhotosResponse(state) {
  return {
    screen: 'PHOTOS',
    data: {
      school_name: String(state.schoolName || 'This school').slice(0, 80),
      hint: 'One photo per register page, for ONE class. Get the whole name column in frame.',
    },
  };
}

/**
 * How many active children each of these classes has — asked as a COUNT, never
 * read as a list.
 *
 * bd-p3bs1. This used to be one read of every active enrolment row for every
 * class at the school, tallied in JS. PostgREST answers at most 1,000 rows and
 * says nothing about the ones it dropped, so past 1,000 enrolments the tally
 * came from an arbitrary truncated slice: a class whose rows fell in the
 * discarded tail counted 0, was filtered out by the `> 0` test below, and
 * vanished from both the status list and the open-roster actions. Measured on
 * prod 2026-09-08: at ICG, F-6/2 (1,060 active enrolments, 24 classes) Grade 3-E
 * lost all 41 of its children and Grade 2-D showed 23 of 42.
 *
 * A count is not a list, so ask for the count. `head: true` + `count: 'exact'`
 * makes PostgREST answer in the Content-Range header and ship NO rows at all: it
 * is exact by construction, has no interaction with the row cap, and needs
 * neither ordering nor paging — there is no truncation to be silent about.
 *
 * Load math. Requests are bounded by CLASSES AT ONE SCHOOL (24 at the largest,
 * hard-capped at CLASS_CAP), not by enrolments — which is the number that grows.
 * Bytes drop from 1,060 rows x ~48 B = 51 KB and rising, to ~0. Each count is an
 * index-only scan on (class_id, is_active). gradeCoverage runs on the SCHOOL
 * screen and once per save, inside a data_exchange Meta kills at ~10s, so the
 * counts go out COUNT_CONCURRENCY at a time rather than one after another.
 */
async function enrollmentCounts(classIds) {
  const counts = new Map();
  for (let i = 0; i < classIds.length; i += COUNT_CONCURRENCY) {
    const batch = classIds.slice(i, i + COUNT_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const settled = await Promise.all(batch.map(async (id) => {
      const { count, error } = await supabase
        .from('class_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', id).eq('is_active', true);
      return { id, count, error };
    }));
    for (const r of settled) {
      // A failed count is NOT zero. Zero hides the class; leaving it unset means
      // the same, so the one thing that must not happen silently is logged.
      if (r.error) {
        logToFile('\u26a0\ufe0f roster coverage: enrolment count failed', {
          classId: r.id, error: r.error.message,
        });
        continue;
      }
      counts.set(r.id, r.count || 0);
    }
  }
  return counts;
}

/**
 * The coach-facing class label: "Grade 3-B", "Grade 3-B (Evening)". Only a
 * non-default shift is named — the same rule /class renders by — so twin classes
 * that differ only by shift stay tellable apart on every list here.
 */
function classLabel(ordinal, section, shiftCode) {
  const base = `Grade ${ordinal || '?'}${section ? `-${section}` : ''}`;
  return shiftCode && shiftCode !== DEFAULT_SHIFT ? `${base} (${shiftTitle(shiftCode)})` : base;
}

/** Which of these classes has an active class teacher — one read, not one per class. */
async function classTeacherIds(classIds) {
  if (!classIds.length) return new Set();
  const { data, error } = await supabase
    .from('class_teachers').select('class_id')
    .in('class_id', classIds).eq('is_active', true).eq('is_class_teacher', true)
    .limit(CLASS_CAP);
  if (error) {
    logToFile('\u26a0\ufe0f roster coverage: class-teacher read failed', { error: error.message });
    return new Set();
  }
  return new Set((data || []).map((r) => r.class_id));
}

/**
 * Which grades of 1-5 does this school have rosters for? The unit is the GRADE
 * (any section with children counts), because nothing tells us how many sections
 * a school runs — the status list shows each scanned class, so a coach who knows
 * there is a 1-B can see it missing herself.
 */
async function gradeCoverage(schoolId) {
  const { data: classes } = await supabase
    .from('classes').select('id, grade_code, section, shift_code, session_code, is_active')
    .eq('school_id', schoolId).eq('is_active', true)
    .order('grade_code', { ascending: true }).order('section', { ascending: true })
    .limit(CLASS_CAP);
  const ids = (classes || []).map((c) => c.id);
  if (ids.length >= CLASS_CAP) {
    logToFile('\u26a0\ufe0f roster coverage: class ceiling hit — some classes not counted', {
      schoolId, cap: CLASS_CAP,
    });
  }
  const counts = await enrollmentCounts(ids);
  const { data: grades } = await supabase
    .from('grade_levels').select('code, ordinal').eq('band', 'primary').order('ordinal');
  const ordinalOf = new Map((grades || []).map((g) => [g.code, g.ordinal]));
  const withTeacher = await classTeacherIds(ids);

  const done = (classes || [])
    .filter((c) => (counts.get(c.id) || 0) > 0)
    .map((c) => ({
      id: c.id,
      ordinal: ordinalOf.get(c.grade_code) || null,
      label: classLabel(ordinalOf.get(c.grade_code), c.section, c.shift_code),
      count: counts.get(c.id) || 0,
      // bd-dz6qb.5 (a): a class nobody is the class teacher of is invisible on
      // /class and /attendance. The coach has to be able to SEE that here, or the
      // only way to find the 19 such classes is to open every one.
      hasTeacher: withTeacher.has(c.id),
    }))
    .sort((a, b) => (a.ordinal || 99) - (b.ordinal || 99) || a.label.localeCompare(b.label));

  const doneOrdinals = new Set(done.map((c) => c.ordinal).filter((o) => o >= 1 && o <= 5));
  const missingOrdinals = [1, 2, 3, 4, 5].filter((o) => !doneOrdinals.has(o));
  return { done, doneOrdinals, missingOrdinals };
}

/** The completion nudge, appended to every confirmation. Best-effort by design. */
async function coverageLine(schoolId) {
  try {
    const cov = await gradeCoverage(schoolId);
    if (cov.doneOrdinals.size >= 5) {
      return '\n\nAll 5 grades are scanned at this school — it is complete. Thank you.';
    }
    const missing = cov.missingOrdinals.map((o) => `Grade ${o}`).join(', ');
    return `\n\nNow ${cov.doneOrdinals.size} of 5 grades scanned at this school — ${missing} remaining.`;
  } catch (e) {
    return '';
  }
}

async function schoolStatus(state) {
  const cov = await gradeCoverage(state.schoolId);
  if (!cov.done.length) return null;
  state.statusClasses = cov.done;

  const lines = [`Scanned ${cov.doneOrdinals.size} of 5 grades at this school.`, ''];
  cov.done.forEach((c) => lines.push(
    `\u2714 ${c.label} — ${c.count} ${c.count === 1 ? 'child' : 'children'}${c.hasTeacher ? '' : ' — no class teacher'}`,
  ));
  cov.missingOrdinals.forEach((o) => lines.push(`\u2022 Grade ${o} — not yet scanned`));
  const teacherless = cov.done.filter((c) => !c.hasTeacher).length;
  if (teacherless) {
    lines.push('', `${NO_TEACHER_MARK}${teacherless === 1 ? 'One class has' : `${teacherless} classes have`} no class teacher, so nobody can mark attendance there. Open the class to name one.`);
  }

  return {
    screen: 'SCHOOL_STATUS',
    data: {
      heading: String(state.schoolName).slice(0, 80),
      coverage_text: lines.join('\n').slice(0, 4000),
      nudge: 'A school is complete when every class of grades 1-5 has a roster.',
      actions: [
        opt('scan', 'Scan a new register'),
        // The count alone, no unit: the worst case — "⚠ Grade 3-B (Evening) · 48" — is
        // 26 code points, and "children" pushed "Grade 1-E (Evening) · 4 childr"
        // through the 30-point cap (seen live on the sandbox). One format for every
        // row; the coverage text above says "children" for all of them.
        ...cov.done.map((c) => opt(
          `open:${c.id}`,
          `${c.hasTeacher ? '' : NO_TEACHER_MARK}${c.label} \u00b7 ${c.count}`.slice(0, 30),
        )),
      ],
    },
  };
}

async function classLabelFor(state, cls) {
  const hit = (state.statusClasses || []).find((c) => c.id === cls.id);
  if (hit) return hit.label;
  const { data: grades } = await supabase
    .from('grade_levels').select('code, ordinal').eq('band', 'primary').order('ordinal');
  const ord = new Map((grades || []).map((g) => [g.code, g.ordinal])).get(cls.grade_code);
  return classLabel(ord, cls.section, cls.shift_code);
}

/** The class teacher of a class — { id, name } — or null when nobody holds the role. */
async function classTeacherOf(classId) {
  const { data: rows } = await supabase
    .from('class_teachers').select('teacher_user_id')
    .eq('class_id', classId).eq('is_active', true).eq('is_class_teacher', true).limit(1);
  const id = rows && rows[0] && rows[0].teacher_user_id;
  if (!id) return null;
  const { data: u } = await supabase.from('users').select('id, name').eq('id', id).maybeSingle();
  return { id, name: (u && fullName(u)) || 'the class teacher' };
}

/** A saved roster, read back from the database — identities kept for the editor. */
async function openRosterView(state, classId) {
  // CONTAINMENT. The class id arrives in a Flow payload, and a Flow already on a
  // handset can post back whatever it likes. The class must be at the school the
  // coach is working in — the endpoint's own state, never the payload's word.
  const { data: cls } = await supabase
    .from('classes').select('id, school_id, grade_code, section, shift_code, session_code, is_active')
    .eq('id', classId).maybeSingle();
  if (!cls || !cls.is_active || cls.school_id !== state.schoolId) {
    logToFile('\u26a0\ufe0f roster view: class refused — not at the chosen school', {
      classId, schoolId: state.schoolId, found: Boolean(cls),
    });
    return stop('That class is not at this school. Close this and send /roster again.');
  }

  const { data: enr } = await supabase
    .from('class_enrollments').select('student_id, roll_number')
    .eq('class_id', classId).eq('is_active', true)
    .order('roll_number', { ascending: true }).limit(CLASS_ROSTER_CAP);
  if (!enr || !enr.length) return stop('That roster is empty now. Close this and send /roster again.');
  if (enr.length >= CLASS_ROSTER_CAP) {
    logToFile('\u26a0\ufe0f roster view: class roster ceiling hit — the list shown is incomplete', {
      classId, cap: CLASS_ROSTER_CAP,
    });
  }

  const { data: kids } = await supabase
    .from('students').select('id, student_name, father_name')
    .in('id', enr.map((e) => e.student_id));
  const byId = new Map((kids || []).map((k) => [k.id, k]));

  const rows = enr
    .map((e) => {
      const k = byId.get(e.student_id) || {};
      return {
        id: e.student_id,
        roll_number: e.roll_number === null || e.roll_number === undefined ? null : e.roll_number,
        student_name: k.student_name || '',
        father_name: k.father_name || null,
      };
    })
    .filter((r) => r.student_name)
    .sort((a, b) => ((a.roll_number === null ? 999 : a.roll_number) - (b.roll_number === null ? 999 : b.roll_number))
      || a.student_name.localeCompare(b.student_name));

  const label = await classLabelFor(state, cls);
  const teacher = await classTeacherOf(classId);
  state.viewClass = {
    id: classId,
    label,
    schoolId: cls.school_id,
    gradeCode: cls.grade_code,
    section: cls.section || null,
    shiftCode: cls.shift_code || DEFAULT_SHIFT,
    sessionCode: cls.session_code,
    teacher,
  };
  state.viewRoster = rows;

  return {
    screen: 'ROSTER_VIEW',
    data: {
      heading: `${label} \u00b7 ${rows.length} ${rows.length === 1 ? 'child' : 'children'}`,
      // The one fact that decides whether these children have an attendance
      // register at all, said first.
      note: teacher
        ? `Class teacher: ${teacher.name}.`
        : 'No class teacher yet \u2014 nobody can mark attendance for these children.',
      roster_text: renderList(rows),
      actions: rosterViewActions(state),
    },
  };
}

/**
 * What a coach can do with a saved roster. A RadioButtonsGroup bound to data, so
 * this list — not the published asset — decides what is offered. Titles are 30
 * code points at most.
 */
function rosterViewActions(state) {
  const teacher = state.viewClass && state.viewClass.teacher;
  return [
    opt('edit', 'Correct the students'),
    opt('teacher', teacher ? 'Change the class teacher' : 'Set the class teacher'),
    opt('details', 'Change grade, section or shift'),
  ];
}

// ---------------------------------------------------------------------------
// CLASS_DETAILS → (CLASS_MERGE) — grade / section / shift of a saved class
// ---------------------------------------------------------------------------

/**
 * The details editor, pre-filled with the class as it is. The three pickers are
 * the CLASS screen's, read from the same reference tables, so this offers exactly
 * what a scan can produce. A class outside grades 1-5 keeps its own grade in the
 * list, or the pre-fill would point at an option that is not there.
 */
async function toClassDetails(state) {
  if (!state.viewRoster || !state.viewClass) {
    return stop('That session has expired. Close this and send /roster again.');
  }
  const [{ data: grades }, sections, shifts] = await Promise.all([
    supabase.from('grade_levels').select('code, ordinal').eq('band', 'primary').order('ordinal'),
    listSeeded('sections'),
    listSeeded('shifts'),
  ]);
  const gradeOpts = (grades || []).map((g) => opt(g.code, `Grade ${g.ordinal}`));
  if (!gradeOpts.some((g) => g.id === state.viewClass.gradeCode)) {
    const { data: own } = await supabase
      .from('grade_levels').select('code, ordinal').eq('code', state.viewClass.gradeCode).maybeSingle();
    gradeOpts.unshift(opt(state.viewClass.gradeCode, own ? `Grade ${own.ordinal}` : state.viewClass.gradeCode));
  }
  const n = state.viewRoster.length;
  state.pendingDetails = null;
  return {
    screen: 'CLASS_DETAILS',
    data: {
      heading: `${state.viewClass.label} \u00b7 ${n} ${n === 1 ? 'child' : 'children'}`.slice(0, 80),
      note: 'The children, their attendance history and the class teacher stay with the class.',
      grades: gradeOpts,
      sections: [...sections.map((c) => opt(c, c)), opt(NO_SECTION, 'No section')],
      shifts: shifts.map((c) => opt(c, shiftTitle(c))),
      grade_code: state.viewClass.gradeCode,
      section: state.viewClass.section || NO_SECTION,
      shift_code: state.viewClass.shiftCode || DEFAULT_SHIFT,
    },
  };
}

/** The identity the coach submitted, normalised the way the writer normalises it. */
function detailsFrom(screenData) {
  const rawSection = screenData.section;
  const rawShift = screenData.shift_code;
  return {
    gradeCode: String(screenData.grade_code || ''),
    section: rawSection && rawSection !== NO_SECTION ? String(rawSection).trim().toUpperCase() : null,
    shiftCode: typeof rawShift === 'string' && rawShift.trim() ? rawShift.trim() : DEFAULT_SHIFT,
  };
}

/** A coach-facing label for an identity, before the database has said anything. */
async function labelForDetails(d) {
  const { data: g } = await supabase
    .from('grade_levels').select('code, ordinal').eq('code', d.gradeCode).maybeSingle();
  return classLabel(g && g.ordinal, d.section, d.shiftCode);
}

function unchangedScreen(label, n, body) {
  return {
    screen: 'SAVED',
    data: {
      heading: `${label} unchanged`,
      body,
      roster_action: 'unchanged',
      roster_class: label,
      roster_count: String(n),
    },
  };
}

/**
 * The submit. Same identity → nothing written. A free target → renamed in place.
 * A target that exists → NOT merged: the coach is shown the existing class, its
 * child count, and asked (CLASS_MERGE). The merge itself only happens from there.
 */
async function saveClassDetails(state, screenData) {
  if (!state.viewRoster || !state.viewClass) {
    return stop('That session has expired. Close this and send /roster again.');
  }
  const wanted = detailsFrom(screenData);
  const cur = state.viewClass;
  const label = cur.label;
  const n = state.viewRoster.length;

  if (wanted.gradeCode === cur.gradeCode
      && (wanted.section || null) === (cur.section || null)
      && wanted.shiftCode === (cur.shiftCode || DEFAULT_SHIFT)) {
    return unchangedScreen(label, n, `Nothing was changed \u2014 ${label} stays as it is, ${n} children on the roster.`);
  }

  const res = await ClassService.changeClassDetails({
    classId: cur.id,
    schoolId: state.schoolId,
    gradeCode: wanted.gradeCode,
    section: wanted.section,
    shiftCode: wanted.shiftCode,
    actorUserId: state.user.id,
    merge: false,
  });
  if (res.error) {
    logToFile('[roster] class details refused', { classId: cur.id, wanted, error: res.error }, 'error');
    return stop(`${DETAILS_FAILURES[res.error] || 'The class could not be changed.'} Nothing was changed.`);
  }

  const newLabel = await labelForDetails(wanted);

  if (res.action === 'unchanged') {
    return unchangedScreen(label, n, `Nothing was changed \u2014 ${label} stays as it is, ${n} children on the roster.`);
  }

  if (res.action === 'collision') {
    // Never silently. Say which class, how many children, and ask.
    state.pendingDetails = { wanted, existingClassId: res.existingClassId, existingCount: res.existingCount, newLabel };
    const ec = res.existingCount || 0;
    return {
      screen: 'CLASS_MERGE',
      data: {
        heading: `${newLabel} already exists`,
        body: `${newLabel} is already saved at this school with ${ec} ${ec === 1 ? 'child' : 'children'}. `
          + `This class, ${label}, has ${n}.\n\n`
          + 'Keep both and change nothing, or merge this class into the existing one: '
          + `its ${n} children move across (a child already there is not doubled), and ${label} closes. Nothing is deleted.`,
        decisions: [
          opt('cancel', 'Keep both \u2014 change nothing'),
          opt('merge', 'Merge into the existing class'),
        ],
      },
    };
  }

  // renamed
  logToFile('[roster] class details changed', {
    classId: cur.id, from: { gradeCode: cur.gradeCode, section: cur.section, shiftCode: cur.shiftCode },
    to: wanted, mirrorsRenamed: res.mirrorsRenamed, by: state.user.id,
  });
  await rosterStorage.putManifest({
    schoolId: state.schoolId,
    runId: `details-${cur.id}-${Date.now()}`,
    manifest: {
      action: 'change_details', saved_at: new Date().toISOString(),
      school_id: state.schoolId, school_name: state.schoolName, class_id: cur.id,
      from: { grade_code: cur.gradeCode, section: cur.section, shift_code: cur.shiftCode, label },
      to: { grade_code: wanted.gradeCode, section: wanted.section, shift_code: wanted.shiftCode, label: newLabel },
      edited_by_user_id: state.user.id, result: res,
    },
  });
  state.viewClass = { ...cur, label: newLabel, gradeCode: wanted.gradeCode, section: wanted.section, shiftCode: wanted.shiftCode };
  return {
    screen: 'SAVED',
    data: {
      heading: `${newLabel} \u2014 details changed`,
      body: `${label} is now ${newLabel}. The ${n} children, their attendance history and the class teacher stayed with it.${await coverageLine(state.schoolId)}`,
      roster_action: 'details_changed',
      roster_class: newLabel,
      roster_count: String(n),
    },
  };
}

/** The coach's answer to the collision. Cancel writes nothing; merge writes once. */
async function resolveClassMerge(state, screenData) {
  const pend = state.pendingDetails;
  if (!state.viewRoster || !state.viewClass || !pend) {
    return stop('That session has expired, so nothing was merged. Close this and send /roster again to start again.');
  }
  const cur = state.viewClass;
  const label = cur.label;
  const n = state.viewRoster.length;
  const decision = String(screenData.decision || 'cancel');
  state.pendingDetails = null;

  if (decision !== 'merge') {
    return unchangedScreen(label, n, `Both classes were kept. Nothing was changed \u2014 ${label} stays as it is, ${n} children on the roster.`);
  }

  const res = await ClassService.changeClassDetails({
    classId: cur.id,
    schoolId: state.schoolId,
    gradeCode: pend.wanted.gradeCode,
    section: pend.wanted.section,
    shiftCode: pend.wanted.shiftCode,
    actorUserId: state.user.id,
    merge: true,
  });
  if (res.error) {
    logToFile('[roster] merge refused', { classId: cur.id, into: pend.existingClassId, error: res.error }, 'error');
    return stop(`${DETAILS_FAILURES[res.error] || 'The classes could not be merged.'} Nothing was changed.`);
  }
  if (res.action !== 'merged') {
    // The world moved between the question and the answer (the twin was closed,
    // or this class was). Say so rather than pretend.
    return stop('The other class changed while you were deciding, so nothing was merged. Send /roster again and open the class afresh.');
  }

  logToFile('[roster] classes merged', {
    sourceClassId: cur.id, targetClassId: res.targetClassId, moved: res.moved,
    closedDuplicates: res.closedDuplicates, teachersMoved: res.teachersMoved, by: state.user.id,
  });
  await rosterStorage.putManifest({
    schoolId: state.schoolId,
    runId: `merge-${cur.id}-${Date.now()}`,
    manifest: {
      action: 'merge_classes', saved_at: new Date().toISOString(),
      school_id: state.schoolId, school_name: state.schoolName,
      source_class_id: cur.id, source_label: label, target_class_id: res.targetClassId, target_label: pend.newLabel,
      edited_by_user_id: state.user.id, result: res,
    },
  });
  const tc = res.targetCount === null || res.targetCount === undefined ? (n + (pend.existingCount || 0) - res.closedDuplicates) : res.targetCount;
  const dup = res.closedDuplicates
    ? ` ${res.closedDuplicates} ${res.closedDuplicates === 1 ? 'child was' : 'children were'} already there and ${res.closedDuplicates === 1 ? 'was' : 'were'} not doubled.`
    : '';
  return {
    screen: 'SAVED',
    data: {
      heading: `Merged into ${pend.newLabel}`,
      body: `${res.moved} ${res.moved === 1 ? 'child' : 'children'} moved from ${label} into ${pend.newLabel}.${dup} ${pend.newLabel} now has ${tc} children. ${label} is closed, nothing was deleted.${await coverageLine(state.schoolId)}`,
      roster_action: 'merged',
      roster_class: pend.newLabel,
      roster_count: String(tc),
    },
  };
}

/** The hand-over picker: the school's registered teachers, plus leave-as-is. */
async function toClassTeacherPicker(state) {
  if (!state.viewRoster || !state.viewClass) {
    return stop('That session has expired. Close this and send /roster again.');
  }
  const teachers = await teachersFor(state.user, state.schoolId, opt('none', TEACHER_KEEP_TITLE))
    .catch(() => [opt('none', TEACHER_KEEP_TITLE)]);
  const current = state.viewClass.teacher;
  const n = state.viewRoster.length;
  return {
    screen: 'CLASS_TEACHER',
    data: {
      heading: `${state.viewClass.label} \u00b7 ${n} ${n === 1 ? 'child' : 'children'}`.slice(0, 80),
      current: current
        ? `Class teacher today: ${current.name}. Choosing someone else hands the class over to them.`
        : 'No class teacher yet. The teacher you name gets these children in their attendance list.',
      teachers,
      help: teachers.length > 1
        ? 'Only teachers with an account are listed. Add a missing teacher first, then come back.'
        : 'No registered teacher at this school yet. Add the teacher first, then come back.',
    },
  };
}

/** The hand-over itself, through the one writer. */
async function saveClassTeacher(state, screenData) {
  if (!state.viewRoster || !state.viewClass) {
    return stop('That session has expired. Close this and send /roster again.');
  }
  const label = state.viewClass.label;
  const n = state.viewRoster.length;
  const picked = screenData.teacher_user_id;
  if (!picked || picked === 'none') {
    return {
      screen: 'SAVED',
      data: {
        heading: `${label} unchanged`,
        body: `No class teacher was set. Nothing was changed \u2014 ${n} children on the roster, as before.`,
        roster_action: 'unchanged',
        roster_class: label,
        roster_count: String(n),
      },
    };
  }

  const res = await ClassService.handOverClass({
    classId: state.viewClass.id,
    schoolId: state.schoolId,
    teacherUserId: picked,
    actorUserId: state.user.id,
  });
  if (res.error) {
    logToFile('[roster] hand-over failed', {
      classId: state.viewClass.id, teacherUserId: picked, error: res.error,
    }, 'error');
    return stop(`${HAND_OVER_FAILURES[res.error] || 'The class teacher could not be set.'} Nothing was changed.`);
  }

  const { data: u } = await supabase.from('users').select('id, name').eq('id', picked).maybeSingle();
  const name = (u && fullName(u)) || 'The teacher';
  const previous = state.viewClass.teacher;
  logToFile('[roster] class handed over', {
    classId: state.viewClass.id,
    teacherUserId: picked,
    previousClassTeacherUserId: res.previousClassTeacherUserId,
    repointed: res.repointed,
    retiredMirrors: res.retiredMirrors,
    listAdopted: res.listAdopted,
    alreadyClassTeacher: res.alreadyClassTeacher,
    by: state.user.id,
  });
  await rosterStorage.putManifest({
    schoolId: state.schoolId,
    runId: `handover-${state.viewClass.id}-${Date.now()}`,
    manifest: {
      action: 'hand_over',
      saved_at: new Date().toISOString(),
      school_id: state.schoolId,
      school_name: state.schoolName,
      class_id: state.viewClass.id,
      class_label: label,
      class_teacher_user_id: picked,
      previous_class_teacher_user_id: res.previousClassTeacherUserId,
      edited_by_user_id: state.user.id,
      result: res,
    },
  });
  state.viewClass.teacher = { id: picked, name };

  const handed = res.alreadyClassTeacher
    ? `${name} was already the class teacher of ${label}.`
    : `${name} is now the class teacher of ${label}${previous && previous.id !== picked ? `, in place of ${previous.name}` : ''}.`;
  return {
    screen: 'SAVED',
    data: {
      heading: `${label} \u2014 class teacher set`,
      body: `${handed} The ${n} ${n === 1 ? 'child is' : 'children are'} in their attendance list now.${await coverageLine(state.schoolId)}`,
      roster_action: 'teacher_set',
      roster_class: label,
      roster_count: String(n),
    },
  };
}

function openRosterEditor(state) {
  if (!state.viewRoster || !state.viewClass) {
    return stop('That session has expired. Close this and send /roster again.');
  }
  state.editRunId = rosterStorage.newRunId();

  const { chunks, labels, helpers, visible, overflow } = toChunks(state.viewRoster);
  const notes = [`${state.viewClass.label}. Fix a name or roll, add a missing child on a new line, delete a line to remove.`];
  if (overflow) notes.push(`${overflow} more are on this roster than fit here.`);

  const data = {
    heading: `${state.viewRoster.length} children on this roster`,
    note: notes.join(' ').slice(0, 400),
    roster_text: renderList(state.viewRoster),
  };
  for (let i = 0; i < MAX_BOXES; i += 1) {
    data[`chunk${i + 1}`] = chunks[i];
    data[`label${i + 1}`] = labels[i];
    data[`help${i + 1}`] = helpers[i];
    if (i > 0) data[`show${i + 1}`] = visible[i];
  }
  return { screen: 'ROSTER_EDIT', data };
}

/** Up to three names for a coach-facing sentence; more than that just says how many. */
function namesOf(rows) {
  const names = rows.map((r) => String(r.student_name || '').trim()).filter(Boolean);
  if (names.length > 3) return `${names.length} children`;
  if (names.length <= 1) return names[0] || 'one child';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

async function saveRosterEdits(state, screenData) {
  if (!state.viewRoster || !state.viewClass || !state.editRunId) {
    return stop('That session has expired. Close this and send /roster again.');
  }
  const edits = [];
  for (let i = 1; i <= MAX_BOXES; i += 1) {
    edits.push(...parseChunk(screenData[`chunk${i}`]));
  }
  const diff = pairMoves(reconcile(state.viewRoster, edits));
  const label = state.viewClass.label;
  const total = diff.updated.length + diff.moved.length + diff.added.length + diff.removed.length;
  const coverage = await coverageLine(state.schoolId);

  // A child reconcile() could not place. She is NOT removed and her row is not
  // touched — guessing is what renamed a class and struck off the wrong child
  // (bd-a05gc) — so the only correct thing left is to say her name out loud and
  // let the coach fix it on a second pass.
  const kept = diff.unresolved || [];
  const keptLine = kept.length
    ? ` I could not tell which line belonged to ${namesOf(kept)}, so ${kept.length === 1 ? 'she is' : 'they are'} still on the roster — open the class again to correct ${kept.length === 1 ? 'her' : 'them'}.`
    : '';

  if (!total) {
    return {
      screen: 'SAVED',
      data: {
        heading: `${label} unchanged`,
        body: `Nothing was changed — ${state.viewRoster.length} children on the roster, as before.${keptLine}${coverage}`,
        roster_action: 'unchanged',
        roster_class: label,
        roster_count: String(state.viewRoster.length),
      },
    };
  }

  const res = await ClassService.applyRosterEdits({
    classId: state.viewClass.id,
    runId: state.editRunId,
    editedByUserId: state.user.id,
    updates: diff.updated,
    moves: diff.moved,
    adds: diff.added,
    removes: diff.removed.map((r) => ({ id: r.id })),
  });
  if (res.error) {
    logToFile('[roster] edit failed', { runId: state.editRunId, classId: state.viewClass.id, error: res.error }, 'error');
    return stop(`${IMPORT_FAILURES[res.error] || 'The changes could not be saved.'} Nothing was changed.`);
  }

  logToFile('[roster] edited', {
    runId: state.editRunId,
    classId: state.viewClass.id,
    updated: diff.updated.length,
    moved: diff.moved.length,
    added: diff.added.length,
    removed: diff.removed.length,
    unresolved: kept.length,
    replay: res.replay === true,
  });
  await rosterStorage.putManifest({
    schoolId: state.schoolId,
    runId: state.editRunId,
    manifest: {
      action: 'edit',
      run_id: state.editRunId,
      saved_at: new Date().toISOString(),
      school_id: state.schoolId,
      school_name: state.schoolName,
      class_id: state.viewClass.id,
      class_label: label,
      edited_by_user_id: state.user.id,
      diff: {
        updated: diff.updated,
        moved: diff.moved,
        added: diff.added,
        removed: diff.removed.map((r) => r.id),
        // Kept on purpose. An auditor asking "why is this child still here?"
        // needs the run that declined to guess about her.
        unresolved: kept.map((r) => r.id),
      },
      result: res,
    },
  });

  const parts = [];
  if (diff.updated.length) parts.push(`${diff.updated.length} corrected`);
  if (diff.moved.length) parts.push(`${diff.moved.length} roll ${diff.moved.length === 1 ? 'number' : 'numbers'} fixed`);
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  const now = state.viewRoster.length + diff.added.length - diff.removed.length;

  return {
    screen: 'SAVED',
    data: {
      heading: `${label} updated`,
      body: `${parts.join(', ')}. ${now} children on the roster.${keptLine}${coverage}`,
      roster_action: 'edited',
      roster_class: label,
      roster_count: String(now),
    },
  };
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

  // Fields that are not ON the review screen — the parent phone, the admission
  // number, the date of birth — are not the coach's job to re-check from here, so
  // they are carried across from what was extracted, matched on the line the
  // coach left in place (by roll; a line without a roll carries nothing).
  const extractedByRoll = new Map();
  (state.rendered || []).forEach((s) => {
    if (s.roll_number) extractedByRoll.set(String(s.roll_number), s);
  });

  const finalList = edits.map((e) => {
    const x = e.roll ? extractedByRoll.get(String(e.roll)) : null;
    return {
      roll_number: e.roll,
      student_name: e.student_name,
      father_name: e.father_name,
      parent_phone: (x && x.parent_phone) || null,
      admission_no: (x && x.admission_no) || null,
      date_of_birth: (x && x.date_of_birth) || null,
    };
  }).filter((s) => s.student_name).slice(0, MAX_STUDENTS);

  if (!finalList.length) return stop('The list came back empty, so nothing was saved.');

  // state.shiftCode is null when the payload carried none — see the CLASS branch.
  const shiftCode = state.shiftCode || DEFAULT_SHIFT;
  const shiftSource = state.shiftCode ? 'coach' : 'default';

  const saved = await ClassService.importRoster({
    runId: state.runId,
    schoolId: state.schoolId,
    gradeCode: state.gradeCode,
    section: state.section,
    shiftCode,
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
    shiftCode,
    shiftSource,
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
      shift_code: shiftCode,
      // 'coach' = chosen on the screen; 'default' = the payload carried no shift and
      // we fell back. Every class written under 'default' is a candidate for the
      // twin-merge repair, so it must be findable.
      shift_source: shiftSource,
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
        corrected: diff.updated,
        added: diff.added,
        removed: diff.removed.map((s) => s.student_name),
        unresolved: (diff.unresolved || []).map((s) => s.student_name),
      },
      write_result: {
        added: saved.added, skipped: saved.skipped, mirrored: saved.mirrored,
        class_teacher_assigned: saved.classTeacherAssigned, error: saved.error || null,
      },
    },
  });

  // Saying nothing when no teacher was named is how 45 classes and 1,526 children
  // came to sit unreachable. The positive was already said; the negative was not.
  const teacherLine = saved.classTeacherAssigned
    ? ' The class teacher can see them in their attendance now.'
    : ' No class teacher was named, so nobody can mark attendance for these children.'
      + ' Scan this class again and name one.';
  const skippedLine = saved.skipped ? ` ${saved.skipped} were already there.` : '';
  // The completion nudge: every save says how far this school is from all of 1-5.
  const coverage = await coverageLine(state.schoolId);
  // What the coach cares about is how many children are on the class roster now,
  // not how many rows this particular submit inserted — a re-scan that adds nobody
  // is a successful confirmation, not "0 students".
  const onRoster = (saved.added || 0) + (saved.skipped || 0);

  return {
    screen: 'SAVED',
    data: {
      heading: `${classLabel} saved`,
      body: `${onRoster} students are on the roster.${skippedLine}${teacherLine}${coverage}`,
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

/** Hand-over refusals a coach can read. Everything else is our bug and says so plainly. */
const HAND_OVER_FAILURES = {
  unknown_class: 'That class is no longer active.',
  wrong_school: 'That class is not at this school.',
  unknown_teacher: 'That teacher has no account yet.',
  not_a_teacher: 'A coach or principal cannot be named as the class teacher.',
  unknown_grade: 'That class has a grade this school does not use.',
  save_in_progress: 'This class is being saved right now — give it a minute and try again.',
  missing_actor: 'Your account could not be read. Send /roster again.',
};

/** Class-details refusals a coach can read. */
const DETAILS_FAILURES = {
  unknown_class: 'That class is no longer active.',
  wrong_school: 'That class is not at this school.',
  unknown_grade: 'That grade is not one this school uses.',
  unknown_section: 'That section is not set up for this school.',
  unknown_shift: 'That shift is not one this school uses.',
  save_in_progress: 'This class is being saved right now — give it a minute and try again.',
  missing_actor: 'Your account could not be read. Send /roster again.',
};

/** ClassService returns error VALUES; these are the sentences for the ones a coach can see. */
const IMPORT_FAILURES = {
  save_in_progress: 'This roster is already being saved — give it a minute, then check the class before scanning again.',
  unknown_grade: 'That grade is not one this school uses.',
  unknown_section: 'That section is not set up for this school.',
  unknown_shift: 'That shift is not one this school uses.',
  unknown_session: 'The school year is not set up yet.',
  no_students: 'The list came back empty, so nothing was saved.',
  missing_school: 'No school was chosen.',
  insert_failed: 'A student could not be saved.',
};

// Every write beneath these two entry points — the scan save, the edit save, and
// whatever the saved-roster screens gain next — is made ON BEHALF OF the coach
// whose id is the flow token. runAsActor puts that id on each request so the
// record_history trigger records a person, not the connection role (bd-a21ks).
// Wrapped here, at the boundary, so no service signature has to change.
const { runAsActor } = require('../utils/actor-context');

module.exports = {
  handleRosterInit: (userId) => runAsActor(userId, () => handleRosterInit(userId)),
  handleRosterDataExchange: (userId, screen, screenData) =>
    runAsActor(userId, () => handleRosterDataExchange(userId, screen, screenData)),
  // Exported for tests — the save is where the idempotency contract lives, and
  // the edit save is where a coach's delete becomes a closed enrolment.
  saveRoster,
  saveRosterEdits,
  teachersFor,
  MAX_STUDENTS,
  CLASS_WAIT_MS,
  _pending: pending,
};
