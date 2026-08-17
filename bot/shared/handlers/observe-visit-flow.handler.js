'use strict';
/**
 * bd-2430/bd-2431 (visit picker) + bd-2443 (scheduling UI) — the observe-visit
 * Flow endpoint handler.
 *
 * TWO UIs served by one handler, switched by OBSERVE_SCHEDULING_UI:
 *
 * LEGACY (flag off — the live v1 Flow): INIT → SELECT_SCHOOL NavigationList →
 * SELECT_TEACHER (paginated NavigationList, 18/page — bd-2431) → BRIEF →
 * complete{step:'start'}. Byte-compatible with the published v1 Flow — pinned
 * by tests. The flag exists because code and the Flow asset deploy at
 * different moments: BOTH mixed states (new code + v1 Flow, old code + v2
 * Flow) must keep working.
 *
 * SCHEDULING (flag on — the v2 Flow): INIT → MENU (debriefs/schedule/new with
 * live counts) → DEBRIEFS (tap exits to the chat debrief) · SCHEDULE (Dropdown
 * of upcoming visits → BRIEF → start) · SELECT_SCHOOL/SELECT_TEACHER (Dropdown
 * pickers — WhatsApp's dropdown sheet gives native client-side search; no
 * pagination needed, 200-option cap ≥ the 160-teacher max) → BRIEF_SCHEDULE →
 * SCHEDULE_PICKER (CalendarPicker Mon–Fri + slot Dropdown) → CONFIRM_SCHEDULED
 * → SCHEDULE loop, or step:'done' → SUCCESS close (the localized chat ack is
 * sent by flow-response.handler off the completion params).
 *
 * NO `version` field ever appears in a response (bd-215). flowToken = coach
 * user.id (bare UUID — colons would trip the loose token detectors).
 * bd-2331: NavigationList/Dropdown chrome is Latin-only.
 */

const LeaderSource = require('../services/observe/assignment/leader-source');
const ObserveState = require('../services/observe/observe-state.service');
// bd-88krt — Flow screen text is per-language DATA, never a literal here.
const { observeStrings, observeLang } = require('../services/observe/observe-strings');
const { buildBriefViewModel } = require('../services/observe/observe-brief-card');
const { getObserveArm } = require('../services/observe/observe-gate');
const { logToFile } = require('../utils/logger');

// bd-2443: read per-call — the flag flips alongside the Flow republish and
// must not require a process restart to be testable.
const schedulingOn = () => process.env.OBSERVE_SCHEDULING_UI === 'true';

// bd-2331 (CRITICAL): Meta's list/dropdown secondary text fails on Arabic/Urdu
// script — all picker chrome below is English/Latin. Brief/date screens are
// text components and stay in the coach's language.
const PICKER_LANG = 'en';

const SCHOOL_TAP = 'Tap to see teachers';
const TEACHERS_WORD = 'teachers';
const DUE_WORD = 'due for a visit';
const NEEDS_SUPPORT = 'Needs support';
const LAST_VISITED = 'Last visited';
const NOT_VISITED = 'Not yet visited';
const NEXT_LABEL = 'Next page ➡';
const PREV_LABEL = '⬅ Previous page';
const MORE_TEACHERS = 'more teachers';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PAGE_SIZE = 18; // legacy NavigationList pagination (bd-2431)
const SCHEDULE_AHEAD_DAYS = 56;
const DROPDOWN_CAP = 200; // Meta Dropdown ceiling — clamp + log, never silently

const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length <= n ? t : t.slice(0, n - 1) + '…'; };

/** "12 Jun" — Latin (list chrome). '' on an unparseable date. */
function fmtVisitDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Wed 6 Aug" from YYYY-MM-DD (Latin — dropdown/list chrome). */
function fmtDayDate(ymd) {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return String(ymd || '');
  const d = new Date(ms);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function teacherMeta(t) {
  const parts = [];
  if (t.needsSupport) parts.push(NEEDS_SUPPORT);
  const dateStr = t.lastVisitAt ? fmtVisitDate(t.lastVisitAt) : '';
  parts.push(t.lastVisitAt && dateStr ? `${LAST_VISITED} ${dateStr}` : NOT_VISITED);
  return parts.join(' · ');
}

// ── legacy NavigationList builders (v1 Flow — unchanged, bd-2430/2431) ───────

function schoolItem(s) {
  const metaParts = [`${s.teacherCount} ${TEACHERS_WORD}`];
  if (s.dueCount > 0) metaParts.push(`${s.dueCount} ${DUE_WORD}`);
  return {
    id: String(s.school_ext_id),
    'main-content': {
      title: clip(s.school_name || 'School', 30),
      description: clip(SCHOOL_TAP, 30),
      metadata: clip(metaParts.join(' · '), 80),
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'school', school_ext_id: String(s.school_ext_id) } },
  };
}

