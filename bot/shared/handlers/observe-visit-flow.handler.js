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
const _done = (heading, body, action = 'roster', schoolName = '') => ({
  heading: heading || '',
  body: body || '',
  school_name: schoolName || '',
  extension_message_response: { params: { observe_visit_action: action } },
});

/**
 * SUCCESS payload. Every key the screen declares is filled here with a safe
 * default, so no call site can omit one — a declared-but-missing key fails the
 * entire screen with payload-schema-error, which is exactly how "Schedule an
 * observation" broke live on 17 Aug.
 */
const _success = (heading, body, opts = {}) => ({
  heading: heading || '',
  body: body || '',
  action: opts.action || 'done',
  teacher_name: opts.teacherName || '',
  sched_date: opts.date || '',
  sched_slot: opts.slot || '',
  extension_message_response: {
    params: {
      observe_visit_action: opts.action || 'done',
      // flow_token rides along on the schedule close — dropping it broke
      // visit-flow-scheduling when the payload moved into this helper.
      ...(opts.flowToken ? { flow_token: opts.flowToken } : {}),
      teacher_name: opts.teacherName || '',
      sched_date: opts.date || '',
      sched_slot: opts.slot || '',
    },
  },
});

// ── scheduling-UI builders (v2 Flow — bd-2443) ───────────────────────────────

// Lazy requires — observe-debrief pulls whatsapp.service; keep cycles out.
// bd-0cxz6: MODULE scope. This used to be declared inside handle(), so
// menuScreen's call to it threw ReferenceError, was swallowed by a catch,
// and the empty-school menu silently never trimmed.
const _admin = () => require('../services/observe/observe-school-admin.service');

const _debriefService = () => require('../services/observe/observe-debrief.service');
const _scheduleStore = () => require('../services/observe/observe-schedule.service');

async function menuScreen(userId, opts = {}) {
  let pending = 0;
  let upcoming = 0;
  // bd-0cxz6: how many schools she actually has. Zero is a real state now that
  // /observe opens for any coach, and the menu must not offer her a scheduling
  // path that can only dead-end on an empty school list.
  let schoolCount = opts.schoolCount;
  if (schoolCount == null) {
    try {
      const A = _admin();
      schoolCount = (await A.listMySchools(userId)).length;
    } catch (_) { schoolCount = 1; }   // unknown -> behave as today
  }
  let nForm = 0; let nDebrief = 0; let nSend = 0;
  try {
    const Debrief = _debriefService();
    const [f, p, u] = await Promise.all([
      Debrief.listUnfinished(userId, { limit: 100 }).catch(() => []),
      Debrief.listPendingDebriefs(userId, { limit: 100 }).catch(() => []),
      Debrief.listUnsentReports(userId, { limit: 100 }).catch(() => []),
    ]);
    nForm = f.length; nDebrief = p.length; nSend = u.length;
    pending = nForm + nDebrief + nSend;
  } catch (_) { /* counts stay 0 — the menu must always render */ }
  try { upcoming = await _scheduleStore().countUpcoming(userId); } catch (_) {}
  // bd-tju8f (operator design, 2026-08-24): three stage rows with counts —
  // mirror of the old single "Complete debriefs" row. Zero-count rows are
  // hidden (same conditional-trim pattern as the schoolCount==0 case below).
  const stageRows = [
    { id: 'work_form', title: 'Complete the form', n: nForm, meta: `${nForm} to finish`, step: 'work_form' },
    { id: 'debriefs', title: 'Complete debriefs', n: nDebrief, meta: `${nDebrief} pending`, step: 'debriefs' },
    { id: 'work_send', title: 'Send reports', n: nSend, meta: `${nSend} to send`, step: 'work_send' },
  ].filter((r) => r.n > 0).map((r) => ({
    id: r.id,
    'main-content': { title: r.title, metadata: r.meta },
    'on-click-action': { name: 'data_exchange', payload: { step: r.step } },
  }));
  const items = [
    ...stageRows,
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
    {
      // Teacher-level admin is its OWN entry. Folding it into the school one
      // would hide it behind a label that promises something else.
      id: 'manage_teachers',
      'main-content': {
        title: 'Add or remove a teacher',
        metadata: 'By her WhatsApp number',
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'teacher_school_open' } },
    },
  ];
  if (!schoolCount) {
    // Nothing to debrief, schedule or observe until she has a school. Show the
    // one action that gets her unstuck, and say why the rest is missing.
    const only = items.filter((i) => i.id === 'manage');   // teacher admin needs a school first
    only[0]['main-content'].metadata = 'Start here — add your first school';
    return { screen: 'MENU', data: { items: only } };
  }
  return { screen: 'MENU', data: { items } };
}

