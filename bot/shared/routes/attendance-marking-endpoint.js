/**
 * Attendance — marking Flow endpoint (data_exchange, encrypted).
 *
 * Three ways in, one way through:
 *
 *   teacher, tapping    CLASS → DATE ─┐
 *   principal, tapping  STAFF_DATE ───┼→ MARK → LEAVE → CONFIRM → SAVED
 *   principal, by voice REVIEW ───────┘         (REVIEW joins at LEAVE)
 *
 * (docs/flows/attendance-marking-flow.json)
 *
 * ONE screen set serves both actors. A teacher marks students, a principal marks
 * their school's teachers; the only difference is which roster the INIT loads and
 * which write function CONFIRM calls. Two products became one interaction to
 * learn and one to maintain.
 *
 * WHY THREE ENTRY SCREENS. WhatsApp refuses to OPEN a Flow on a screen that has
 * incoming edges, and nothing forbids a Flow having several screens with
 * none. That is the whole reason STAFF_DATE exists as a near-duplicate of DATE: a
 * principal's register must start on the date, DATE has an incoming edge from CLASS,
 * so the staff path needs its own root. Collapsing them would put the class picker
 * back in front of a principal, which is precisely what removed.
 *
 * The tap-or-voice question is NOT a screen here any more. It is asked in chat by
 * the router, because a Flow cannot receive a voice note — the voice branch has to
 * be outside the Flow before it can start.
 *
 * flow_token carries the context:
 *   "<userId>"                            → CLASS      (teacher; the Flow picks the class)
 *   "<userId>:teacher:<schoolId>"         → STAFF_DATE (principal, tapping)
 *   "<userId>:teacher:<schoolId>:voice"   → REVIEW     (principal, after a voice note)
 *   "<userId>:student:<listId>"           → CLASS      (legacy; see handleMarkingInit)
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { markStudents, markTeachers, personName, loadStaffRoster } = require('../services/attendance-write.service');
const VoiceAttendance = require('../services/voice-attendance.service');
const ConversationState = require('../services/conversation-state.service');
const { rosterLabel } = require('../services/classes/roster-label');
const { deliverRegister } = require('../services/attendance-register-delivery.service');

// Above this many classes the inline radio list stops fitting a phone screen and the
// picker becomes a Dropdown instead. Chosen for the screen, not the platform: Meta
// allows 20 radio options and 200 dropdown options.
const RADIO_MAX = 5;

// Region timezone for the register date. Config-driven, never hardcoded per country.
const REGISTER_TIME_ZONE = process.env.REGION_TIME_ZONE || 'Asia/Karachi';

/**
 * Keeps a roster data-source well-formed when there is nobody on it.
 *
 * MARK, LEAVE and REVIEW each bind a CheckboxGroup to `${data.roster}`, and a
 * CheckboxGroup can render neither a MISSING data-source nor an EMPTY one. bd-2713
 * fixed the first half — the empty-roster branch had been answering with no roster
 * key at all — and left the second, so the branch written to say "no students in this
 * class yet" went on producing the same unrenderable screen it was meant to replace.
 * Reported again on 2026-08-28 at DATE → MARK for an empty class.
 *
 * The group is NOT hidden when this is the only entry. A `visible` guard was tried
 * and had to come out: MARK's Form carries exactly one control, so making it
 * conditional left the Footer's `${form.absent}` with nothing to resolve and the
 * submit silently never left the handset — the screen drew, the teacher ticked, and
 * pressing Continue did nothing (2026-08-28, WhatsApp Web). /class survives the same
 * guard because its Form always has a visible TextArea beside the checkbox.
 *
 * So the row is always drawn and simply says there is nobody yet. It is filtered out
 * of any submission — a Flow already delivered to a handset can post back anything —
 * and the heading and note above it say the same thing in full.
 */
const NO_ROSTER_OPTION = Object.freeze({ id: '__none__', title: 'Nobody on this list yet' });

/**
 * The two fields every roster-bearing screen needs, derived from one list.
 * @param {Array<{id:string,title:string,description?:string}>} rows
 */
function rosterPayload(rows) {
  const has = rows.length > 0;
  return { has_roster: has, roster: has ? rows : [NO_ROSTER_OPTION] };
}

/** Drop the placeholder from anything a screen sends back. */
function stripPlaceholder(ids) {
  return (ids || []).filter((id) => id !== NO_ROSTER_OPTION.id);
}

/**
 * In-flight marking state — in Postgres, because this process is not the only one.
 *
 * This was a module-level `Map` keyed by flow token. That works only if every screen
 * of a register lands on the SAME process, and staging alone runs three replicas
 * (three "Bot server started" inside two seconds) on top of ordinary restarts. When
 * the hop misses, every reader here falls back to renderClassScreen() — so the
 * teacher is thrown back to the class picker mid-register, and because CLASS has no
 * self-edge in the routing model, answering CLASS while already on CLASS is not a
 * legal transition and the button appears dead. Reported 2026-08-28 as "it goes back
 * to the date page, and Continue does nothing", intermittently, which is the shape of
 * a round-robin: one attempt in three completed.
 *
 * ConversationState is the store built for exactly this, and its own header says why
 * Redis was rejected for it — the NIETE Redis has no persistent volume, so a restart
 * dropped every in-flight conversation. Keyed on user id alone, so a teacher who is
 * interrupted still finds their register where they left it.
 *
 * THE ROSTER IS DELIBERATELY NOT STORED. It is re-read per screen from the same
 * (subject, targetId) the state does carry, which keeps the JSONB small — a 225-child
 * class is ~20KB that would otherwise be rewritten on every hop — and means a child
 * added or removed mid-register is reflected rather than frozen at CLASS. See
 * withRoster().
 */