function teacherItem(t, schoolExtId) {
  const mc = {
    title: clip(t.teacher_name || 'Teacher', 30),
    metadata: clip(teacherMeta(t), 80),
  };
  const desc = t.level || (t.grade != null && t.grade !== '' ? `Grade ${t.grade}` : null);
  if (desc) mc.description = clip(String(desc), 20);
  return {
    id: String(t.teacher_ext_id),
    'main-content': mc,
    'on-click-action': {
      name: 'data_exchange',
      payload: { step: 'teacher', teacher_ext_id: String(t.teacher_ext_id), school_ext_id: String(schoolExtId) },
    },
  };
}

function pageNavItem(schoolExtId, page, isNext, remaining) {
  return {
    id: `page:${page}`,
    'main-content': {
      title: clip(isNext ? NEXT_LABEL : PREV_LABEL, 30),
      metadata: clip(isNext ? `${remaining} ${MORE_TEACHERS}` : ' ', 80),
    },
    'on-click-action': {
      name: 'data_exchange',
      payload: { step: 'school', school_ext_id: String(schoolExtId), page },
    },
  };
}

async function schoolsScreen(userId) {
  const schools = await LeaderSource.listSchools(userId);
  return { screen: 'SELECT_SCHOOL', data: { items: schools.map((s) => schoolItem(s)) } };
}

async function teachersScreen(userId, schoolExtId, page = 0) {
  const teachers = await LeaderSource.listTeachers(userId, schoolExtId);
  const p = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 0;
  const start = p * PAGE_SIZE;
  const slice = teachers.slice(start, start + PAGE_SIZE);
  const items = slice.map((t) => teacherItem(t, schoolExtId));
  if (p > 0) items.unshift(pageNavItem(schoolExtId, p - 1, false, 0));
  const remaining = teachers.length - (start + slice.length);
  if (remaining > 0) items.push(pageNavItem(schoolExtId, p + 1, true, remaining));
  try { await ObserveState.setState(userId, 'awaiting_pick', { schoolExtId, page: p }); } catch (_) {}
  return {
    screen: 'SELECT_TEACHER',
    data: { items, school_ext_id: String(schoolExtId || '') },
  };
}


// ── bd-88krt · search + act-on-a-visit (HITL R37/R39) ────────────────────────
//
// Meta's Flow Dropdown holds 200 options and has NO built-in search or filter
// field, and there is no searchable-list component. The documented way to search
// is TextInput -> data_exchange -> server-filtered options, which is what
// SEARCH_TEACHER does. RadioButtonsGroup caps at 20, so that is the ceiling on
// how many matches a screen can render — and it is why the action bar is a
// radio group rather than several footer buttons (Meta allows only one Footer).

const TEACHER_MATCH_CAP = 20;   // RadioButtonsGroup ceiling

/**
 * Filter a roster by part of a name. A BLANK term returns everyone — a coach
 * with five teachers should never be made to type. Nameless rows can never
 * match but must never throw.
 */
function filterTeachersByTerm(teachers, term, cap = TEACHER_MATCH_CAP) {
  const list = Array.isArray(teachers) ? teachers : [];
  const t = String(term == null ? '' : term).trim().toLowerCase();
  if (!t) return list;
  return list
    .filter((x) => String((x && x.teacher_name) || '').toLowerCase().includes(t))
    .slice(0, cap);
}

/**
 * Which screen a choice from the action bar leads to. Anything unexpected (a
 * stale Flow client, a renamed option) falls back to running the observation —
 * the coach is standing in a classroom, so a dead end is the worst outcome.
 */
function visitActionTarget(choice) {
  if (choice === 'reschedule') return 'SCHEDULE_EDIT';
  if (choice === 'cancel') return 'CANCEL';
  return 'BRIEF';
}

/** One line naming who, where and when. Unknown parts are omitted, never printed. */
function visitSummary(row) {
  const r = row || {};
  const bits = [r.teacher_name, r.school_name].filter(Boolean).map((x) => clip(String(x), 24));
  const when = [r.scheduled_for, r.scheduled_slot].filter(Boolean).join(' ');
  if (when) bits.push(when);
  return clip(bits.join(' · '), 80);
}