// bd-43474: Meta's NavigationList holds 20 rows. Reserve one for "show more"
// so a coach with a long backlog can always reach the rest.
const DEBRIEF_PAGE = 19;

async function _stageScreen(userId, offset, { screen, step, fetch, metaOf, action }) {
  const Debrief = _debriefService();
  const off = Math.max(0, Number(offset) || 0);
  const upto = off + DEBRIEF_PAGE + 1;
  const rows = await fetch(Debrief, userId, { limit: upto }).catch(() => []);
  const nameOf = (sess) => sess.teacher_name
    || (sess.analysis_data && sess.analysis_data.teacher_delivery && sess.analysis_data.teacher_delivery.teacher_name)
    || 'Observation';
  const row = (sess) => ({
    id: String(sess.id),
    'main-content': {
      title: clip(nameOf(sess), 30),
      metadata: clip([sess.school_name, `Observed ${fmtVisitDate(sess.created_at)}`, metaOf(sess)].filter(Boolean).join(' - '), 80),
    },
    // bd-ej21x: with the OBS_ACTION screen published (flag mirrors the
    // OBSERVE_STAGE_SCREENS deploy-order contract), a row opens "This
    // observation" instead of jumping straight into the chat handoff.
    'on-click-action': process.env.OBSERVE_OBS_ACTION === 'true'
      ? { name: 'data_exchange', payload: { step: 'obs_action', session_id: String(sess.id), stage: step } }
      : {
        name: 'complete',
        payload: { observe_visit_action: typeof action === 'function' ? action(sess) : action, session_id: String(sess.id) },
      },
  });
  const all = rows.map(row);
  const page = all.slice(off, off + DEBRIEF_PAGE);
  const items = [...page];
  if (all.length > off + DEBRIEF_PAGE) {
    items.push({
      id: 'more',
      'main-content': { title: 'Show more', metadata: `${off + page.length} of ${all.length} shown` },
      'on-click-action': { name: 'data_exchange', payload: { step, offset: off + DEBRIEF_PAGE } },
    });
  }
  if (!items.length) {
    items.push({
      id: 'none',
      'main-content': { title: 'Nothing pending', metadata: 'Use the back arrow to return' },
      'on-click-action': { name: 'data_exchange', payload: { step } },
    });
  }
  return { screen, data: { items } };
}

// bd-tju8f: each stage renders on its OWN Flow screen with its own 19-row page
// (operator design — per-stage budgets instead of one stitched list).
// WORK_FORM / WORK_SEND are the two screens added to the Flow JSON in the same
// change; DEBRIEFS keeps its published title and id.
// Deploy-order safety: until the Flow JSON carrying WORK_FORM/WORK_SEND is
// PUBLISHED on this WABA, render those stages on the existing DEBRIEFS screen
// (right rows, provisional title). Flip OBSERVE_STAGE_SCREENS=true after the
// republish — code first, Flow second, env third; each step is safe alone.
const _stageScreenId = (want) => (process.env.OBSERVE_STAGE_SCREENS === 'true' ? want : 'DEBRIEFS');
const workFormScreen = (userId, offset) => _stageScreen(userId, offset, {
  screen: _stageScreenId('WORK_FORM'), step: 'work_form',
  fetch: (D, u, o) => D.listUnfinished(u, o),
  metaOf: (s) => ({ gate: 'finish setup', form: 'form to submit',
    retry: 'stopped - tap to retry', wait: 'analysing…' })[s.resume] || 'finish setup',
  action: 'resume',
});
const debriefsScreen = (userId, offset) => _stageScreen(userId, offset, {
  screen: 'DEBRIEFS', step: 'debriefs',
  fetch: (D, u, o) => D.listPendingDebriefs(u, o),
  metaOf: () => 'debrief pending', action: 'debrief',
});
// bd-1ezak: the Send-reports screen now carries the LIVE delivery status per
// row (invite sent <date> — waiting for tap / send failed / not sent yet), and
// includes the awaiting-tap rows that used to vanish entirely.
const workSendScreen = (userId, offset) => _stageScreen(userId, offset, {
  screen: _stageScreenId('WORK_SEND'), step: 'work_send',
  fetch: (D, u, o) => D.listUnsentReports(u, { ...o, includeAwaitingTap: true }),
  // Test doubles may stub the service without the helper — fall back to the
  // historical constant rather than throwing mid-screen.
  metaOf: (s) => {
    const D = _debriefService();
    return typeof D.sendReportRowMeta === 'function' ? D.sendReportRowMeta(s) : 'report not sent yet';
  },
  action: 'send_report',
});