const MARKING_FLOW = 'attendance_marking';

/** Long enough to walk a full class; short enough not to haunt the afternoon. */
const MARKING_TTL_SECONDS = 1800;

/**
 * One roster row for a CheckboxGroup.
 *
 * The roll number rides in the TITLE and there is no `description` key, which is not
 * cosmetic: WhatsApp WEB refuses to render a CheckboxGroup whose data-source items
 * carry `description`, while the phone renders it fine. Reported 2026-08-28 — the
 * register bounced from DATE back to the class picker on WhatsApp Desktop and worked
 * on the same account from a handset. Every payload that DID render on desktop had
 * two-key items: /class's remove list ({id, title}) and this flow's own empty-roster
 * placeholder. The only one that failed was the populated register, which was the
 * only one sending three.
 *
 * /class already had it right (class-manager-endpoint.js :: buildRosterScreen), so
 * this is the same row shape, cap included — item titles are a capped field and a
 * long name plus a roll prefix will exceed it.
 */
function rosterRow(p) {
  const roll = p.roll_number != null ? `${p.roll_number}. ` : '';
  const chars = [...`${roll}${personName(p)}`];
  return { id: p.id, title: chars.length <= 30 ? chars.join('') : `${chars.slice(0, 29).join('')}…` };
}

/**
 * The fields worth persisting — every one a scalar or a list of ids.
 * Anything derivable (people, label) is left out on purpose.
 */
function persistable(ctx) {
  return {
    userId: ctx.userId || null,
    subject: ctx.subject || null,
    targetId: ctx.targetId || null,
    date: ctx.date || null,
    absentIds: ctx.absentIds || [],
    leaveIds: ctx.leaveIds || [],
    leaveType: ctx.leaveType == null ? null : ctx.leaveType,
    voiceLeaveIds: ctx.voiceLeaveIds || [],
    // Display-only, and only the voice path sets them: the transcript REVIEW quotes
    // back and the names it could not place. Carried because saving this state
    // replaces the voice stash they came from.
    transcript: ctx.transcript || null,
    unmatched: ctx.unmatched || [],
  };
}

/** The register this teacher is in the middle of, or null. */
async function loadCtx(flowToken) {
  const { userId } = parseToken(flowToken);
  if (!userId) return null;
  const state = await ConversationState.getState(userId);
  // Scoped: a teacher parked in some other flow is not half-way through a register.
  if (!state || state.flow !== MARKING_FLOW) {
    // A miss is the whole reason a register bounces back to the class picker, and it
    // is otherwise indistinguishable from a normal start. Say which it was.
    logToFile('📋 Marking ctx MISS', { userId, foundFlow: state ? state.flow : null });
    return null;
  }
  return { ...state.payload, userId };
}

/** Remember it. Returns the ctx so call sites can chain as they did with the Map. */
async function saveCtx(flowToken, ctx) {
  const { userId } = parseToken(flowToken);
  const merged = { ...ctx, userId: ctx.userId || userId };
  await ConversationState.setState(userId, {
    flow: MARKING_FLOW,
    step: ctx.step || null,
    payload: persistable(merged),
    ttlSeconds: MARKING_TTL_SECONDS,
  });
  return merged;
}

/** Done with it. */
async function dropCtx(flowToken) {
  const { userId } = parseToken(flowToken);
  return ConversationState.clearState(userId, { flow: MARKING_FLOW });
}

/**
 * ctx plus the roster it refers to, read fresh.
 * Every screen that needs names or counts goes through here rather than trusting a
 * copy taken at CLASS.
 */
async function withRoster(ctx) {
  const { people, label } = await loadSubject(ctx);
  return { ...ctx, people, label };
}

/**
 * "<userId>" | "<userId>:<subject>:<targetId>[:<mode>]" → its parts.
 *
 * The target is OPTIONAL: the Flow's CLASS screen picks what to mark, so a TEACHER
 * opens with the bare user id. A principal always carries a composite token, because
 * their target is settled by their role before the Flow opens.
 *
 * The old student-composite shape still parses too. A Flow message already delivered
 * to a handset carries it, and a token the endpoint cannot read is a register the
 * teacher cannot open.
 */
function parseToken(flowToken) {
  const [userId, subject, targetId, mode] = String(flowToken || '').split(':');
  return {
    userId,
    subject: subject === 'teacher' ? 'teacher' : 'student',
    targetId: targetId || null,
    picked: Boolean(targetId),
    // 'voice' means an extraction is waiting to be reviewed. Anything else is a tap.
    mode: mode === 'voice' ? 'voice' : 'tap',
  };
}

/**
 * The register date in the REGION's timezone, not UTC.
 *
 * `new Date().toISOString()` is UTC, so for Pakistan (UTC+5) every register marked
 * before 05:00 local was being dated to the previous day — and prettyDate() then
 * formatted it in UTC too, so the screen agreed with the wrong date and nothing
 * looked amiss. Resolved from config rather than hardcoded, because region
 * behaviour is config-driven here and Tanzania/Yemen sit in different offsets.
 */