/**
 * bd-88krt — which school a teacher belongs to. A cross-school name search
 * returns no school, and the brief needs one; asking the roster is cheaper and
 * more honest than threading an empty string through the Flow.
 */
async function schoolOfTeacher(userId, teacherExtId) {
  try {
    const all = await LeaderSource.listTeachers(userId);
    const hit = (all || []).find((t) => String(t.teacher_ext_id) === String(teacherExtId));
    return (hit && hit.school_ext_id) || '';
  } catch (_) {
    return '';
  }
}



// bd-88krt — shorthands so the Flow steps stay readable. Screen copy is always
// per-language DATA (language protocol), never a literal at the call site.
const S_ = (lang) => observeStrings(lang);
const _done = (heading, body, action = 'roster') => ({
  heading: heading || '',
  body: body || '',
  extension_message_response: { params: { observe_visit_action: action } },
});

// ── scheduling-UI builders (v2 Flow — bd-2443) ───────────────────────────────

// Lazy requires — observe-debrief pulls whatsapp.service; keep cycles out.
const _debriefService = () => require('../services/observe/observe-debrief.service');
const _scheduleStore = () => require('../services/observe/observe-schedule.service');

async function menuScreen(userId) {
  let pending = 0;
  let upcoming = 0;
  try {
    const Debrief = _debriefService();
    const [p, u] = await Promise.all([
      Debrief.listPendingDebriefs(userId).catch(() => []),
      Debrief.listUnsentReports(userId).catch(() => []),
    ]);
    pending = p.length + u.length;
  } catch (_) { /* count stays 0 — the menu must always render */ }
  try { upcoming = await _scheduleStore().countUpcoming(userId); } catch (_) {}
  const items = [
    {
      id: 'debriefs',
      'main-content': {
        title: 'Complete debriefs',
        metadata: pending > 0 ? `${pending} pending` : 'No pending debriefs',
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'debriefs' } },
    },
    {
      id: 'schedule',
      'main-content': {
        // bd-88krt: the row now leads to run / reschedule / cancel, so it should
        // say so. NavigationList caps title at 30 chars and metadata at 80.
        title: 'My schedule',
        metadata: upcoming > 0
          ? `${upcoming} upcoming · run, reschedule or cancel`
          : 'Nothing scheduled yet',
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'schedule' } },
    },
    {
      id: 'new',
      'main-content': {
        title: 'Schedule new observation',
        metadata: 'Pick a school and teacher',
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'schools' } },
    },
    {
      // bd-88krt — occasional roster admin sits BELOW the daily actions.
      id: 'manage',
      'main-content': {
        title: 'Add or remove a school',
        metadata: 'Search every school by name or EMIS',
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'add_search_open' } },
    },
  ];
  return { screen: 'MENU', data: { items } };
}

async function debriefsScreen(userId) {
  const Debrief = _debriefService();
  const [pendings, unsent] = await Promise.all([
    Debrief.listPendingDebriefs(userId).catch(() => []),
    Debrief.listUnsentReports(userId).catch(() => []),
  ]);
  const row = (sess, metaSuffix) => ({
    id: String(sess.id),
    'main-content': {
      title: clip((sess.analysis_data && sess.analysis_data.teacher_delivery && sess.analysis_data.teacher_delivery.teacher_name) || 'Observation', 30),
      metadata: clip(`Observed ${fmtVisitDate(sess.created_at)} - ${metaSuffix}`, 80),
    },
    'on-click-action': {
      name: 'complete',
      payload: { observe_visit_action: 'debrief', session_id: String(sess.id) },
    },
  });
  const items = [
    ...pendings.map((s) => row(s, 'debrief pending')),
    ...unsent.map((s) => row(s, 'report not sent yet')),
  ];
  if (!items.length) {
    // NavigationList needs >=1 row; a self-refreshing placeholder keeps an
    // accidental tap harmless (the system back arrow returns to MENU).
    items.push({
      id: 'none',
      'main-content': { title: 'Nothing pending', metadata: 'Use the back arrow to return' },
      'on-click-action': { name: 'data_exchange', payload: { step: 'debriefs' } },
    });
  }
  return { screen: 'DEBRIEFS', data: { items } };
}

function _clampOptions(options, label, userId) {
  if (options.length > DROPDOWN_CAP) {
    logToFile('observe-visit: dropdown options clamped', { userId, label, total: options.length, cap: DROPDOWN_CAP });
    return options.slice(0, DROPDOWN_CAP);
  }
  return options;
}