// bd-ej21x — one lookup the OBS_ACTION steps share: how to re-fetch a stage's
// rows, which legacy complete-action "Continue" must carry, and where to fall
// back when the session vanished between list and tap.
const _stageDefs = {
  work_form: { fetch: (D, u, o) => D.listUnfinished(u, o), action: 'resume', screen: workFormScreen },
  debriefs: { fetch: (D, u, o) => D.listPendingDebriefs(u, o), action: 'debrief', screen: debriefsScreen },
  work_send: { fetch: (D, u, o) => D.listUnsentReports(u, { ...o, includeAwaitingTap: true }), action: 'send_report', screen: workSendScreen },
};

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
    data: _success(S.flow_scheduled_heading, S.flow_scheduled_body, {
      action: 'done',
      flowToken,
      teacherName: (screenData && screenData.teacher_name) || '',
      date: (screenData && screenData.sched_date) || '',
      slot: (screenData && screenData.sched_slot) || '',
    }),
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
  // bd-5n1a2: this line used to say "teacher bound" even when resolveTeacher
  // returned null — which is exactly the case that silently breaks the capture
  // (unbound session → report goes to the coach, who-ask re-fires). Say which
  // one actually happened.
  if (teacher) {
    logToFile('🔭 observe-visit: teacher bound, awaiting_audio', {
      userId, teacherExtId, boundUserId: teacher.user_id || null,
    });
  } else {
    // level='error' is required, not decorative: an unbound capture sends the
    // report to the coach instead of the teacher, so an on-caller wants this in
    // the `level == 'error'` dashboard filter rather than buried at info.
    logToFile('❌ observe-visit: teacher bind FAILED — capture will run UNBOUND', {
      userId, teacherExtId, schoolExtId: String(schoolExtId || ''),
    }, 'error');
  }
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
async function handle(userId, action, screen, screenData = {}, flowToken = '', user = null, opts = {}) {
  const step = screenData && screenData.step;
  const v2 = schedulingOn();
  logToFile('observe-visit flow', { userId, action, screen, step, v2 });

  if (action === 'INIT' || action === 'init') {
    return v2 ? menuScreen(userId, opts) : schoolsScreen(userId);
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
    if (step === 'debriefs') return debriefsScreen(userId, screenData && screenData.offset);
    if (step === 'work_form') return workFormScreen(userId, screenData && screenData.offset);
    if (step === 'work_send') return workSendScreen(userId, screenData && screenData.offset);
    // bd-ej21x — "This observation": Continue (legacy chat handoff, byte-
    // identical payload) or Cancel (in-flow, the visit-cancel pattern).
    if (step === 'obs_action') {
      const def = _stageDefs[screenData && screenData.stage] || _stageDefs.debriefs;
      const sid = String((screenData && screenData.session_id) || '');
      const rows = await def.fetch(_debriefService(), userId, { limit: 100 }).catch(() => []);
      const sess = rows.find((r) => String(r.id) === sid);
      if (!sess) return def.screen(userId, 0);
      const tName = sess.teacher_name
        || (sess.analysis_data && sess.analysis_data.teacher_delivery && sess.analysis_data.teacher_delivery.teacher_name)
        || 'Observation';
      // Meta: a NavigationList screen allows no other components, so the
      // session summary rides as the Continue row's metadata (80-char cap).
      const summary = clip([tName, sess.school_name, `Observed ${fmtVisitDate(sess.created_at)}`]
        .filter(Boolean).join(' - '), 80);
      return { screen: 'OBS_ACTION', data: { items: [
        { id: 'continue',
          'main-content': { title: 'Continue this observation', metadata: summary },
          'on-click-action': { name: 'complete', payload: { observe_visit_action: def.action, session_id: sid } } },
        { id: 'cancel',
          'main-content': { title: 'Cancel this observation', metadata: 'It leaves your list — the recording stays saved' },
          // one tap must never cancel — the row opens the in-flow confirm below
          'on-click-action': { name: 'data_exchange', payload: { step: 'obs_cancel_confirm', session_id: sid, stage: screenData && screenData.stage } } },
      ] } };
    }
    // bd-ej21x — the in-flow confirm: same screen, two server-fed rows. Yes
    // proceeds to obs_cancel; Keep re-renders the Continue/Cancel pair.
    if (step === 'obs_cancel_confirm') {
      const sid = String((screenData && screenData.session_id) || '');
      const stage = (screenData && screenData.stage) || 'debriefs';
      return { screen: 'OBS_ACTION', data: { items: [
        { id: 'cancel_yes',
          'main-content': { title: 'Yes, cancel it', metadata: 'It leaves your list — the recording stays saved' },
          'on-click-action': { name: 'data_exchange', payload: { step: 'obs_cancel', session_id: sid } } },
        { id: 'cancel_keep',
          'main-content': { title: 'Keep this observation', metadata: 'Go back' },
          'on-click-action': { name: 'data_exchange', payload: { step: 'obs_action', session_id: sid, stage } } },
      ] } };
    }
    if (step === 'obs_cancel') {
      const Resume = require('../services/observe/observe-resume.service');
      const res = await Resume.cancelObservationCore(
        String((screenData && screenData.session_id) || ''), user || { id: userId });
      const S = observeStrings(_flowLang);
      if (res.outcome === 'cancelled' || res.outcome === 'already') {
        return { screen: 'SUCCESS', data: _success(S.obs_cancelled_heading, S.obs_cancelled_body, { action: 'cancelled' }) };
      }
      const body = res.outcome === 'too_late' ? S.cancel_too_late : S.flow_action_failed_body;
      return { screen: 'SUCCESS', data: _success(S.flow_action_failed_heading, body, { action: 'noop' }) };
    }
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
          data: _success(
            ok ? S.flow_cancelled_heading : S.flow_action_failed_heading,
            ok ? S.flow_cancelled_body : S.flow_action_failed_body,
            { action: ok ? 'cancelled' : 'noop', teacherName: row.teacher_name || '' },
          ),
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
        data: _success(
          ok ? S2.flow_rescheduled_heading : S2.flow_action_failed_heading,
          ok ? S2.flow_rescheduled_body : S2.flow_action_failed_body,
          { action: ok ? 'rescheduled' : 'noop', teacherName: moved.teacher_name || '',
            date: date || '', slot: slot || '' },
        ),
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
        // teacherCount (what she HOLDS) as well as teachersMapped (what this
        // call wrote) — a re-submit maps 0 and must not read as "no teachers".
        A.addedSchoolAck(_flowLang, {
          schoolName: res.schoolName, teachersMapped: res.teachersMapped,
          teacherCount: res.teacherCount, alreadyMine: res.alreadyMine,
        }),
        'roster', res.schoolName) };
    }

    // bd-gndeg: the search sits BEFORE the picker because a screen holds one
    // Footer (MANAGE_SCHOOLS' is already "remove") and routing is a DAG, so a
    // screen cannot re-filter itself. Same shape as ADD_SEARCH -> ADD_RESULTS.
    if (step === 'manage_search') return { screen: 'REMOVE_SEARCH', data: {} };

    if (step === 'manage') {
      const A = _admin();
      const term = screenData && screenData.term;
      const mine = await A.listMySchools(userId).catch(() => []);
      // Reuse the matcher the add path uses — name, EMIS or full ext id. A
      // blank term matches everything, so a short list needs no typing.
      const hits = mine.filter((x) => A.matchSchool({
        school_name: x.school_name, emis: x.emis, school_ext_id: x.school_ext_id,
      }, term));
      const options = hits.length
        ? hits.slice(0, A.RESULT_CAP).map((x) => _opt(x.school_ext_id, x.school_name, `EMIS ${x.emis || ''}`, ''))
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

    // ── teachers, one at a time ──────────────────────────────────────
    //
    // Two data_exchange round trips per change on purpose: a *_lookup/_check
    // step that only READS and renders the plan, then a *_commit step that
    // writes. The coach sees exactly what is about to happen and can back out,
    // which is the whole requirement.

    const _T = () => require('../services/observe/observe-teacher-admin.service');
    const _tdone = (heading, body) => ({ screen: 'TEACHER_DONE', data: { heading, body } });
    const _refuse = (key) => {
      const T = _T();
      return _tdone(S_(_flowLang).flow_action_failed_heading, T.refusalBody(_flowLang, key));
    };

    if (step === 'teacher_school_open') {
      const A = _admin();
      const mine = await A.listMySchools(userId).catch(() => []);
      const options = mine.length
        ? mine.slice(0, A.RESULT_CAP).map((x) => _opt(x.school_ext_id, x.school_name, `EMIS ${x.emis || ''}`, ''))
        : [_opt('none', S_(_flowLang).search_no_match, '', '')];
      return { screen: 'TEACHER_SCHOOL', data: { options } };
    }

    if (step === 'teacher_add_open') {
      const schoolExtId = String((screenData && screenData.school_ext_id) || '');
      if (!schoolExtId || schoolExtId === 'none') return _refuse('school_not_found');
      const A = _admin();
      const mine = await A.listMySchools(userId).catch(() => []);
      const school = mine.find((x) => x.school_ext_id === schoolExtId);
      return {
        screen: 'TEACHER_ADD',
        data: { school_ext_id: schoolExtId, school_name: (school && school.school_name) || '' },
      };
    }

    // READS ONLY. Renders what would happen; writes nothing.
    if (step === 'teacher_add_lookup') {
      const T = _T();
      const schoolExtId = String((screenData && screenData.school_ext_id) || '');
      const plan = await T.planAdd({
        actorLeaderUserId: userId, schoolExtId, rawPhone: screenData && screenData.phone,
      }).catch(() => ({ outcome: 'failed' }));

      if (['invalid_phone', 'ambiguous', 'school_not_found', 'failed'].includes(plan.outcome)) {
        return _refuse(plan.outcome);
      }
      // A teacher nobody knows needs a name, and the coach may not have typed one.
      const typedName = String((screenData && screenData.name) || '').trim();
      if (plan.outcome === 'new' && !typedName) return _refuse('name_required');

      const name = plan.teacherName || typedName;
      return {
        screen: 'TEACHER_CONFIRM',
        data: {
          plan: T.movePlanAck(_flowLang, { ...plan, teacherName: name }),
          school_ext_id: schoolExtId,
          phone: String(plan.phone || ''),
          name,
          confirm_label: clip(S_(_flowLang).teacher_confirm_label || 'Yes, go ahead', 20),
        },
      };
    }

    if (step === 'teacher_add_commit') {
      const T = _T();
      const res = await T.commitAdd({
        actorLeaderUserId: userId,
        schoolExtId: String((screenData && screenData.school_ext_id) || ''),
        rawPhone: screenData && screenData.phone,
        teacherName: screenData && screenData.name,
      }).catch(() => ({ outcome: 'failed' }));

      if (!res.wrote && res.outcome !== 'already_here') return _refuse(res.outcome || 'failed');
      return _tdone(
        S_(_flowLang).teacher_added_heading || 'Done',
        T.movePlanAck(_flowLang, { ...res, outcome: res.outcome === 'move' ? 'move' : 'already_here' }),
      );
    }

    if (step === 'teacher_remove_open') {
      const T = _T();
      const A = _admin();
      const schoolExtId = String((screenData && screenData.school_ext_id) || '');
      const mine = await A.listMySchools(userId).catch(() => []);
      const school = mine.find((x) => x.school_ext_id === schoolExtId);
      const teachers = await T.listTeachersAtSchool(userId, schoolExtId).catch(() => []);
      const options = teachers.length
        ? teachers.slice(0, A.RESULT_CAP).map((t) => _opt(
          t.teacher_ext_id, t.teacher_name, t.level || '', t.teacher_phone_e164 || ''))
        : [_opt('none', S_(_flowLang).search_no_match, '', '')];
      return {
        screen: 'TEACHER_PICK',
        data: {
          options,
          school_ext_id: schoolExtId,
          school_name: (school && school.school_name) || '',
        },
      };
    }

    // READS ONLY — and it is where the coach learns a booked visit will go.
    if (step === 'teacher_remove_check') {
      const T = _T();
      const schoolExtId = String((screenData && screenData.school_ext_id) || '');
      const teacherExtId = String((screenData && screenData.teacher_ext_id) || '');
      if (!teacherExtId || teacherExtId === 'none') return _refuse('not_found');
      const plan = await T.planRemoval({ schoolExtId, teacherExtId }).catch(() => ({ ok: false }));
      if (!plan.ok) return _refuse(plan.reason || 'failed');
      return {
        screen: 'TEACHER_REMOVE_CONFIRM',
        data: {
          plan: T.removalPlanAck(_flowLang, plan),
          school_ext_id: schoolExtId,
          teacher_ext_id: teacherExtId,
        },
      };
    }

    if (step === 'teacher_remove_commit') {
      const T = _T();
      const res = await T.commitRemoval({
        actorLeaderUserId: userId,
        schoolExtId: String((screenData && screenData.school_ext_id) || ''),
        teacherExtId: String((screenData && screenData.teacher_ext_id) || ''),
        reason: (screenData && screenData.reason) || null,
      }).catch(() => ({ ok: false }));
      if (!res.ok) return _refuse(res.reason || 'failed');
      return _tdone(
        S_(_flowLang).teacher_removed_heading || 'Removed',
        T.removedTeacherAck(_flowLang, { teacherName: res.teacherName, schoolName: res.schoolName }),
      );
    }

    if (step === 'teacher_cancel') {
      return _tdone(S_(_flowLang).teacher_cancelled_heading || 'No changes', _T().refusalBody(_flowLang, 'cancelled'));
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