function regionToday(timeZone = REGISTER_TIME_ZONE) {
  // en-CA renders as YYYY-MM-DD, which is already the storage format.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

function todayISO() {
  return regionToday();
}

/**
 * The window a register may be dated into: today back to a term's worth of days.
 *
 * Shared by DATE, STAFF_DATE and REVIEW so the three cannot drift — an unbounded
 * past invites the typo that files a register in the wrong academic year, and a
 * future date is not a register at all.
 */
function dateBounds() {
  const today = regionToday();
  const min = new Date(`${today}T00:00:00Z`);
  min.setUTCDate(min.getUTCDate() - 90);
  return { min_date: min.toISOString().split('T')[0], max_date: today };
}

/**
 * Whatever the CalendarPicker sent → a YYYY-MM-DD this region recognises.
 *
 * Some clients return epoch millis as a string and others the ISO date; never trust
 * it to be one shape. Anything unreadable, and anything in the future, falls back to
 * today rather than failing the submit — the principal is mid-register.
 */
function readDate(raw) {
  const value = String(raw == null ? '' : raw);
  let date = regionToday();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = value;
  } else if (/^\d+$/.test(value)) {
    date = new Intl.DateTimeFormat('en-CA', {
      timeZone: REGISTER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Number(value)));
  }
  return date > regionToday() ? regionToday() : date;
}

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    // The ISO date is already region-local (regionToday), so it is formatted as a
    // bare calendar date. Re-applying a zone here would shift it a second time.
  });
}

/** The roster row, including the bridge to the canonical class. */
async function loadList(listId) {
  const { data } = await supabase
    .from('student_lists')
    .select('id, class_name, section, class_id')
    .eq('id', listId)
    .maybeSingle();
  return data || null;
}

/** Membership from the enrollment system: class_enrollments -> students. */
async function loadEnrolledRoster(classId) {
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id, roll_number')
    .eq('class_id', classId)
    .eq('is_active', true);

  if (!enrollments || !enrollments.length) return [];

  const { data: people } = await supabase
    .from('students')
    .select('id, student_name')
    .in('id', enrollments.map((e) => e.student_id));

  const nameById = new Map((people || []).map((p) => [p.id, p.student_name]));
  return enrollments
    .map((e) => ({ id: e.student_id, student_name: nameById.get(e.student_id), roll_number: e.roll_number }))
    .sort((a, b) => (a.roll_number ?? 1e9) - (b.roll_number ?? 1e9));
}

/** Membership from the legacy denormalised pointer. */
async function loadLegacyRoster(listId) {
  const { data } = await supabase
    .from('students')
    .select('id, student_name, roll_number')
    .eq('list_id', listId)
    .eq('is_active', true)
    .order('roll_number');
  return data || [];
}

/**
 * Who is in this class — enrollment first, legacy second.
 *
 * PREFER-THEN-FALL-BACK rather than a switch. `/class` owns rosters now, so
 * class_enrollments is the source of truth, but it is not populated yet and the
 * backfill has not run. A hard switch would read zero for every class, including
 * the 29 real students on production whose membership exists only as
 * students.list_id — a full class silently marked present. This ordering is
 * correct before, during, and after the backfill.
 *
 * Remove the fallback once class_enrollments is backfilled AND verified, not
 * before. (bd-2724)
 */
async function loadStudentRoster(listId, list = null) {
  const row = list || await loadList(listId);
  if (row && row.class_id) {
    const enrolled = await loadEnrolledRoster(row.class_id);
    if (enrolled.length) return enrolled;
  }
  return loadLegacyRoster(listId);
}

async function loadSchoolLabel(schoolId) {
  const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return data?.name || 'Your school';
}

/**
 * The teacher's classes, as Dropdown options.
 *
 * This is the screen that replaced the chat picker. Chat could offer 3 reply buttons
 * or 10 list rows TOTAL (whatsapp.service.js refuses more), so a teacher with 20
 * class-sections had 10 of them permanently unreachable. A Flow Dropdown takes 200.
 *
 * "My teachers" USED to be the first option here, because CLASS was the Flow's only
 * entry screen and there was nowhere else to put the staff path. STAFF_DATE is now a
 * second root, so a principal never arrives on this screen at all and staff is no
 * longer an option on it. Classes, and only classes.
 *
 * Option ids still carry the subject — "student:<listId>" — so the CLASS submit
 * handler's parser is unchanged and an in-flight Flow keeps working.
 */
async function loadMarkables(userId) {
  const { data: user } = await supabase
    .from('users').select('id, role, school_id').eq('id', userId).maybeSingle();

  const options = [];

  const { data: lists } = await supabase
    .from('student_lists')
    .select('id, class_name, section, class_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at');

  const counts = await rosterCounts(lists || []);
  for (const row of (lists || [])) {
    const n = counts.get(row.id) || 0;
    options.push({
      id: `student:${row.id}`,
      title: rosterLabel(row),
      description: n ? `${n} students` : 'No students yet',
    });
  }

  return { user, options };
}