async function scheduleScreen(userId) {
  const rows = await _scheduleStore().listUpcoming(userId).catch(() => []);
  let options = rows.map((r) => ({
    id: String(r.id),
    title: clip(r.teacher_name || 'Teacher', 30),
    description: clip(r.school_name || '', 60),
    metadata: clip(`${r.overdue ? 'Overdue - ' : ''}${fmtDayDate(r.scheduled_for)}${r.scheduled_slot ? ` - ${r.scheduled_slot}` : ''}`, 80),
  }));
  if (!options.length) {
    options = [{ id: 'none', title: 'No scheduled visits yet', description: 'Go back and schedule one' }];
  }
  return { screen: 'SCHEDULE', data: { options: _clampOptions(options, 'schedule', userId) } };
}

async function schoolsScreenV2(userId) {
  const schools = await LeaderSource.listSchools(userId);
  const options = schools.map((s) => {
    const parts = [`${s.teacherCount} ${TEACHERS_WORD}`];
    if (s.dueCount > 0) parts.push(`${s.dueCount} ${DUE_WORD}`);
    return {
      id: String(s.school_ext_id),
      title: clip(s.school_name || 'School', 30),
      description: clip(parts.join(' - '), 60),
    };
  });
  return { screen: 'SELECT_SCHOOL', data: { options: _clampOptions(options, 'schools', userId) } };
}

async function teachersScreenV2(userId, schoolExtId, term = null) {
  const all = await LeaderSource.listTeachers(userId, schoolExtId);
  // bd-88krt: a term arrives only from SEARCH_TEACHER; blank means "show all".
  const teachers = filterTeachersByTerm(all, term);
  const options = teachers.map((t) => ({
    id: String(t.teacher_ext_id),
    title: clip(t.teacher_name || 'Teacher', 30),
    description: clip(String(t.level || (t.grade != null && t.grade !== '' ? `Grade ${t.grade}` : '')), 30),
    metadata: clip(teacherMeta(t), 80),
  }));
  try { await ObserveState.setState(userId, 'awaiting_pick', { schoolExtId }); } catch (_) {}
  return {
    screen: 'SELECT_TEACHER',
    data: { options: _clampOptions(options, 'teachers', userId), school_ext_id: String(schoolExtId || '') },
  };
}

/**
 * Shared brief builder. screenId = 'BRIEF' (observe path — Footer completes
 * with step:'start') or 'BRIEF_SCHEDULE' (scheduling path — Footer goes to
 * the picker). Field set identical (operator: "the same UI").
 */
async function briefScreen(userId, screenData, screenId = 'BRIEF') {
  const teacherExtId = screenData && (screenData.teacher_ext_id || screenData.teacher_ext);
  const schoolExtId = screenData && screenData.school_ext_id;
  const brief = await LeaderSource.buildBrief(userId, teacherExtId, schoolExtId);
  const vm = buildBriefViewModel({
    teacher: brief.teacher,
    trend: brief.trend,
    strength: brief.strengthLabel,
    growth: brief.growthLabel,
    moves: brief.moves,
    noData: brief.noData,
  });
  let page = 0;
  let origin = screenData && screenData.origin;
  try {
    const st = await ObserveState.getState(userId);
    page = (st && st.page) || 0;
    if (!origin) origin = st && st.origin;
  } catch (_) {}
  try { await ObserveState.setState(userId, 'brief_shown', { schoolExtId, teacherExtId, page, origin: origin || 'new' }); } catch (_) {}
  return {
    screen: screenId,
    data: {
      teacher_name: vm.teacher_name,
      subtitle: vm.subtitle,
      strength_text: vm.strength_text,
      growth_text: vm.growth_text,
      moves_intro: vm.moves_intro,
      moves_text: vm.moves_text,
      trend_text: vm.trend_text,
      debrief_reminder: vm.debrief_reminder,
      guidance_text: vm.guidance_text,
      teacher_ext_id: String(teacherExtId || ''),
      school_ext_id: String(schoolExtId || ''),
    },
  };
}

async function _teacherAndSchoolNames(userId, teacherExtId, schoolExtId) {
  let teacherName = 'Teacher';
  let schoolName = '';
  try {
    const t = await LeaderSource.resolveTeacher(userId, teacherExtId, schoolExtId);
    if (t && t.teacher_name) teacherName = t.teacher_name;
  } catch (_) {}
  try {
    const schools = await LeaderSource.listSchools(userId);
    const s = schools.find((x) => String(x.school_ext_id) === String(schoolExtId));
    if (s && s.school_name) schoolName = s.school_name;
  } catch (_) {}
  return { teacherName, schoolName };
}