/**
 * How many students each list has — in TWO reads, whatever the class count.
 *
 * This used to fetch every roster in FULL, one class at a time: 2 + 2N sequential
 * round trips just to render "3 students" beside each class. Measured on staging with
 * 3 classes that was 8 queries and ~2s inside Railway; at the 20 classes the Dropdown
 * exists to support it is 42 serial round trips (bd-2728).
 *
 * Same PREFER-THEN-FALL-BACK rule as loadStudentRoster(): enrollment wins, legacy
 * covers the classes the backfill has not reached. Counted here rather than queried
 * per class, so the two cannot drift apart.
 */
async function rosterCounts(lists) {
  const out = new Map();
  if (!lists.length) return out;

  const listIds = lists.map((l) => l.id);
  const classIds = lists.filter((l) => l.class_id).map((l) => l.class_id);

  const [enrolled, legacy] = await Promise.all([
    classIds.length
      ? supabase.from('class_enrollments').select('class_id').in('class_id', classIds).eq('is_active', true)
      : Promise.resolve({ data: [] }),
    supabase.from('students').select('list_id').in('list_id', listIds).eq('is_active', true),
  ]);

  const byClass = new Map();
  for (const r of (enrolled && enrolled.data) || []) {
    byClass.set(r.class_id, (byClass.get(r.class_id) || 0) + 1);
  }
  const byList = new Map();
  for (const r of (legacy && legacy.data) || []) {
    byList.set(r.list_id, (byList.get(r.list_id) || 0) + 1);
  }

  for (const l of lists) {
    const viaEnrollment = l.class_id ? (byClass.get(l.class_id) || 0) : 0;
    out.set(l.id, viaEnrollment || byList.get(l.id) || 0);
  }
  return out;
}

/** CLASS — pick what to mark. The Flow's entry screen. */
async function renderClassScreen(flowToken) {
  const { userId } = parseToken(flowToken);
  const { options } = await loadMarkables(userId);

  if (!options.length) {
    // Nothing to mark at all. Say so on the entry screen rather than opening a
    // register against nobody; the router normally intercepts this first.
    return {
      screen: 'CLASS',
      data: {
        heading: 'You do not have any classes yet',
        class_label: 'Class',
        classes: [],
      },
    };
  }

  return {
    screen: 'CLASS',
    data: {
      heading: 'Which class are we marking?',
      class_label: 'Class',
      classes: options,
      ...pickerFor(options.length),
    },
  };
}

/**
 * Radio buttons while they fit on a screen, a Dropdown once they do not.
 *
 * A Dropdown is a FIELD: it renders as one row the teacher taps, which opens a picker
 * sheet over the screen. Correct for twenty class-sections and one tap too many for
 * three — the classes are the only question on the screen, so they should BE the
 * screen. RadioButtonsGroup shows them inline; it caps at 20 options where a Dropdown
 * takes 200, and five is where a radio list stops fitting a phone without scrolling.
 *
 * Both controls live on the screen and exactly one is visible (`visible` on the
 * CHILDREN — Meta refuses to publish a Form that carries it).
 */
function pickerFor(count) {
  const useRadio = count > 0 && count <= RADIO_MAX;
  return { use_radio: useRadio, use_dropdown: !useRadio };
}

/**
 * CLASS submitted — remember the choice, then ask for the date.
 *
 * Reads whichever picker was showing. `class_id` is the pre-two-picker key and is
 * still accepted, because a Flow already open on a handset submits with it.
 */
async function handleClassSubmit(flowToken, screenData) {
  const d = screenData || {};
  const choice = String(d.class_radio || d.class_dropdown || d.class_id || '');
  const [subject, targetId] = choice.split(':');
  if (!targetId) {
    // Re-rendering CLASS in answer to CLASS is not a legal transition, so this reads
    // to the teacher as a dead button rather than as a re-ask.
    logToFile('📋 Marking CLASS choice unparsed', { keys: Object.keys(d), choice });
    return renderClassScreen(flowToken);
  }

  const { userId } = parseToken(flowToken);
  const resolved = subject === 'teacher' ? 'teacher' : 'student';
  await saveCtx(flowToken, { userId, subject: resolved, targetId });

  return renderDateScreen(flowToken);
}