async function pickerScreen(userId, screenData) {
  const teacherExtId = screenData && screenData.teacher_ext_id;
  const schoolExtId = screenData && screenData.school_ext_id;
  const { teacherName, schoolName } = await _teacherAndSchoolNames(userId, teacherExtId, schoolExtId);
  const today = new Date();
  const max = new Date(today.getTime() + SCHEDULE_AHEAD_DAYS * 24 * 3600 * 1000);
  try { await ObserveState.setState(userId, 'awaiting_pick', { schoolExtId, teacherExtId, origin: 'new' }); } catch (_) {}
  return {
    screen: 'SCHEDULE_PICKER',
    data: {
      recap: clip(`${teacherName}${schoolName ? ` - ${schoolName}` : ''}`, 80),
      min_date: today.toISOString().slice(0, 10),
      max_date: max.toISOString().slice(0, 10),
      teacher_ext_id: String(teacherExtId || ''),
      school_ext_id: String(schoolExtId || ''),
    },
  };
}

async function saveScheduleStep(userId, screenData) {
  const teacherExtId = screenData && screenData.teacher_ext_id;
  const schoolExtId = screenData && screenData.school_ext_id;
  const date = screenData && screenData.obs_date;
  const slot = screenData && screenData.obs_slot;
  const { teacherName, schoolName } = await _teacherAndSchoolNames(userId, teacherExtId, schoolExtId);
  await _scheduleStore().saveSchedule(userId, {
    school_ext_id: String(schoolExtId || ''),
    teacher_ext_id: String(teacherExtId || ''),
    teacher_name: teacherName,
    school_name: schoolName,
    date,
    slot,
  });
  logToFile('🗓️ observe-visit: schedule saved', { userId, teacherExtId, date, slot });
  return {
    screen: 'CONFIRM_SCHEDULED',
    data: {
      recap: clip(`${teacherName} - ${fmtDayDate(date)} at ${slot}${schoolName ? ` - ${schoolName}` : ''}`, 120),
      teacher_name: teacherName,
      sched_date: String(date || ''),
      sched_slot: String(slot || ''),
    },
  };
}

/** The "I'm done for now" exit — endpoint-driven SUCCESS close. The chat ack
 * (localized, recapping the schedule + the /observe re-entry) is sent by
 * flow-response.handler off these params. */
function successDone(flowToken, screenData, lang = 'en') {
  // bd-88krt: SUCCESS is now data-driven so a cancel stops reading "Observation
  // scheduled". EVERY path to it must supply heading+body — a declared key the
  // endpoint omits fails the whole screen (payload-schema-error, learned live).
  const S = observeStrings(lang);
  return {
    screen: 'SUCCESS',
    data: {
      heading: S.flow_scheduled_heading,
      body: S.flow_scheduled_body,
      extension_message_response: {
        params: {
          observe_visit_action: 'done',
          flow_token: flowToken,
          teacher_name: (screenData && screenData.teacher_name) || '',
          sched_date: (screenData && screenData.sched_date) || '',
          sched_slot: (screenData && screenData.sched_slot) || '',
        },
      },
    },
  };
}

// ── bind + start (shared by both UIs) ────────────────────────────────────────

async function bindAndStart(userId, screenData, user) {
  const teacherExtId = screenData && (screenData.teacher_ext_id || screenData.teacher_ext);
  const schoolExtId = screenData && screenData.school_ext_id;
  let teacher = null;
  try {
    teacher = await LeaderSource.resolveTeacher(userId, teacherExtId, schoolExtId);
  } catch (err) {
    logToFile('observe-visit: resolveTeacher failed', { userId, teacherExtId, error: err.message });
  }
  const arm = user ? getObserveArm(user) : 'functional';
  await ObserveState.setState(userId, 'awaiting_audio', {
    arm,
    // school_ext_id rides along so the capture lifecycle can retire the
    // matching observation_schedules row (bd-2445).
    boundTeacher: teacher ? { ...teacher, school_ext_id: String(schoolExtId || '') } : null,
  });
  logToFile('🔭 observe-visit: teacher bound, awaiting_audio', {
    userId, teacherExtId, boundUserId: teacher && teacher.user_id,
  });
  return { action: 'bound', boundTeacher: teacher };
}