/** DATE — any day up to today in the region's timezone. */
async function renderDateScreen(flowToken) {
  const ctx = await loadCtx(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const label = ctx.subject === 'teacher'
    ? await loadSchoolLabel(ctx.targetId)
    : rosterLabel(await loadList(ctx.targetId));

  return {
    screen: 'DATE',
    data: {
      heading: label,
      date_label: 'Date',
      ...dateBounds(),
      marked_note: 'Pick today, or any earlier day you missed.',
    },
  };
}

/**
 * DATE submitted — into the register.
 *
 * This used to ask HOW next. That question moved into chat: it is the
 * first thing to decide, not the third, and the voice half of it cannot be answered
 * from inside a Flow at all.
 */
async function handleDateSubmit(flowToken, screenData) {
  const ctx = await loadCtx(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  await saveCtx(flowToken, { ...ctx, date: readDate(screenData && screenData.register_date) });
  return renderMarkScreen(flowToken);
}

/**
 * STAFF_DATE — the principal's entry screen. Which day are we marking?
 *
 * A near-duplicate of DATE by NECESSITY, not by oversight: DATE has an incoming edge
 * from CLASS, and a Flow cannot be OPENED on a screen with incoming edges.
 * The staff path has to start somewhere, and this is that somewhere.
 */
async function renderStaffDateScreen(flowToken) {
  const { userId, targetId } = parseToken(flowToken);
  const existing = (await loadCtx(flowToken)) || {};
  const schoolId = existing.targetId || targetId;

  // Seed the context here rather than on submit: the date screen is the first thing
  // a principal sees, so this is where the register's identity is established.
  await saveCtx(flowToken, { ...existing, userId, subject: 'teacher', targetId: schoolId });

  return {
    screen: 'STAFF_DATE',
    data: {
      heading: await loadSchoolLabel(schoolId),
      date_label: 'Date',
      ...dateBounds(),
      marked_note: 'Pick today, or any earlier day you missed.',
    },
  };
}

/** STAFF_DATE submitted — straight into the register; there is no class to pick. */
async function handleStaffDateSubmit(flowToken, screenData) {
  const ctx = (await loadCtx(flowToken)) || {};
  if (!ctx.targetId) return renderStaffDateScreen(flowToken);

  await saveCtx(flowToken, { ...ctx, date: readDate(screenData && screenData.register_date) });
  return renderMarkScreen(flowToken);
}

/**
 * REVIEW — what the voice note said, pre-ticked, for the principal to check.
 *
 * The extraction is a SUGGESTION and this screen is where it earns its place: the
 * absentees arrive already selected, and the principal adds, removes or ignores them
 * before the ordinary LEAVE → CONFIRM → write path runs. Voice never writes a
 * register; it fills a form in.
 *
 * The heard transcript is shown verbatim. When a name could not be placed, saying so
 * is the difference between "it ignored Zubair" and "it heard Zubair and could not
 * find him" — the second is actionable, the first looks like a bug.
 */
async function renderReviewScreen(flowToken) {
  const { userId, subject, targetId } = parseToken(flowToken);
  // Saving the register's context replaces the voice stash — both live in the same
  // conversation-state row under different flow names, and setState does not merge.
  // So on a RE-render (a resubmit, or a handset reopening the Flow) the stash is
  // already gone, and reading only it would silently drop every pre-tick the voice
  // note earned. What was carried across at the first render is authoritative.
  const carried = (await loadCtx(flowToken)) || {};
  const stashed = Object.keys(carried).length
    ? {
      subject: carried.subject,
      targetId: carried.targetId,
      absentIds: carried.absentIds || [],
      leaveIds: carried.voiceLeaveIds || [],
      transcript: carried.transcript,
      unmatched: carried.unmatched,
    }
    : ((await VoiceAttendance.pendingResult(userId)) || {});
  // The token is authoritative — it is what the Flow was opened with. The stash is
  // the fallback for a token that predates carrying the subject.
  const ctx = {
    userId,
    subject: subject || stashed.subject || 'teacher',
    targetId: targetId || stashed.targetId || stashed.schoolId,
  };

  const { people, label } = await loadSubject(ctx);
  if (!people.length) return emptyRosterScreen(ctx.subject === 'teacher');

  const known = new Set(people.map((p) => p.id));
  const preselected = (stashed.absentIds || []).filter((id) => known.has(id));
  const leaveIds = (stashed.leaveIds || []).filter((id) => known.has(id) && !preselected.includes(id));

  await saveCtx(flowToken, {
    ...ctx,
    absentIds: preselected,
    voiceLeaveIds: leaveIds,
    transcript: stashed.transcript || null,
    unmatched: stashed.unmatched || [],
  });

  const unmatched = stashed.unmatched || [];
  const heard = stashed.transcript
    ? `Heard: "${String(stashed.transcript).slice(0, 220)}"`
    : 'I could not make out the voice note — tick the names instead.';
  const rosterWord = ctx.subject === 'teacher' ? 'staff list' : 'class list';

  return {
    screen: 'REVIEW',
    data: {
      heading: label,
      heard_note: heard,
      date_label: 'Date',
      ...dateBounds(),
      ...rosterPayload(people.map(rosterRow)),
      preselected,
      correction_note: unmatched.length
        ? `I could not find ${unmatched.join(', ')} on your ${rosterWord} — tick them by hand if they are away.`
        : 'Tap to add or remove anyone before saving.',
    },
  };
}

/** REVIEW submitted — the principal's taps win over the transcription, always. */
async function handleReviewSubmit(flowToken, screenData) {
  const stored = await loadCtx(flowToken);
  if (!stored) return renderReviewScreen(flowToken);

  // Re-read rather than trusting a roster copied at REVIEW: the ids coming back are
  // validated against it, so it has to be the roster as it is NOW.
  const ctx = await withRoster(stored);
  const known = new Set((ctx.people || []).map((p) => p.id));
  // Whatever came back from the screen IS the answer: a name the principal
  // un-ticked was un-ticked on purpose, and re-adding the voice's suggestion here
  // would silently overrule the correction this screen exists to collect.
  const absentIds = ((screenData && screenData.absent) || []).filter((id) => known.has(id));

  await saveCtx(flowToken, {
    ...ctx,
    date: readDate(screenData && screenData.register_date),
    absentIds,
  });

  // The voice may also have named people as being on leave. Those are offered on
  // the LEAVE screen as pre-existing knowledge rather than written from here.
  return renderLeaveScreen(flowToken);
}

/**
 * INIT — the Flow's entry point. Which of the three roots does this token mean?
 *
 * A Flow may only be OPENED on a screen with no incoming edges, so this
 * function may only ever answer CLASS, STAFF_DATE or REVIEW. Answering MARK or
 * CONFIRM earns
 *   invalid-screen-transition: The first screen -[X] ... already have incoming
 *   nodes found in the routing model
 * and strands the person mid-flow with their taps already spent. The
 * flow-screen-contract guard enforces this statically; it has caught it twice.
 *
 * An old STUDENT composite token deliberately does NOT skip ahead — its
 * target would be DATE, which has an incoming edge from CLASS. One extra tap on the
 * picker beats a Flow that cannot open.
 */
async function handleMarkingInit(flowToken) {
  const { userId, subject, targetId, picked, mode } = parseToken(flowToken);
  logToFile('📋 Marking INIT', { userId, subject, targetId, picked, mode });

  // A voice note has already been transcribed by the time this Flow opens, whoever
  // sent it — the extraction is waiting to be reviewed, and REVIEW is a root. This
  // comes FIRST so a student voice token reaches it too.
  if (picked && mode === 'voice') return renderReviewScreen(flowToken);

  if (subject === 'teacher' && picked) {
    // A principal's target is settled by their role before the Flow opens, so the
    // staff path has a legal root of its own and starts on the date.
    return renderStaffDateScreen(flowToken);
  }

  if (picked) logToFile('📋 Legacy composite token — entering at the picker', { userId, subject, targetId });
  return renderClassScreen(flowToken);
}

/**
 * Who this register covers, and what to call it — for EITHER subject.
 *
 * Extracted because three screens need the same answer (MARK, LEAVE and REVIEW) and
 * three copies of a two-branch switch is three chances for the register, the review
 * screen and the write to disagree about who is on the roster.
 */
async function loadSubject(ctx) {
  if (ctx.subject === 'teacher') {
    return { people: await loadStaffRoster(ctx.targetId, ctx.userId), label: await loadSchoolLabel(ctx.targetId) };
  }
  const listRow = await loadList(ctx.targetId);
  return { people: await loadStudentRoster(ctx.targetId, listRow), label: rosterLabel(listRow) };
}

/**
 * Nobody to mark — say what is missing and who can fix it, never a blank list.
 *
 * MARK, not CONFIRM: CONFIRM has incoming edges and answering it at INIT produced
 *   invalid-screen-transition: The first screen -[CONFIRM] ... already have
 *   incoming nodes found in the routing model
 * so the branch written to be graceful was the only one that hard-failed.
 * Reaching MARK by navigation is legal, which is why this is safe from any entry.
 *
 * `pending` keeps the context but no roster, so submitting re-renders this rather
 * than writing a register against nobody.
 */
function emptyRosterScreen(isTeacherSubject) {
  return {
    screen: 'MARK',
    data: {
      heading: isTeacherSubject ? 'No teachers listed for your school yet' : 'No students in this class yet',
      subject_note: isTeacherSubject
        ? 'Your NIETE coordinator needs to link staff to your school before you can mark them.'
        : 'Add students from /class, then mark attendance.',
      ...rosterPayload([]),
    },
  };
}

/** The register itself — roster loaded for whatever was picked. */
async function renderMarkScreen(flowToken) {
  const ctx = await loadCtx(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const isTeacherSubject = ctx.subject === 'teacher';
  const { people, label } = await loadSubject(ctx);

  if (!people.length) return emptyRosterScreen(isTeacherSubject);

  // KNOWN GAP — rosters over 20. WhatsApp caps a CheckboxGroup at 20 options and this
  // passes the whole roster, here and on the leave screen. Meta does not document what
  // happens at runtime when an endpoint sends more: a rejection strands the teacher
  // (bad, but safe), a silent truncation hides students past the 20th and — because
  // marking is by exception — records them PRESENT unseen (bad, and unsafe). Not yet
  // observed on a real handset, so neither should be assumed.
  //
  // Deliberately NOT capped here: a silent slice would GUARANTEE the unsafe outcome
  // instead of merely risking it. Pagination with an explicit "not reviewed"
  // confirmation is the agreed fix. It wanted this state in a shared store first,
  // which it now is (bd-2733). See docs/features/attendance.md.
  //
  // Re-saved rather than skipped so reaching the register refreshes the TTL — a
  // teacher part-way through a long roster has not gone idle.
  await saveCtx(flowToken, ctx);

  return {
    screen: 'MARK',
    data: {
      heading: `${label} · ${prettyDate(ctx.date)}`,
      subject_note: isTeacherSubject
        ? 'Tap the teachers who are absent. Leave is asked next.'
        : 'Tap the students who are absent. Leave is asked next.',
      ...rosterPayload(people.map(rosterRow)),
    },
  };
}

/**
 * MARK submitted — absentees recorded, then ask about leave SEPARATELY.
 *
 * Absent and leave used to be two CheckboxGroups over the same roster on this one
 * screen, so both listed every student and the same child could be ticked in both;
 * resolveStatuses() then arbitrated it at write time. Now the leave page is offered
 * the roster MINUS the absentees, so the overlap cannot be expressed (bd-2727).
 *
 * Nothing is written here. markStudents() derives every tally from the whole roster
 * in one call, so a partial write would store wrong counts — and a teacher who
 * abandoned the leave page would leave them wrong for good.
 */
async function handleMarkSubmit(flowToken, screenData) {
  const stored = await loadCtx(flowToken);
  if (!stored) return renderClassScreen(flowToken);
  const ctx = await withRoster(stored);

  // Nobody on the roster means there is no register to take. The footer submits like
  // any other screen, so without this the teacher walks an empty class straight
  // through LEAVE and CONFIRM into a saved register of nobody. emptyRosterScreen()
  // has always claimed this behaviour in its comment; it never had it.
  if (!ctx.people || !ctx.people.length) {
    return emptyRosterScreen(ctx.subject === 'teacher');
  }

  // Only ids that are actually on the roster. Guards the placeholder and a stale
  // handset naming somebody who has since left the class.
  const onRoster = new Set(ctx.people.map((p) => p.id));
  const absentIds = stripPlaceholder(screenData?.absent).filter((id) => onRoster.has(id));
  await saveCtx(flowToken, { ...ctx, absentIds });
  return renderLeaveScreen(flowToken);
}

/** LEAVE — only the students who were NOT marked absent. */
async function renderLeaveScreen(flowToken) {
  const stored = await loadCtx(flowToken);
  if (!stored) return renderClassScreen(flowToken);
  const ctx = await withRoster(stored);

  const absent = new Set(ctx.absentIds || []);
  const remaining = (ctx.people || []).filter((p) => !absent.has(p.id));
  const absentCount = absent.size;

  // A voice note can also have named people as being on leave. Offer that as a
  // pre-tick here rather than writing it: leave is a claim about WHY someone is
  // away, and a transcription is not evidence enough to record it unreviewed.
  const heardOnLeave = (ctx.voiceLeaveIds || []).filter((id) => !absent.has(id));

  return {
    screen: 'LEAVE',
    data: {
      heading: absentCount
        ? `${absentCount} marked absent`
        : 'Nobody marked absent',
      // Say what has already been decided, so the teacher is not re-deciding it.
      subject_note: `Everyone else is marked present. Tap anyone on approved leave instead — ${remaining.length} left to consider.`,
      // Everyone absent empties this list, which is a legitimate register and must
      // still walk on to CONFIRM — so the group is hidden, not the screen refused.
      ...rosterPayload(remaining.map(rosterRow)),
      preselected: heardOnLeave,
    },
  };
}

/** LEAVE submitted — a leave type only if anyone actually is. */
async function handleLeaveSubmit(flowToken, screenData) {
  const stored = await loadCtx(flowToken);
  if (!stored) return renderClassScreen(flowToken);
  const ctx = await withRoster(stored);

  // Intersect with what this page actually offered. A payload naming an absentee
  // cannot promote them onto the leave list.
  const absent = new Set(ctx.absentIds || []);
  const offered = new Set((ctx.people || []).filter((p) => !absent.has(p.id)).map((p) => p.id));
  const leaveIds = (screenData?.on_leave || []).filter((id) => offered.has(id));

  await saveCtx(flowToken, { ...ctx, leaveIds });

  // No leave TYPE step (bd-2729): the register is Present / Absent / Leave. Asking
  // casual-vs-sick-vs-official cost a screen on every marking run to record a
  // distinction nobody asked to report. leave_type/notes are written NULL, which the
  // write path already does for every non-leave row, so no schema change is needed —
  // and the service still accepts a type if the portal ever wants to set one.
  return await renderConfirm(flowToken, { ...ctx, leaveIds, leaveType: null });
}

/**
 * Is this class+date already on file, and with what?
 *
 * The write path always replaced correctly — one session per (class, date), records
 * deleted and re-inserted, was_manually_edited flipped. What was missing was telling
 * the teacher, so CONFIRM carried a static "Marked this day already?" caption on
 * every register whether or not one existed. A hedge shown always is read as
 * boilerplate and ignored (bd-2730).
 */
async function existingRegister(ctx) {
  if (ctx.subject === 'teacher') {
    const { data } = await supabase
      .from('teacher_attendance_records')
      .select('teacher_id, status, date')
      .eq('school_id', ctx.targetId)
      .eq('date', ctx.date);
    if (!data || !data.length) return null;
    const tally = { present: 0, absent: 0, leave: 0 };
    for (const r of data) if (tally[r.status] !== undefined) tally[r.status] += 1;
    return { ...tally, at: null };
  }

  const { data } = await supabase
    .from('attendance_sessions')
    .select('id, present_count, absent_count, leave_count, created_at')
    .eq('list_id', ctx.targetId)
    .eq('session_date', ctx.date)
    .eq('session_type', ctx.sessionType || 'full_day');
  const row = (data || [])[0];
  if (!row) return null;
  return {
    present: row.present_count || 0,
    absent: row.absent_count || 0,
    leave: row.leave_count || 0,
    at: row.created_at || null,
  };
}

/** "10:27" in the region's timezone, for "saved at ..." copy. */
function regionTime(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: REGISTER_TIME_ZONE, hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return null; }
}

/**
 * CONFIRM preview — names who is being marked BEFORE the write.
 * The old principal channel took typed coordinates and never named anyone back,
 * so one mistyped number silently marked the wrong colleague absent.
 */
async function renderConfirm(flowToken, ctx) {
  const away = new Set([...(ctx.absentIds || []), ...(ctx.leaveIds || [])]);
  const absentNames = ctx.people.filter((p) => (ctx.absentIds || []).includes(p.id)).map(personName);
  const leaveNames = ctx.people
    .filter((p) => (ctx.leaveIds || []).includes(p.id) && !(ctx.absentIds || []).includes(p.id))
    .map(personName);
  const present = ctx.people.length - away.size;

  const lines = [];
  if (absentNames.length) lines.push(`Absent: ${absentNames.join(', ')}`);
  if (leaveNames.length) lines.push(`On leave: ${leaveNames.join(', ')}`);
  if (!lines.length) lines.push('Everyone is present.');

  // Look before warning. An unconditional caption is boilerplate; a specific one,
  // naming what is about to be lost, is a decision the teacher can actually make.
  const prior = await existingRegister(ctx);
  let overwriteNote = '';
  if (prior) {
    const when = regionTime(prior.at);
    overwriteNote = `⚠️ Already marked for ${prettyDate(ctx.date)}`
      + (when ? ` at ${when}` : '')
      + ` — ${prior.present} present · ${prior.absent} absent · ${prior.leave} on leave.`
      + ' Saving replaces it.';
  }

  return {
    screen: 'CONFIRM',
    data: {
      heading: `${present} present · ${absentNames.length} absent · ${leaveNames.length} on leave`,
      detail: lines.join('\n'),
      overwrite_note: overwriteNote,
    },
  };
}

/** CONFIRM confirmed — write through the shared service. */
async function handleConfirmSubmit(flowToken) {
  const stored = await loadCtx(flowToken);
  const ctx = stored ? await withRoster(stored) : null;
  if (!ctx) {
    return {
      screen: 'CONFIRM',
      data: { heading: 'That session expired', detail: 'Say "attendance" to start again.', overwrite_note: '' },
    };
  }

  try {
    const result = ctx.subject === 'teacher'
      ? await markTeachers({
        principalUserId: ctx.userId, schoolId: ctx.targetId, date: ctx.date,
        staff: ctx.people, absentIds: ctx.absentIds, leaveIds: ctx.leaveIds, leaveType: ctx.leaveType,
      })
      : await markStudents({
        userId: ctx.userId, listId: ctx.targetId, date: ctx.date,
        roster: ctx.people, absentIds: ctx.absentIds, leaveIds: ctx.leaveIds, leaveType: ctx.leaveType,
      });

    await dropCtx(flowToken);
    // Whoever they are, the voice branch is finished the moment the register is saved.
    await VoiceAttendance.disarm(ctx.userId);

    const s = result.summary;

    // The cumulative register, AFTER the write, so the day just saved is in it.
    //
    // NOT awaited. Meta expects a data_exchange reply promptly, and this does xlsx
    // generation, an R2 put and a WhatsApp media upload — seconds of work that would
    // hold the SAVED screen hostage to three external services. The register is a
    // follow-up document, not part of the transaction: a failure here is logged and
    // the attendance is still saved, which is what SAVED is reporting.
    deliverRegister({
      userId: ctx.userId,
      subject: ctx.subject,
      targetId: ctx.targetId,
      date: ctx.date,
      roster: ctx.people,
      todayTally: s,
    }).catch((error) => logToFile('❌ Register delivery threw despite its own guard', {
      userId: ctx.userId, error: error.message,
    }, 'error'));

    const saved = result.replaced
      ? 'This replaced the record you saved earlier for the same day.'
      : 'Thank you — that is today done.';

    return {
      screen: 'SAVED',
      data: {
        heading: `Saved · ${s.present} present · ${s.absent} absent · ${s.leave} on leave`,
        detail: `${saved} Your register for the month is on its way to this chat.`,
        overwrite_note: '',
      },
    };
  } catch (error) {
    logToFile('❌ Marking confirm failed', { flowToken, error: error.message });
    return {
      screen: 'CONFIRM',
      data: { heading: 'Could not save', detail: error.message, overwrite_note: '' },
    };
  }
}

async function handleMarkingDataExchange(flowToken, screen, screenData) {
  logToFile('📋 Marking data_exchange', { screen });
  const answer = await dispatchMarking(flowToken, screen, screenData);
  // The missing half of this trace. Every report so far has been "it went back a
  // screen", and the incoming screen alone cannot show that — only what we sent can.
  logToFile('📋 Marking answered', { screen, answered: answer && answer.screen });
  return answer;
}

async function dispatchMarking(flowToken, screen, screenData) {
  if (screen === 'CLASS') return handleClassSubmit(flowToken, screenData);
  if (screen === 'DATE') return handleDateSubmit(flowToken, screenData);
  if (screen === 'STAFF_DATE') return handleStaffDateSubmit(flowToken, screenData);
  if (screen === 'REVIEW') return handleReviewSubmit(flowToken, screenData);
  if (screen === 'MARK') return handleMarkSubmit(flowToken, screenData);
  if (screen === 'LEAVE') return handleLeaveSubmit(flowToken, screenData);
  if (screen === 'CONFIRM') return handleConfirmSubmit(flowToken);
  return handleMarkingInit(flowToken);
}

module.exports = {
  handleMarkingInit,
  renderClassScreen,
  pickerFor,
  RADIO_MAX,
  renderStaffDateScreen,
  renderReviewScreen,
  loadSubject,
  regionToday,
  dateBounds,
  readDate,
  handleMarkingDataExchange,
  parseToken,
  prettyDate,
  NO_ROSTER_OPTION,
};