/** Recover {schoolExtId, page, teacherExtId, origin} from payload/state. */
async function rememberedPick(userId, screenData) {
  let schoolExtId = screenData && screenData.school_ext_id;
  let page = screenData && screenData.page;
  let teacherExtId = screenData && screenData.teacher_ext_id;
  let origin = null;
  try {
    const st = await ObserveState.getState(userId);
    if (!schoolExtId) schoolExtId = st && st.schoolExtId;
    if (page == null) page = st && st.page;
    if (!teacherExtId) teacherExtId = st && st.teacherExtId;
    origin = st && st.origin;
  } catch (_) {}
  return { schoolExtId, page: page || 0, teacherExtId, origin };
}

// ── dispatch ─────────────────────────────────────────────────────────────────

/**
 * @param {string} userId    coach user.id (from flow_token)
 * @param {string} action    'INIT' | 'data_exchange' | 'BACK' | 'complete' | 'ping'
 * @param {string} screen    current screen id (on BACK: the screen being LEFT)
 * @param {object} screenData decrypted screen payload
 * @param {string} flowToken raw flow token
 * @param {object} [user]    coach users row (optional — for the observe arm on bind)
 */
async function handle(userId, action, screen, screenData = {}, flowToken = '', user = null) {
  const step = screenData && screenData.step;
  const v2 = schedulingOn();
  logToFile('observe-visit flow', { userId, action, screen, step, v2 });

  if (action === 'INIT' || action === 'init') {
    return v2 ? menuScreen(userId) : schoolsScreen(userId);
  }

  if (action === 'BACK') {
    // `screen` is the screen being LEFT (bd-2365).
    if (v2) {
      if (screen === 'DEBRIEFS' || screen === 'SCHEDULE' || screen === 'SELECT_SCHOOL') return menuScreen(userId);
      if (screen === 'SELECT_TEACHER') return schoolsScreenV2(userId);
      if (screen === 'BRIEF_SCHEDULE') {
        const { schoolExtId } = await rememberedPick(userId, screenData);
        return teachersScreenV2(userId, schoolExtId);
      }
      if (screen === 'SCHEDULE_PICKER') {
        const { schoolExtId, teacherExtId } = await rememberedPick(userId, screenData);
        return briefScreen(userId, { teacher_ext_id: teacherExtId, school_ext_id: schoolExtId }, 'BRIEF_SCHEDULE');
      }
      if (screen === 'CONFIRM_SCHEDULED') return scheduleScreen(userId);
      if (screen === 'BRIEF') {
        const { schoolExtId, origin } = await rememberedPick(userId, screenData);
        if (origin === 'schedule') return scheduleScreen(userId);
        return teachersScreenV2(userId, schoolExtId);
      }
      return menuScreen(userId);
    }
    // legacy BACK (v1 Flow — unchanged)
    if (screen === 'SELECT_TEACHER') return schoolsScreen(userId);
    const { schoolExtId, page } = await rememberedPick(userId, screenData);
    return teachersScreen(userId, schoolExtId, page);
  }

  if (action === 'complete') {
    return bindAndStart(userId, screenData, user);
  }

  // bd-88krt — the coach's language for Flow screen text, taken from the user
  // object this handler already receives. No query, and nothing that can exit
  // the process in a test.
  const _flowLang = observeLang(user || {});

  if (action === 'data_exchange') {
    // v2-only steps (the v1 Flow never sends them, so they are inert dark)
    if (step === 'add_search_open') return { screen: 'ADD_SEARCH', data: {} };
    if (step === 'debriefs') return debriefsScreen(userId);
    if (step === 'schedule') return scheduleScreen(userId);
    if (step === 'schools') return schoolsScreenV2(userId);
    if (step === 'sched_teacher') {
      const picked = screenData && screenData.picked;
      if (!picked || picked === 'none') return scheduleScreen(userId);
      const rows = await _scheduleStore().listUpcoming(userId).catch(() => []);
      const row = rows.find((r) => String(r.id) === String(picked));
      if (!row) return scheduleScreen(userId);
      // bd-88krt: offer run / reschedule / cancel first (HITL R39). Running the
      // observation is still one tap away, so the common path costs nothing.
      return { screen: 'VISIT_ACTION', data: { visit_id: String(row.id), summary: visitSummary(row) } };
    }

    // bd-88krt — the action bar's choice.
    if (step === 'visit_action') {
      const visitId = screenData && screenData.visit_id;
      const rows = await _scheduleStore().listUpcoming(userId).catch(() => []);
      const row = rows.find((r) => String(r.id) === String(visitId));
      if (!row) return scheduleScreen(userId);
      const target = visitActionTarget(screenData && screenData.choice);

      if (target === 'CANCEL') {
        const ok = await _scheduleStore().cancelById(userId, row.id).catch(() => false);
        const S = observeStrings(_flowLang);
        return {
          screen: 'SUCCESS',
          data: {
            heading: ok ? S.flow_cancelled_heading : S.flow_action_failed_heading,
            body: ok ? S.flow_cancelled_body : S.flow_action_failed_body,
            extension_message_response: { params: {
              observe_visit_action: ok ? 'cancelled' : 'noop',
              teacher_name: row.teacher_name || '',
            } },
          },
        };
      }
      if (target === 'SCHEDULE_EDIT') {
        const today = new Date();
        const max = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
        return { screen: 'SCHEDULE_EDIT', data: {
          visit_id: String(row.id),
          summary: visitSummary(row),
          min_date: today.toISOString().slice(0, 10),
          max_date: max.toISOString().slice(0, 10),
          slots: _scheduleStore().SLOTS.map((x) => ({ id: String(x), title: String(x) })),
        } };
      }
      try { await ObserveState.setState(userId, 'awaiting_pick', { schoolExtId: row.school_ext_id, teacherExtId: row.teacher_ext_id, origin: 'schedule' }); } catch (_) {}
      return briefScreen(userId, { teacher_ext_id: row.teacher_ext_id, school_ext_id: row.school_ext_id, origin: 'schedule' }, 'BRIEF');
    }

    // bd-88krt — save a reschedule.
    if (step === 'visit_edit') {
      const visitId = screenData && screenData.visit_id;
      const date = screenData && screenData.date;
      const slot = screenData && screenData.slot;
      let ok = false;
      try { ok = await _scheduleStore().rescheduleById(userId, visitId, date, slot); } catch (_) { ok = false; }
      const rows2 = await _scheduleStore().listUpcoming(userId).catch(() => []);
      const moved = rows2.find((r) => String(r.id) === String(visitId)) || {};
      const S2 = observeStrings(_flowLang);
      return {
        screen: 'SUCCESS',
        data: {
          heading: ok ? S2.flow_rescheduled_heading : S2.flow_action_failed_heading,
          body: ok ? S2.flow_rescheduled_body : S2.flow_action_failed_body,
          extension_message_response: { params: {
            observe_visit_action: ok ? 'rescheduled' : 'noop',
            teacher_name: moved.teacher_name || '',
            sched_date: date || '',
            sched_slot: slot || '',
          } },
        },
      };
    }

    // bd-88krt — the TextInput search. Meta gives no built-in Dropdown search,
    // so the term comes back here and the options are filtered server-side.
    if (step === 'teacher_search') {
      // The search link sits on SELECT_SCHOOL, BEFORE a school is chosen, so
      // there is no school to scope by — and searching the coach's whole patch
      // is what she actually wants (median 123 teachers across her schools).
      return teachersScreenV2(userId, null, screenData && screenData.term);
    }

    // ── bd-88krt · search, and owning your school list ───────────────────
    const _admin = () => require('../services/observe/observe-school-admin.service');
    const _opt = (id, title, description, metadata) => ({
      id: String(id), title: clip(title || '', 30),
      description: clip(description || '', 30), metadata: clip(metadata || '', 80),
    });

    // Schools I already have, by name or EMIS.
    if (step === 'school_search') {
      const A = _admin();
      const mine = await A.listMySchools(userId).catch(() => []);
      const hits = mine.filter((x) => A.matchSchool(x, screenData && screenData.term)).slice(0, A.RESULT_CAP);
      const options = hits.length
        ? hits.map((x) => _opt(x.school_ext_id, x.school_name, `EMIS ${x.emis || ''}`, ''))
        : [_opt('none', S_(_flowLang).search_no_match, '', '')];
      return { screen: 'SCHOOL_RESULTS', data: { options } };
    }

    // My teachers at a school, by name or phone.
    if (step === 'teacher_search') {
      const A = _admin();
      const schoolExtId = (screenData && screenData.school_ext_id) || null;
      const all = await LeaderSource.listTeachers(userId, schoolExtId).catch(() => []);
      const hits = all.filter((t) => A.matchTeacher(t, screenData && screenData.term)).slice(0, A.RESULT_CAP);
      const options = hits.length
        ? hits.map((t) => _opt(t.teacher_ext_id, t.teacher_name, t.level || '', t.phone_e164 || ''))
        : [_opt('none', S_(_flowLang).search_no_match, '', '')];
      return { screen: 'TEACHER_RESULTS', data: { options, school_ext_id: String(schoolExtId || '') } };
    }

    // The whole universe of schools — what she can ADD.
    if (step === 'add_search') {
      const A = _admin();
      const hits = await A.searchUniverse(userId, screenData && screenData.term).catch(() => []);
      const options = hits.length
        ? hits.map((x) => _opt(x.school_ext_id, x.school_name,
            `EMIS ${x.emis}`, x.alreadyMine ? S_(_flowLang).school_already_mine : ''))
        : [_opt('none', S_(_flowLang).search_no_match, '', '')];
      return { screen: 'ADD_RESULTS', data: { options } };
    }

    if (step === 'add_school') {
      const A = _admin();
      const picked = screenData && screenData.picked;
      const S = S_(_flowLang);
      if (!picked || picked === 'none') return { screen: 'ACTION_DONE', data: _done(S.search_no_match, '') };
      const res = await A.addSchoolForCoach(userId, picked).catch(() => ({ ok: false }));
      if (!res.ok) return { screen: 'ACTION_DONE', data: _done(S.flow_action_failed_heading, S.flow_action_failed_body) };
      return { screen: 'ACTION_DONE', data: _done(
        S.school_added_heading,
        A.addedSchoolAck(_flowLang, { schoolName: res.schoolName, teachersMapped: res.teachersMapped }),
        'roster') };
    }

    if (step === 'manage') {
      const A = _admin();
      const mine = await A.listMySchools(userId).catch(() => []);
      const options = mine.length
        ? mine.map((x) => _opt(x.school_ext_id, x.school_name, `EMIS ${x.emis || ''}`, ''))
        : [_opt('none', S_(_flowLang).search_no_match, '', '')];
      return { screen: 'MANAGE_SCHOOLS', data: { options } };
    }

    if (step === 'remove_school') {
      const A = _admin();
      const picked = screenData && screenData.picked;
      const S = S_(_flowLang);
      if (!picked || picked === 'none') return { screen: 'ACTION_DONE', data: _done(S.search_no_match, '') };
      const res = await A.removeSchoolForCoach(userId, picked).catch(() => ({ ok: false }));
      return { screen: 'ACTION_DONE', data: res.ok
        ? _done(S.school_removed_heading, A.removedSchoolAck(_flowLang, { schoolName: res.schoolName }), 'roster')
        : _done(S.flow_action_failed_heading, S.flow_action_failed_body) };
    }

    if (step === 'to_picker') return pickerScreen(userId, screenData);
    if (step === 'save_schedule') return saveScheduleStep(userId, screenData);
    if (step === 'done') return successDone(flowToken || userId, screenData, _flowLang);

    if (step === 'school') {
      // v2 Dropdown Footer sends `picked`; the legacy NavigationList tap (and
      // its pagination rows) send school_ext_id (+page). Shape-discriminated
      // so BOTH Flow versions work against this code (the deploy-order rule).
      if (screenData && screenData.picked != null) return teachersScreenV2(userId, screenData.picked);
      return teachersScreen(userId, screenData.school_ext_id, screenData.page || 0);
    }
    if (step === 'teacher') {
      if (screenData && screenData.picked != null) {
        // A cross-school search returns no school_ext_id, so resolve it from the
        // teacher herself rather than sending the brief an empty school.
        let schoolExtId = screenData.school_ext_id;
        if (!schoolExtId) schoolExtId = await schoolOfTeacher(userId, screenData.picked);
        return briefScreen(userId, { teacher_ext_id: screenData.picked, school_ext_id: schoolExtId }, 'BRIEF_SCHEDULE');
      }
      return briefScreen(userId, screenData, 'BRIEF');
    }
    if (step === 'start') return bindAndStart(userId, screenData, user);
    if (step === 'back') {
      const { schoolExtId, page } = await rememberedPick(userId, screenData);
      return teachersScreen(userId, schoolExtId, page);
    }
    if (!step || screen === 'SELECT_SCHOOL') return v2 ? schoolsScreenV2(userId) : schoolsScreen(userId);
  }

  logToFile('observe-visit: unknown action/step', { action, step, screen });
  return v2 ? menuScreen(userId) : schoolsScreen(userId);
}

module.exports = {
  handle,
  // bd-88krt — pure decisions, unit-tested
  filterTeachersByTerm,
  schoolOfTeacher,
  visitActionTarget,
  visitSummary,
  TEACHER_MATCH_CAP,
  // exported for tests / reuse:
  schoolItem,
  teacherItem,
  schoolsScreen,
  teachersScreen,
  briefScreen,
  bindAndStart,
  menuScreen,
  debriefsScreen,
  scheduleScreen,
  schoolsScreenV2,
  teachersScreenV2,
  pickerScreen,
  PAGE_SIZE,
};
